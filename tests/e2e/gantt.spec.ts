import { test, expect } from "@playwright/test";

test("画面デモのガントは日/週を切り替え、タスク期間を表示する", async ({
  page,
}) => {
  await page.goto("/projects/demo-a/board");
  await page
    .getByRole("link", { name: "ガントチャートへ →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ガントチャート", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("表示の開始日").fill("2026-11-01");
  await page.getByLabel("表示単位").selectOption("week");
  await page.getByRole("button", { name: "表示する", exact: true }).click();
  await expect(page.getByRole("rowheader")).toHaveCount(6);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "の週" }),
  ).toHaveCount(12);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/projects/demo-b/gantt");
  await expect(
    page.getByText("タスクはまだありません", { exact: true }),
  ).toBeVisible();
});
