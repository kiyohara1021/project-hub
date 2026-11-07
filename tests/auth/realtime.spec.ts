import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
async function connected(page: Page) {
  await expect(page.getByRole("status", { name: "同期状態" })).toHaveText(
    "接続済み",
    { timeout: 20000 },
  );
}
async function fixture() {
  const settings = localSettings(),
    service = adminClient(settings);
  const owner = await dbLogin(settings, "admin"),
    member = await dbLogin(settings, "member");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "リアルタイム検証用スペース",
    }),
  );
  checked(
    await service
      .from("memberships")
      .insert({ workspace_id: wid, user_id: member.user.id, role: "member" }),
  );
  const project = checked(
    await service
      .from("projects")
      .insert({ workspace_id: wid, name: "同期検証用プロジェクト" })
      .select()
      .single(),
  );
  return {
    wid,
    project,
    service,
    owner,
    member,
    board: `/projects/${project.id}/board?workspace=${wid}`,
    base: `/api/v1/workspaces/${wid}/projects/${project.id}/tasks`,
    async cleanup() {
      for (const table of [
        "project_requests",
        "task_requests",
        "issue_requests",
        "comment_requests",
        "member_requests",
      ])
        localSql(`delete from private.${table} where workspace_id='${wid}'`);
      for (const table of [
        "tasks",
        "issues",
        "projects",
        "memberships",
        "activity_logs",
      ])
        checked(await service.from(table).delete().eq("workspace_id", wid));
      checked(await service.from("workspaces").delete().eq("id", wid));
    },
  };
}
async function create(page: Page, base: string, title: string) {
  const response = await page.request.post(base, {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: {
      title,
      description: "",
      priority: "medium",
      assignee_id: null,
      due_date: null,
    },
  });
  expect(response.status()).toBe(201);
}

