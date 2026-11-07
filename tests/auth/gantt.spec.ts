import { test, expect, type Page } from "@playwright/test";
const wid = "11111111-1111-4111-8111-111111111111";
const origin = "http://127.0.0.1:3101";
async function login(page: Page, alias: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}
test("360pxで開始日を保存し、ガントの日/週・期間移動・未設定と期間外を確認する", async ({
  page,
}) => {
  await login(page, "admin");
  const created = await page.request.post(
    `/api/v1/workspaces/${wid}/projects`,
    {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: `ガント画面確認-${crypto.randomUUID()}`,
        description: "",
        due_date: null,
      },
    },
  );
  expect(created.status()).toBe(201);
  const project = (await created.json()).data;
  const base = `/api/v1/workspaces/${wid}/projects/${project.id}/tasks`;
  const create = async (
    title: string,
    start_date: string | null,
    due_date: string | null,
  ) => {
    const response = await page.request.post(base, {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title,
        description: "",
        priority: "medium",
        assignee_id: null,
        start_date,
        due_date,
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };
  await create("片側だけの期間", null, "2026-12-10");
  await create("表示期間外のタスク", "2027-03-01", "2027-03-10");
  const rejected = await page.request.post(base, {
    headers: { origin, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "逆転日程",
      description: "",
      priority: "medium",
      assignee_id: null,
      start_date: "2026-12-11",
      due_date: "2026-12-10",
    },
  });
  expect(rejected.status()).toBe(400);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/projects/${project.id}/board?workspace=${wid}`);
  await page.getByRole("button", { name: "タスク追加", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("タスク名", { exact: true })
    .fill("開始日を設定したタスク");
  await dialog.getByLabel("開始日（任意）").fill("2026-12-01");
  await dialog.getByLabel("期限（任意）").fill("2026-12-10");
  await dialog.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("link", { name: "ガントチャートへ →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ガントチャート", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("表示の開始日").fill("2026-12-01");
  await page.getByRole("button", { name: "表示する", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "開始日を設定したタスク" });
  await expect(row).toContainText("開始日：2026-12-01");
  await expect(row).toContainText("期限：2026-12-10");
  await expect(
    page.getByRole("row").filter({ hasText: "片側だけの期間" }),
  ).toContainText("期間未設定");
  await expect(
    page.getByRole("row").filter({ hasText: "表示期間外のタスク" }),
  ).toContainText("表示期間外");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("region", { name: "タスクの期間表（横にスクロールできます）" })
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await page.getByLabel("表示単位").selectOption("week");
  await page.getByRole("button", { name: "表示する", exact: true }).click();
  await expect(page).toHaveURL(/unit=week/);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "の週" }),
  ).toHaveCount(12);
  await page.getByRole("link", { name: "次の期間 →", exact: true }).click();
  await expect(page.getByLabel("表示の開始日")).toHaveValue("2027-02-23");
  await login(page, "viewer");
  await page.goto(
    `/projects/${project.id}/gantt?workspace=${wid}&start=2026-12-01`,
  );
  await expect(
    page.getByRole("heading", { name: "ガントチャート", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "開始日を設定したタスク" }),
  ).toBeVisible();
  await login(page, "outside");
  await page.goto(`/projects/${project.id}/gantt?workspace=${wid}`);
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
});

test("ガントは25件ずつページを送り、アーカイブの期間も閲覧できる", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page, "admin");
  const created = await page.request.post(
    `/api/v1/workspaces/${wid}/projects`,
    {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: `ガントページ確認-${crypto.randomUUID()}`,
        description: "",
        due_date: null,
      },
    },
  );
  const project = (await created.json()).data;
  const base = `/api/v1/workspaces/${wid}/projects/${project.id}/tasks`;
  for (let i = 0; i < 26; i++) {
    const response = await page.request.post(base, {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title: `期間ページ確認${i}`,
        description: "",
        priority: "medium",
        assignee_id: null,
        start_date: "2026-12-01",
        due_date: "2026-12-01",
      },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto(
    `/projects/${project.id}/gantt?workspace=${wid}&start=2026-12-01`,
  );
  await expect(page.getByRole("rowheader")).toHaveCount(25);
  await page.getByRole("link", { name: "次の25件 →", exact: true }).click();
  await expect(page.getByRole("rowheader")).toHaveCount(1);
  await page.getByRole("link", { name: "最初のページ", exact: true }).click();
  await expect(page.getByRole("rowheader")).toHaveCount(25);
  const archived = await page.request.patch(
    `/api/v1/workspaces/${wid}/projects/${project.id}`,
    {
      headers: { origin },
      data: {
        name: project.name,
        description: "",
        status: "archived",
        due_date: null,
        version: project.version,
      },
    },
  );
  expect(archived.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "アーカイブ済み" }),
  ).toContainText("アーカイブ済み");
  await expect(page.getByRole("rowheader")).toHaveCount(25);
});
