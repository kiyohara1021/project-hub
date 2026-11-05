import test from "node:test";
import assert from "node:assert/strict";
import {
  localSettings,
  adminClient,
  login,
  checked,
} from "../../scripts/local-supabase.mjs";
test("所属管理の競合・最後の管理者・担当解除・監査・権限", async () => {
  const settings = localSettings(),
    service = adminClient(settings);
  const owner = await login(settings, "admin"),
    member = await login(settings, "member"),
    viewer = await login(settings, "viewer"),
    outside = await login(settings, "outside");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "所属検証のテスト用スペース",
    }),
  );
  checked(
    await service.from("memberships").insert([
      { workspace_id: wid, user_id: member.user.id, role: "member" },
      { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
    ]),
  );
  const args = {
    p_workspace_id: wid,
    p_user_id: member.user.id,
    p_role: "viewer",
    p_version: 1,
    p_remove: false,
  };
  for (const actor of [member, viewer, outside])
    assert.equal(
      (await actor.client.rpc("change_member", args)).error?.code,
      "42501",
    );
  assert.equal(
    (
      await owner.client.rpc("change_member", {
        ...args,
        p_user_id: owner.user.id,
        p_role: "member",
      })
    ).error?.message,
    "LAST_ADMIN",
  );
  const results = await Promise.all([
    owner.client.rpc("change_member", args),
    owner.client.rpc("change_member", { ...args, p_role: "admin" }),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.find((r) => r.error).error.code, "40001");
  assert.equal(
    (
      await owner.client.rpc("change_member", {
        ...args,
        p_version: 2,
        p_role: "invalid",
      })
    ).error?.code,
    "22023",
  );
  const pid = checked(
    await owner.client.rpc("create_project", {
      p_workspace_id: wid,
      p_name: "担当解除のテスト用プロジェクト",
    }),
  ).id;
  const task = checked(
    await service
      .from("tasks")
      .insert({
        workspace_id: wid,
        project_id: pid,
        title: "テスト用タスク",
        assignee_id: member.user.id,
      })
      .select()
      .single(),
  );
  const issue = checked(
    await service
      .from("issues")
      .insert({
        workspace_id: wid,
        project_id: pid,
        title: "テスト用課題",
        assignee_id: member.user.id,
      })
      .select()
      .single(),
  );
  checked(
    await owner.client.rpc("change_member", {
      ...args,
      p_role: null,
      p_version: 2,
      p_remove: true,
    }),
  );
  for (const [table, row] of [
    ["tasks", task],
    ["issues", issue],
  ]) {
    const current = checked(
      await service
        .from(table)
        .select("assignee_id,version")
        .eq("id", row.id)
        .single(),
    );
    assert.equal(current.assignee_id, null);
    assert.equal(current.version, row.version + 1);
  }
  assert.equal(
    checked(
      await member.client.from("projects").select("id").eq("workspace_id", wid),
    ).length,
    0,
  );
  const events = checked(
    await owner.client
      .from("activity_logs")
      .select("action,entity_type")
      .eq("workspace_id", wid),
  );
  assert.ok(
    events.some(
      (e) => e.entity_type === "memberships" && e.action === "DELETE",
    ),
  );
  assert.equal(
    (await owner.client.rpc("change_member", { ...args, p_version: 2 })).error
      ?.code,
    "P0002",
  );
  checked(await service.from("issues").delete().eq("workspace_id", wid));
  checked(await service.from("tasks").delete().eq("workspace_id", wid));
  checked(await service.from("projects").delete().eq("workspace_id", wid));
  checked(await service.from("memberships").delete().eq("workspace_id", wid));
  checked(await service.from("activity_logs").delete().eq("workspace_id", wid));
  checked(await service.from("workspaces").delete().eq("id", wid));
});
