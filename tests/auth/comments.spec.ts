import {test,expect,type Page} from "@playwright/test";
import {localSettings,login as dbLogin,adminClient,checked} from "../../scripts/local-supabase.mjs";
import {localSql} from "../../scripts/local-sql.mjs";
import type {IssueComment,CommentPage} from "../../src/lib/comment-types";

const origin="http://127.0.0.1:3101";
async function login(page:Page,alias:string){
  await page.goto("/login");await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);await page.getByLabel("パスワード",{exact:true}).fill("Local-Demo-Only-2026!");await page.getByRole("button",{name:"ログイン",exact:true}).click();await expect(page).toHaveURL(/\/workspaces$/);
}
async function fixture(){
  const settings=localSettings(),service=adminClient(settings),owner=await dbLogin(settings,"admin"),member=await dbLogin(settings,"member"),viewer=await dbLogin(settings,"viewer");
  const wid=checked(await owner.client.rpc("create_workspace",{p_name:"コメント検証用スペース"}));
  checked(await service.from("memberships").insert([{workspace_id:wid,user_id:member.user.id,role:"member"},{workspace_id:wid,user_id:viewer.user.id,role:"viewer"}]));
  const project=checked(await service.from("projects").insert({workspace_id:wid,name:"コメント検証用プロジェクト"}).select().single());
  const otherProject=checked(await service.from("projects").insert({workspace_id:wid,name:"コメント境界検証用プロジェクト"}).select().single());
  const issue=checked(await service.from("issues").insert({workspace_id:wid,project_id:project.id,title:"コメント検証用課題"}).select().single());
  const otherIssue=checked(await service.from("issues").insert({workspace_id:wid,project_id:project.id,title:"コメント境界検証用課題"}).select().single());
  const api=`/api/v1/workspaces/${wid}/projects/${project.id}/issues/${issue.id}/comments`,url=`/projects/${project.id}/issues?workspace=${wid}&q=${encodeURIComponent(issue.title)}`;
  return {wid,project,otherProject,issue,otherIssue,api,url,service,memberId:member.user.id,
    async cleanup(){
      localSql(`delete from private.comment_requests where workspace_id='${wid}'`);
      for(const table of ["issues","projects","memberships","activity_logs"])checked(await service.from(table).delete().eq("workspace_id",wid));
      checked(await service.from("workspaces").delete().eq("id",wid));
    }
  };
}
async function post(page:Page,api:string,body:string,key=crypto.randomUUID()){
  const response=await page.request.post(api,{headers:{origin,"Idempotency-Key":key},data:{body}});expect(response.status()).toBe(201);return (await response.json()).data as IssueComment;
}
async function openComments(page:Page,url:string){
  await page.goto(url);await page.getByRole("button",{name:"コメント",exact:true}).first().click();return page.getByRole("dialog",{name:"課題コメント",exact:true});
}

