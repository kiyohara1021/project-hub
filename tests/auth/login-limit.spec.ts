import { test, expect } from "@playwright/test";

test("ログイン制限の案内から通常のログインを再試行できる", async ({ page }) => {
  await page.goto("/login?error=rate_limit");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "ログインの試行が制限されています。" }),
  ).toHaveText(
    "ログインの試行が制限されています。しばらく待ってから、もう一度お試しください。",
  );
  await page.getByLabel("メールアドレス").fill("admin@example.invalid");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});
