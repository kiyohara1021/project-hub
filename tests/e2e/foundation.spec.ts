import { test, expect } from "@playwright/test";

test("6画面への遷移と本文の表示", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  const pages = [["ダッシュボード", "/dashboard"], ["プロジェクト一覧", "/projects"], ["カンバン", "/projects/demo-a/board"], ["課題一覧", "/projects/demo-a/issues"], ["メンバー", "/members"], ["操作履歴", "/activity"]];
  for (const [title, url] of pages) {
    if (await page.getByRole("button", { name: "メニューを開く" }).isVisible()) await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("navigation", { name: "メインメニュー" }).filter({ visible: true }).getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("検索、空状態、プロジェクトIDと404", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("プロジェクト名で検索").fill("存在しない架空名");
  await expect(page.getByText("該当するデータがありません")).toBeVisible();
  await page.getByLabel("プロジェクト名で検索").fill("架空プロジェクトB");
  await page.getByRole("link", { name: "架空プロジェクトB", exact: true }).click();
  await expect(page).toHaveURL("/projects/demo-b/board");
  await expect(page.getByText("タスクはまだありません")).toBeVisible();
  await page.getByRole("link", { name: "このプロジェクトの課題" }).click();
  await expect(page).toHaveURL("/projects/demo-b/issues");
  await expect(page.getByText("課題はまだありません")).toBeVisible();
  const response = await page.goto("/projects/unknown/board");
  // App Router may stream the not-found boundary with HTTP 200; UI must still be 404.
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
});

test("モバイルの状態選択とキーボードメニュー", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto("/projects/demo-a/board");
  await page.getByLabel("表示する状態").selectOption("完了");
  await expect(page.getByRole("heading", { name: "基本レイアウトを作成する" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "画面項目を整理する" })).not.toBeVisible();
  const trigger = page.getByRole("button", { name: "メニューを開く" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("公開用ヘッダーと画面デモの認証分離",async({page,request})=>{
 const response=await page.goto('/login');expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');await expect(page.getByText('接続設定がありません',{exact:true})).toBeVisible();await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
 const api=await request.get('/api/v1/workspaces/11111111-1111-4111-8111-111111111111/projects');expect(api.status()).toBe(503);expect(api.headers()['cache-control']).toContain('no-store');
});
