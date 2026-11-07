import { test, expect } from "@playwright/test";

test("画面デモの全画面とモバイルメニューがCSP違反を起こさない", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction("recordCspViolation", (value: string) =>
    violations.push(value),
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as unknown as { recordCspViolation: (value: string) => void }
      ).recordCspViolation(`${event.effectiveDirective}: ${event.blockedURI}`);
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
  const routes = [
    "/dashboard",
    "/projects",
    "/projects/demo-a/board",
    "/projects/demo-a/issues",
    "/members",
    "/activity",
    "/projects/demo-a/gantt",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/confirm",
    "/workspaces",
    "/login",
  ];
  const nonces = new Set<string>();
  for (const route of routes) {
    const response = await page.goto(route);
    const headers = response!.headers();
    const nonce =
      headers["content-security-policy"].match(/'nonce-([^']+)'/)![1];
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["cache-control"]).toContain("no-store");
    expect(nonces.has(nonce)).toBe(false);
    nonces.add(nonce);
    if (route === "/login")
      await expect(page.getByRole("status")).toContainText(
        "接続設定がありません",
      );
    else if (route === "/workspaces")
      await expect(page.getByRole("status")).toContainText("DB接続は無効です");
    else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const scripts = await page
      .locator("script")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLScriptElement).nonce),
      );
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((value) => value === nonce)).toBe(true);
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
    expect(violations).toEqual([]);
  }
  // Client-side navigation keeps the initial document policy/nonce.
  await page.goto("/projects/demo-a/board");
  await page.getByRole("link", { name: "このプロジェクトの課題" }).click();
  await expect(page).toHaveURL("/projects/demo-a/issues");
  expect(violations).toEqual([]);
});

test("CSPはnonceなしscriptの実行を遮断し、違反を通知する", async ({
  page,
  request,
}) => {
  const root = await request.get("/", { maxRedirects: 0 });
  expect(root.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  );
  const violations: { directive: string; disposition: string }[] = [];
  await page.exposeFunction(
    "recordProbeViolation",
    (value: { directive: string; disposition: string }) =>
      violations.push(value),
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as unknown as {
          recordProbeViolation: (value: {
            directive: string;
            disposition: string;
          }) => void;
        }
      ).recordProbeViolation({
        directive: event.effectiveDirective,
        disposition: event.disposition,
      });
    });
  });
  await page.route("**/dashboard", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        "</body>",
        "<script>document.documentElement.dataset.cspEnforcementProbe = 'executed'</script></body>",
      ),
    });
  });
  const report = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/csp-report") &&
      response.request().method() === "POST",
  );
  await page.goto("/dashboard");
  await expect
    .poll(() => violations)
    .toContainEqual({ directive: "script-src-elem", disposition: "enforce" });
  expect((await report).status()).toBe(204);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-csp-enforcement-probe",
    "executed",
  );
});
