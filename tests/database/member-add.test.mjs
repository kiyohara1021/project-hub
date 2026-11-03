import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {localSettings,adminClient,login,checked} from "../../scripts/local-supabase.mjs";
import {localSql} from "../../scripts/local-sql.mjs";

test("所属追加は管理者限定で原子的・再送可能、既存の権限を維持",async()=>{
  const settings=localSettings(),service=adminClient(settings);
  const owner=await login(settings,"admin"),member=await login(settings,"member"),viewer=await login(settings,"viewer"),outside=await login(settings,"outside"),target=await login(settings,"unassigned");
  const anon=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false}});
  const wid=checked(await owner.client.rpc("create_workspace",{p_name:"所属追加検証のテスト用スペース"}));
  try {
    checked(await service.from("memberships").insert([{workspace_id:wid,user_id:member.user.id,role:"member"},{workspace_id:wid,user_id:viewer.user.id,role:"viewer"}]));
    const args={p_workspace_id:wid,p_user_id:target.user.id,p_role:"viewer",p_key:randomUUID()};
    for(const actor of [member,viewer,outside])assert.equal((await actor.client.rpc("add_member_once",args)).error?.code,"42501");
    assert.ok((await anon.rpc("add_member_once",args)).error);
    assert.equal(checked(await owner.client.from("profiles").select("id").eq("id",target.user.id)).length,0);
    assert.ok((await owner.client.from("memberships").insert({workspace_id:wid,user_id:target.user.id,role:"viewer"})).error);
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_role:"invalid"})).error?.code,"22023");
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_user_id:randomUUID()})).error?.code,"P0002");
    for(const key of [null,"","a".repeat(129),"bad key"])assert.equal((await owner.client.rpc("add_member_once",{...args,p_key:key})).error?.code,"22023");
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_user_id:null})).error?.code,"22023");
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_role:null})).error?.code,"22023");
    assert.throws(()=>localSql("begin; set local role authenticated; select * from private.member_requests; rollback;"));
    assert.equal(localSql(`select count(*) from private.member_requests where workspace_id='${wid}'`),"0");
    assert.equal(checked(await owner.client.from("activity_logs").select("id").eq("workspace_id",wid).eq("entity_id",target.user.id)).length,0);
    const concurrent=await Promise.all([owner.client.rpc("add_member_once",args),owner.client.rpc("add_member_once",args)]);
    const created=checked(concurrent[0]);assert.deepEqual(checked(concurrent[1]),created);assert.equal(created.version,1);assert.equal(created.role,"viewer");
    assert.equal(checked(await target.client.from("workspaces").select("id").eq("id",wid)).length,1);
    assert.equal(checked(await owner.client.from("profiles").select("id").eq("id",target.user.id)).length,1);
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_role:"admin"})).error?.message,"IDEMPOTENCY_CONFLICT");
    assert.equal((await owner.client.rpc("add_member_once",{...args,p_key:randomUUID(),p_role:"admin"})).error?.message,"ALREADY_MEMBER");
    const logs=()=>owner.client.from("activity_logs").select("id,changes,actor_id").eq("workspace_id",wid).eq("entity_type","memberships").eq("entity_id",target.user.id).eq("action","INSERT");
    const events=checked(await logs());assert.equal(events.length,1);assert.equal(events[0].actor_id,owner.user.id);assert.equal(events[0].changes.after.role,"viewer");
    checked(await owner.client.rpc("change_member",{p_workspace_id:wid,p_user_id:target.user.id,p_role:"member",p_version:1,p_remove:false}));
    assert.deepEqual(checked(await owner.client.rpc("add_member_once",args)),created);
    assert.equal(checked(await owner.client.from("memberships").select("role,version").eq("workspace_id",wid).eq("user_id",target.user.id).single()).role,"member");
    checked(await owner.client.rpc("change_member",{p_workspace_id:wid,p_user_id:target.user.id,p_role:null,p_version:2,p_remove:true}));
    assert.deepEqual(checked(await owner.client.rpc("add_member_once",args)),created);
    assert.equal(checked(await target.client.from("workspaces").select("id").eq("id",wid)).length,0);
    localSql(`update private.member_requests set expires_at=clock_timestamp()-interval '1 second' where workspace_id='${wid}'`);
    assert.equal(checked(await owner.client.rpc("add_member_once",args)).version,1);
    assert.equal(checked(await logs()).length,2);
    checked(await owner.client.rpc("change_member",{p_workspace_id:wid,p_user_id:target.user.id,p_role:null,p_version:1,p_remove:true}));
    const different=await Promise.all([owner.client.rpc("add_member_once",{...args,p_key:randomUUID()}),owner.client.rpc("add_member_once",{...args,p_key:randomUUID()})]);
    assert.equal(different.filter(r=>!r.error).length,1);assert.equal(different.find(r=>r.error).error.message,"ALREADY_MEMBER");
    // 再送時にも権限を再検査する。
    checked(await owner.client.rpc("set_member_role",{p_workspace_id:wid,p_user_id:member.user.id,p_role:"admin"}));
    checked(await member.client.rpc("set_member_role",{p_workspace_id:wid,p_user_id:owner.user.id,p_role:"member"}));
    assert.equal((await owner.client.rpc("add_member_once",args)).error?.code,"42501");
    assert.equal((await member.client.rpc("change_member",{p_workspace_id:wid,p_user_id:member.user.id,p_role:null,p_version:2,p_remove:true})).error?.message,"LAST_ADMIN");
  } finally {
    localSql(`delete from private.member_requests where workspace_id='${wid}'`);
    for(const table of ["memberships","activity_logs"])checked(await service.from(table).delete().eq("workspace_id",wid));
    checked(await service.from("workspaces").delete().eq("id",wid));
  }
});
