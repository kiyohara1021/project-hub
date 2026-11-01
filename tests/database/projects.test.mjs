import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSettings, login, checked, workspaceA, workspaceB } from "../../scripts/local-supabase.mjs";

test("作成の再送を直列化し、権限・本文違い・更新競合を拒否する", async () => {
  const settings = localSettings();
  const { client } = await login(settings, "admin");
  const key = randomUUID();
  const input = { p_workspace_id: workspaceA, p_name: "再送検証の架空プロジェクト", p_description: "架空の説明", p_due_date: "2026-12-01", p_key: key };
  const results = await Promise.all([client.rpc("create_project_once", input), client.rpc("create_project_once", input)]);
  const first = checked(results[0]); const second = checked(results[1]);
  assert.equal(first.id, second.id);
  assert.equal(first.description, "架空の説明");
  assert.equal(checked(await client.from("activity_logs").select("id").eq("entity_id", first.id)).length, 1);
  assert.equal((await client.rpc("create_project_once", { ...input, p_name: "本文違い" })).error?.code, "40001");
  assert.equal((await client.rpc("create_project_once", { ...input, p_workspace_id: workspaceB })).error?.code, "42501");
  assert.equal((await client.schema("private").from("project_requests").select("*")).data, null);
  for (const alias of ["member", "viewer", "outside", "unassigned"]) {
    const { client: other } = await login(settings, alias);
    assert.equal((await other.rpc("create_project_once", input)).error?.code, "42501");
    assert.equal((await other.rpc("edit_project", { p_workspace_id: workspaceA, p_project_id: first.id, p_name: "不許可", p_description: "", p_status: "active", p_due_date: null, p_version: 1 })).error?.code, "42501");
  }
  const update = { p_workspace_id: workspaceA, p_project_id: first.id, p_name: "再送検証を更新", p_description: "更新説明", p_status: "archived", p_due_date: null, p_version: 1 };
  const changed = checked(await client.rpc("edit_project", update));
  assert.equal(changed.version, 2);
  assert.equal(changed.status, "archived");
  assert.equal((await client.rpc("edit_project", update)).error?.code, "40001");
  const restored = checked(await client.rpc("edit_project", { ...update, p_status: "active", p_version: 2 }));
  assert.equal(restored.version, 3);
  assert.equal(restored.description, "更新説明");
  // 再送は更新後も最初の作成結果を返し、書込は再実行しない。
  assert.equal(checked(await client.rpc("create_project_once", input)).version, 1);
  assert.equal(checked(await client.from("projects").select("version").eq("id", first.id))[0].version, 3);
  const { client: outside } = await login(settings, "outside");
  assert.notEqual(checked(await outside.rpc("create_project_once", { ...input, p_workspace_id: workspaceB })).id, first.id);
});