test("別の認証セッションの変更を反映し、ダイアログと未保存入力を保持する", async ({
  page,
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({ baseURL: origin }),
    other = await context.newPage();
  try {
    await login(page, "admin");
    await login(other, "member");
    await other.goto(f.board);
    await connected(other);
    await create(page, f.base, "別セッションからの追加");
    await expect(
      other.getByRole("article", {
        name: "別セッションからの追加",
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    await other
      .getByRole("button", { name: "タスク追加", exact: true })
      .click();
    const dialog = other.getByRole("dialog", {
      name: "タスク追加",
      exact: true,
    });
    await create(page, f.base, "ダイアログ表示中の追加");
    const banner = other.getByRole("status", { name: "画面の更新" });
    await expect(banner).toContainText("更新があります", { timeout: 20000 });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("タスク名", { exact: true }).fill("未保存の入力");
    await create(page, f.base, "入力中の追加");
    await expect(banner).toContainText("入力内容は保持しています");
    await expect(dialog.getByLabel("タスク名", { exact: true })).toHaveValue(
      "未保存の入力",
    );
    await expect(
      other.getByRole("article", { name: "入力中の追加", exact: true }),
    ).toHaveCount(0);
    await banner
      .getByRole("button", { name: "入力を破棄して再読込", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      other.getByRole("article", { name: "入力中の追加", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await f.cleanup();
  }
});

test("オフライン復帰で取りこぼしを取得し、参加失効とログアウトで購読を終了する", async ({
  page,
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({ baseURL: origin }),
    other = await context.newPage();
  try {
    await login(page, "admin");
    await login(other, "member");
    await other.goto(f.board);
    await connected(other);
    await context.setOffline(true);
    await expect(
      other.getByRole("status", { name: "画面の更新" }),
    ).toContainText("更新の受信が止まっています");
    await create(page, f.base, "切断中の追加");
    await context.setOffline(false);
    await connected(other);
    await expect(
      other.getByRole("article", { name: "切断中の追加", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    checked(
      await f.owner.client.rpc("remove_member", {
        p_workspace_id: f.wid,
        p_user_id: f.member.user.id,
      }),
    );
    await expect(
      other.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeVisible({ timeout: 20000 });
    await other.goto("/workspaces");
    await connected(other);
    const sockets: { closed: boolean }[] = [];
    // Capture a fresh provider connection so closure is observable without reading SDK internals.
    other.on("websocket", (socket) => {
      const state = { closed: false };
      sockets.push(state);
      socket.on("close", () => {
        state.closed = true;
      });
    });
    await other.reload();
    await connected(other);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    // Observe transport shutdown before navigation destroys the old document's
    // Playwright socket observer. The logout request still reaches the real server.
    await other.route("**/auth/logout", async (route) => {
      await expect
        .poll(() => sockets.every((socket) => socket.closed), {
          timeout: 15000,
        })
        .toBe(true);
      await route.continue();
    });
    await other
      .getByRole("button", { name: "ログアウト", exact: true })
      .click();
    await expect(other).toHaveURL(/\/login/);
    await expect(other.getByRole("status", { name: "同期状態" })).toHaveCount(
      0,
    );
    await expect
      .poll(() => sockets.every((socket) => socket.closed))
      .toBe(true);
  } finally {
    await context.setOffline(false);
    await context.close();
    await f.cleanup();
  }
});

test("非公開の非参加者と別ワークスペースのユーザーにイベントを漏らさない", async ({
  page,
  browser,
}) => {
  const f = await fixture();
  const contexts = await Promise.all([
    browser.newContext({ baseURL: origin }),
    browser.newContext({ baseURL: origin }),
  ]);
  try {
    const viewer = await dbLogin(localSettings(), "viewer"),
      outside = await dbLogin(localSettings(), "outside");
    checked(
      await f.service.from("memberships").insert({
        workspace_id: f.wid,
        user_id: viewer.user.id,
        role: "viewer",
      }),
    );
    const privateProject = checked(
      await f.owner.client.rpc("set_project_access", {
        p_workspace_id: f.wid,
        p_project_id: f.project.id,
        p_visibility: "private",
        p_member_ids: [f.member.user.id],
        p_version: f.project.version,
      }),
    );
    expect(privateProject.visibility).toBe("private");
    const received: string[][] = [[], []];
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    for (const [index, alias] of ["viewer", "outside"].entries()) {
      pages[index].on("websocket", (socket) =>
        socket.on("framereceived", (frame) => {
          const payload = String(frame.payload);
          if (payload.includes('"event":"postgres_changes"'))
            received[index].push(payload);
        }),
      );
      await login(pages[index], alias);
      await connected(pages[index]);
    }
    await login(page, "admin");
    await page.goto(f.board);
    await connected(page);
    // The authorized browser receiving the same write is the positive control.
    const marker = new Date().toISOString();
    await create(page, f.base, "非参加者に届かない変更");
    await expect(
      page.getByRole("article", {
        name: "非参加者に届かない変更",
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    for (const user of [viewer, outside]) {
      const rows = checked(
        await user.client
          .from("realtime_updates")
          .select("*")
          .eq("user_id", f.owner.user.id),
      );
      expect(rows).toEqual([]);
      expect(
        checked(
          await user.client
            .from("realtime_updates")
            .select("id")
            .gte("created_at", marker),
        ),
      ).toEqual([]);
      expect(
        checked(
          await user.client
            .from("tasks")
            .select("id")
            .eq("project_id", f.project.id),
        ),
      ).toEqual([]);
    }
    // Allow an unauthorized delivery queued beside the positive control to surface.
    await page.waitForTimeout(1500);
    expect(received.map((events) => events.length)).toEqual([0, 0]);
    for (const target of pages) {
      await expect(
        target.getByRole("status", { name: "画面の更新" }),
      ).toHaveCount(0);
      await expect(
        target.getByText("非参加者に届かない変更", { exact: true }),
      ).toHaveCount(0);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await f.cleanup();
  }
});
