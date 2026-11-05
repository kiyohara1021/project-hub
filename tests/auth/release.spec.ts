import { test, expect, type Page, type Locator } from "@playwright/test";
const wid = "11111111-1111-4111-8111-111111111111",
  pid = "33333333-3333-4333-8333-333333333333";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("admin@example.invalid");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/workspaces$/);
}
async function dialogKeys(page: Page, trigger: Locator) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((e) => e.contains(document.activeElement))).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
}
for (const width of [360, 1280])
  test(`${width}pxで6画面・本文スキップ・キーボードダイアログ・ログアウト`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await login(page);
    const routes = [
      ["ダッシュボード", "/dashboard"],
      ["プロジェクト一覧", "/projects"],
      ["カンバン", `/projects/${pid}/board`],
      ["課題一覧", `/projects/${pid}/issues`],
      ["メンバー", "/members"],
      ["操作履歴", "/activity"],
    ];
    for (const [title, path] of routes) {
      const response = await page.goto(`${path}?workspace=${wid}`);
      expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response?.headers()["x-frame-options"]).toBe("DENY");
      expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      await expect(
        page.getByRole("heading", { level: 1, name: title, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "本文へ移動", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 360) {
        const trigger = page.getByRole("button", {
          name: "メニューを開く",
          exact: true,
        });
        await dialogKeys(page, trigger);
      }
      if (title === "プロジェクト一覧")
        await dialogKeys(
          page,
          page.getByRole("button", { name: "プロジェクト作成", exact: true }),
        );
      if (title === "カンバン")
        await dialogKeys(
          page,
          page.getByRole("button", { name: "タスク追加", exact: true }),
        );
      if (title === "課題一覧")
        await dialogKeys(
          page,
          page.getByRole("button", { name: "課題追加", exact: true }),
        );
      if (title === "メンバー")
        await dialogKeys(
          page,
          page
            .getByRole("article", { name: "デモメンバー02", exact: true })
            .getByRole("button", { name: "権限を管理", exact: true }),
        );
    }
    await page.goto("/workspaces");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "ログイン状況",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ログアウト", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await page.request.get(`/api/v1/workspaces/${wid}/activity`)).status(),
    ).toBe(401);
  });