test("コメントAPIの再送・競合・本文境界・所属と投稿者権限",async({page})=>{
  const f=await fixture();try{
    await login(page,"member");const key=crypto.randomUUID();const comment=await post(page,f.api,"  調査内容\n次の対応  ",key);expect(comment).toMatchObject({body:"調査内容\n次の対応",author_id:f.memberId,author_display_name:"デモメンバー02",version:1,issue_id:f.issue.id});
    const replay=await page.request.post(f.api,{headers:{origin,"Idempotency-Key":key},data:{body:"調査内容\n次の対応"}});expect(replay.status()).toBe(201);expect((await replay.json()).data.id).toBe(comment.id);
    const mismatch=await page.request.post(f.api,{headers:{origin,"Idempotency-Key":key},data:{body:"異なる内容"}});expect(mismatch.status()).toBe(409);expect((await mismatch.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    const list=await page.request.get(f.api);expect(list.status()).toBe(200);expect(list.headers()["cache-control"]).toBe("private, no-store");expect((await list.json()).data).toHaveLength(1);
    for(const data of [{body:""},{body:"\u0000"},{body:" \n "},{body:null},{body:123},{body:"a".repeat(5001)},{body:"本文",author_id:f.memberId},{body:"本文",version:1},{}])expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data})).status()).toBe(400);
    expect((await page.request.post(f.api,{headers:{origin},data:{body:"本文"}})).status()).toBe(400);
    expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":"bad key"},data:{body:"本文"}})).status()).toBe(400);
    expect((await page.request.post(f.api,{headers:{origin:"https://example.invalid","Idempotency-Key":crypto.randomUUID()},data:{body:"本文"}})).status()).toBe(403);
    expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID(),"Content-Type":"text/plain"},data:'{"body":"本文"}'})).status()).toBe(415);
    expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{body:"a".repeat(33000)}})).status()).toBe(413);
    const boundary=await post(page,f.api,"😀".repeat(5000));expect(Array.from(boundary.body)).toHaveLength(5000);
    for(const query of ["limit=0","limit=101","limit=1.5","limit=1&limit=2","cursor=","cursor=invalid","unknown=1",`cursor=${Buffer.from(JSON.stringify({time:"2026-02-30T00:00:00Z",id:comment.id})).toString("base64url")}`])expect((await page.request.get(`${f.api}?${query}`)).status()).toBe(400);
    const item=`${f.api}/${comment.id}`;expect((await page.request.patch(item,{headers:{origin},data:{body:"更新",version:1,author_id:f.memberId}})).status()).toBe(400);
    const own=await page.request.patch(item,{headers:{origin},data:{body:"調査内容更新",version:1}});expect(own.status()).toBe(200);expect((await own.json()).data).toMatchObject({body:"調査内容更新",version:2,author_id:f.memberId,created_at:comment.created_at});
    expect((await page.request.patch(item,{headers:{origin},data:{body:"競合",version:1}})).status()).toBe(409);expect((await page.request.delete(item,{headers:{origin},data:{version:1}})).status()).toBe(409);
    expect((await page.request.get(item.replace(f.project.id,f.otherProject.id))).status()).toBe(404);expect((await page.request.get(item.replace(f.issue.id,f.otherIssue.id))).status()).toBe(404);
    await login(page,"admin");const adminComment=await post(page,f.api,"管理者のコメント");const updated=await page.request.patch(item,{headers:{origin},data:{body:"管理者が整理",version:2}});expect(updated.status()).toBe(200);
    await login(page,"member");expect((await page.request.patch(`${f.api}/${adminComment.id}`,{headers:{origin},data:{body:"拒否",version:adminComment.version}})).status()).toBe(403);expect((await page.request.delete(`${f.api}/${adminComment.id}`,{headers:{origin},data:{version:adminComment.version}})).status()).toBe(403);
    await login(page,"viewer");expect((await page.request.get(f.api)).status()).toBe(200);expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{body:"拒否"}})).status()).toBe(403);expect((await page.request.patch(item,{headers:{origin},data:{body:"拒否",version:3}})).status()).toBe(403);
    await login(page,"outside");expect((await page.request.get(f.api)).status()).toBe(404);expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{body:"拒否"}})).status()).toBe(404);
    await page.context().clearCookies();expect((await page.request.get(f.api)).status()).toBe(401);expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{body:"拒否"}})).status()).toBe(401);
    await login(page,"admin");expect((await page.request.delete(item,{headers:{origin},data:{version:3}})).status()).toBe(204);expect((await page.request.get(item)).status()).toBe(404);
  }finally{await f.cleanup();}
});

