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

test("ワークスペース作成は本人admin・再送原子性・本文競合と所属境界を維持する", async () => {
  const settings = localSettings();
  const owner = await login(settings, "unassigned");
  const other = await login(settings, "outside");
  const service = adminClient(settings);
  const key = randomUUID();
  const args = { p_name: "  新しい作業場所  ", p_key: key };
  const created = await Promise.all(
    Array.from({ length: 3 }, () =>
      owner.client.rpc("create_workspace_once", args),
    ),
  );
  const first = checked(created[0]);
  const wid = first.id;
  try {
    created.forEach((result) => assert.deepEqual(checked(result), first));
    assert.equal(first.name, "新しい作業場所");
    assert.deepEqual(
      checked(
        await owner.client
          .from("memberships")
          .select("user_id,role")
          .eq("workspace_id", wid),
      ),
      [{ user_id: owner.user.id, role: "admin" }],
    );
    assert.equal(
      (
        await owner.client.rpc("create_workspace_once", {
          ...args,
          p_name: "別の名前",
        })
      ).error.code,
      "40001",
    );
    assert.deepEqual(
      checked(await other.client.from("workspaces").select("id").eq("id", wid)),
      [],
    );
    for (const name of ["", " ", "あ".repeat(121)])
      assert.equal(
        (
          await owner.client.rpc("create_workspace_once", {
            p_name: name,
            p_key: randomUUID(),
          })
        ).error.code,
        "22023",
      );
    assert.ok(
      (
        await owner.client.rpc("create_workspace_once", {
          p_name: "確認",
          p_key: "",
        })
      ).error,
    );
    assert.ok(
      (await owner.client.from("workspaces").insert({ name: "直接書込" }))
        .error,
    );
    assert.equal(
      Number(
        localSql(
          `select count(*) from private.workspace_requests where actor_id='${owner.user.id}' and request_key='${key}';`,
        ),
      ),
      1,
    );
    // Existing record cannot be replayed after the creator loses membership.
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: other.user.id, role: "admin" }),
    );
    checked(
      await service
        .from("memberships")
        .delete()
        .eq("workspace_id", wid)
        .eq("user_id", owner.user.id),
    );
    assert.equal(
      (await owner.client.rpc("create_workspace_once", args)).error.code,
      "P0002",
    );
    localSql(
      `update private.workspace_requests set expires_at='1970-01-01' where actor_id='${owner.user.id}' and request_key='${key}'; select private.purge_expired_requests(1000);`,
    );
    assert.equal(
      Number(
        localSql(
          `select count(*) from private.workspace_requests where actor_id='${owner.user.id}' and request_key='${key}';`,
        ),
      ),
      0,
    );
    assert.equal(
      checked(await service.from("workspaces").select("id").eq("id", wid))
        .length,
      1,
    );
    assert.ok(
      checked(
        await service
          .from("activity_logs")
          .select("id")
          .eq("workspace_id", wid),
      ).length > 0,
    );
  } finally {
    localSql(
      `delete from private.workspace_requests where workspace_id='${wid}'; delete from public.memberships where workspace_id='${wid}'; delete from public.activity_logs where workspace_id='${wid}'; delete from public.workspaces where id='${wid}';`,
    );
  }
});
