import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  localSettings,
  login,
  adminClient,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
function checked(result) {
  if (result.error)
    throw new Error(
      `Invitation fixture RPC failed: ${result.error.code} ${result.error.message}`,
      { cause: result.error },
    );
  return result.data;
}
const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
test("メール招待は現在の確認済みメール・原子承諾・回転・権限・再試行を保護する", async () => {
  const helper = JSON.parse(
    localSql(`select jsonb_build_object(
    'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,
    'arguments',pronargs,'config',proconfig,
    'hub_owner',has_function_privilege('project_hub_owner',oid,'execute'),
    'anon',has_function_privilege('anon',oid,'execute'),
    'authenticated',has_function_privilege('authenticated',oid,'execute'),
    'service_role',has_function_privilege('service_role',oid,'execute')
  ) from pg_proc where oid='private.invitation_verified_email()'::regprocedure;`),
  );
  assert.deepEqual(helper, {
    owner: "postgres",
    definer: true,
    volatility: "s",
    arguments: 0,
    config: ['search_path=""'],
    hub_owner: true,
    anon: false,
    authenticated: false,
    service_role: false,
  });
  for (const role of ["anon", "authenticated", "service_role"])
    assert.throws(
      () =>
        localSql(
          `begin; set local role ${role}; select private.invitation_verified_email(); rollback;`,
        ),
      /permission denied/,
    );
  const settings = localSettings();
  const owner = await login(settings, "admin");
  const target = await login(settings, "unassigned");
  const other = await login(settings, "outside");
  const service = adminClient(settings);
  const wid = checked(
    await owner.client.rpc("create_workspace_once", {
      p_name: "招待テスト用",
      p_key: randomUUID(),
    }),
  ).id;
  const input = {
    p_workspace_id: wid,
    p_email: " UNASSIGNED@example.invalid ",
    p_role: "viewer",
    p_token_hash: hash(),
    p_key: randomUUID(),
  };
  const originalConfirmedAt = localSql(
    `select coalesce(quote_literal(email_confirmed_at),'null') from auth.users where id='${target.user.id}';`,
  );
  let testFailure;
  try {
    const first = checked(
      await owner.client.rpc("prepare_workspace_invitation", input),
    );
    assert.equal(first.email, "unassigned@example.invalid");
    assert.equal(first.replayed, false);
    assert.ok(!("token_hash" in first));
    const replay = checked(
      await owner.client.rpc("prepare_workspace_invitation", {
        ...input,
        p_token_hash: hash(),
      }),
    );
    assert.equal(replay.id, first.id);
    assert.equal(replay.replayed, true);
    assert.equal(
      (
        await owner.client.rpc("prepare_workspace_invitation", {
          ...input,
          p_role: "member",
        })
      ).error.code,
      "40001",
    );
    assert.equal(
      (
        await target.client.rpc("list_workspace_invitations", {
          p_workspace_id: wid,
        })
      ).error.code,
      "42501",
    );
    assert.equal(
      (
        await other.client.rpc("read_workspace_invitation", {
          p_token_hash: input.p_token_hash,
        })
      ).error.code,
      "P0002",
    );
    assert.deepEqual(
      checked(
        await service
          .from("memberships")
          .select("user_id")
          .eq("workspace_id", wid)
          .eq("user_id", target.user.id),
      ),
      [],
    );
    localSql(
      `update auth.users set email_confirmed_at=null where id='${target.user.id}';`,
    );
    assert.equal(
      (
        await target.client.rpc("accept_workspace_invitation", {
          p_token_hash: input.p_token_hash,
        })
      ).error.code,
      "P0002",
    );
    localSql(
      `update auth.users set email_confirmed_at=now() where id='${target.user.id}';`,
    );
    const rotatedHash = hash();
    const update = {
      p_workspace_id: wid,
      p_invitation_id: first.id,
      p_action: "resend",
      p_version: first.version,
      p_token_hash: rotatedHash,
      p_key: randomUUID(),
    };
    const rotated = checked(
      await owner.client.rpc("update_workspace_invitation", update),
    );
    assert.equal(rotated.version, 2);
    assert.equal(
      (
        await target.client.rpc("accept_workspace_invitation", {
          p_token_hash: input.p_token_hash,
        })
      ).error.code,
      "P0002",
    );
    assert.equal(
      (
        await owner.client.rpc("update_workspace_invitation", {
          ...update,
          p_key: randomUUID(),
        })
      ).error.code,
      "40001",
    );
    checked(
      await target.client.rpc("read_workspace_invitation", {
        p_token_hash: rotatedHash,
      }),
    );
    const accepted = await Promise.all(
      [1, 2, 3].map(() =>
        target.client.rpc("accept_workspace_invitation", {
          p_token_hash: rotatedHash,
        }),
      ),
    );
    assert.equal(
      accepted.map(checked).filter((x) => x.membership_created).length,
      1,
    );
    assert.equal(
      checked(
        await service
          .from("memberships")
          .select("role")
          .eq("workspace_id", wid)
          .eq("user_id", target.user.id)
          .single(),
      ).role,
      "viewer",
    );
    checked(
      await service
        .from("memberships")
        .delete()
        .eq("workspace_id", wid)
        .eq("user_id", target.user.id),
    );
    assert.equal(
      checked(
        await target.client.rpc("accept_workspace_invitation", {
          p_token_hash: rotatedHash,
        }),
      ).membership_created,
      false,
    );
    assert.deepEqual(
      checked(
        await service
          .from("memberships")
          .select("user_id")
          .eq("workspace_id", wid)
          .eq("user_id", target.user.id),
      ),
      [],
    );
    const audit = localSql(
      `select coalesce(jsonb_agg(changes),'[]'::jsonb)::text from public.activity_logs where workspace_id='${wid}' and entity_type='workspace_invitations';`,
    );
    assert.ok(!audit.includes("example.invalid"));
    assert.ok(!audit.includes(rotatedHash));
    const second = checked(
      await owner.client.rpc("prepare_workspace_invitation", {
        ...input,
        p_token_hash: hash(),
        p_key: randomUUID(),
      }),
    );
    const cancelled = checked(
      await owner.client.rpc("update_workspace_invitation", {
        ...update,
        p_invitation_id: second.id,
        p_version: second.version,
        p_action: "cancel",
        p_token_hash: null,
        p_key: randomUUID(),
      }),
    );
    assert.equal(cancelled.status, "cancelled");
    const expiringHash = hash();
    const expiring = checked(
      await owner.client.rpc("prepare_workspace_invitation", {
        ...input,
        p_email: "outside@example.invalid",
        p_token_hash: expiringHash,
        p_key: randomUUID(),
      }),
    );
    localSql(
      `update private.workspace_invitations set expires_at=now()-interval '1 second' where id='${expiring.id}';`,
    );
    assert.equal(
      (
        await other.client.rpc("accept_workspace_invitation", {
          p_token_hash: expiringHash,
        })
      ).error.code,
      "P0002",
    );
    const newHash = hash();
    checked(
      await owner.client.rpc("update_workspace_invitation", {
        ...update,
        p_invitation_id: expiring.id,
        p_version: expiring.version,
        p_token_hash: newHash,
        p_key: randomUUID(),
      }),
    );
    // Permission is checked at acceptance time, including the inviter's current role.
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: target.user.id, role: "admin" }),
    );
    localSql(
      `update public.memberships set role='member' where workspace_id='${wid}' and user_id='${owner.user.id}';`,
    );
    assert.equal(
      (
        await other.client.rpc("accept_workspace_invitation", {
          p_token_hash: newHash,
        })
      ).error.code,
      "P0002",
    );
    localSql(
      `update public.memberships set role='admin' where workspace_id='${wid}' and user_id='${owner.user.id}';`,
    );
    checked(
      await service
        .from("memberships")
        .delete()
        .eq("workspace_id", wid)
        .eq("user_id", target.user.id),
    );
    const selfHash = hash();
    checked(
      await owner.client.rpc("prepare_workspace_invitation", {
        ...input,
        p_email: "admin@example.invalid",
        p_token_hash: selfHash,
        p_key: randomUUID(),
      }),
    );
    checked(
      await owner.client.rpc("accept_workspace_invitation", {
        p_token_hash: selfHash,
      }),
    );
    assert.equal(
      checked(
        await service
          .from("memberships")
          .select("role")
          .eq("workspace_id", wid)
          .eq("user_id", owner.user.id)
          .single(),
      ).role,
      "admin",
    );
  } catch (error) {
    testFailure = error;
    throw error;
  } finally {
    try {
      localSql(`begin;
        update auth.users set email_confirmed_at=${originalConfirmedAt} where id='${target.user.id}';
        delete from private.invitation_requests where workspace_id='${wid}';
        delete from private.workspace_requests where workspace_id='${wid}';
        delete from private.workspace_invitations where workspace_id='${wid}';
        delete from public.memberships where workspace_id='${wid}';
        delete from public.activity_logs where workspace_id='${wid}';
        delete from public.workspaces where id='${wid}';
        commit;`);
    } catch (cleanupError) {
      if (testFailure)
        throw new AggregateError(
          [testFailure, cleanupError],
          "Invitation test and fixture cleanup failed",
        );
      throw cleanupError;
    }
  }
});
