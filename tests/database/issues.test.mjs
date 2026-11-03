import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {localSettings,login,checked,workspaceA,workspaceB} from "../../scripts/local-supabase.mjs";

test("課題の再送・状態変更・集計・競合・権限・アーカイブ・削除履歴",async()=>{
  const settings=localSettings();const owner=await login(settings,"admin");const member=await login(settings,"member");const viewer=await login(settings,"viewer");const outside=await login(settings,"outside");const unassigned=await login(settings,"unassigned");
  const anon=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false}});
  const project=checked(await owner.client.rpc("create_project",{p_workspace_id:workspaceA,p_name:"課題検証のテスト用プロジェクト"}));
  const scope={p_workspace_id:workspaceA,p_project_id:project.id};
  const input={...scope,p_title:"課題検証A",p_description:"テスト用の説明",p_priority:"high",p_assignee_id:member.user.id,p_due_date:"2026-12-01",p_key:randomUUID()};
  const count=async()=>checked(await member.client.rpc("read_dashboard",{p_workspace_id:workspaceA})).metrics.open_issues;
  const before=await count();
  assert.equal((await anon.rpc("create_issue_once",input)).error?.code,"42501");
  const results=await Promise.all([member.client.rpc("create_issue_once",input),member.client.rpc("create_issue_once",input)]);
  const issue=checked(results[0]);assert.equal(issue.id,checked(results[1]).id);assert.equal(issue.status,"open");assert.equal(await count(),before+1);
  assert.equal((await member.client.rpc("create_issue_once",{...input,p_title:"異なる内容"})).error?.code,"40001");
  assert.equal((await member.client.rpc("create_issue_once",{...input,p_key:randomUUID(),p_assignee_id:outside.user.id})).error?.code,"23503");
  assert.equal((await member.client.rpc("create_issue_once",{...input,p_workspace_id:workspaceB})).error?.code,"42501");
  for(const client of [viewer.client,outside.client,unassigned.client]) {
    assert.equal((await client.rpc("create_issue_once",input)).error?.code,"42501");
    assert.equal((await client.rpc("edit_issue",{...scope,p_issue_id:issue.id,p_title:"拒否",p_description:"",p_status:"resolved",p_priority:"medium",p_assignee_id:null,p_due_date:null,p_version:1})).error?.code,"42501");
    assert.equal((await client.rpc("delete_issue",{...scope,p_issue_id:issue.id,p_version:1})).error?.code,"42501");
  }
  const edit={...scope,p_issue_id:issue.id,p_title:"課題検証A更新",p_description:"更新説明",p_status:"investigating",p_priority:"low",p_assignee_id:null,p_due_date:null,p_version:1};
  let current=checked(await member.client.rpc("edit_issue",edit));assert.equal(await count(),before+1);
  assert.equal((await member.client.rpc("edit_issue",edit)).error?.code,"40001");
  current=checked(await member.client.rpc("edit_issue",{...edit,p_status:"resolved",p_version:current.version}));assert.equal(await count(),before);
  current=checked(await member.client.rpc("edit_issue",{...edit,p_status:"closed",p_version:current.version}));assert.equal(await count(),before);
  current=checked(await member.client.rpc("edit_issue",{...edit,p_status:"open",p_version:current.version}));assert.equal(await count(),before+1);
  assert.equal((await member.client.rpc("edit_issue",{...edit,p_status:"invalid",p_version:current.version})).error?.code,"23514");
  const other=checked(await owner.client.rpc("create_project",{p_workspace_id:workspaceA,p_name:"別の課題検証プロジェクト"}));
  assert.equal((await member.client.rpc("edit_issue",{...edit,p_project_id:other.id,p_version:current.version})).error?.code,"P0002");
  assert.equal((await member.client.rpc("delete_issue",{...scope,p_project_id:other.id,p_issue_id:issue.id,p_version:current.version})).error?.code,"P0002");
  const competing=await Promise.all([member.client.rpc("edit_issue",{...edit,p_status:"resolved",p_version:current.version}),owner.client.rpc("edit_issue",{...edit,p_status:"investigating",p_version:current.version})]);
  assert.equal(competing.filter(r=>!r.error).length,1);assert.equal(competing.filter(r=>r.error?.code==="40001").length,1);
  current=checked(await member.client.from("issues").select("*").eq("id",issue.id))[0];
  const race=await Promise.all([
    owner.client.rpc("update_project",{p_workspace_id:workspaceA,p_project_id:project.id,p_name:project.name,p_status:"archived",p_due_date:null,p_version:1}),
    member.client.rpc("edit_issue",{...edit,p_status:"open",p_version:current.version}),
  ]);
  assert.equal(race[0].error,null);assert.ok(!race[1].error||race[1].error.code==="55000");
  current=checked(await member.client.from("issues").select("*").eq("id",issue.id))[0];
  for(const client of [owner.client,member.client]) {
    assert.equal((await client.rpc("create_issue_once",{...input,p_key:randomUUID()})).error?.code,"55000");
    assert.equal((await client.rpc("edit_issue",{...edit,p_version:current.version})).error?.code,"55000");
    assert.equal((await client.rpc("delete_issue",{...scope,p_issue_id:issue.id,p_version:current.version})).error?.code,"55000");
  }
  checked(await owner.client.rpc("update_project",{p_workspace_id:workspaceA,p_project_id:project.id,p_name:project.name,p_status:"active",p_due_date:null,p_version:2}));
  assert.equal((await member.client.rpc("delete_issue",{...scope,p_issue_id:issue.id,p_version:1})).error?.code,"40001");
  checked(await member.client.rpc("delete_issue",{...scope,p_issue_id:issue.id,p_version:current.version}));
  assert.equal(checked(await viewer.client.from("issues").select("id").eq("id",issue.id)).length,0);assert.equal(await count(),before);
  const logs=checked(await member.client.from("activity_logs").select("action,actor_id,changes").eq("entity_id",issue.id));
  assert.equal(logs.filter(l=>l.action==="INSERT").length,1);assert.equal(logs.filter(l=>l.action==="DELETE").length,1);
  assert.ok(logs.every(l=>[member.user.id,owner.user.id].includes(l.actor_id)));assert.ok(logs.every(l=>!JSON.stringify(l.changes).includes("更新説明")));
});
