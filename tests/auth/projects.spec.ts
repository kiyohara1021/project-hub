import { test, expect, type Page } from "@playwright/test";

const workspace = "11111111-1111-4111-8111-111111111111";
const otherWorkspace = "22222222-2222-4222-8222-222222222222";
const api = `/api/v1/workspaces/${workspace}/projects`;
const origin = "http://127.0.0.1:3101";
async function login(page: Page, alias = "admin") {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}

test("管理者の作成・編集・アーカイブ・復元とURL検索", async ({ page }) => {
  const name = `画面検証のテスト用プロジェクト-${crypto.randomUUID().slice(0, 8)}`;
  const updatedName = `${name}更新`;
  await login(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/projects?workspace=${workspace}`);
  await page
    .getByRole("button", { name: "プロジェクト作成", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByLabel("プロジェクト名", { exact: true }).fill(name);
  await dialog.getByLabel("説明", { exact: true }).fill("テスト用の説明を保存");
  await dialog.getByLabel("期限（任意）").fill("2026-12-15");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByLabel("プロジェクト名で検索").fill(name);
  await page.getByRole("button", { name: "検索する" }).click();
  await expect(page).toHaveURL(/q=/);
  await page.reload();
  await expect(page.getByLabel("プロジェクト名で検索")).toHaveValue(name);
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await dialog.getByLabel("プロジェクト名", { exact: true }).fill(updatedName);
  await dialog.getByLabel("状態", { exact: true }).selectOption("archived");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: updatedName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(dialog.getByLabel("状態", { exact: true })).toHaveValue(
    "archived",
  );
  await dialog.getByLabel("状態", { exact: true }).selectOption("active");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("状態で絞り込み").selectOption("archived");
  await page.getByRole("button", { name: "検索する" }).click();
  await expect(page.getByText("該当するデータがありません")).toBeVisible();
  await page.getByRole("link", { name: "リセット", exact: true }).click();
  await expect(page.getByLabel("プロジェクト名で検索")).toHaveValue("");
  await expect(page.getByLabel("状態で絞り込み")).toHaveValue("");
  await page.goto(`/projects?workspace=${workspace}&limit=1`);
  const heading = await page.locator("main h2").first().textContent();
  await page.getByRole("link", { name: "次のページ" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator("main h2").first()).not.toHaveText(heading ?? "");
  await page.getByRole("link", { name: "最初のページ" }).click();
  await expect(page.locator("main h2").first()).toHaveText(heading ?? "");
});

test("API入力・再送・権限・競合とダイアログの復旧", async ({ page }) => {
  await login(page);
  const headers = { origin, "Idempotency-Key": crypto.randomUUID() };
  const body = {
    name: `競合検証のテスト用プロジェクト-${crypto.randomUUID().slice(0, 8)}`,
    description: "",
    due_date: null,
  };
  const one = await page.request.post(api, { headers, data: body });
  expect(one.status()).toBe(201);
  const project = (await one.json()).data;
  expect(
    (await (await page.request.post(api, { headers, data: body })).json()).data
      .id,
  ).toBe(project.id);
  expect(
    (
      await page.request.post(api, {
        headers,
        data: { ...body, name: "違う本文" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(api, {
        headers: { ...headers, origin: "https://example.invalid" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(api, { headers: { origin }, data: body })
    ).status(),
  ).toBe(400);
  for (const invalid of [
    { ...body, name: " " },
    { ...body, due_date: "2026-02-30" },
    { ...body, workspace_id: otherWorkspace },
    { ...body, description: "x".repeat(5001) },
  ]) {
    expect(
      (
        await page.request.post(api, {
          headers: { origin, "Idempotency-Key": crypto.randomUUID() },
          data: invalid,
        })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await page.request.post(api, {
        headers: { origin, "Idempotency-Key": crypto.randomUUID() },
        data: { ...body, description: "x".repeat(33000) },
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await page.request.post(`/api/v1/workspaces/${otherWorkspace}/projects`, {
        headers,
        data: body,
      })
    ).status(),
  ).toBe(404);
  expect((await page.request.get(api + "?limit=1&limit=2")).status()).toBe(400);
  const badCursor = Buffer.from(
    JSON.stringify({ time: "2026-02-30T00:00:00Z", id: project.id }),
  ).toString("base64url");
  expect((await page.request.get(api + "?cursor=" + badCursor)).status()).toBe(
    400,
  );
  await page.goto(
    `/projects?workspace=${workspace}&q=${encodeURIComponent(body.name)}`,
  );
  await page.getByRole("button", { name: "編集", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("説明", { exact: true }).fill("保持したい入力");
  const update = {
    ...body,
    status: "active",
    version: 1,
    description: "外部更新",
  };
  expect(
    (
      await page.request.patch(`${api}/${project.id}`, {
        headers: { origin },
        data: update,
      })
    ).status(),
  ).toBe(200);
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "他の操作で更新されました",
  );
  await expect(dialog.getByLabel("説明", { exact: true })).toHaveValue(
    "保持したい入力",
  );
  await dialog
    .getByRole("button", { name: "入力を破棄して最新版を読み直す" })
    .click();
  await expect(dialog.getByLabel("説明", { exact: true })).toHaveValue(
    "外部更新",
  );
  await page.route(
    `**/api/v1/workspaces/${workspace}/projects/${project.id}`,
    (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "検証用の保存失敗" } }),
          })
        : route.continue(),
  );
  await dialog.getByLabel("説明", { exact: true }).fill("失敗後も入力を保持");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog.getByRole("alert")).toContainText("検証用の保存失敗");
  await expect(dialog.getByLabel("説明", { exact: true })).toHaveValue(
    "失敗後も入力を保持",
  );
  await page.unrouteAll();
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).not.toBeVisible();
});

test("閲覧者は変更できず、無所属と別workspaceを分離", async ({ page }) => {
  await login(page, "viewer");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(
    `/projects?workspace=${workspace}&q=${encodeURIComponent("サンプルプロジェクトA")}`,
  );
  await expect(
    page.getByRole("heading", { name: "サンプルプロジェクトA", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "プロジェクト作成" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).not.toBeVisible();
  const headers = { origin, "Idempotency-Key": crypto.randomUUID() };
  expect(
    (
      await page.request.post(api, {
        headers,
        data: { name: "拒否", description: "", due_date: null },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(`${api}/33333333-3333-4333-8333-333333333333`, {
        headers,
        data: {
          name: "拒否",
          description: "",
          due_date: null,
          status: "active",
          version: 1,
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto(`/projects?workspace=${otherWorkspace}`);
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
});
