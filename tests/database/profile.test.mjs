import test from "node:test";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
import {localSettings,login,adminClient,checked} from "../../scripts/local-supabase.mjs";

test("表示名は本人だけが1〜80文字で変更でき、他人の行や直接更新は変えられない",async()=>{
  const settings=localSettings(),service=adminClient(settings);
  const member=await login(settings,"member"),viewer=await login(settings,"viewer");
  const original=checked(await service.from("profiles").select("display_name").eq("id",member.user.id).single()).display_name;
  try{
    const updated=checked(await member.client.rpc("update_my_profile",{p_display_name:"  表示名検証の架空メンバー  "}));
    assert.equal(updated.id,member.user.id);assert.equal(updated.display_name,"表示名検証の架空メンバー");
    // 同じワークスペースのメンバーには新しい名前が見える
    assert.equal(checked(await viewer.client.from("profiles").select("display_name").eq("id",member.user.id).single()).display_name,"表示名検証の架空メンバー");
    for(const name of [""," ","あ".repeat(81),null])assert.equal((await member.client.rpc("update_my_profile",{p_display_name:name})).error?.code,"22023");
    assert.ok(checked(await member.client.rpc("update_my_profile",{p_display_name:"あ".repeat(80)})));
    // 直接のUPDATEは権限がなく、他人の名前は変わらない
    assert.ok((await viewer.client.from("profiles").update({display_name:"乗っ取り"}).eq("id",member.user.id)).error);
    assert.equal(checked(await service.from("profiles").select("display_name").eq("id",member.user.id).single()).display_name,"あ".repeat(80));
    // 未ログインでは呼べない
    const anon=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    assert.ok((await anon.rpc("update_my_profile",{p_display_name:"匿名"})).error);
  }finally{
    checked(await service.from("profiles").update({display_name:original}).eq("id",member.user.id));
  }
});
