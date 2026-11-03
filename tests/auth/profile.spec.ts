import {test,expect,type Page} from "@playwright/test";
import {localSettings,adminClient,checked} from "../../scripts/local-supabase.mjs";
const wid="11111111-1111-4111-8111-111111111111",origin="http://127.0.0.1:3101";
async function login(page:Page,alias:string){await page.goto("/login");await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);await page.getByLabel("パスワード",{exact:true}).fill("Local-Demo-Only-2026!");await page.getByRole("button",{name:"ログイン",exact:true}).click();await expect(page).toHaveURL(/\/workspaces$/);}
test("本人が表示名を変更でき、メンバー一覧に反映され、APIは入力と境界を検証する",async({page})=>{
 const service=adminClient(localSettings());
 await login(page,"member");
 const original=(await page.getByLabel("表示名",{exact:true}).inputValue());
 try{
  await page.getByLabel("表示名",{exact:true}).fill("表示名E2Eの架空メンバー");await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("表示名を保存しました");await expect(page.getByText("ログイン中: 表示名E2Eの架空メンバー")).toBeVisible();
  await page.goto(`/members?workspace=${wid}`);await expect(page.getByRole("article",{name:"表示名E2Eの架空メンバー",exact:true})).toContainText("（自分）");
  const url="/api/v1/me/profile";
  expect((await page.request.patch(url,{headers:{origin},data:{display_name:"あ".repeat(81)}})).status()).toBe(400);
  expect((await page.request.patch(url,{headers:{origin},data:{display_name:"架空",user_id:"00000000-0000-4000-8000-000000000000"}})).status()).toBe(400);
  expect((await page.request.patch(url,{headers:{origin:"https://example.invalid"},data:{display_name:"架空"}})).status()).toBe(403);
  await page.context().clearCookies();expect((await page.request.patch(url,{headers:{origin},data:{display_name:"架空"}})).status()).toBe(401);
 }finally{
  const user=checked(await service.from("profiles").select("id").eq("display_name","表示名E2Eの架空メンバー")).at(0);
  if(user)checked(await service.from("profiles").update({display_name:original}).eq("id",user.id));
 }
});
