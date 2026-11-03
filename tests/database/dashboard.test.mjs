import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localSettings, adminClient, login, checked, workspaceA } from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

test("日本時間の境界とSECURITY INVOKERを固定する",()=>{
  assert.equal(localSql("select private.dashboard_day('2026-11-01 14:59:59+00'::timestamptz),private.dashboard_day('2026-11-01 15:00:00+00'::timestamptz)"),"2026-11-01|2026-11-02");
  assert.equal(localSql("select prosecdef,provolatile from pg_proc where oid='public.read_dashboard(uuid)'::regprocedure"),"f|s");
});

test("1000行超の集計、重み付き進捗、境界日、0件、所属と本人の分離",async()=>{
  const settings=localSettings(); const admin=adminClient(settings);
  const owner=await login(settings,"admin"); const member=await login(settings,"member"); const viewer=await login(settings,"viewer"); const outside=await login(settings,"outside");
  const anon=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false}});
  assert.equal((await anon.rpc("read_dashboard",{p_workspace_id:workspaceA})).error?.code,"42501");
  const wid=checked(await owner.client.rpc("create_workspace",{p_name:"集計検証デモスペース"}));
  try {
    checked(await admin.from("memberships").insert([{workspace_id:wid,user_id:member.user.id,role:"member"},{workspace_id:wid,user_id:viewer.user.id,role:"viewer"}]));
    const empty=checked(await member.client.rpc("read_dashboard",{p_workspace_id:wid}));
    assert.deepEqual(empty.metrics,{active_projects:0,task_total:0,task_done:0,completion_percent:0,overdue_tasks:0,open_issues:0});
    assert.deepEqual(empty.projects,[]); assert.deepEqual(empty.my_tasks,[]);
    const day=empty.today; const yesterday=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
    const ids=[randomUUID(),randomUUID(),randomUUID()];
    checked(await admin.from("projects").insert([
      {id:ids[0],workspace_id:wid,name:"集計用のテスト用プロジェクト",status:"active"},
      {id:ids[1],workspace_id:wid,name:"0件のテスト用プロジェクト",status:"planned"},
      {id:ids[2],workspace_id:wid,name:"除外するテスト用プロジェクト",status:"archived"},
    ]));
    // 1001件をSQL側で集計。HTTPの行数上限1000を越えても全件を数える。
    for(let start=0;start<1001;start+=400) {
      const rows=Array.from({length:Math.min(400,1001-start)},(_,offset)=>{
        const index=start+offset;
        return {workspace_id:wid,project_id:ids[0],title:`集計用のテスト用タスク${index}`,status:index<500?"done":"doing",assignee_id:index>=500?member.user.id:null,due_date:index===500?yesterday:index===501?day:null};
      });
      checked(await admin.from("tasks").insert(rows));
    }
    checked(await admin.from("tasks").insert({workspace_id:wid,project_id:ids[2],title:"集計しないテスト用タスク",status:"todo",assignee_id:member.user.id,due_date:yesterday}));
    checked(await admin.from("issues").insert([
      {workspace_id:wid,project_id:ids[0],title:"未解決のテスト用課題",status:"open"},
      {workspace_id:wid,project_id:ids[0],title:"調査中のテスト用課題",status:"investigating"},
      {workspace_id:wid,project_id:ids[0],title:"解決済みのテスト用課題",status:"resolved"},
      {workspace_id:wid,project_id:ids[0],title:"終了したテスト用課題",status:"closed"},
      {workspace_id:wid,project_id:ids[2],title:"除外するテスト用課題",status:"open"},
    ]));
    const data=checked(await member.client.rpc("read_dashboard",{p_workspace_id:wid}));
    assert.deepEqual(data.metrics,{active_projects:1,task_total:1001,task_done:500,completion_percent:50,overdue_tasks:1,open_issues:2});
    assert.equal(data.today,new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date(data.as_of)));
    assert.equal(data.projects.length,2);
    assert.equal(data.projects.find(p=>p.id===ids[0]).completion_percent,50);
    assert.equal(data.projects.find(p=>p.id===ids[1]).completion_percent,0);
    assert.equal(data.my_tasks.length,5); assert.equal(data.my_tasks[0].due_date,yesterday); assert.equal(data.my_tasks[1].due_date,day);
    assert.ok(data.my_tasks.every(t=>t.status!=="done" && t.project_id===ids[0]));
    assert.equal(data.recent_activity.length,5); assert.ok(data.recent_activity.every(a=>!("changes" in a)));
    assert.equal(checked(await viewer.client.rpc("read_dashboard",{p_workspace_id:wid})).my_tasks.length,0);
    assert.equal(checked(await owner.client.rpc("read_dashboard",{p_workspace_id:wid})).metrics.task_total,1001);
    assert.equal((await outside.client.rpc("read_dashboard",{p_workspace_id:wid})).error?.code,"P0002");
    assert.equal((await outside.client.rpc("read_dashboard",{p_workspace_id:randomUUID()})).error?.code,"P0002");
    // 所属を外した直後は同じJWTでも集計を返さない。
    checked(await owner.client.rpc("remove_member",{p_workspace_id:wid,p_user_id:member.user.id}));
    assert.equal((await member.client.rpc("read_dashboard",{p_workspace_id:wid})).error?.code,"P0002");
  } finally {
    checked(await admin.from("tasks").delete().eq("workspace_id",wid));
    checked(await admin.from("issues").delete().eq("workspace_id",wid));
    checked(await admin.from("projects").delete().eq("workspace_id",wid));
    checked(await admin.from("memberships").delete().eq("workspace_id",wid));
    checked(await admin.from("activity_logs").delete().eq("workspace_id",wid));
    checked(await admin.from("workspaces").delete().eq("id",wid));
  }
});
