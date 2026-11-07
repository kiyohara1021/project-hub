import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  localSettings,
  login,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

test("Realtimeは現在の閲覧者にだけ最小INSERTを作り、失効通知・権限・保持期間を守る", async () => {
  const settings = localSettings(),
    service = adminClient(settings),
    started = new Date().toISOString();
  const admin = await login(settings, "admin"),
    member = await login(settings, "member"),
    viewer = await login(settings, "viewer");
  const wid = checked(
    await admin.client.rpc("create_workspace", { p_name: "同期の宛先検証" }),
  );
  const users = [admin.user.id, member.user.id, viewer.user.id];
  try {
    checked(
      await service.from("memberships").insert([
        { workspace_id: wid, user_id: member.user.id, role: "member" },
        { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
      ]),
    );
    let hidden = checked(
      await admin.client.rpc("create_project_once", {
        p_workspace_id: wid,
        p_name: "配信しないプロジェクト名",
        p_description: "配信しない説明",
        p_due_date: null,
        p_key: randomUUID(),
        p_visibility: "private",
      }),
    );
    hidden = checked(
      await admin.client.rpc("set_project_access", {
        p_workspace_id: wid,
        p_project_id: hidden.id,
        p_visibility: "private",
        p_member_ids: [member.user.id],
        p_version: hidden.version,
      }),
    );
    const task = checked(
      await admin.client.rpc("create_task_once", {
        p_workspace_id: wid,
        p_project_id: hidden.id,
        p_title: "配信しないタスク名",
        p_description: "秘密の本文",
        p_priority: "medium",
        p_assignee_id: null,
        p_due_date: null,
        p_key: randomUUID(),
      }),
    );
    const marker = new Date().toISOString();
    checked(
      await admin.client.rpc("edit_task", {
        p_workspace_id: wid,
        p_project_id: hidden.id,
        p_task_id: task.id,
        p_title: "配信しない変更後のタスク名",
        p_description: "秘密の本文",
        p_priority: "high",
        p_assignee_id: null,
        p_due_date: null,
        p_version: task.version,
      }),
    );
    const rows = checked(
      await service
        .from("realtime_updates")
        .select("*")
        .gte("created_at", marker)
        .eq("kind", "data"),
    );
    assert.deepEqual(
      [...new Set(rows.map((row) => row.user_id))].sort(),
      [admin.user.id, member.user.id].sort(),
    );
    assert.ok(rows.length > 0);
    assert.ok(
      rows.every(
        (row) =>
          Object.keys(row).sort().join(",") === "created_at,id,kind,user_id",
      ),
    );
    const payload = JSON.stringify(rows);
    for (const value of [wid, hidden.id, task.id, "秘密の本文", "配信しない"])
      assert.ok(!payload.includes(value));
    const own = checked(
      await member.client
        .from("realtime_updates")
        .select("*")
        .gte("created_at", marker),
    );
    assert.ok(
      own.length > 0 && own.every((row) => row.user_id === member.user.id),
    );
    assert.equal(
      checked(
        await viewer.client
          .from("realtime_updates")
          .select("id")
          .gte("created_at", marker),
      ).length,
      0,
    );
    assert.equal(
      checked(
        await member.client
          .from("realtime_updates")
          .select("id")
          .eq("user_id", admin.user.id),
      ).length,
      0,
    );
    assert.ok(
      (
        await member.client
          .from("realtime_updates")
          .insert({ user_id: member.user.id, kind: "data" })
      ).error,
    );
    assert.ok(
      (
        await member.client
          .from("realtime_updates")
          .update({ kind: "access" })
          .eq("id", own[0].id)
      ).error,
    );
    assert.ok(
      (
        await member.client
          .from("realtime_updates")
          .delete()
          .eq("id", own[0].id)
      ).error,
    );
    const anon = createClient(settings.API_URL, settings.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assert.ok((await anon.from("realtime_updates").select("id")).error);

    const revokedAt = new Date().toISOString();
    checked(
      await admin.client.rpc("remove_member", {
        p_workspace_id: wid,
        p_user_id: member.user.id,
      }),
    );
    const revoked = checked(
      await member.client
        .from("realtime_updates")
        .select("kind,user_id")
        .gte("created_at", revokedAt),
    );
    assert.ok(revoked.some((row) => row.kind === "access"));
    assert.equal(
      checked(
        await member.client.from("projects").select("id").eq("id", hidden.id),
      ).length,
      0,
    );
    const secondMarker = new Date().toISOString();
    checked(
      await admin.client.rpc("create_task_once", {
        p_workspace_id: wid,
        p_project_id: hidden.id,
        p_title: "失効後の変更",
        p_description: "",
        p_priority: "low",
        p_assignee_id: null,
        p_due_date: null,
        p_key: randomUUID(),
      }),
    );
    assert.equal(
      checked(
        await member.client
          .from("realtime_updates")
          .select("id")
          .gte("created_at", secondMarker)
          .eq("kind", "data"),
      ).length,
      0,
    );

    const publication = JSON.parse(
      localSql(
        "select jsonb_build_object('all',puballtables,'insert',pubinsert,'update',pubupdate,'delete',pubdelete,'truncate',pubtruncate) from pg_publication where pubname='supabase_realtime';",
      ),
    );
    assert.deepEqual(publication, {
      all: false,
      insert: true,
      update: false,
      delete: false,
      truncate: false,
    });
    assert.equal(
      localSql(
        "select string_agg(schemaname||'.'||tablename,',' order by schemaname,tablename) from pg_publication_tables where pubname='supabase_realtime';",
      ),
      "public.realtime_updates",
    );
    assert.equal(
      localSql(
        "select relreplident from pg_class where oid='public.realtime_updates'::regclass;",
      ),
      "d",
    );
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/202611060019_realtime_updates.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const preflight = migration.match(
      /do \$publication_preflight\$[\s\S]*?\$publication_preflight\$;/,
    )[0];
    for (const setup of [
      "alter publication supabase_realtime add table public.projects;",
      "drop publication supabase_realtime; create publication supabase_realtime for all tables;",
    ])
      assert.throws(
        () => localSql(`begin; ${setup} ${preflight} commit;`),
        /publication is used by other tables/,
      );
    assert.equal(
      localSql(
        "select string_agg(schemaname||'.'||tablename,',' order by schemaname,tablename) from pg_publication_tables where pubname='supabase_realtime';",
      ),
      "public.realtime_updates",
    );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.throws(
        () =>
          localSql(
            `begin; set local role ${role}; select private.purge_realtime_updates(100); rollback;`,
          ),
        /permission denied/,
      );
    for (const limit of ["null", "0", "10001"])
      assert.throws(
        () => localSql(`select private.purge_realtime_updates(${limit});`),
        /INVALID_INPUT/,
      );
    const first = randomUUID(),
      second = randomUUID(),
      boundary = randomUUID(),
      future = randomUUID();
    localSql(`do $retention$
      declare removed integer;
      begin
        insert into public.realtime_updates(id,user_id,kind,created_at) values
          ('${first}','${admin.user.id}','data','1970-01-01'),
          ('${second}','${admin.user.id}','data','1970-01-02'),
          ('${boundary}','${admin.user.id}','data',statement_timestamp()-interval '1 day'),
          ('${future}','${admin.user.id}','data',statement_timestamp()+interval '1 day');
        removed:=private.purge_realtime_updates(1);
        if removed<>1 then raise exception 'Cleanup bound failed'; end if;
        if exists(select 1 from public.realtime_updates where id='${first}') then raise exception 'Oldest expired row remains'; end if;
        if not exists(select 1 from public.realtime_updates where id='${second}') then raise exception 'Cleanup exceeded bound'; end if;
        perform private.purge_realtime_updates(10000);
        if exists(select 1 from public.realtime_updates where id='${second}') then raise exception 'Expired row remains'; end if;
        if (select count(*) from public.realtime_updates where id in ('${boundary}','${future}'))<>2 then raise exception 'Valid rows deleted'; end if;
        delete from public.realtime_updates where id in ('${boundary}','${future}');
      end;
    $retention$;`);
  } finally {
    for (const table of [
      "project_requests",
      "task_requests",
      "issue_requests",
      "comment_requests",
      "member_requests",
    ])
      localSql(`delete from private.${table} where workspace_id='${wid}'`);
    for (const table of [
      "tasks",
      "issues",
      "projects",
      "memberships",
      "activity_logs",
    ])
      checked(await service.from(table).delete().eq("workspace_id", wid));
    checked(await service.from("workspaces").delete().eq("id", wid));
    checked(
      await service
        .from("realtime_updates")
        .delete()
        .in("user_id", users)
        .gte("created_at", started),
    );
  }
});
