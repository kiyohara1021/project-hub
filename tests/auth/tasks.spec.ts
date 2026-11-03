import { test, expect, type Page } from "@playwright/test";
const wid = "11111111-1111-4111-8111-111111111111";
const otherWid = "22222222-2222-4222-8222-222222222222";
const origin = "http://127.0.0.1:3101";

async function login(page: Page, alias: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page.getByLabel("パスワード", { exact: true }).fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}
async function project(page: Page) {
  await login(page,"admin");
  const response = await page.request.post(`/api/v1/workspaces/${wid}/projects`, { headers: { origin,"Idempotency-Key":crypto.randomUUID() }, data: { name:`カンバン検証のテスト用プロジェクト-${crypto.randomUUID().slice(0,8)}`,description:"",due_date:null } });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}
function endpoints(pid: string) { return { base:`/api/v1/workspaces/${wid}/projects/${pid}/tasks`, board:`/projects/${pid}/board?workspace=${wid}` }; }
async function create(page: Page, base: string, title: string) {
  const response = await page.request.post(base,{ headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{title,description:"",priority:"medium",assignee_id:null,due_date:null} });
  expect(response.status()).toBe(201); return (await response.json()).data;
}

test("メンバーが360pxで追加・編集・状態変更・絞込・削除", async ({ page }) => {
  const p = await project(page); const { base,board } = endpoints(p.id);
  await login(page,"member"); await page.setViewportSize({ width:360,height:800 });
  await page.goto(board);
  await page.getByRole("button", { name:"タスク追加",exact:true }).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("タスク名",{exact:true}).fill("テスト用タスク画面確認");
  await dialog.getByLabel("説明",{exact:true}).fill("テスト用の説明");
  await dialog.getByLabel("優先度",{exact:true}).selectOption("high");
  await dialog.getByLabel("担当者",{exact:true}).selectOption({label:"デモメンバー02"});
  await dialog.getByLabel("期限（任意）").fill("2026-12-10");
  await dialog.getByRole("button",{name:"保存する"}).click();
  await expect(dialog).not.toBeVisible();
  let card=page.getByRole("article",{name:"テスト用タスク画面確認",exact:true});
  await expect(card).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.getByRole("button",{name:"編集",exact:true}).click();
  await dialog.getByLabel("タスク名",{exact:true}).fill("テスト用タスク画面更新");
  await dialog.getByLabel("優先度",{exact:true}).selectOption("low");
  await dialog.getByRole("button",{name:"保存する"}).click();
  await expect(dialog).not.toBeVisible();
  card=page.getByRole("article",{name:"テスト用タスク画面更新",exact:true});
  await card.getByRole("combobox",{name:"テスト用タスク画面更新の状態"}).selectOption("doing");
  await expect(page.getByRole("status").filter({hasText:"タスクの位置を保存しました"})).toBeVisible();
  await page.getByLabel("表示する状態",{exact:true}).selectOption("doing");
  await expect(card).toBeVisible(); await page.reload();
  await page.getByLabel("表示する状態",{exact:true}).selectOption("doing"); await expect(card).toBeVisible();
  await page.getByLabel("優先度で絞り込み").selectOption("high");
  await page.getByRole("button",{name:"絞り込む"}).click(); await expect(page).toHaveURL(/priority=high/);
  await expect(card).not.toBeVisible();
  await page.getByRole("link",{name:"リセット",exact:true}).click();
  await expect(page.getByLabel("優先度で絞り込み")).toHaveValue("");
  await page.getByLabel("表示する状態",{exact:true}).selectOption("doing");
  await card.getByRole("button",{name:"編集",exact:true}).click();
  await dialog.getByRole("button",{name:"タスクを削除…",exact:true}).click();
  await expect(dialog.getByText(/元に戻せません/)).toBeVisible();
  await dialog.getByRole("button",{name:"削除する",exact:true}).click();
  await expect(dialog).not.toBeVisible(); await expect(card).not.toBeVisible();
  expect((await (await page.request.get(base+"?status=doing")).json()).data).toHaveLength(0);
});

