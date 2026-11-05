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
    "/workspaces",
    "/login",
  ];
  const nonces = new Set<string>();
  for (const route of routes) {
    const response = await page.goto(route);
    const headers = response!.headers();
    const nonce =
      headers["content-security-policy-report-only"].match(
        /'nonce-([^']+)'/,
      )![1];
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["cache-control"]).toContain("no-store");
    expect(nonces.has(nonce)).toBe(false);
    nonces.add(nonce);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
  await page
    .getByRole("link", { name: "このプロジェクトの課題", exact: true })
    .click();
  await expect(page).toHaveURL("/projects/demo-a/issues");
  expect(violations).toEqual([]);
});

test("Report-Onlyはnonceなしscriptを検出し、まだ実行を遮断しない", async ({
  page,
  request,
}) => {
  const root = await request.get("/", { maxRedirects: 0 });
  expect(root.headers()["content-security-policy-report-only"]).toContain(
    "'strict-dynamic'",
  );
  await page.goto("/dashboard");
  const violation = await page.evaluate(
    () =>
      new Promise<{ directive: string; disposition: string }>((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (event) =>
            resolve({
              directive: event.effectiveDirective,
              disposition: event.disposition,
            }),
          { once: true },
        );
        const script = document.createElement("script");
        script.textContent =
          "document.documentElement.dataset.cspReportOnlyProbe = 'executed'";
        document.body.appendChild(script);
      }),
  );
  expect(violation.directive).toBe("script-src-elem");
  expect(violation.disposition).toBe("report");
  await expect(page.locator("html")).toHaveAttribute(
    "data-csp-report-only-probe",
    "executed",
  );
});
