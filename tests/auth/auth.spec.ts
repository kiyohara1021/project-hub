import { test, expect } from "@playwright/test";

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

test("認証、所属データ、API境界、ログアウト", async ({ page, request }) => {
  const url = `/api/v1/workspaces/${workspaceA}/projects`;
  expect((await request.get(url)).status()).toBe(401);
  expect((await request.post("/auth/login", { headers: { origin: "https://example.invalid" }, form: { email: "admin@example.invalid", password: "anything" } })).status()).toBe(403);
  expect((await request.get("/auth/logout")).status()).toBe(405);
  await page.goto("/workspaces");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("メールアドレス").fill("admin@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Wrong-password!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ログインできませんでした" })).toBeVisible();
  await page.getByLabel("メールアドレス").fill("admin@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole("heading", { name: "デモスペースA", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "デモスペースA", exact: true })).toBeVisible();
  await expect(page.getByText("サンプルプロジェクトB", { exact: true })).not.toBeVisible();
  const api = await page.request.get(url);
  expect(api.status()).toBe(200);
  expect(api.headers()["cache-control"]).toContain("no-store");
  expect((await api.json()).data.every((p: { name: string }) => !p.name.includes("プロジェクトB"))).toBe(true);
  expect((await page.request.get(`/api/v1/workspaces/${workspaceB}/projects`)).status()).toBe(404);
  expect((await page.request.get("/api/v1/workspaces/99999999-9999-4999-8999-999999999999/projects")).status()).toBe(404);
  expect((await page.request.get(url + "?limit=0")).status()).toBe(400);
  expect((await page.request.get(url + "?cursor=invalid")).status()).toBe(400);
  expect((await page.request.get(url + "?status=invalid")).status()).toBe(400);
  const first = await (await page.request.get(url + "?limit=1")).json();
  expect(first.data).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const second = await (await page.request.get(url + "?limit=1&cursor=" + first.nextCursor)).json();
  expect(second.data[0].id).not.toBe(first.data[0].id);
  expect((await page.request.post("/auth/logout", { headers: { origin: "https://example.invalid" } })).status()).toBe(403);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get(url)).status()).toBe(401);
  await page.goto("/workspaces");
  await expect(page).toHaveURL(/\/login$/);
});

for (const alias of ["viewer", "outside", "unassigned"]) {
  test(`${alias}の所属に応じてDBデータを分離`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
    await page.getByLabel("パスワード", { exact: true }).fill("Local-Demo-Only-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
    if (alias === "viewer") {
      await expect(page.getByRole("region", { name: "デモスペースA", exact: true })).toBeVisible();
      await expect(page.getByText("サンプルプロジェクトB", { exact: true })).not.toBeVisible();
    } else if (alias === "outside") {
      await expect(page.getByRole("region", { name: "デモスペースB", exact: true })).toBeVisible();
      await expect(page.getByText("サンプルプロジェクトA", { exact: true })).not.toBeVisible();
    } else {
      await expect(page.getByText("所属ワークスペースがありません", { exact: true })).toBeVisible();
      await expect(page.getByText("サンプルプロジェクトA", { exact: true })).not.toBeVisible();
      await expect(page.getByText("サンプルプロジェクトB", { exact: true })).not.toBeVisible();
    }
    expect((await page.request.get(`/api/v1/workspaces/${workspaceA}/projects`)).status()).toBe(alias === "viewer" ? 200 : 404);
    if (alias === "unassigned") {
      await page.goto("/projects");
      await expect(page.getByText("所属ワークスペースがありません", { exact: true })).toBeVisible();
    }
  });
}
