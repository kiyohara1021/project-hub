import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  localSettings,
  login,
  checked,
  workspaceA,
} from "../../scripts/local-supabase.mjs";

test("タスクの開始日は旧呼出互換・再送・競合・権限・期間制約を維持する", async () => {
  const settings = localSettings();
  const owner = await login(settings, "admin");
  const member = await login(settings, "member");
  const viewer = await login(settings, "viewer");
  const project = checked(
    await owner.client.rpc("create_project", {
      p_workspace_id: workspaceA,
      p_name: "ガント日程検証",
    }),
  );
  const scope = { p_workspace_id: workspaceA, p_project_id: project.id };
  const input = {
    ...scope,
    p_title: "期間のあるタスク",
    p_description: "",
    p_priority: "medium",
    p_assignee_id: null,
    p_due_date: "2026-12-10",
    p_key: randomUUID(),
    p_start_date: "2026-12-01",
  };
  let task = checked(await member.client.rpc("create_task_once", input));
  assert.equal(task.start_date, "2026-12-01");
  assert.equal(
    checked(await member.client.rpc("create_task_once", input)).id,
    task.id,
  );
  assert.equal(
    (
      await member.client.rpc("create_task_once", {
        ...input,
        p_start_date: "2026-12-02",
      })
    ).error?.code,
    "40001",
  );
  assert.ok(
    (
      await viewer.client.rpc("create_task_once", {
        ...input,
        p_key: randomUUID(),
      })
    ).error,
  );
  for (const start of ["2026-12-11", "infinity", "10000-01-01"])
    assert.equal(
      (
        await member.client.rpc("create_task_once", {
          ...input,
          p_key: randomUUID(),
          p_start_date: start,
        })
      ).error?.code,
      "23514",
    );
  const legacy = {
    ...scope,
    p_title: "開始日省略",
    p_description: "",
    p_priority: "medium",
    p_assignee_id: null,
    p_due_date: null,
    p_key: randomUUID(),
  };
  const old = checked(await member.client.rpc("create_task_once", legacy));
  assert.equal(old.start_date, null);
  assert.equal(
    checked(
      await member.client.rpc("create_task_once", {
        ...legacy,
        p_start_date: null,
      }),
    ).id,
    old.id,
  );
  const edit = {
    ...scope,
    p_task_id: task.id,
    p_title: task.title,
    p_description: "",
    p_priority: "medium",
    p_assignee_id: null,
    p_due_date: "2026-12-11",
    p_version: task.version,
  };
  task = checked(await member.client.rpc("edit_task", edit));
  assert.equal(task.start_date, "2026-12-01");
  assert.equal(
    (
      await member.client.rpc("edit_task", {
        ...edit,
        p_start_date: "2026-12-02",
        p_schedule_provided: true,
      })
    ).error?.code,
    "40001",
  );
  assert.equal(
    (
      await member.client.rpc("edit_task", {
        ...edit,
        p_version: task.version,
        p_due_date: "2026-11-01",
      })
    ).error?.code,
    "23514",
  );
  task = checked(
    await member.client.rpc("edit_task", {
      ...edit,
      p_version: task.version,
      p_start_date: null,
      p_schedule_provided: true,
    }),
  );
  assert.equal(task.start_date, null);
  checked(
    await owner.client.rpc("update_project", {
      p_workspace_id: workspaceA,
      p_project_id: project.id,
      p_name: project.name,
      p_status: "archived",
      p_due_date: null,
      p_version: project.version,
    }),
  );
  assert.equal(
    (
      await member.client.rpc("edit_task", {
        ...edit,
        p_version: task.version,
        p_start_date: "2026-12-01",
        p_schedule_provided: true,
      })
    ).error?.code,
    "55000",
  );
});
