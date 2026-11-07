import { randomUUID } from "node:crypto";
import {
  localSettings,
  adminClient,
  login,
  checked,
  demoPassword,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

export async function notificationFixture() {
  const settings = localSettings();
  const service = adminClient(settings);
  const owner = await login(settings, "admin");
  const member = await login(settings, "member");
  const alias = `notifications-${randomUUID()}`;
  checked(
    await service.auth.admin.createUser({
      email: `${alias}@example.invalid`,
      password: demoPassword,
      email_confirm: true,
    }),
  );
  const recipient = await login(settings, alias);
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "通知検証用スペース",
    }),
  );
  checked(
    await service.from("memberships").insert([
      { workspace_id: wid, user_id: member.user.id, role: "member" },
      { workspace_id: wid, user_id: recipient.user.id, role: "member" },
    ]),
  );
  const project = checked(
    await owner.client.rpc("create_project", {
      p_workspace_id: wid,
      p_name: "通知検証用プロジェクト",
    }),
  );
  const scope = { p_workspace_id: wid, p_project_id: project.id };
  const taskInput = {
    ...scope,
    p_title: "通知に複製しないタスク名",
    p_description: "通知に複製しないタスク本文",
    p_priority: "medium",
    p_assignee_id: recipient.user.id,
    p_due_date: null,
    p_key: randomUUID(),
  };
  const task = checked(await owner.client.rpc("create_task_once", taskInput));
  const issue = checked(
    await owner.client.rpc("create_issue_once", {
      ...taskInput,
      p_title: "通知に複製しない課題名",
      p_key: randomUUID(),
    }),
  );
  return {
    settings,
    service,
    owner,
    member,
    recipient,
    alias,
    wid,
    project,
    scope,
    task,
    issue,
    taskInput,
    async cleanup() {
      for (const table of [
        "comment_requests",
        "member_requests",
        "task_requests",
        "issue_requests",
        "project_requests",
      ])
        localSql(`delete from private.${table} where workspace_id='${wid}'`);
      for (const table of [
        "user_notifications",
        "issue_comments",
        "tasks",
        "issues",
        "projects",
        "memberships",
        "activity_logs",
      ])
        checked(await service.from(table).delete().eq("workspace_id", wid));
      checked(await service.from("workspaces").delete().eq("id", wid));
      checked(
        await service.from("profiles").delete().eq("id", recipient.user.id),
      );
      checked(await service.auth.admin.deleteUser(recipient.user.id));
    },
  };
}
