import {test,expect,type Page} from "@playwright/test";
import type {Activity,ActivityPage} from "../../src/lib/activity-types";
import {localSql} from "../../scripts/local-sql.mjs";
const wid="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",origin="http://127.0.0.1:3101";
async function login(page:Page,alias:string){await page.goto("/login");await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);await page.getByLabel("パスワード",{exact:true}).fill("Local-Demo-Only-2026!");await page.getByRole("button",{name:"ログイン",exact:true}).click();await expect(page).toHaveURL(/\/workspaces$/);}
async function fixture(page:Page){
  await login(page,"admin");const headers={origin,"Idempotency-Key":crypto.randomUUID()};
  const response=await page.request.post(`/api/v1/workspaces/${wid}/projects`,{headers,data:{name:"履歴画面検証の架空プロジェクト",description:"",due_date:null}});expect(response.status()).toBe(201);const project=(await response.json()).data;
  const base=`/api/v1/workspaces/${wid}/projects/${project.id}/tasks`;
  const created=await page.request.post(base,{headers,data:{title:"履歴画面の架空タスク",description:"記録しない架空本文",priority:"high",assignee_id:null,due_date:null}});expect(created.status()).toBe(201);const task=(await created.json()).data;
  const moved=await page.request.post(`${base}/${task.id}/move`,{headers:{origin},data:{status:"doing",before_id:null,version:task.version}});expect(moved.status()).toBe(200);const current=(await moved.json()).data;
  expect((await page.request.delete(`${base}/${task.id}`,{headers:{origin},data:{version:current.version}})).status()).toBe(204);
  expect((await page.request.patch(`/api/v1/workspaces/${wid}/projects/${project.id}`,{headers:{origin},data:{name:project.name,description:"",status:"archived",due_date:null,version:project.version}})).status()).toBe(200);
  // 複合同時刻カーソルを検証するため、ローカルのこのfixtureだけ時刻を揃える。
  if(!/^[0-9a-f-]{36}$/.test(project.id))throw new Error("invalid fixture");
  localSql(`update public.activity_logs set created_at='2026-11-01 00:00:00+00' where project_id='${project.id}'`);
  return project;
}
test("削除・アーカイブ後の履歴を360pxで閲覧し、各絞り込みと同時刻ページ送りを保持",async({page})=>{
  const project=await fixture(page);const api=`/api/v1/workspaces/${wid}/activity`;const query=`project=${project.id}&limit=2`;
  const all:Activity[]=[];let cursor:string|null=null;
  do{const response=await page.request.get(`${api}?${query}${cursor?`&cursor=${cursor}`:""}`);expect(response.status()).toBe(200);const result:ActivityPage=await response.json();all.push(...result.data);cursor=result.nextCursor;}while(cursor);
  expect(all).toHaveLength(5);expect(new Set(all.map(e=>e.id)).size).toBe(5);expect(all.map(e=>e.id)).toEqual(all.map(e=>e.id).sort().reverse());expect(JSON.stringify(all)).not.toContain("記録しない架空本文");
  await login(page,"viewer");await page.setViewportSize({width:360,height:800});await page.goto(`/activity?workspace=${wid}&${query}`);await expect(page.getByRole("article")).toHaveCount(2);await expect(page.getByRole("article").first().getByRole("time")).toHaveText("2026/11/01 09:00:00");
  await page.getByRole("link",{name:"次のページ →",exact:true}).click();await expect(page).toHaveURL(/cursor=/);await expect(page.getByRole("article")).toHaveCount(2);await page.getByRole("link",{name:"最初のページ",exact:true}).click();await expect(page).not.toHaveURL(/cursor=/);
  await page.getByLabel("対象種別で絞り込み").selectOption("tasks");await page.getByLabel("操作で絞り込み").selectOption("UPDATE");await page.getByRole("button",{name:"絞り込む",exact:true}).click();await expect(page).toHaveURL(new RegExp(`project=${project.id}`));await expect(page.getByRole("article")).toHaveCount(1);await expect(page.getByRole("article")).toContainText("未着手 → 状態: 進行中");
  await page.getByRole("article").getByRole("link",{name:"この操作者で絞る",exact:true}).click();await expect(page).toHaveURL(/actor=/);await expect(page.getByRole("link",{name:"操作者の絞り込みを解除",exact:true})).toBeVisible();await page.getByRole("link",{name:"操作者の絞り込みを解除",exact:true}).click();await expect(page).not.toHaveURL(/actor=/);
  await page.getByLabel("操作で絞り込み").selectOption("DELETE");await page.getByRole("button",{name:"絞り込む",exact:true}).click();await expect(page.getByRole("article")).toContainText("タスクを削除");await page.getByRole("article").getByRole("link",{name:"このプロジェクトで絞る",exact:true}).click();await expect(page).toHaveURL(new RegExp(`project=${project.id}`));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("link",{name:"プロジェクトの絞り込みを解除",exact:true}).click();await expect(page).not.toHaveURL(/project=/);
});
test("履歴APIの所属境界・入力検証・安全な変更値・空表示・未認証",async({page})=>{
  const project=await fixture(page);const api=`/api/v1/workspaces/${wid}/activity`;
  const malformed=Buffer.from(JSON.stringify({time:"2026-02-30T00:00:00Z",id:project.id})).toString("base64url");
  for(const query of ["action=invalid","entity=profiles","limit=0","limit=101","limit=1.5","project=invalid","actor=invalid","cursor=","cursor=invalid",`cursor=${malformed}`,"action=INSERT&action=DELETE","unknown=1"])expect((await page.request.get(`${api}?${query}`)).status()).toBe(400);
  localSql(`update public.activity_logs set changes=changes||'{"secret":"架空の非公開値"}'::jsonb||jsonb_build_object('after',changes->'after'||'{"description":"架空本文","role":"偽造ロール"}'::jsonb) where project_id='${project.id}' and entity_type='tasks'`);
  const safe=await page.request.get(`${api}?project=${project.id}`);expect(safe.headers()["cache-control"]).toBe("private, no-store");expect(await safe.text()).not.toMatch(/架空の非公開値|架空本文|偽造ロール/);
  for(const method of ["post","patch","delete"] as const)expect((await page.request[method](api,{headers:{origin},data:{}})).status()).toBe(405);
  expect((await page.request.get(`/api/v1/workspaces/${other}/activity`)).status()).toBe(404);expect((await page.request.get('/api/v1/workspaces/invalid/activity')).status()).toBe(400);
  expect((await(await page.request.get(`${api}?project=${crypto.randomUUID()}`)).json()).data).toEqual([]);
  await page.goto(`/activity?workspace=${wid}&project=${crypto.randomUUID()}`);await expect(page.getByText("操作履歴がありません",{exact:true})).toBeVisible();await page.goto(`/activity?workspace=${wid}&entity=invalid`);await expect(page.getByText("検索条件を確認してください",{exact:true})).toBeVisible();await page.getByRole("link",{name:"検索をリセット",exact:true}).click();await expect(page.getByRole("heading",{level:1,name:"操作履歴",exact:true})).toBeVisible();
  await login(page,"outside");await page.goto(`/activity?workspace=${other}`);await expect(page.getByRole("heading",{level:1,name:"操作履歴",exact:true})).toBeVisible();expect((await page.request.get(api)).status()).toBe(404);
  await login(page,"unassigned");await page.goto('/activity');await expect(page.getByText("所属ワークスペースがありません",{exact:true})).toBeVisible();expect((await page.request.get(api)).status()).toBe(404);
  await page.context().clearCookies();expect((await page.request.get(api)).status()).toBe(401);await page.goto('/activity');await expect(page).toHaveURL(/\/login$/);
});
test("履歴読取障害を安全なエラーに変換し再試行で復旧、ダッシュボードの導線を維持",async({page})=>{
  await login(page,"member");const api=`/api/v1/workspaces/${wid}/activity`;
  try{localSql("revoke select on public.activity_logs from authenticated");const response=await page.request.get(api);expect(response.status()).toBe(500);expect((await response.json()).error.message).toBe("操作履歴を取得できませんでした");await page.goto(`/activity?workspace=${wid}`);await expect(page.getByRole("heading",{name:"操作履歴を表示できませんでした",exact:true})).toBeVisible();}
  finally{localSql("grant select on public.activity_logs to authenticated");}
  await page.getByRole("button",{name:"再試行する",exact:true}).click();await expect(page.getByRole("heading",{level:1,name:"操作履歴",exact:true})).toBeVisible();
  await page.goto(`/dashboard?workspace=${wid}`);await page.getByRole("link",{name:"操作履歴をすべて見る →",exact:true}).click();await expect(page).toHaveURL(`/activity?workspace=${wid}`);
});
