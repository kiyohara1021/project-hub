import { test, expect } from "@playwright/test";

const workspace = "11111111-1111-4111-8111-111111111111";
const project = "33333333-3333-4333-8333-333333333333";

for (const width of [360, 1280]) {
  test(`${width}pxの接続画面・Sheet・編集ダイアログでCSP違反を起こさない`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const violations: string[] = [];
    await page.exposeFunction("recordCspViolation", (value: string) =>
      violations.push(value),
    );
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (
          window as unknown as { recordCspViolation: (value: string) => void }
        ).recordCspViolation(
          `${event.effectiveDirective}: ${event.blockedURI}`,
        );
      });
    });
    page.on("console", (message) => {
      if (
        /violates the following Content Security Policy|Refused to (?:execute|apply|load|connect)/i.test(
          message.text(),
        )
      )
        violations.push(message.text());
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("admin@example.invalid");
    await page
      .getByLabel("パスワード", { exact: true })
      .fill("Local-Demo-Only-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
    const routes = [
      ["/workspaces", ""],
      [`/dashboard?workspace=${workspace}`, ""],
      [`/projects?workspace=${workspace}`, "プロジェクト作成"],
      [`/projects/${project}/board?workspace=${workspace}`, "タスク追加"],
      [`/projects/${project}/issues?workspace=${workspace}`, "課題追加"],
      [`/members?workspace=${workspace}`, "メンバーを追加"],
      [`/activity?workspace=${workspace}`, ""],
      [`/projects/${project}/gantt?workspace=${workspace}`, ""],
      ["/signup", ""],
      ["/forgot-password", ""],
      ["/confirm", ""],
      ["/reset-password", ""],
    ];
    const nonces = new Set<string>();
    for (const [url, trigger] of routes) {
      const response = await page.goto(url);
      const headers = response!.headers();
      const nonce =
        headers["content-security-policy"].match(/'nonce-([^']+)'/)![1];
      expect(headers["content-security-policy-report-only"]).toBeUndefined();
      expect(headers["cache-control"]).toContain("no-store");
      expect(nonces.has(nonce)).toBe(false);
      nonces.add(nonce);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const scriptNonces = await page
        .locator("script")
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLScriptElement).nonce),
        );
      expect(scriptNonces.length).toBeGreaterThan(0);
      expect(scriptNonces.every((value) => value === nonce)).toBe(true);
      const menu = page.getByRole("button", {
        name: "メニューを開く",
        exact: true,
      });
      if (await menu.isVisible()) {
        await menu.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(await page.locator("style").count()).toBeGreaterThan(0);
        expect(
          await page
            .locator("style")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  (element as HTMLStyleElement).nonce ===
                  document.querySelector<HTMLScriptElement>("script[nonce]")
                    ?.nonce,
              ),
            ),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
      }
      if (trigger) {
        await page.getByRole("button", { name: trigger, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(await page.locator("style").count()).toBeGreaterThan(0);
        expect(
          await page
            .locator("style")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  (element as HTMLStyleElement).nonce ===
                  document.querySelector<HTMLScriptElement>("script[nonce]")
                    ?.nonce,
              ),
            ),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
      }
      if (url.includes("/issues?")) {
        await page
          .getByRole("button", { name: "コメント", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("dialog", { name: "課題コメント", exact: true }),
        ).toBeVisible();
        expect(await page.locator("style").count()).toBeGreaterThan(0);
        expect(
          await page
            .locator("style")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  (element as HTMLStyleElement).nonce ===
                  document.querySelector<HTMLScriptElement>("script[nonce]")
                    ?.nonce,
              ),
            ),
        ).toBe(true);
        await expect(
          page.getByRole("dialog").locator("[aria-busy]"),
        ).toHaveAttribute("aria-busy", "false");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
      }
      expect(violations).toEqual([]);
    }
    // RSC updates use new request nonces; dialogs must keep the document nonce.
    await page.goto(`/dashboard?workspace=${workspace}`);
    await page
      .getByRole("button", { name: "最新の状況を取得", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "最新の状況を取得", exact: true }),
    ).toBeEnabled();
    const menu = page.getByRole("button", {
      name: "メニューを開く",
      exact: true,
    });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "メインメニュー" })
      .filter({ visible: true })
      .getByRole("link", { name: "プロジェクト一覧", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "プロジェクト名で検索" })
      .fill("サンプルプロジェクトA");
    await page
      .getByRole("link", { name: "サンプルプロジェクトA", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project}/board`));
    await page.getByRole("button", { name: "タスク追加", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.locator("style").count()).toBeGreaterThan(0);
    expect(
      await page
        .locator("style")
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              (element as HTMLStyleElement).nonce ===
              document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce,
          ),
        ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(violations).toEqual([]);
  });
}
