import { test, expect, type Page } from "@playwright/test";
import {
  localSettings,
  adminClient,
  login as dbLogin,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";
async function login(page: Page, alias: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(`${alias}@example.invalid`);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Local-Demo-Only-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}

test("集計表示・0件の切替・モバイル導線・変更の反映", async ({ page }) => {
  const settings = localSettings();
  const admin = adminClient(settings);
  const owner = await dbLogin(settings, "admin");
  const member = await dbLogin(settings, "member");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: `画面集計デモ-${crypto.randomUUID().slice(0, 8)}`,
    }),
  );
  const emptyWid = checked(
    await owner.client.rpc("create_workspace", { p_name: "0件の画面集計デモ" }),
  );
  const pid = crypto.randomUUID();
  const doingId = crypto.randomUUID();
  try {
    checked(
      await admin.from("memberships").insert([
        { workspace_id: wid, user_id: member.user.id, role: "member" },
        { workspace_id: emptyWid, user_id: member.user.id, role: "member" },
      ]),
    );
    const initial = checked(
      await owner.client.rpc("read_dashboard", { p_workspace_id: wid }),
    );
    const today = initial.today;
    const yesterday = new Date(Date.parse(today) - 86400000)
      .toISOString()
      .slice(0, 10);
    checked(
      await admin.from("projects").insert({
        id: pid,
        workspace_id: wid,
        name: "画面集計のテスト用プロジェクト",
        status: "active",
      }),
    );
    checked(
      await admin.from("tasks").insert([
        {
          id: crypto.randomUUID(),
          workspace_id: wid,
          project_id: pid,
          title: "超過したテスト用タスク",
          assignee_id: member.user.id,
          status: "todo",
          due_date: yesterday,
          position: 1024,
        },
        {
          id: doingId,
          workspace_id: wid,
          project_id: pid,
          title: "今日のテスト用タスク",
          assignee_id: member.user.id,
          status: "doing",
          due_date: today,
          position: 1024,
        },
        {
          id: crypto.randomUUID(),
          workspace_id: wid,
          project_id: pid,
          title: "期限未設定のテスト用タスク",
          assignee_id: member.user.id,
          status: "review",
          position: 1024,
        },
        {
          id: crypto.randomUUID(),
          workspace_id: wid,
          project_id: pid,
          title: "完了済みのテスト用タスク",
          assignee_id: member.user.id,
          status: "done",
          due_date: yesterday,
          position: 1024,
        },
      ]),
    );
    checked(
      await admin.from("issues").insert({
        workspace_id: wid,
        project_id: pid,
        title: "未解決のテスト用課題",
        status: "open",
      }),
    );
    // 空表示を確認するため、この専用fixtureだけ操作履歴を空にする。
    checked(
      await admin.from("activity_logs").delete().eq("workspace_id", emptyWid),
    );
    await login(page, "member");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/dashboard?workspace=${wid}`);
    await expect(
      page.getByRole("region", { name: "進行中プロジェクト", exact: true }),
    ).toContainText("1件");
    await expect(
      page.getByRole("region", { name: "完了率", exact: true }),
    ).toContainText("25%");
    await expect(
      page.getByRole("region", { name: "期限超過タスク", exact: true }),
    ).toContainText("1件");
    await expect(
      page.getByRole("region", { name: "未解決課題", exact: true }),
    ).toContainText("1件");
    await expect(
      page.getByRole("progressbar", {
        name: "画面集計のテスト用プロジェクトの進捗",
      }),
    ).toHaveAttribute("aria-valuenow", "25");
    await expect(
      page
        .getByRole("region", { name: "自分のタスク", exact: true })
        .getByRole("link"),
    ).toHaveCount(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByLabel("ワークスペース", { exact: true })
      .selectOption(emptyWid);
    await page.getByRole("button", { name: "最新の状況を取得" }).click();
    await expect(page).toHaveURL(`/dashboard?workspace=${emptyWid}`);
    await expect(
      page.getByRole("region", { name: "完了率", exact: true }),
    ).toContainText("0%");
    await expect(
      page.getByText("集計対象のプロジェクトはありません。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("担当する未完了タスクはありません。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("操作履歴はまだありません。", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("ワークスペース", { exact: true }).selectOption(wid);
    await page.getByRole("button", { name: "最新の状況を取得" }).click();
    await page
      .getByRole("region", { name: "自分のタスク", exact: true })
      .getByRole("link", { name: "今日のテスト用タスク", exact: true })
      .click();
    await expect(page).toHaveURL(/column=doing/);
    await expect(page.getByLabel("表示する状態", { exact: true })).toHaveValue(
      "doing",
    );
    await expect(
      page.getByRole("article", { name: "今日のテスト用タスク", exact: true }),
    ).toBeVisible();
    await page.getByLabel("今日のテスト用タスクの状態").selectOption("done");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "タスクの位置を保存しました" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page
      .getByRole("navigation", { name: "メインメニュー" })
      .filter({ visible: true })
      .getByRole("link", { name: "ダッシュボード", exact: true })
      .click();
    await expect(page).toHaveURL(`/dashboard?workspace=${wid}`);
    await expect(
      page.getByRole("region", { name: "完了率", exact: true }),
    ).toContainText("50%");
    await expect(
      page
        .getByRole("region", { name: "自分のタスク", exact: true })
        .getByRole("link", { name: "今日のテスト用タスク", exact: true }),
    ).not.toBeVisible();
  } finally {
    for (const space of [wid, emptyWid]) {
      checked(await admin.from("tasks").delete().eq("workspace_id", space));
      checked(await admin.from("issues").delete().eq("workspace_id", space));
      checked(await admin.from("projects").delete().eq("workspace_id", space));
      checked(
        await admin.from("memberships").delete().eq("workspace_id", space),
      );
      checked(
        await admin.from("activity_logs").delete().eq("workspace_id", space),
      );
      checked(await admin.from("workspaces").delete().eq("id", space));
    }
  }
});

test("集計APIとページで認証・所属・クエリー・本人の境界を守る", async ({
  page,
  request,
}) => {
  const api = `/api/v1/workspaces/${workspaceA}/dashboard`;
  expect((await request.get(api)).status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "viewer");
  const result = await page.request.get(api);
  expect(result.status()).toBe(200);
  expect(result.headers()["cache-control"]).toContain("no-store");
  expect((await result.json()).data.my_tasks).toEqual([]);
  expect(
    (
      await page.request.get(`/api/v1/workspaces/${workspaceB}/dashboard`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        "/api/v1/workspaces/99999999-9999-4999-8999-999999999999/dashboard",
      )
    ).status(),
  ).toBe(404);
  expect(
    (await page.request.get("/api/v1/workspaces/invalid/dashboard")).status(),
  ).toBe(400);
  expect((await page.request.get(api + "?user_id=anything")).status()).toBe(
    400,
  );
  expect((await page.request.get(api + "?today=2020-01-01")).status()).toBe(
    400,
  );
  await page.goto(`/dashboard?workspace=${workspaceB}`);
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
  await login(page, "outside");
  await page.goto(`/dashboard?workspace=${workspaceB}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "ダッシュボード",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "プロジェクト進捗", exact: true })
      .getByRole("link", { name: /サンプルプロジェクトB/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "プロジェクト進捗", exact: true })
      .getByRole("link", { name: /サンプルプロジェクトA/ }),
  ).not.toBeVisible();
  await login(page, "unassigned");
  await page.goto("/dashboard");
  await expect(
    page.getByText("所属ワークスペースがありません", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(api)).status()).toBe(404);
});

test("DB読取障害を隠して再試行で復旧する", async ({ page }) => {
  await login(page, "member");
  try {
    localSql(
      "revoke execute on function public.read_dashboard(uuid) from authenticated",
    );
    const result = await page.request.get(
      `/api/v1/workspaces/${workspaceA}/dashboard`,
    );
    expect(result.status()).toBe(500);
    expect((await result.json()).error.message).toBe(
      "集計を取得できませんでした",
    );
    await page.goto(`/dashboard?workspace=${workspaceA}`);
    await expect(
      page.getByRole("heading", {
        name: "ダッシュボードを表示できませんでした",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    localSql(
      "grant execute on function public.read_dashboard(uuid) to authenticated",
    );
  }
  await page.getByRole("button", { name: "再試行する", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "ダッシュボード",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "完了率", exact: true }),
  ).toBeVisible();
});
