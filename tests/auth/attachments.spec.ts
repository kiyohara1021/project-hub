import { test, expect, type Page } from "@playwright/test";
const wid = "11111111-1111-4111-8111-111111111111",
  origin = "http://127.0.0.1:3101";
async function login(page: Page, alias: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}
async function fixture(page: Page) {
  await login(page, "admin");
  const response = await page.request.post(
    `/api/v1/workspaces/${wid}/projects`,
    {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: `添付画面確認-${crypto.randomUUID()}`,
        description: "",
        due_date: null,
      },
    },
  );
  expect(response.status()).toBe(201);
  const project = (await response.json()).data;
  const taskResponse = await page.request.post(
    `/api/v1/workspaces/${wid}/projects/${project.id}/tasks`,
    {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title: "資料を添付するタスク",
        description: "",
        priority: "medium",
        assignee_id: null,
        due_date: null,
      },
    },
  );
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()).data;
  return {
    project,
    task,
    board: `/projects/${project.id}/board?workspace=${wid}`,
    base: `/api/v1/workspaces/${wid}/projects/${project.id}/tasks/${task.id}/attachments`,
  };
}
const file = {
  name: "確認資料.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("添付ファイルの画面確認\n"),
};

test("360pxで添付を送信・ダウンロードし、閲覧者の権限と管理者の確認削除を検証する", async ({
  page,
}) => {
  const f = await fixture(page);
  await login(page, "member");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(f.board);
  await page
    .getByRole("article", { name: f.task.title, exact: true })
    .getByRole("button", { name: "添付ファイル", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "添付ファイル", exact: true });
  await expect(
    dialog.getByText("添付ファイルはありません", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("添付するファイル").setInputFiles(file);
  await dialog
    .getByRole("button", { name: "アップロード", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: file.name, exact: true }),
  ).toBeVisible();
  const list = await page.request.get(f.base);
  expect(list.status()).toBe(200);
  const row = (await list.json()).data[0];
  const content = await page.request.get(`${f.base}/${row.id}`);
  expect(content.status()).toBe(200);
  expect(content.headers()["content-disposition"]).toContain("attachment;");
  expect(content.headers()["x-content-type-options"]).toBe("nosniff");
  expect(content.headers()["cache-control"]).toContain("no-store");
  expect(await content.text()).toBe(file.buffer.toString());
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await login(page, "viewer");
  await page.goto(f.board);
  await page
    .getByRole("article", { name: f.task.title, exact: true })
    .getByRole("button", { name: "添付ファイル", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "添付ファイル", exact: true });
  await expect(
    dialog.getByRole("link", { name: file.name, exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("添付するファイル")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "削除…", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.delete(`${f.base}/${row.id}`, { headers: { origin } })
    ).status(),
  ).toBe(403);
  expect((await page.request.get(`${f.base}/${row.id}`)).status()).toBe(200);
  await login(page, "outside");
  expect((await page.request.get(f.base)).status()).toBe(404);
  await login(page, "admin");
  await page.goto(f.board);
  await page
    .getByRole("article", { name: f.task.title, exact: true })
    .getByRole("button", { name: "添付ファイル", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "添付ファイル", exact: true });
  await dialog.getByRole("button", { name: "削除…", exact: true }).click();
  await expect(
    dialog.getByText(`「${file.name}」を削除します。元に戻せません。`, {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "削除をやめる", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: file.name, exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "削除…", exact: true }).click();
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    dialog.getByText("添付ファイルはありません", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(`${f.base}/${row.id}`)).status()).toBe(404);
});

test("添付APIは形式・容量・再送・親の整合・アーカイブを検査する", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const f = await fixture(page);
  const key = crypto.randomUUID();
  const upload = async (payload = file, requestKey = crypto.randomUUID()) =>
    page.request.post(f.base, {
      headers: { origin, "Idempotency-Key": requestKey },
      multipart: { file: payload },
    });
  const created = await upload(file, key);
  expect(created.status()).toBe(201);
  const row = (await created.json()).data;
  const repeated = await upload(file, key);
  expect(repeated.status()).toBe(201);
  expect((await repeated.json()).data.id).toBe(row.id);
  expect(
    (
      await upload({ ...file, buffer: Buffer.from("異なる本文") }, key)
    ).status(),
  ).toBe(409);
  for (const invalid of [
    { ...file, name: "偽装.png", mimeType: "image/png" },
    { ...file, name: "危険.html", mimeType: "text/html" },
    { ...file, buffer: Buffer.from([255, 254, 0, 0]) },
  ])
    expect((await upload(invalid)).status()).toBe(400);
  expect(
    (
      await upload({ ...file, buffer: Buffer.alloc(3 * 1024 * 1024 + 1, 65) })
    ).status(),
  ).toBe(413);
  expect(
    (
      await page.request.post(f.base, {
        headers: {
          origin: "https://unrelated.invalid",
          "Idempotency-Key": crypto.randomUUID(),
        },
        multipart: { file },
      })
    ).status(),
  ).toBe(403);
  const wrongTarget = `/api/v1/workspaces/${wid}/projects/${f.project.id}/tasks/${crypto.randomUUID()}/attachments/${row.id}`;
  expect((await page.request.get(wrongTarget)).status()).toBe(404);
  const issueResponse = await page.request.post(
    `/api/v1/workspaces/${wid}/projects/${f.project.id}/issues`,
    {
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title: "添付する課題",
        description: "",
        priority: "medium",
        assignee_id: null,
        due_date: null,
      },
    },
  );
  expect(issueResponse.status()).toBe(201);
  const issue = (await issueResponse.json()).data;
  const issueBase = `/api/v1/workspaces/${wid}/projects/${f.project.id}/issues/${issue.id}/attachments`;
  const issueFile = await page.request.post(issueBase, {
    headers: { origin, "Idempotency-Key": crypto.randomUUID() },
    multipart: { file },
  });
  expect(issueFile.status()).toBe(201);
  const second = (await issueFile.json()).data;
  await page.goto(`/projects/${f.project.id}/issues?workspace=${wid}`);
  await page
    .getByRole("button", { name: "添付ファイル", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "添付ファイル", exact: true })
      .getByRole("link", { name: file.name, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "添付ファイル", exact: true }),
  ).not.toBeVisible();
  const archived = await page.request.patch(
    `/api/v1/workspaces/${wid}/projects/${f.project.id}`,
    {
      headers: { origin },
      data: {
        name: f.project.name,
        description: "",
        status: "archived",
        due_date: null,
        version: f.project.version,
      },
    },
  );
  expect(archived.status()).toBe(200);
  expect((await upload()).status()).toBe(409);
  expect((await page.request.get(`${f.base}/${row.id}`)).status()).toBe(200);
  expect(
    (
      await page.request.delete(`${f.base}/${row.id}`, { headers: { origin } })
    ).status(),
  ).toBe(409);
  const latest = (await archived.json()).data;
  expect(
    (
      await page.request.patch(
        `/api/v1/workspaces/${wid}/projects/${f.project.id}`,
        {
          headers: { origin },
          data: {
            name: f.project.name,
            description: "",
            status: "active",
            due_date: null,
            version: latest.version,
          },
        },
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.delete(`${f.base}/${row.id}`, { headers: { origin } })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.delete(`${issueBase}/${second.id}`, {
        headers: { origin },
      })
    ).ok(),
  ).toBe(true);
});