test("360pxで投稿・HTML文字列・編集競合の復旧・確認削除とフォーカス復帰",async({page})=>{
  const f=await fixture();try{
    await login(page,"member");await page.setViewportSize({width:360,height:800});let dialog=await openComments(page,f.url);await expect(dialog.getByText("コメントはまだありません",{exact:true})).toBeVisible();
    const content='<img src=x onerror="window.commentXss=true">\n調査記録';await dialog.getByLabel("コメント本文",{exact:true}).fill(content);await dialog.getByRole("button",{name:"コメントを投稿",exact:true}).click();
    const article=dialog.getByRole("article",{name:"デモメンバー02のコメント",exact:true});await expect(article).toContainText(content);expect(await dialog.locator("img").count()).toBe(0);expect(await page.evaluate(()=>Reflect.get(window,"commentXss"))).toBeUndefined();
    await article.getByRole("button",{name:"編集",exact:true}).click();await dialog.getByLabel("コメントを編集",{exact:true}).fill("未保存の調査結果");
    const list:CommentPage=await(await page.request.get(f.api)).json();const target=list.data[0];expect((await page.request.patch(`${f.api}/${target.id}`,{headers:{origin},data:{body:"別操作で更新",version:target.version}})).status()).toBe(200);
    await dialog.getByRole("button",{name:"変更を保存",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("他の操作");await expect(dialog.getByLabel("コメントを編集",{exact:true})).toHaveValue("未保存の調査結果");
    await dialog.getByRole("button",{name:"入力を破棄して最新版を読み直す",exact:true}).click();await expect(dialog.getByLabel("コメントを編集",{exact:true})).toHaveValue("別操作で更新");
    await dialog.getByLabel("コメントを編集",{exact:true}).fill("対応内容を追記");await dialog.getByRole("button",{name:"変更を保存",exact:true}).click();await expect(article).toContainText("対応内容を追記");await expect(article).toContainText("編集済み");
    await article.getByRole("button",{name:"削除…",exact:true}).click();await expect(dialog.getByRole("button",{name:"削除する",exact:true})).toBeVisible();await dialog.getByRole("button",{name:"削除をやめる",exact:true}).click();await expect(article).toContainText("対応内容を追記");
    await article.getByRole("button",{name:"削除…",exact:true}).click();await dialog.getByRole("button",{name:"削除する",exact:true}).click();await expect(dialog.getByText("コメントはまだありません",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(dialog.getByRole("button",{name:"コメントを投稿",exact:true})).toBeEnabled();await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();await expect(page.getByRole("button",{name:"コメント",exact:true}).first()).toBeFocused();
    await login(page,"admin");await post(page,f.api,"閲覧権限確認用コメント");await login(page,"viewer");dialog=await openComments(page,f.url);await expect(dialog.getByText("閲覧権限確認用コメント",{exact:true})).toBeVisible();await expect(dialog.getByLabel("コメント本文",{exact:true})).toHaveCount(0);await expect(dialog.getByRole("button",{name:"編集",exact:true})).toHaveCount(0);await expect(dialog.getByRole("button",{name:"削除…",exact:true})).toHaveCount(0);
  }finally{await f.cleanup();}
});

test("通信結果不明の投稿再試行で二重登録を防ぎ、読取失敗でも本文と既存表示を保持",async({page})=>{
  const f=await fixture();try{
    await login(page,"member");const dialog=await openComments(page,f.url);let firstKey:string|undefined,retryKey:string|undefined;
    await page.route(`**${f.api}`,async route=>{
      if(route.request().method()!=="POST")return route.continue();
      if(!firstKey){firstKey=route.request().headers()["idempotency-key"];await route.fetch();return route.abort();}
      retryKey=route.request().headers()["idempotency-key"];await route.continue();
    });
    await dialog.getByLabel("コメント本文",{exact:true}).fill("通信再試行の調査結果");await dialog.getByRole("button",{name:"コメントを投稿",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("再試行");await expect(dialog.getByLabel("コメント本文",{exact:true})).toHaveValue("通信再試行の調査結果");
    await dialog.getByRole("button",{name:"コメントを投稿",exact:true}).click();await expect(dialog.getByText("通信再試行の調査結果",{exact:true})).toBeVisible();expect(retryKey).toBe(firstKey);expect(((await(await page.request.get(f.api)).json()) as CommentPage).data).toHaveLength(1);
    await dialog.getByLabel("コメント本文",{exact:true}).fill("まだ送っていない内容");
    await page.route(`**${f.api}*`,async route=>route.request().method()==="GET"?route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:{code:"READ_FAILED",message:"コメントを取得できませんでした"}})}):route.continue());
    await dialog.getByRole("button",{name:"最新のコメントを取得",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("コメントを取得できませんでした");await expect(dialog.getByText("通信再試行の調査結果",{exact:true})).toBeVisible();await expect(dialog.getByLabel("コメント本文",{exact:true})).toHaveValue("まだ送っていない内容");
    await page.unroute(`**${f.api}*`);await dialog.getByRole("button",{name:"再試行する",exact:true}).click();await expect(dialog.getByRole("alert")).toHaveCount(0);await expect(dialog.getByText("通信再試行の調査結果",{exact:true})).toBeVisible();
  }finally{await f.cleanup();}
});

test("同時刻コメントのページ送りとアーカイブ内の閲覧専用を確認",async({page})=>{
  const f=await fixture();try{
    await login(page,"admin");for(let n=0;n<26;n++)await post(page,f.api,`ページ送りのコメント${n.toString().padStart(2,"0")}`);
    localSql(`update public.issue_comments set created_at='2026-11-01 00:00:00+00',updated_at='2026-11-01 00:00:00+00' where issue_id='${f.issue.id}'`);
    const first:CommentPage=await(await page.request.get(`${f.api}?limit=25`)).json();expect(first.data).toHaveLength(25);expect(first.nextCursor).toBeTruthy();const second:CommentPage=await(await page.request.get(`${f.api}?limit=25&cursor=${first.nextCursor}`)).json();expect(second.data).toHaveLength(1);expect(new Set([...first.data,...second.data].map(c=>c.id)).size).toBe(26);
    let dialog=await openComments(page,f.url);await expect(dialog.getByRole("article")).toHaveCount(25);await dialog.getByRole("button",{name:"さらに読み込む",exact:true}).click();await expect(dialog.getByRole("article")).toHaveCount(26);await expect(dialog.getByRole("button",{name:"さらに読み込む",exact:true})).toHaveCount(0);await page.keyboard.press("Escape");
    checked(await f.service.from("projects").update({status:"archived"}).eq("id",f.project.id));dialog=await openComments(page,f.url);await expect(dialog.getByRole("article")).toHaveCount(25);await expect(dialog.getByLabel("コメント本文",{exact:true})).toHaveCount(0);await expect(dialog.getByRole("button",{name:"編集",exact:true})).toHaveCount(0);
    expect((await page.request.post(f.api,{headers:{origin,"Idempotency-Key":crypto.randomUUID()},data:{body:"拒否"}})).status()).toBe(409);expect((await page.request.patch(`${f.api}/${first.data[0].id}`,{headers:{origin},data:{body:"拒否",version:first.data[0].version}})).status()).toBe(409);expect((await page.request.delete(`${f.api}/${first.data[0].id}`,{headers:{origin},data:{version:first.data[0].version}})).status()).toBe(409);
  }finally{await f.cleanup();}
});
