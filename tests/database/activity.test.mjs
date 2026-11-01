import test from "node:test";
import assert from "node:assert/strict";
import {localSql} from "../../scripts/local-sql.mjs";
import {randomUUID} from "node:crypto";
import {localSettings,login,adminClient,checked} from "../../scripts/local-supabase.mjs";

test("履歴のスナップショット・削除後の保持・所属分離・直接改ざん拒否",async()=>{
  const settings=localSettings(),service=adminClient(settings);
  const owner=await login(settings,"admin"),member=await login(settings,"member"),viewer=await login(settings,"viewer"),outside=await login(settings,"outside");
  const wid=checked(await owner.client.rpc("create_workspace",{p_name:"履歴検証の架空スペース"}));
  try{
    checked(await service.from("memberships").insert([{workspace_id:wid,user_id:member.user.id,role:"member"},{workspace_id:wid,user_id:viewer.user.id,role:"viewer"}]));
    const project=checked(await owner.client.rpc("create_project",{p_workspace_id:wid,p_name:"履歴検証の架空プロジェクト"}));
    const args={p_workspace_id:wid,p_project_id:project.id,p_title:"履歴の架空タスク",p_description:"記録しない架空本文",p_priority:"high",p_assignee_id:null,p_due_date:null,p_key:randomUUID()};
    const task=checked(await member.client.rpc("create_task_once",args));
    const before=checked(await owner.client.from("activity_logs").select("id").eq("workspace_id",wid));
    assert.equal((await member.client.rpc("edit_task",{p_workspace_id:wid,p_project_id:project.id,p_task_id:task.id,p_title:args.p_title,p_description:args.p_description,p_priority:"low",p_assignee_id:null,p_due_date:null,p_version:99})).error?.code,"40001");
    assert.equal(checked(await owner.client.from("activity_logs").select("id").eq("workspace_id",wid)).length,before.length);
    checked(await member.client.rpc("delete_task",{p_workspace_id:wid,p_project_id:project.id,p_task_id:task.id,p_version:task.version}));
    checked(await owner.client.rpc("remove_member",{p_workspace_id:wid,p_user_id:member.user.id}));
    checked(await service.from("profiles").update({display_name:"デモメンバー02改名検証"}).eq("id",member.user.id));
    const logs=checked(await viewer.client.from("activity_logs").select("*").eq("workspace_id",wid).eq("actor_id",member.user.id));
    assert.equal(logs.length,2);assert.ok(logs.every(e=>e.actor_display_name==="デモメンバー02"));assert.ok(logs.some(e=>e.entity_id===task.id&&e.action==="DELETE"));assert.ok(logs.every(e=>!JSON.stringify(e.changes).includes(args.p_description)));
    for(const actor of [owner,viewer]){
      const row=logs[0];assert.ok((await actor.client.from("activity_logs").insert({...row,id:randomUUID()})).error);
      assert.ok((await actor.client.from("activity_logs").update({actor_display_name:"偽造"}).eq("id",row.id)).error);
      assert.ok((await actor.client.from("activity_logs").delete().eq("id",row.id)).error);
    }
    for(const actor of [member,outside])assert.equal(checked(await actor.client.from("activity_logs").select("id").eq("workspace_id",wid)).length,0);
    localSql(`delete from private.task_requests where workspace_id='${wid}'`);
    checked(await service.from("projects").delete().eq("id",project.id));
    assert.equal(checked(await viewer.client.from("activity_logs").select("id").eq("workspace_id",wid).eq("project_id",project.id)).length,4);
  }finally{
    checked(await service.from("profiles").update({display_name:"デモメンバー02"}).eq("id",member.user.id));
    localSql(`delete from private.task_requests where workspace_id='${wid}'`);
    for(const table of ["tasks","issues","projects","memberships","activity_logs"])checked(await service.from(table).delete().eq("workspace_id",wid));
    checked(await service.from("workspaces").delete().eq("id",wid));
  }
});
