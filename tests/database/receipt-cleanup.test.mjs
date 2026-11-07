import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  localSettings,
  adminClient,
  login,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

const tables = [
  "project_requests",
  "task_requests",
  "issue_requests",
  "member_requests",
  "comment_requests",
];

test("再送記録の清掃は期限切れ・上限を守り、管理者だけが実行できる", async () => {
  const settings = localSettings();
  const service = adminClient(settings);
  const owner = await login(settings, "admin");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "再送記録の清掃確認",
    }),
  );
  const project = checked(
    await owner.client.rpc("create_project", {
      p_workspace_id: wid,
      p_name: "清掃対象の親プロジェクト",
    }),
  );
  const issue = checked(
    await service
      .from("issues")
      .insert({ workspace_id: wid, project_id: project.id, title: "清掃確認" })
      .select("id")
      .single(),
  );
  const prefix = `purge-${randomUUID()}`;
  const historyBefore = checked(
    await service
      .from("activity_logs")
      .select("id")
      .eq("workspace_id", wid)
      .order("id"),
  );
  try {
    // 同一SQL文のstatement_timestampを期限境界に使うため、境界ぴったりも検査できる。
    localSql(`do $test$
      declare
        target text;
        suffix text;
        expiry timestamptz;
        scope_columns text;
        scope_values text;
        outcome jsonb;
        remaining integer;
      begin
        foreach target in array array['project_requests','task_requests','issue_requests','member_requests','comment_requests'] loop
          scope_columns := 'workspace_id,actor_id,request_key,payload,expires_at';
          scope_values := format('%L::uuid,%L::uuid,$1,''{"fixture":true}''::jsonb,$2','${wid}','${owner.user.id}');
          if target in ('task_requests','issue_requests','comment_requests') then
            scope_columns := scope_columns || ',project_id';
            scope_values := scope_values || format(',%L::uuid','${project.id}');
          end if;
          if target='comment_requests' then
            scope_columns := scope_columns || ',issue_id';
            scope_values := scope_values || format(',%L::uuid','${issue.id}');
          end if;
          scope_columns := scope_columns || case when target='member_requests' then ',response' else ',result' end;
          scope_values := scope_values || ',''{"kept":true}''::jsonb';
          foreach suffix in array array['first','second','boundary','future'] loop
            expiry := case suffix
              when 'first' then '1970-01-01'::timestamptz
              when 'second' then '1970-01-02'::timestamptz
              when 'boundary' then statement_timestamp()
              else statement_timestamp()+interval '1 day' end;
            execute format('insert into private.%I(%s) values(%s)',target,scope_columns,scope_values)
              using '${prefix}-'||suffix,expiry;
          end loop;
        end loop;
        outcome := private.purge_expired_requests(1);
        if (outcome->>'skipped')::boolean then raise exception 'Unexpected skipped cleanup'; end if;
        foreach target in array array['project_requests','task_requests','issue_requests','member_requests','comment_requests'] loop
          if (outcome->'deleted'->>target)::integer<>1 then raise exception 'Cleanup exceeded per-table limit: %',target; end if;
          execute format('select count(*) from private.%I where workspace_id=$1 and request_key=$2',target)
            into remaining using '${wid}'::uuid,'${prefix}-first';
          if remaining<>0 then raise exception 'Oldest expired receipt remains: %',target; end if;
          execute format('select count(*) from private.%I where workspace_id=$1 and request_key like $2',target)
            into remaining using '${wid}'::uuid,'${prefix}-%';
          if remaining<>3 then raise exception 'Limit removed extra receipts: %',target; end if;
        end loop;
        outcome := private.purge_expired_requests(10000);
        foreach target in array array['project_requests','task_requests','issue_requests','member_requests','comment_requests'] loop
          execute format('select count(*) from private.%I where workspace_id=$1 and request_key like $2',target)
            into remaining using '${wid}'::uuid,'${prefix}-%';
          if remaining<>1 then raise exception 'Expiry boundary was not respected: %',target; end if;
          execute format('select count(*) from private.%I where workspace_id=$1 and request_key=$2 and payload=''{"fixture":true}''::jsonb and expires_at>statement_timestamp()',target)
            into remaining using '${wid}'::uuid,'${prefix}-future';
          if remaining<>1 then raise exception 'Valid receipt changed: %',target; end if;
        end loop;
      end;
    $test$;`);
    for (const limit of ["null", "0", "-1", "10001"])
      assert.throws(
        () => localSql(`select private.purge_expired_requests(${limit});`),
        /INVALID_INPUT/,
      );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.throws(
        () =>
          localSql(
            `begin; set local role ${role}; select private.purge_expired_requests(1); rollback;`,
          ),
        /permission denied/,
      );
    const definition = JSON.parse(
      localSql(`select jsonb_build_object(
        'owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
        'anon',has_function_privilege('anon',oid,'execute'),
        'authenticated',has_function_privilege('authenticated',oid,'execute'),
        'service_role',has_function_privilege('service_role',oid,'execute')
      ) from pg_proc where oid='private.purge_expired_requests(integer)'::regprocedure;`),
    );
    assert.equal(definition.owner, "project_hub_owner");
    assert.equal(definition.definer, true);
    assert.ok(definition.config.includes('search_path=""'));
    assert.ok(definition.config.includes("lock_timeout=1s"));
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(definition[role], false);
    assert.equal(
      Number(
        localSql(
          "select count(*) from pg_indexes where schemaname='private' and tablename in ('project_requests','task_requests','issue_requests','member_requests','comment_requests') and indexname like '%requests%cleanup%';",
        ),
      ),
      10,
    );
    assert.deepEqual(
      checked(
        await service
          .from("activity_logs")
          .select("id")
          .eq("workspace_id", wid)
          .order("id"),
      ),
      historyBefore,
    );
    assert.equal(
      checked(
        await service.from("issues").select("id").eq("id", issue.id).single(),
      ).id,
      issue.id,
    );
    // pg_cronのない環境の関数検証と、ジョブ導入済み環境の契約確認を区別する。
    if (
      localSql(
        "select exists(select 1 from pg_extension where extname='pg_cron');",
      ) === "t"
    ) {
      const jobs = JSON.parse(
        localSql(`select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'username',username,'active',active,'command',command) order by jobname),'[]'::jsonb)
          from cron.job where jobname in ('project-hub-expired-requests','project-hub-cron-history');`),
      );
      assert.equal(jobs.length, 2);
      for (const job of jobs) {
        assert.equal(job.username, "postgres");
        assert.equal(job.active, true);
        assert.match(job.command, /statement_timeout='30s'/);
        assert.match(job.command, /lock_timeout='1s'/);
      }
      assert.equal(jobs[0].schedule, "47 2 * * *");
      assert.equal(jobs[1].schedule, "17 * * * *");
      assert.match(
        jobs[0].command,
        /end_time<statement_timestamp\(\)-interval '7 days'/,
      );
      assert.match(jobs[1].command, /private\.purge_expired_requests\(1000\)/);
    }
  } finally {
    for (const table of tables)
      localSql(
        `delete from private.${table} where workspace_id='${wid}'::uuid;`,
      );
    for (const table of ["issues", "projects", "memberships", "activity_logs"])
      checked(await service.from(table).delete().eq("workspace_id", wid));
    checked(await service.from("workspaces").delete().eq("id", wid));
  }
});
