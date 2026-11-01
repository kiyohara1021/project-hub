import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSettings, login, checked, adminClient, workspaceA } from "../../scripts/local-supabase.mjs";

test("タスクCRUD、同時再送、全列の順序、権限・アーカイブ・履歴", async () => {
  const settings = localSettings(); const admin = adminClient(settings);
  const owner = await login(settings,"admin"); const member = await login(settings,"member");
  const viewer = await login(settings,"viewer"); const outside = await login(settings,"outside");
  const project = checked(await owner.client.rpc("create_project", { p_workspace_id: workspaceA, p_name: "タスク検証の架空プロジェクト" }));
  const scope = { p_workspace_id: workspaceA, p_project_id: project.id };
  const input = { ...scope, p_title: "タスク検証A", p_description: "架空の説明", p_priority: "high", p_assignee_id: member.user.id, p_due_date: "2026-12-01", p_key: randomUUID() };
  const created = await Promise.all([member.client.rpc("create_task_once",input),member.client.rpc("create_task_once",input)]);
  const a = checked(created[0]); assert.equal(a.id,checked(created[1]).id);
  assert.equal((await member.client.rpc("create_task_once", { ...input,p_title:"異なる本文" })).error?.code,"40001");
  assert.equal((await viewer.client.rpc("create_task_once",input)).error?.code,"42501");
  assert.equal((await outside.client.rpc("create_task_once",input)).error?.code,"42501");
  assert.equal((await member.client.rpc("create_task_once",{ ...input,p_key:randomUUID(),p_assignee_id:outside.user.id })).error?.code,"23503");
  const b = checked(await member.client.rpc("create_task_once",{ ...input,p_title:"タスク検証B",p_key:randomUUID() }));
  const c = checked(await member.client.rpc("create_task_once",{ ...input,p_title:"タスク検証C",p_key:randomUUID() }));
  let moved = checked(await member.client.rpc("move_task",{ ...scope,p_task_id:c.id,p_status:"todo",p_before_id:a.id,p_version:1 }));
  const ordered = checked(await owner.client.from("tasks").select("id,position,version").eq("project_id",project.id).order("position"));
  assert.deepEqual(ordered.map(t=>t.id),[c.id,a.id,b.id]);
  assert.deepEqual(ordered.map(t=>t.position),[1024,2048,3072]);
  assert.equal((await member.client.rpc("move_task",{ ...scope,p_task_id:c.id,p_status:"done",p_before_id:null,p_version:1 })).error?.code,"40001");
  moved = checked(await member.client.rpc("move_task",{ ...scope,p_task_id:c.id,p_status:"doing",p_before_id:null,p_version:moved.version }));
  assert.equal(moved.status,"doing");
  assert.equal((await member.client.rpc("move_task",{ ...scope,p_task_id:c.id,p_status:"done",p_before_id:b.id,p_version:moved.version })).error?.code,"22023");
  const edit = { ...scope,p_task_id:c.id,p_title:"タスク検証C更新",p_description:"更新説明",p_priority:"low",p_assignee_id:null,p_due_date:null,p_version:moved.version };
  const edited = checked(await member.client.rpc("edit_task",edit)); assert.equal(edited.status,"doing");
  assert.equal((await member.client.rpc("edit_task",edit)).error?.code,"40001");
  const otherProject = checked(await owner.client.rpc("create_project", { p_workspace_id:workspaceA,p_name:"別の架空プロジェクト" }));
  assert.equal((await member.client.rpc("delete_task",{ ...scope,p_project_id:otherProject.id,p_task_id:c.id,p_version:edited.version })).error?.code,"P0002");
  assert.equal((await viewer.client.rpc("delete_task",{ ...scope,p_task_id:c.id,p_version:edited.version })).error?.code,"42501");
  checked(await owner.client.rpc("update_project",{ p_workspace_id:workspaceA,p_project_id:project.id,p_name:project.name,p_status:"archived",p_due_date:null,p_version:1 }));
  for (const client of [owner.client,member.client]) {
    assert.equal((await client.rpc("create_task_once",{ ...input,p_key:randomUUID() })).error?.code,"55000");
    assert.equal((await client.rpc("edit_task",{ ...edit,p_version:edited.version })).error?.code,"55000");
    assert.equal((await client.rpc("move_task",{ ...scope,p_task_id:c.id,p_status:"done",p_before_id:null,p_version:edited.version })).error?.code,"55000");
    assert.equal((await client.rpc("delete_task",{ ...scope,p_task_id:c.id,p_version:edited.version })).error?.code,"55000");
  }
  checked(await owner.client.rpc("update_project",{ p_workspace_id:workspaceA,p_project_id:project.id,p_name:project.name,p_status:"active",p_due_date:null,p_version:2 }));
  assert.equal((await member.client.rpc("delete_task",{ ...scope,p_task_id:c.id,p_version:1 })).error?.code,"40001");
  checked(await member.client.rpc("delete_task",{ ...scope,p_task_id:c.id,p_version:edited.version }));
  assert.equal(checked(await viewer.client.from("tasks").select("id").eq("id",c.id)).length,0);
  const logs = checked(await owner.client.from("activity_logs").select("action,actor_id,changes").eq("entity_id",c.id));
  assert.equal(logs.filter(l=>l.action==="DELETE").length,1);
  assert.ok(logs.every(l=>l.actor_id===member.user.id));
  assert.ok(logs.every(l=>!JSON.stringify(l.changes).includes("更新説明")));
  // 編集との競合時、親のアーカイブとタスク更新は同じworkspaceロックで直列化される。
  const current = checked(await admin.from("tasks").select("*").eq("id",a.id))[0];
  const race = await Promise.all([
    owner.client.rpc("update_project",{ p_workspace_id:workspaceA,p_project_id:project.id,p_name:project.name,p_status:"archived",p_due_date:null,p_version:3 }),
    member.client.rpc("edit_task",{ ...edit,p_task_id:a.id,p_version:current.version }),
  ]);
  assert.equal(race[0].error,null);
  assert.ok(!race[1].error || race[1].error.code==="55000");
});
