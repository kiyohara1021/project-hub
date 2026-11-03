import {test,expect,type Page} from "@playwright/test";
import {localSettings,login as dbLogin,adminClient,checked} from "../../scripts/local-supabase.mjs";
const origin="http://127.0.0.1:3101";
async function login(page:Page){await page.goto("/login");await page.getByLabel("メールアドレス").fill("viewer@example.invalid");await page.getByLabel("パスワード",{exact:true}).fill("Local-Demo-Only-2026!");await page.getByRole("button",{name:"ログイン",exact:true}).click();await expect(page).toHaveURL(/\/workspaces$/);}

test("表示名変更APIは本人・入力・Originを検証する",async({page})=>{
  const settings=localSettings(),service=adminClient(settings),actor=await dbLogin(settings,"viewer");const original=checked(await service.from("profiles").select("display_name").eq("id",actor.user.id).single()).display_name;
  try {
    const api="/api/v1/me/profile",headers={origin};await login(page);
    for(const data of [{},{display_name:" "},{display_name:"😀".repeat(81)},{display_name:123},{display_name:"a\u0000b"},{display_name:"変更不可",id:actor.user.id}])expect((await page.request.patch(api,{headers,data})).status()).toBe(400);
    expect((await page.request.patch(api,{headers:{origin:"https://example.invalid"},data:{display_name:"表示名"}})).status()).toBe(403);
    expect((await page.request.patch(api,{headers:{origin,"Content-Type":"text/plain"},data:'{"display_name":"表示名"}'})).status()).toBe(415);
    expect((await page.request.patch(api,{headers,data:{display_name:"x".repeat(33000)}})).status()).toBe(413);
    const result=await page.request.patch(api,{headers,data:{display_name:"　検証用の表示名　"}});expect(result.status()).toBe(200);expect(result.headers()["cache-control"]).toBe("private, no-store");expect((await result.json()).data).toEqual({id:actor.user.id,display_name:"検証用の表示名"});
    await page.context().clearCookies();expect((await page.request.patch(api,{headers,data:{display_name:"表示名"}})).status()).toBe(401);
  }finally{checked(await service.from("profiles").update({display_name:original}).eq("id",actor.user.id));}
});

test("360pxで表示名を変更し、メンバー一覧へ反映・通信失敗後の入力を保持する",async({page})=>{
  const settings=localSettings(),service=adminClient(settings),actor=await dbLogin(settings,"viewer");const original=checked(await service.from("profiles").select("display_name").eq("id",actor.user.id).single()).display_name;
  const member=checked(await service.from("memberships").select("workspace_id").eq("user_id",actor.user.id).limit(1).single());
  try {
    await login(page);await page.setViewportSize({width:360,height:800});const input=page.getByLabel("表示名",{exact:true});await input.fill("表示名を変更した閲覧者");
    let first=true;await page.route("**/api/v1/me/profile",async route=>{if(first){first=false;return route.abort();}return route.continue();});
    await page.getByRole("button",{name:"表示名を保存",exact:true}).click();await expect(page.getByRole("alert")).toContainText("再試行");await expect(input).toHaveValue("表示名を変更した閲覧者");
    await page.getByRole("button",{name:"表示名を保存",exact:true}).click();await expect(page.getByRole("status")).toContainText("表示名を保存しました");await expect(page.getByText("ログイン中: 表示名を変更した閲覧者",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.goto(`/members?workspace=${member.workspace_id}`);await expect(page.getByRole("article",{name:"表示名を変更した閲覧者",exact:true})).toBeVisible();
  }finally{checked(await service.from("profiles").update({display_name:original}).eq("id",actor.user.id));}
});
