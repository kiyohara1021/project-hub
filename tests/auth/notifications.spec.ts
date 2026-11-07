import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { checked, demoPassword } from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
import { notificationFixture } from "../helpers/notification-fixture.mjs";

const origin = "http://127.0.0.1:3101";
const api = "/api/v1/me/notifications";
async function login(page: Page, alias: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}

test("通知APIは本人・現在の権限・入力・Originを検証し、同時刻のページ送りと既読を維持する", async ({
  page,
}) => {
  const f = await notificationFixture();
  try {
    expect((await page.request.get(api)).status()).toBe(401);
    expect((await page.request.get(`${api}/unread-count`)).status()).toBe(401);
    expect(
      (
        await page.request.post(`${api}/read-all`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
    await login(page, f.alias);
    expect(
      (await (await page.request.get(`${api}/unread-count`)).json())
        .unreadCount,
    ).toBe(2);
    for (const query of [
      "?unknown=1",
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=1&limit=2",
      "?unread=0",
      "?unread=1&unread=1",
      "?cursor=invalid",
      "?cursor=",
    ])
      expect((await page.request.get(`${api}${query}`)).status()).toBe(400);
    expect(
      (await page.request.get(`${api}/unread-count?unknown=1`)).status(),
    ).toBe(400);
    for (const [headers, data, status] of [
      [{ origin: "https://example.invalid" }, {}, 403],
      [{ origin, "Content-Type": "text/plain" }, "{}", 415],
      [{ origin }, { other: true }, 400],
      [{ origin }, { payload: "x".repeat(33000) }, 413],
    ] as const)
      expect(
        (
          await page.request.post(`${api}/read-all`, { headers, data })
        ).status(),
      ).toBe(status);
    expect(
      (
        await page.request.post(`${api}/invalid/read`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(400);
    const other = checked(
      await f.service
        .from("user_notifications")
        .insert({
          recipient_id: f.owner.user.id,
          workspace_id: f.wid,
          project_id: f.project.id,
          entity_type: "tasks",
          entity_id: f.task.id,
          kind: "assigned_task",
          source_id: randomUUID(),
          source_version: 1,
        })
        .select("id")
        .single(),
    );
    for (const id of [other.id, randomUUID()])
      expect(
        (
          await page.request.post(`${api}/${id}/read`, {
            headers: { origin },
            data: {},
          })
        ).status(),
      ).toBe(404);
    const sameTime = new Date().toISOString();
    checked(
      await f.service.from("user_notifications").insert(
        Array.from({ length: 30 }, () => ({
          recipient_id: f.recipient.user.id,
          workspace_id: f.wid,
          project_id: f.project.id,
          entity_type: "tasks",
          entity_id: f.task.id,
          kind: "assigned_task",
          source_id: randomUUID(),
          source_version: 1,
          created_at: sameTime,
        })),
      ),
    );
    const response = await page.request.get(api);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const first = await response.json();
    expect(first.unreadCount).toBe(32);
    expect(first.data).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    const second = await (
      await page.request.get(`${api}?cursor=${first.nextCursor}`)
    ).json();
    expect(second.data).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.data, ...second.data].map((row) => row.id)).size,
    ).toBe(32);
    expect(JSON.stringify(first)).not.toContain("通知に複製しない");
    expect(Object.keys(first.data[0]).sort()).toEqual(
      [
        "id",
        "workspace_id",
        "project_id",
        "entity_type",
        "entity_id",
        "kind",
        "created_at",
        "read_at",
      ].sort(),
    );
    const id = first.data[0].id;
    const marked = await page.request.post(`${api}/${id}/read`, {
      headers: { origin },
      data: {},
    });
    expect(marked.status()).toBe(200);
    expect((await marked.json()).data).toEqual({ id });
    const originalRead = checked(
      await f.service
        .from("user_notifications")
        .select("read_at")
        .eq("id", id)
        .single(),
    ).read_at;
    expect(
      (
        await page.request.post(`${api}/${id}/read`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(200);
    expect(
      checked(
        await f.service
          .from("user_notifications")
          .select("read_at")
          .eq("id", id)
          .single(),
      ).read_at,
    ).toBe(originalRead);
    const unread = await (
      await page.request.get(`${api}?unread=1&limit=100`)
    ).json();
    expect(unread.unreadCount).toBe(31);
    expect(unread.data).toHaveLength(31);
    expect(unread.data.some((row: { id: string }) => row.id === id)).toBe(
      false,
    );
    const all = await page.request.post(`${api}/read-all`, {
      headers: { origin },
      data: {},
    });
    expect((await all.json()).data.updated).toBe(31);
    expect(
      (await (await page.request.get(`${api}/unread-count`)).json())
        .unreadCount,
    ).toBe(0);
    expect(
      checked(
        await f.service
          .from("user_notifications")
          .select("read_at")
          .eq("id", other.id)
          .single(),
      ).read_at,
    ).toBeNull();
    await page.context().clearCookies();
    expect(
      (
        await page.request.post(`${api}/${id}/read`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
  } finally {
    await f.cleanup();
  }
});

test("360pxで通知・ページ送り・未読バッジと既読を確認し、通信/読取失敗から復旧する", async ({
  page,
}) => {
  const f = await notificationFixture();
  let revoked = false;
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, f.alias);
    await page.goto("/notifications?limit=1");
    await expect(
      page.getByRole("heading", { name: "通知", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "通知（未読2件）", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("link", { name: "次のページ", exact: true }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("link", { name: "最初のページ", exact: true }).click();
    await expect(page).toHaveURL("/notifications?limit=1");
    let fail = true;
    await page.route("**/api/v1/me/notifications/*/read", async (route) => {
      if (fail) {
        fail = false;
        return route.abort();
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "既読にする", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "もう一度",
    );
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "既読にする", exact: true }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "通知を既読にしました。",
    );
    await expect(page.getByLabel("通知の未読件数")).toHaveText("未読 1件");
    await expect(
      page.getByRole("link", { name: "通知（未読1件）", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "すべて既読にする", exact: true })
      .click();
    await expect(page.getByLabel("通知の未読件数")).toHaveText("未読 0件");
    await expect(
      page.getByRole("link", { name: "通知（未読0件）", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "通知の絞り込み" })
      .getByRole("link", { name: "未読のみ", exact: true })
      .click();
    await expect(
      page.getByText("未読の通知はありません", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    localSql("revoke select on public.user_notifications from authenticated;");
    revoked = true;
    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", {
        name: "通知を表示できませんでした",
        exact: true,
      }),
    ).toBeVisible();
    localSql("grant select on public.user_notifications to authenticated;");
    revoked = false;
    await page.getByRole("button", { name: "再試行する", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "通知", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
  } finally {
    if (revoked)
      localSql("grant select on public.user_notifications to authenticated;");
    await f.cleanup();
  }
});
