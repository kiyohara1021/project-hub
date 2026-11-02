import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {localSettings,adminClient,login,checked,workspaceA} from "../../scripts/local-supabase.mjs";
import {localSql} from "../../scripts/local-sql.mjs";

test("担当件数は全件DB集計し、状態・アーカイブ・所属・権限とページ境界を維持",async()=>{
 const settings=localSettings(),service=adminClient(settings);
 const [owner,member,viewer,outside]=await Promise.all(["admin","member","viewer","outside"].map(alias=>login(settings,alias)));
 const anon=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false}});
 assert.equal((await anon.rpc("read_members",{p_workspace_id:workspaceA})).error?.code,"42501");
 assert.equal(localSql("select prosecdef,provolatile from pg_proc where oid='public.read_members(uuid,text,uuid,integer)'::regprocedure"),"f|s");
 const wid=checked(await owner.client.rpc("create_workspace",{p_name:"担当数検証の架空スペース"}));
 const otherWid=checked(await owner.client.rpc("create_workspace",{p_name:"担当数分離検証の架空スペース"}));
 try{
  checked(await service.from("memberships").insert([{workspace_id:wid,user_id:member.user.id,role:"member"},{workspace_id:wid,user_id:viewer.user.id,role:"viewer"},{workspace_id:otherWid,user_id:member.user.id,role:"member"}]));
  const args={p_workspace_id:wid};
  const empty=checked(await member.client.rpc("read_members",args));assert.equal(empty.data.length,3);assert.ok(empty.data.every(m=>m.task_count===0&&m.issue_count===0));
  const [active,planned,archived,other]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  checked(await service.from("projects").insert([
   {id:active,workspace_id:wid,name:"担当数検証の架空プロジェクト",status:"active"},
   {id:planned,workspace_id:wid,name:"計画中の架空プロジェクト",status:"planned"},
   {id:archived,workspace_id:wid,name:"保管済みの架空プロジェクト",status:"archived"},
   {id:other,workspace_id:otherWid,name:"別所属の架空プロジェクト",status:"active"},
  ]));
  for(const table of ["tasks","issues"]){
   for(let start=0;start<1001;start+=400)checked(await service.from(table).insert(Array.from({length:Math.min(400,1001-start)},(_,i)=>({workspace_id:wid,project_id:active,title:`担当数検証の架空項目${start+i}`,status:table==="tasks"?"doing":"open",assignee_id:member.user.id}))));
   const included=table==="tasks"?["todo","review"]:["investigating"];
   const excluded=table==="tasks"?["done"]:["resolved","closed"];
   checked(await service.from(table).insert([
    ...included.map(status=>({workspace_id:wid,project_id:planned,title:"計画中の架空担当",status,assignee_id:member.user.id})),
    ...excluded.map(status=>({workspace_id:wid,project_id:active,title:"完了済みの架空担当",status,assignee_id:member.user.id})),
    {workspace_id:wid,project_id:archived,title:"保管済みの架空担当",status:table==="tasks"?"todo":"open",assignee_id:member.user.id},
    {workspace_id:otherWid,project_id:other,title:"別所属の架空担当",status:table==="tasks"?"todo":"open",assignee_id:member.user.id},
    {workspace_id:wid,project_id:active,title:"未割当の架空項目",status:table==="tasks"?"todo":"open",assignee_id:null},
   ]));
  }
  for(const actor of [owner,member,viewer]){
   const result=checked(await actor.client.rpc("read_members",args));
   const assigned=result.data.find(m=>m.user_id===member.user.id);assert.equal(assigned.task_count,1003);assert.equal(assigned.issue_count,1002);
   assert.ok(result.data.filter(m=>m.user_id!==member.user.id).every(m=>m.task_count===0&&m.issue_count===0));
  }
  assert.equal((await outside.client.rpc("read_members",args)).error?.code,"P0002");
  assert.equal((await outside.client.rpc("read_members",{p_workspace_id:randomUUID()})).error?.code,"P0002");
  for(const invalid of [{p_role:"invalid"},{p_limit:0},{p_limit:101},{p_limit:null}])assert.equal((await owner.client.rpc("read_members",{...args,...invalid})).error?.code,"22023");
  const filtered=checked(await owner.client.rpc("read_members",{...args,p_role:"member",p_limit:1}));assert.equal(filtered.data[0].user_id,member.user.id);assert.equal(filtered.data[0].task_count,1003);assert.equal(filtered.nextCursor,null);
  let cursor=null;const seen=[];
  do{const result=checked(await viewer.client.rpc("read_members",{...args,p_limit:1,p_cursor:cursor}));seen.push(...result.data.map(m=>m.user_id));cursor=result.nextCursor;}while(cursor);
  assert.deepEqual(seen,[owner.user.id,member.user.id,viewer.user.id].sort());
  // SELECT権限の剥奪はRPCにも効く。所有者権限で集計しない。
  try{localSql("revoke select on public.tasks from authenticated");assert.equal((await viewer.client.rpc("read_members",args)).error?.code,"42501");}
  finally{localSql("grant select on public.tasks to authenticated");}
 }finally{
  for(const id of [wid,otherWid]){
   for(const table of ["tasks","issues","projects","memberships","activity_logs"])checked(await service.from(table).delete().eq("workspace_id",id));
   checked(await service.from("workspaces").delete().eq("id",id));
  }
 }
});
