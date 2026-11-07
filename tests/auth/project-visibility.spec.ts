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
async function fixture() {
  const settings = localSettings(),
    service = adminClient(settings);
  const owner = await dbLogin(settings, "admin"),
    member = await dbLogin(settings, "member"),
    viewer = await dbLogin(settings, "viewer"),
    outside = await dbLogin(settings, "outside");
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "公開範囲の画面検証",
    }),
  );
  checked(
    await service.from("memberships").insert([
      { workspace_id: wid, user_id: member.user.id, role: "member" },
      { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
    ]),
  );
  const common = { p_workspace_id: wid, p_description: "", p_due_date: null };
  const project = checked(
    await owner.client.rpc("create_project_once", {
      ...common,
      p_name: "非公開検証のプロジェクト",
      p_key: randomUUID(),
      p_visibility: "private",
    }),
  );
  const hidden = checked(
    await owner.client.rpc("set_project_access", {
      p_workspace_id: wid,
      p_project_id: project.id,
      p_visibility: "private",
      p_member_ids: [member.user.id],
      p_version: project.version,
    }),
  );
  const publicProject = checked(
    await owner.client.rpc("create_project_once", {
      ...common,
      p_name: "公開検証のプロジェクト",
      p_key: randomUUID(),
    }),
  );
  const taskBody = {
    title: "非公開タスク",
    description: "参加者向けの本文",
    priority: "medium",
    assignee_id: member.user.id,
    due_date: null,
  };
  const args = Object.fromEntries(
    Object.entries(taskBody).map(([key, value]) => [`p_${key}`, value]),
  );
  const task = checked(
    await owner.client.rpc("create_task_once", {
      ...args,
      p_workspace_id: wid,
      p_project_id: hidden.id,
      p_key: randomUUID(),
    }),
  );
  const issue = checked(
    await owner.client.rpc("create_issue_once", {
      ...args,
      p_workspace_id: wid,
      p_project_id: hidden.id,
      p_key: randomUUID(),
    }),
  );
  const comment = checked(
    await owner.client.rpc("create_comment_once", {
      p_workspace_id: wid,
      p_project_id: hidden.id,
      p_issue_id: issue.id,
      p_body: "参加者向けコメント",
      p_key: randomUUID(),
    }),
  );
  const names = checked(
    await service
      .from("profiles")
      .select("id,display_name")
      .in("id", [member.user.id, viewer.user.id]),
  );
  return {
    wid,
    service,
    owner,
    member,
    viewer,
    outside,
    hidden,
    publicProject,
    task,
    issue,
    comment,
    taskBody,
    memberName: names.find(
      (row: { id: string; display_name: string }) => row.id === member.user.id,
    )!.display_name,
    viewerName: names.find(
      (row: { id: string; display_name: string }) => row.id === viewer.user.id,
    )!.display_name,
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

test("非参加者にはAPI・画面・最新一覧から非公開プロジェクトを見せず、公開範囲APIを保護する", async ({
  page,
}) => {
  const f = await fixture();
  const base = `/api/v1/workspaces/${f.wid}/projects/${f.hidden.id}`;
  try {
    await login(page, "viewer");
    const list = await page.request.get(`/api/v1/workspaces/${f.wid}/projects`);
    expect(list.status()).toBe(200);
    const ids = (await list.json()).data.map((row: { id: string }) => row.id);
    expect(ids).toContain(f.publicProject.id);
    expect(ids).not.toContain(f.hidden.id);
    await expect(
      page.getByText(f.hidden.name, { exact: true }),
    ).not.toBeVisible();
    for (const path of [
      base,
      `${base}/access`,
      `${base}/tasks`,
      `${base}/issues`,
      `${base}/issues/${f.issue.id}/comments`,
    ]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(404);
      expect((await response.json()).error.code).toBe("NOT_FOUND");
    }
    for (const [path, method, data] of [
      [
        base,
        "patch",
        {
          name: "変更",
          description: "",
          due_date: null,
          status: "active",
          version: f.hidden.version,
        },
      ],
      [
        `${base}/access`,
        "patch",
        { visibility: "workspace", member_ids: [], version: f.hidden.version },
      ],
      [`${base}/tasks`, "post", f.taskBody],
      [
        `${base}/tasks/${f.task.id}`,
        "patch",
        { ...f.taskBody, version: f.task.version },
      ],
      [`${base}/tasks/${f.task.id}`, "delete", { version: f.task.version }],
      [`${base}/issues`, "post", f.taskBody],
      [`${base}/issues/${f.issue.id}/comments`, "post", { body: "変更" }],
    ] as const) {
      const response = await page.request.fetch(path, {
        method: method.toUpperCase(),
        headers: { origin, "Idempotency-Key": randomUUID() },
        data,
      });
      expect(response.status(), path).toBe(404);
    }
    for (const route of ["board", "issues", "gantt"]) {
      await page.goto(`/projects/${f.hidden.id}/${route}?workspace=${f.wid}`);
      await expect(
        page.getByRole("heading", { name: "ページが見つかりません" }),
      ).toBeVisible();
    }
    await login(page, "admin");
    expect(
      (
        await page.request.patch(`${base}/access`, {
          headers: { origin: "https://example.invalid" },
          data: {
            visibility: "workspace",
            member_ids: [],
            version: f.hidden.version,
          },
        })
      ).status(),
    ).toBe(403);
    for (const data of [
      {},
      { visibility: [], member_ids: [], version: f.hidden.version },
      {
        visibility: "private",
        member_ids: [f.outside.user.id],
        version: f.hidden.version,
      },
      {
        visibility: "private",
        member_ids: [f.member.user.id, f.member.user.id],
        version: f.hidden.version,
      },
      { visibility: "private", member_ids: [], version: 0 },
      {
        visibility: "private",
        member_ids: [],
        version: f.hidden.version,
        admin: true,
      },
    ])
      expect(
        (
          await page.request.patch(`${base}/access`, {
            headers: { origin },
            data,
          })
        ).status(),
      ).toBe(400);
    const saved = await page.request.patch(`${base}/access`, {
      headers: { origin },
      data: {
        visibility: "workspace",
        member_ids: [],
        version: f.hidden.version,
      },
    });
    expect(saved.status()).toBe(200);
    expect(saved.headers()["cache-control"]).toBe("private, no-store");
    expect(
      (
        await page.request.patch(`${base}/access`, {
          headers: { origin },
          data: {
            visibility: "private",
            member_ids: [],
            version: f.hidden.version,
          },
        })
      ).status(),
    ).toBe(409);
    await page.context().clearCookies();
    expect((await page.request.get(`${base}/access`)).status()).toBe(401);
  } finally {
    await f.cleanup();
  }
});

for (const width of [360, 1280])
  test(`${width}pxで非公開作成・参加者変更・競合復旧と参加者の作業を確認する`, async ({
    page,
  }) => {
    const f = await fixture();
    const name = `非公開作成-${randomUUID().slice(0, 8)}`;
    try {
      await page.setViewportSize({ width, height: 800 });
      await login(page, "admin");
      await page.goto(
        `/projects?workspace=${f.wid}&q=${encodeURIComponent(name)}`,
      );
      await page
        .getByRole("button", { name: "プロジェクト作成", exact: true })
        .click();
      let dialog = page.getByRole("dialog", {
        name: "プロジェクト作成",
        exact: true,
      });
      await dialog.getByLabel("プロジェクト名", { exact: true }).fill(name);
      await dialog
        .getByLabel("公開範囲", { exact: true })
        .selectOption("private");
      await dialog
        .getByRole("button", { name: "保存する", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      const card = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole("link", { name, exact: true }) });
      await expect(card).toContainText("管理者と指定した参加者");
      await card.getByRole("button", { name: "公開範囲", exact: true }).click();
      dialog = page.getByRole("dialog", {
        name: "プロジェクトの公開範囲",
        exact: true,
      });
      const checkbox = dialog.getByRole("checkbox", {
        name: new RegExp(f.memberName),
      });
      await expect(checkbox).toBeVisible();
      await checkbox.check();
      const created = checked(
        await f.service
          .from("projects")
          .select("id,version")
          .eq("workspace_id", f.wid)
          .eq("name", name)
          .single(),
      );
      checked(
        await f.owner.client.rpc("edit_project", {
          p_workspace_id: f.wid,
          p_project_id: created.id,
          p_name: name,
          p_description: "",
          p_status: "planned",
          p_due_date: null,
          p_version: created.version,
        }),
      );
      await dialog
        .getByRole("button", { name: "保存する", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "他の操作で更新されました",
      );
      await expect(checkbox).toBeChecked();
      await dialog
        .getByRole("button", {
          name: "入力を破棄して最新版を読み直す",
          exact: true,
        })
        .click();
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
      await dialog
        .getByRole("button", { name: "保存する", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await card.getByRole("button", { name: "公開範囲", exact: true }).click();
      await expect(checkbox).toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(
        card.getByRole("button", { name: "公開範囲", exact: true }),
      ).toBeFocused();
      await login(page, "member");
      await page.goto(`/projects/${created.id}/board?workspace=${f.wid}`);
      await page
        .getByRole("button", { name: "タスク追加", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "タスク追加", exact: true });
      await dialog
        .getByLabel("タスク名", { exact: true })
        .fill("参加者のタスク");
      const assignee = dialog.getByLabel("担当者", { exact: true });
      await expect(
        assignee.locator("option").filter({ hasText: f.viewerName }),
      ).toHaveCount(0);
      await assignee.selectOption(f.member.user.id);
      await dialog
        .getByRole("button", { name: "保存する", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByText("参加者のタスク", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await login(page, "viewer");
      await page.goto(`/projects/${created.id}/board?workspace=${f.wid}`);
      await expect(
        page.getByRole("heading", { name: "ページが見つかりません" }),
      ).toBeVisible();
    } finally {
      await f.cleanup();
    }
  });