test("ドラッグ・上へ・追加読込と、失敗/競合からの復旧", async ({ page }) => {
  // 両端を同時に表示し、ブラウザ自動スクロールで開始座標がずれるのを避ける。
  await page.setViewportSize({width:1440,height:1600});
  const p=await project(page); const {base,board}=endpoints(p.id);
  const a=await create(page,base,"テスト用タスクA"); const b=await create(page,base,"テスト用タスクB"); await create(page,base,"テスト用タスクC");
  await page.goto(board);
  const todo=page.getByRole("region",{name:"未着手",exact:true});
  await page.getByRole("article",{name:"テスト用タスクC",exact:true}).dragTo(page.getByRole("article",{name:"テスト用タスクA",exact:true}));
  await expect(todo.getByRole("heading",{level:3}).first()).toHaveText("テスト用タスクC");
  await expect(page.getByRole("status").filter({hasText:"タスクの位置を保存しました"})).toBeVisible();
  await page.getByRole("article",{name:"テスト用タスクB",exact:true}).getByRole("button",{name:"上へ",exact:true}).click();
  await expect(todo.getByRole("heading",{level:3}).nth(1)).toHaveText("テスト用タスクB");
  await page.route(`**${base}/${a.id}/move`,route=>route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:{message:"検証用の移動失敗"}})}));
  await page.getByLabel("テスト用タスクAの状態").selectOption("done");
  await expect(page.getByRole("alert").filter({hasText:"検証用の移動失敗"})).toBeVisible();
  await expect(todo.getByRole("article",{name:"テスト用タスクA",exact:true})).toBeVisible();
  await page.unrouteAll();
  await page.getByRole("button",{name:"一覧を再読み込み"}).click();
  await expect(page.getByRole("alert").filter({hasText:"検証用の移動失敗"})).not.toBeVisible();
  await page.getByRole("article",{name:"テスト用タスクB",exact:true}).getByRole("button",{name:"編集",exact:true}).click();
  const dialog=page.getByRole("dialog"); await dialog.getByLabel("説明",{exact:true}).fill("保持する入力");
  const current=(await (await page.request.get(`${base}/${b.id}`)).json()).data;
  expect((await page.request.patch(`${base}/${b.id}`,{headers:{origin},data:{title:current.title,description:"別の更新",priority:current.priority,assignee_id:null,due_date:null,version:current.version}})).status()).toBe(200);
  await dialog.getByRole("button",{name:"保存する"}).click();
  await expect(dialog.getByRole("alert")).toContainText("他の操作で更新されました");
  await expect(dialog.getByLabel("説明",{exact:true})).toHaveValue("保持する入力");
  await dialog.getByRole("button",{name:"入力を破棄して最新版を読み直す"}).click();
  await expect(dialog.getByLabel("説明",{exact:true})).toHaveValue("別の更新");
  await dialog.getByRole("button",{name:"キャンセル",exact:true}).click();
  for(let i=0;i<24;i++) await create(page,base,`追加読込のテスト用タスク${i}`);
  await page.reload(); await expect(todo.getByRole("article")).toHaveCount(25);
  await todo.getByRole("button",{name:"さらに読み込む"}).click(); await expect(todo.getByRole("article")).toHaveCount(27);
  const first=await (await page.request.get(base+"?status=todo&limit=1")).json();
  const second=await (await page.request.get(base+"?status=todo&limit=1&cursor="+first.nextCursor)).json();
  expect(second.data[0].id).not.toBe(first.data[0].id);
});

test("APIの入力・再送・所属・アーカイブ境界と閲覧者", async ({ page }) => {
  const p=await project(page); const other=await project(page); const {base,board}=endpoints(p.id);
  const payload={title:"境界検証のテスト用タスク",description:"",priority:"medium",assignee_id:null,due_date:null};
  const headers={origin,"Idempotency-Key":crypto.randomUUID()};
  const one=await page.request.post(base,{headers,data:payload}); expect(one.status()).toBe(201); const task=(await one.json()).data;
  expect((await (await page.request.post(base,{headers,data:payload})).json()).data.id).toBe(task.id);
  expect((await page.request.post(base,{headers,data:{...payload,title:"違う本文"}})).status()).toBe(409);
  expect((await page.request.post(base,{headers:{...headers,origin:"https://example.invalid"},data:payload})).status()).toBe(403);
  expect((await page.request.post(base,{headers:{origin},data:payload})).status()).toBe(400);
  for(const invalid of [{...payload,title:" "},{...payload,due_date:"2026-02-30"},{...payload,priority:"urgent"},{...payload,assignee_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},{...payload,workspace_id:otherWid}]) {
    expect((await page.request.post(base,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:invalid})).status()).toBe(400);
  }
  const otherBase=endpoints(other.id).base;
  expect((await page.request.get(`${otherBase}/${task.id}`)).status()).toBe(404);
  expect((await page.request.patch(`${otherBase}/${task.id}`,{headers:{origin},data:{...payload,version:1}})).status()).toBe(404);
  const outsideBase=`/api/v1/workspaces/${otherWid}/projects/${p.id}/tasks`;
  expect((await page.request.get(outsideBase)).status()).toBe(404);
  const outsidePeople=await page.request.get(`/api/v1/workspaces/${otherWid}/projects`); expect(outsidePeople.status()).toBe(404);
  expect((await page.request.get(base+"?status=invalid")).status()).toBe(400);
  expect((await page.request.get(base+"?status=todo&cursor=bad")).status()).toBe(400);
  expect((await page.request.post(`${base}/${task.id}/move`,{headers:{origin},data:{status:"done",before_id:null,version:999}})).status()).toBe(409);
  expect((await page.request.delete(`${base}/${task.id}`,{headers:{origin},data:{version:999}})).status()).toBe(409);
  expect((await page.request.patch(`/api/v1/workspaces/${wid}/projects/${p.id}`,{headers:{origin},data:{name:p.name,description:"",status:"archived",due_date:null,version:1}})).status()).toBe(200);
  expect((await page.request.post(base,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:payload})).status()).toBe(409);
  expect((await page.request.patch(`${base}/${task.id}`,{headers:{origin},data:{...payload,version:1}})).status()).toBe(409);
  expect((await page.request.delete(`${base}/${task.id}`,{headers:{origin},data:{version:1}})).status()).toBe(409);
  expect((await page.request.post(`${base}/${task.id}/move`,{headers:{origin},data:{status:"done",before_id:null,version:1}})).status()).toBe(409);
  await page.goto(board); await expect(page.getByText("アーカイブ済みのため閲覧のみ利用できます。")).toBeVisible();
  await expect(page.getByRole("button",{name:"タスク追加",exact:true})).not.toBeVisible();
  await login(page,"viewer"); await page.goto(endpoints(other.id).board);
  await expect(page.getByRole("button",{name:"タスク追加",exact:true})).not.toBeVisible();
  expect((await page.request.post(otherBase,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:payload})).status()).toBe(403);
});
