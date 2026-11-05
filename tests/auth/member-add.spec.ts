import { test, expect, type Page } from "@playwright/test";
import {
  localSettings,
  login as dbLogin,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
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
async function fixture() {
  const settings = localSettings(),
    service = adminClient(settings),
    owner = await dbLogin(settings, "admin"),
    target = await dbLogin(settings, "unassigned"),
    viewer = await dbLogin(settings, "viewer"),
    member = await dbLogin(settings, "member");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "所属追加画面検証のテスト用スペース",
    }),
  );
  checked(
    await service.from("memberships").insert([
      { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
      { workspace_id: wid, user_id: member.user.id, role: "member" },
    ]),
  );
  return {
    wid,
    uid: target.user.id,
    async cleanup() {
      localSql(
        `delete from private.member_requests where workspace_id='${wid}'`,
      );
      for (const table of ["memberships", "activity_logs"])
        checked(await service.from(table).delete().eq("workspace_id", wid));
      checked(await service.from("workspaces").delete().eq("id", wid));
    },
  };
}
test("所属追加APIは再送可能で入力・認証・権限を検査する", async ({ page }) => {
  const f = await fixture();
  try {
    const api = `/api/v1/workspaces/${f.wid}/members`,
      body = { user_id: f.uid, role: "viewer" },
      headers = { origin, "Idempotency-Key": crypto.randomUUID() };
    await login(page, "admin");
    for (const data of [
      { ...body, role: "invalid" },
      { ...body, user_id: "invalid" },
      { role: "viewer" },
      { ...body, extra: true },
    ])
      expect((await page.request.post(api, { headers, data })).status()).toBe(
        400,
      );
    expect(
      (
        await page.request.post(api, { headers: { origin }, data: body })
      ).status(),
    ).toBe(400);
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
        await page.request.post(api, {
          headers: { ...headers, "Content-Type": "text/plain" },
          data: JSON.stringify(body),
        })
      ).status(),
    ).toBe(415);
    expect(
      (
        await page.request.post(api, {
          headers,
          data: { ...body, user_id: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(api, {
          headers,
          data: { ...body, extra: "x".repeat(33000) },
        })
      ).status(),
    ).toBe(413);
    const created = await page.request.post(api, { headers, data: body });
    expect(created.status()).toBe(201);
    expect(created.headers()["cache-control"]).toBe("private, no-store");
    const result = await created.json();
    expect(result.data.role).toBe("viewer");
    expect(
      await (await page.request.post(api, { headers, data: body })).json(),
    ).toEqual(result);
    const conflict = await page.request.post(api, {
      headers,
      data: { ...body, role: "admin" },
    });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    const duplicate = await page.request.post(api, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { ...body, role: "admin" },
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error.code).toBe("ALREADY_MEMBER");
    for (const alias of ["member", "viewer"]) {
      await login(page, alias);
      expect(
        (await page.request.post(api, { headers, data: body })).status(),
      ).toBe(403);
      await page.goto(`/members?workspace=${f.wid}`);
      await expect(
        page.getByRole("button", { name: "メンバーを追加", exact: true }),
      ).toHaveCount(0);
    }
    await login(page, "outside");
    expect(
      (await page.request.post(api, { headers, data: body })).status(),
    ).toBe(404);
    await login(page, "unassigned");
    await page.goto(`/members?workspace=${f.wid}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "メンバー", exact: true }),
    ).toBeVisible();
    await page.context().clearCookies();
    expect(
      (await page.request.post(api, { headers, data: body })).status(),
    ).toBe(401);
  } finally {
    await f.cleanup();
  }
});
test("360pxの追加確認・入力保持・通信再試行・成功とフォーカス復帰", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await login(page, "admin");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/members?workspace=${f.wid}`);
    const trigger = page.getByRole("button", {
      name: "メンバーを追加",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("追加するロール", { exact: true }),
    ).toHaveValue("viewer");
    await dialog
      .getByLabel("登録済みユーザーID", { exact: true })
      .fill(crypto.randomUUID());
    await dialog
      .getByRole("button", { name: "追加内容を確認", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("全プロジェクト");
    await dialog
      .getByRole("button", { name: "確認して追加", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("見つかりません");
    await dialog.getByRole("button", { name: "見直す", exact: true }).click();
    await expect(
      dialog.getByLabel("登録済みユーザーID", { exact: true }),
    ).not.toHaveValue("");
    await dialog.getByLabel("登録済みユーザーID", { exact: true }).fill(f.uid);
    await dialog
      .getByRole("button", { name: "追加内容を確認", exact: true })
      .click();
    let firstKey: string | undefined;
    let retriedKey: string | undefined;
    await page.route(`**/api/v1/workspaces/${f.wid}/members`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (!firstKey) {
        firstKey = route.request().headers()["idempotency-key"];
        await route.fetch();
        return route.abort();
      }
      retriedKey = route.request().headers()["idempotency-key"];
      await route.continue();
    });
    await dialog
      .getByRole("button", { name: "確認して追加", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("同じ入力で再試行");
    await dialog
      .getByRole("button", { name: "確認して追加", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(retriedKey).toBe(firstKey);
    await expect(
      page.getByRole("article", { name: "デモメンバー05", exact: true }),
    ).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  } finally {
    await f.cleanup();
  }
});

test("所属先切替では前のユーザーIDと確認状態を引き継がない", async ({
  page,
}) => {
  const first = await fixture(),
    second = await fixture();
  try {
    await login(page, "admin");
    await page.goto(`/members?workspace=${first.wid}`);
    await page
      .getByRole("button", { name: "メンバーを追加", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("登録済みユーザーID", { exact: true })
      .fill(first.uid);
    await dialog
      .getByLabel("追加するロール", { exact: true })
      .selectOption("admin");
    await dialog
      .getByRole("button", { name: "追加内容を確認", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await page
      .getByLabel("ワークスペース", { exact: true })
      .selectOption(second.wid);
    await page.getByRole("button", { name: "絞り込む", exact: true }).click();
    await page
      .getByRole("button", { name: "メンバーを追加", exact: true })
      .click();
    await expect(
      dialog.getByLabel("登録済みユーザーID", { exact: true }),
    ).toHaveValue("");
    await expect(
      dialog.getByLabel("追加するロール", { exact: true }),
    ).toHaveValue("viewer");
    await expect(
      dialog.getByRole("button", { name: "追加内容を確認", exact: true }),
    ).toBeVisible();
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});
