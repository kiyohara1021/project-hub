import {test,expect,type Page} from "@playwright/test";
import {localSettings,adminClient,login as dbLogin,checked} from "../../scripts/local-supabase.mjs";
const wid="11111111-1111-4111-8111-111111111111",origin="http://127.0.0.1:3101";
async function login(page:Page,alias:string){await page.goto("/login");await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);await page.getByLabel("パスワード",{exact:true}).fill("Local-Demo-Only-2026!");await page.getByRole("button",{name:"ログイン",exact:true}).click();await expect(page).toHaveURL(/\/workspaces$/);}
test("管理者が360pxでロール変更・競合復旧・最後の管理者保護を確認",async({page})=>{
 await login(page,"admin");await page.setViewportSize({width:360,height:800});await page.goto(`/members?workspace=${wid}`);
 const member=page.getByRole("article",{name:"デモメンバー02",exact:true});await member.getByRole("button",{name:"権限を管理"}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("ロール",{exact:true}).selectOption("viewer");await dialog.getByRole("button",{name:"ロール変更…"}).click();await expect(dialog.getByRole("status")).toContainText("閲覧者");await dialog.getByRole("button",{name:"確認して実行"}).click();await expect(dialog).not.toBeVisible();await expect(member).toContainText("閲覧者");
 const list=await(await page.request.get(`/api/v1/workspaces/${wid}/members`)).json();const target=list.data.find((m:{profiles:{display_name:string}})=>m.profiles.display_name==="デモメンバー02");const url=`/api/v1/workspaces/${wid}/members/${target.user_id}`;
 await member.getByRole("button",{name:"権限を管理"}).click();expect((await page.request.patch(url,{headers:{origin},data:{role:"member",version:target.version}})).status()).toBe(204);
 await dialog.getByLabel("ロール",{exact:true}).selectOption("admin");await dialog.getByRole("button",{name:"ロール変更…"}).click();await dialog.getByRole("button",{name:"確認して実行"}).click();await expect(dialog.getByRole("alert")).toContainText("他の操作");await dialog.getByRole("button",{name:"入力を破棄して最新版を読み直す"}).click();await expect(dialog.getByLabel("ロール",{exact:true})).toHaveValue("member");await dialog.getByRole("button",{name:"キャンセル",exact:true}).click();
 await page.reload();await page.getByRole("article",{name:"デモメンバー01",exact:true}).getByRole("button",{name:"権限を管理"}).click();await dialog.getByRole("button",{name:"所属を解除…"}).click();await expect(dialog.getByRole("status")).toContainText("未割当");await dialog.getByRole("button",{name:"確認して実行"}).click();await expect(dialog.getByRole("alert")).toContainText("最後の管理者");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("メンバー一覧のページ送り・絞り込み・API権限と入力検証",async({page})=>{
 await login(page,"admin");const base=`/api/v1/workspaces/${wid}/members`;const first=await(await page.request.get(`${base}?limit=1`)).json();expect(first.data).toHaveLength(1);const second=await(await page.request.get(`${base}?limit=1&cursor=${first.nextCursor}`)).json();expect(second.data[0].user_id).not.toBe(first.data[0].user_id);
 for(const query of ["role=invalid","role=admin&role=viewer","limit=0","cursor=invalid","unknown=1"])expect((await page.request.get(`${base}?${query}`)).status()).toBe(400);
 const target=first.data[0],url=`${base}/${target.user_id}`;expect((await page.request.patch(url,{headers:{origin:"https://example.invalid"},data:{role:"viewer",version:target.version}})).status()).toBe(403);expect((await page.request.patch(url,{headers:{origin},data:{role:"viewer",version:target.version,extra:true}})).status()).toBe(400);
 await page.goto(`/members?workspace=${wid}&role=viewer`);await expect(page.getByRole("article")).toHaveCount(1);await page.getByRole("link",{name:"リセット",exact:true}).click();await expect(page.getByRole("article")).toHaveCount(3);
 await login(page,"viewer");await page.goto(`/members?workspace=${wid}`);await expect(page.getByRole("button",{name:"権限を管理"})).toHaveCount(0);expect((await page.request.delete(url,{headers:{origin},data:{version:target.version}})).status()).toBe(403);expect((await page.request.get('/api/v1/workspaces/22222222-2222-4222-8222-222222222222/members')).status()).toBe(404);
 await page.context().clearCookies();expect((await page.request.get(base)).status()).toBe(401);await page.goto(`/members?workspace=${wid}`);await expect(page).toHaveURL(/\/login$/);
});

test("担当数を全ロールで閲覧し、絞り込みと360pxの表示を維持",async({page})=>{
 const settings=localSettings(),service=adminClient(settings);const owner=await dbLogin(settings,"admin"),assigned=await dbLogin(settings,"member"),viewer=await dbLogin(settings,"viewer");
 const space=checked(await owner.client.rpc("create_workspace",{p_name:"画面担当数検証の架空スペース"}));
 try{
  checked(await service.from("memberships").insert([{workspace_id:space,user_id:assigned.user.id,role:"member"},{workspace_id:space,user_id:viewer.user.id,role:"viewer"}]));
  const project=checked(await owner.client.rpc("create_project",{p_workspace_id:space,p_name:"画面担当数検証の架空プロジェクト"}));
  checked(await service.from("tasks").insert([{workspace_id:space,project_id:project.id,title:"未完了の架空担当",status:"todo",assignee_id:assigned.user.id},{workspace_id:space,project_id:project.id,title:"完了した架空担当",status:"done",assignee_id:assigned.user.id}]));
  checked(await service.from("issues").insert([{workspace_id:space,project_id:project.id,title:"未解決の架空担当",assignee_id:assigned.user.id,status:"open"},{workspace_id:space,project_id:project.id,title:"調査中の架空担当",assignee_id:assigned.user.id,status:"investigating"}]));
  for(const alias of ["admin","member","viewer"]){
   await login(page,alias);const response=await page.request.get(`/api/v1/workspaces/${space}/members?role=member&limit=1`);expect(response.status()).toBe(200);const result=await response.json();expect(result.data[0]).toMatchObject({user_id:assigned.user.id,task_count:1,issue_count:2});expect(result.nextCursor).toBeNull();
  }
  await page.setViewportSize({width:360,height:800});await page.goto(`/members?workspace=${space}&role=member&limit=1`);
  const card=page.getByRole("article",{name:"デモメンバー02",exact:true});await expect(card).toContainText("未完了タスク1件");await expect(card).toContainText("未解決課題2件");await expect(page.getByText("担当件数は計画中",{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel("ロールで絞り込み").selectOption("viewer");await page.getByRole("button",{name:"絞り込む",exact:true}).click();const zero=page.getByRole("article",{name:"デモメンバー03",exact:true});await expect(zero).toContainText("未完了タスク0件");await expect(zero).toContainText("未解決課題0件");
  const details=await page.request.get(`/api/v1/workspaces/${space}/members/${assigned.user.id}`);expect(details.status()).toBe(200);expect((await details.json()).data.user_id).toBe(assigned.user.id);
 }finally{
  for(const table of ["tasks","issues","projects","memberships","activity_logs"])checked(await service.from(table).delete().eq("workspace_id",space));
  checked(await service.from("workspaces").delete().eq("id",space));
 }
});
