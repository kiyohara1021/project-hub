import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  localSettings,
  login,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

test("非公開プロジェクトは読取・集計・全更新・再送を分離し、参加失効と削除後履歴を維持する", async () => {
  const settings = localSettings(),
    service = adminClient(settings);
  const actors = Object.fromEntries(
    await Promise.all(
      ["admin", "member", "viewer", "outside", "unassigned"].map(
        async (alias) => [alias, await login(settings, alias)],
      ),
    ),
  );
  const { admin, member, viewer, outside, unassigned } = actors;
  const wid = checked(
    await admin.client.rpc("create_workspace", { p_name: "公開範囲検証" }),
  );
  const access = async (project, visibility, ids) =>
    checked(
      await admin.client.rpc("set_project_access", {
        p_workspace_id: wid,
        p_project_id: project.id,
        p_visibility: visibility,
        p_member_ids: ids,
        p_version: project.version,
      }),
    );
  const taskArgs = (pid) => ({
    p_workspace_id: wid,
    p_project_id: pid,
    p_title: "非公開タスク",
    p_description: "非公開の本文",
    p_priority: "medium",
    p_assignee_id: null,
    p_due_date: null,
    p_key: randomUUID(),
  });
  try {
    checked(
      await service.from("memberships").insert([
        { workspace_id: wid, user_id: member.user.id, role: "member" },
        { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
      ]),
    );
    let publicProject = checked(
      await admin.client.rpc("create_project_once", {
        p_workspace_id: wid,
        p_name: "全員のプロジェクト",
        p_description: "",
        p_due_date: null,
        p_key: randomUUID(),
      }),
    );
    assert.equal(publicProject.visibility, "workspace");
    let hidden = checked(
      await admin.client.rpc("create_project_once", {
        p_workspace_id: wid,
        p_name: "指定参加者のプロジェクト",
        p_description: "非公開",
        p_due_date: null,
        p_key: randomUUID(),
        p_visibility: "private",
      }),
    );
    assert.equal(
      checked(
        await member.client.from("projects").select("id").eq("id", hidden.id),
      ).length,
      0,
    );
    hidden = await access(hidden, "private", [member.user.id]);
    const args = { ...taskArgs(hidden.id), p_assignee_id: member.user.id };
    const task = checked(await member.client.rpc("create_task_once", args));
    const issue = checked(
      await member.client.rpc("create_issue_once", {
        ...taskArgs(hidden.id),
        p_title: "非公開課題",
        p_assignee_id: member.user.id,
      }),
    );
    const commentArgs = {
      p_workspace_id: wid,
      p_project_id: hidden.id,
      p_issue_id: issue.id,
      p_body: "参加者向けコメント",
      p_key: randomUUID(),
    };
    const comment = checked(
      await member.client.rpc("create_comment_once", commentArgs),
    );
    const publicTask = checked(
      await admin.client.rpc("create_task_once", {
        ...taskArgs(publicProject.id),
        p_assignee_id: viewer.user.id,
      }),
    );
    for (const actor of [viewer, outside, unassigned]) {
      for (const table of [
        "projects",
        "tasks",
        "issues",
        "issue_comments",
        "activity_logs",
        "project_members",
      ])
        assert.equal(
          checked(
            await actor.client
              .from(table)
              .select("*")
              .eq(table === "projects" ? "id" : "project_id", hidden.id),
          ).length,
          0,
          table,
        );
      assert.equal(
        (
          await actor.client.rpc("read_project_assignees", {
            p_workspace_id: wid,
            p_project_id: hidden.id,
          })
        ).error?.code,
        "P0002",
      );
    }
    const hiddenLogIds = new Set(
      checked(
        await admin.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", hidden.id),
      ).map((row) => row.id),
    );
    const viewerDashboard = checked(
      await viewer.client.rpc("read_dashboard", { p_workspace_id: wid }),
    );
    assert.equal(viewerDashboard.metrics.task_total, 1);
    assert.ok(
      !viewerDashboard.projects.some((project) => project.id === hidden.id),
    );
    assert.ok(
      !viewerDashboard.recent_activity.some((row) => hiddenLogIds.has(row.id)),
    );
    const memberDashboard = checked(
      await member.client.rpc("read_dashboard", { p_workspace_id: wid }),
    );
    assert.equal(memberDashboard.metrics.task_total, 2);
    const viewerMembers = checked(
      await viewer.client.rpc("read_members", { p_workspace_id: wid }),
    );
    const memberMembers = checked(
      await member.client.rpc("read_members", { p_workspace_id: wid }),
    );
    assert.equal(
      viewerMembers.data.find((row) => row.user_id === member.user.id)
        .task_count,
      0,
    );
    assert.equal(
      memberMembers.data.find((row) => row.user_id === member.user.id)
        .task_count,
      1,
    );
    assert.equal(
      memberMembers.data.find((row) => row.user_id === member.user.id)
        .issue_count,
      1,
    );
    assert.deepEqual(
      checked(
        await member.client.rpc("read_project_assignees", {
          p_workspace_id: wid,
          p_project_id: hidden.id,
        }),
      )
        .map((row) => row.id)
        .sort(),
      [admin.user.id, member.user.id].sort(),
    );
    assert.equal(
      (
        await admin.client.rpc("create_task_once", {
          ...taskArgs(hidden.id),
          p_assignee_id: viewer.user.id,
        })
      ).error?.code,
      "23503",
    );
    assert.equal(
      (
        await service.from("issues").insert({
          workspace_id: wid,
          project_id: hidden.id,
          title: "不正な担当",
          assignee_id: viewer.user.id,
        })
      ).error?.code,
      "23503",
    );

    publicProject = await access(publicProject, "private", [member.user.id]);
    const cleared = checked(
      await service
        .from("tasks")
        .select("assignee_id,version")
        .eq("id", publicTask.id)
        .single(),
    );
    assert.equal(cleared.assignee_id, null);
    assert.equal(cleared.version, publicTask.version + 1);
    assert.equal(
      checked(
        await viewer.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", publicProject.id),
      ).length,
      0,
    );
    publicProject = await access(publicProject, "workspace", []);
    assert.ok(
      checked(
        await viewer.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", publicProject.id),
      ).length > 0,
    );

    // 暗黙に閲覧できる管理者も、降格すると非参加のprivate担当を失う。
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: outside.user.id, role: "admin" }),
    );
    const adminTask = checked(
      await admin.client.rpc("create_task_once", {
        ...taskArgs(hidden.id),
        p_assignee_id: outside.user.id,
      }),
    );
    const outsideMembership = checked(
      await service
        .from("memberships")
        .select("version")
        .eq("workspace_id", wid)
        .eq("user_id", outside.user.id)
        .single(),
    );
    checked(
      await admin.client.rpc("change_member", {
        p_workspace_id: wid,
        p_user_id: outside.user.id,
        p_role: "member",
        p_version: outsideMembership.version,
        p_remove: false,
      }),
    );
    assert.equal(
      checked(
        await service
          .from("tasks")
          .select("assignee_id")
          .eq("id", adminTask.id)
          .single(),
      ).assignee_id,
      null,
    );
    assert.equal(
      checked(
        await outside.client.from("projects").select("id").eq("id", hidden.id),
      ).length,
      0,
    );

    for (const ids of [
      [unassigned.user.id],
      [member.user.id, member.user.id],
      [null],
      null,
    ])
      assert.equal(
        (
          await admin.client.rpc("set_project_access", {
            p_workspace_id: wid,
            p_project_id: hidden.id,
            p_visibility: "private",
            p_member_ids: ids,
            p_version: hidden.version,
          })
        ).error?.code,
        "22023",
      );
    assert.equal(
      (
        await admin.client.rpc("set_project_access", {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_visibility: "private",
          p_member_ids: [],
          p_version: 0,
        })
      ).error?.code,
      "40001",
    );
    hidden = await access(hidden, "private", [member.user.id, viewer.user.id]);
    assert.equal(
      checked(
        await viewer.client
          .from("issue_comments")
          .select("id")
          .eq("id", comment.id),
      ).length,
      1,
    );
    assert.equal(
      (
        await viewer.client.rpc("create_comment_once", {
          ...commentArgs,
          p_key: randomUUID(),
        })
      ).error?.code,
      "42501",
    );
    hidden = await access(hidden, "private", [viewer.user.id]);
    for (const [rpc, input] of [
      ["create_task_once", args],
      [
        "edit_task",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_task_id: task.id,
          p_title: "変更",
          p_description: "",
          p_priority: "low",
          p_assignee_id: null,
          p_due_date: null,
          p_version: task.version,
        },
      ],
      [
        "move_task",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_task_id: task.id,
          p_status: "doing",
          p_before_id: null,
          p_version: task.version,
        },
      ],
      [
        "delete_task",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_task_id: task.id,
          p_version: task.version,
        },
      ],
      ["create_issue_once", taskArgs(hidden.id)],
      [
        "edit_issue",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_issue_id: issue.id,
          p_title: "変更",
          p_description: "",
          p_status: "open",
          p_priority: "low",
          p_assignee_id: null,
          p_due_date: null,
          p_version: issue.version,
        },
      ],
      [
        "delete_issue",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_issue_id: issue.id,
          p_version: issue.version,
        },
      ],
      ["create_comment_once", commentArgs],
      [
        "edit_comment",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_issue_id: issue.id,
          p_comment_id: comment.id,
          p_body: "変更",
          p_version: comment.version,
        },
      ],
      [
        "delete_comment",
        {
          p_workspace_id: wid,
          p_project_id: hidden.id,
          p_issue_id: issue.id,
          p_comment_id: comment.id,
          p_version: comment.version,
        },
      ],
    ])
      assert.equal(
        (await member.client.rpc(rpc, input)).error?.code,
        "P0002",
        rpc,
      );
    assert.equal(
      checked(
        await service
          .from("tasks")
          .select("assignee_id,version")
          .eq("id", task.id)
          .single(),
      ).assignee_id,
      null,
    );
    assert.equal(
      checked(
        await service
          .from("issues")
          .select("assignee_id")
          .eq("id", issue.id)
          .single(),
      ).assignee_id,
      null,
    );

    hidden = await access(hidden, "private", [member.user.id, viewer.user.id]);
    checked(
      await admin.client.rpc("remove_member", {
        p_workspace_id: wid,
        p_user_id: member.user.id,
      }),
    );
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: member.user.id, role: "member" }),
    );
    assert.equal(
      checked(
        await member.client.from("projects").select("id").eq("id", hidden.id),
      ).length,
      0,
    );
    assert.ok(
      (
        await member.client.from("project_members").insert({
          workspace_id: wid,
          project_id: hidden.id,
          user_id: member.user.id,
        })
      ).error,
    );

    // 管理用の親削除後も、public履歴は従来通り、private履歴は当時の参加者だけ。
    for (const table of [
      "project_requests",
      "task_requests",
      "issue_requests",
      "comment_requests",
    ])
      localSql(`delete from private.${table} where workspace_id='${wid}'`);
    checked(await service.from("tasks").delete().eq("workspace_id", wid));
    checked(await service.from("issues").delete().eq("workspace_id", wid));
    checked(await service.from("projects").delete().eq("workspace_id", wid));
    assert.ok(
      checked(
        await viewer.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", hidden.id),
      ).length > 0,
    );
    assert.equal(
      checked(
        await member.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", hidden.id),
      ).length,
      0,
    );
    assert.ok(
      checked(
        await member.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", publicProject.id),
      ).length > 0,
    );
    checked(
      await admin.client.rpc("remove_member", {
        p_workspace_id: wid,
        p_user_id: viewer.user.id,
      }),
    );
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: viewer.user.id, role: "viewer" }),
    );
    assert.equal(
      checked(
        await viewer.client
          .from("activity_logs")
          .select("id")
          .eq("project_id", hidden.id),
      ).length,
      0,
    );
  } finally {
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
  }
});
