import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  localSettings,
  login,
  adminClient,
  checked,
  workspaceA,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
const bucket = "project-attachments";

test("添付は親の権限・予約・Storage保存・公開確定・親削除後の回収を維持する", async () => {
  const settings = localSettings();
  const admin = await login(settings, "admin"),
    member = await login(settings, "member"),
    viewer = await login(settings, "viewer"),
    outside = await login(settings, "outside");
  const service = adminClient(settings);
  const project = checked(
    await admin.client.rpc("create_project", {
      p_workspace_id: workspaceA,
      p_name: "添付のDB検証",
    }),
  );
  const task = checked(
    await member.client.rpc("create_task_once", {
      p_workspace_id: workspaceA,
      p_project_id: project.id,
      p_title: "添付先",
      p_description: "",
      p_priority: "medium",
      p_assignee_id: null,
      p_due_date: null,
      p_key: randomUUID(),
    }),
  );
  const bytes = new TextEncoder().encode("添付ファイルのテスト\n");
  const input = {
    p_workspace_id: workspaceA,
    p_project_id: project.id,
    p_kind: "task",
    p_target_id: task.id,
    p_file_name: "添付.txt",
    p_content_type: "text/plain",
    p_size_bytes: bytes.length,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_key: randomUUID(),
  };
  const reserved = checked(
    await member.client.rpc("reserve_attachment", input),
  );
  assert.equal(reserved.state, "pending");
  assert.equal(
    checked(await member.client.rpc("reserve_attachment", input)).id,
    reserved.id,
  );
  assert.equal(
    (
      await member.client.rpc("reserve_attachment", {
        ...input,
        p_file_name: "異なる.txt",
      })
    ).error?.code,
    "40001",
  );
  assert.ok(
    (
      await viewer.client.rpc("reserve_attachment", {
        ...input,
        p_key: randomUUID(),
      })
    ).error,
  );
  assert.ok(
    (
      await outside.client.rpc("reserve_attachment", {
        ...input,
        p_key: randomUUID(),
      })
    ).error,
  );
  assert.equal(
    (await member.client.rpc("finalize_attachment", { p_id: reserved.id }))
      .error?.code,
    "22023",
  );
  assert.equal(
    checked(
      await viewer.client
        .from("attachments")
        .select("id")
        .eq("id", reserved.id),
    ).length,
    0,
  );
  assert.ok(
    (await viewer.client.storage.from(bucket).download(reserved.id)).error,
  );
  assert.ok(
    (
      await member.client.storage
        .from(bucket)
        .upload(randomUUID(), bytes, { contentType: "text/plain" })
    ).error,
  );
  const uploaded = await member.client.storage
    .from(bucket)
    .upload(reserved.id, bytes, { contentType: "text/plain" });
  assert.ifError(uploaded.error);
  const ready = checked(
    await member.client.rpc("finalize_attachment", { p_id: reserved.id }),
  );
  assert.equal(ready.state, "ready");
  assert.equal(
    checked(
      await viewer.client.from("attachments").select("id").eq("id", ready.id),
    ).length,
    1,
  );
  assert.ifError(
    (await viewer.client.storage.from(bucket).download(ready.id)).error,
  );
  assert.ok(
    (await outside.client.storage.from(bucket).download(ready.id)).error,
  );
  checked(
    await service.from("memberships").insert({
      workspace_id: workspaceA,
      user_id: outside.user.id,
      role: "member",
    }),
  );
  try {
    assert.equal(
      (await outside.client.rpc("remove_attachment", { p_id: ready.id })).error
        ?.code,
      "42501",
    );
  } finally {
    checked(
      await service
        .from("memberships")
        .delete()
        .eq("workspace_id", workspaceA)
        .eq("user_id", outside.user.id),
    );
  }
  const hidden = checked(
    await admin.client.rpc("set_project_access", {
      p_workspace_id: workspaceA,
      p_project_id: project.id,
      p_visibility: "private",
      p_member_ids: [member.user.id],
      p_version: project.version,
    }),
  );
  assert.ok(
    (await viewer.client.storage.from(bucket).download(ready.id)).error,
  );
  assert.equal(
    checked(
      await viewer.client.from("attachments").select("id").eq("id", ready.id),
    ).length,
    0,
  );
  assert.ifError(
    (await member.client.storage.from(bucket).download(ready.id)).error,
  );
  checked(
    await admin.client.rpc("set_project_access", {
      p_workspace_id: workspaceA,
      p_project_id: project.id,
      p_visibility: "workspace",
      p_member_ids: [],
      p_version: hidden.version,
    }),
  );

  assert.ok(
    (await viewer.client.rpc("remove_attachment", { p_id: ready.id })).error,
  );
  assert.ok(
    (await member.client.storage.from(bucket).remove([ready.id])).error ||
      checked(
        await member.client.from("attachments").select("id").eq("id", ready.id),
      ).length === 1,
  );
  assert.ifError(
    (await member.client.storage.from(bucket).download(ready.id)).error,
  );
  checked(
    await member.client.rpc("delete_task", {
      p_workspace_id: workspaceA,
      p_project_id: project.id,
      p_task_id: task.id,
      p_version: task.version,
    }),
  );
  assert.equal(
    checked(
      await admin.client.from("attachments").select("id").eq("id", ready.id),
    ).length,
    0,
  );
  assert.ok(
    (await member.client.storage.from(bucket).download(ready.id)).error,
  );
  const ledger = JSON.parse(
    localSql(
      `select jsonb_build_object('state',state,'path',object_path) from private.attachment_objects where id='${ready.id}'::uuid;`,
    ),
  );
  assert.equal(ledger.state, "deleting");
  assert.equal(ledger.path, ready.id);
  assert.throws(
    () =>
      localSql(`select private.complete_attachment_cleanup('${ready.id}');`),
    /DELETE_PENDING/,
  );
  assert.ifError((await service.storage.from(bucket).remove([ready.id])).error);
  localSql(`select private.complete_attachment_cleanup('${ready.id}');`);
  assert.equal(
    Number(
      localSql(
        `select count(*) from private.attachment_objects where id='${ready.id}';`,
      ),
    ),
    0,
  );
});

test("予約上限・失効・回収権限とアーカイブを検査する", async () => {
  const settings = localSettings(),
    admin = await login(settings, "admin"),
    member = await login(settings, "member");
  const project = checked(
    await admin.client.rpc("create_project", {
      p_workspace_id: workspaceA,
      p_name: "添付予約の上限検証",
    }),
  );
  const issue = checked(
    await adminClient(settings)
      .from("issues")
      .insert({
        workspace_id: workspaceA,
        project_id: project.id,
        title: "予約先の課題",
      })
      .select("id")
      .single(),
  );
  const input = {
    p_workspace_id: workspaceA,
    p_project_id: project.id,
    p_kind: "issue",
    p_target_id: issue.id,
    p_file_name: "確認.txt",
    p_content_type: "text/plain",
    p_size_bytes: 1,
    p_sha256: "a".repeat(64),
  };
  const ids = [];
  for (let i = 0; i < 20; i++)
    ids.push(
      checked(
        await member.client.rpc("reserve_attachment", {
          ...input,
          p_key: randomUUID(),
        }),
      ).id,
    );
  assert.equal(
    (
      await member.client.rpc("reserve_attachment", {
        ...input,
        p_key: randomUUID(),
      })
    ).error?.code,
    "54000",
  );
  localSql(
    `update private.attachment_objects set expires_at=statement_timestamp()-interval '1 minute' where id in (${ids.map((id) => `'${id}'::uuid`).join(",")});`,
  );
  const batch = JSON.parse(
    localSql(
      "select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from private.attachment_cleanup_batch(100) q;",
    ),
  );
  assert.ok(ids.every((id) => batch.some((row) => row.id === id)));
  for (const id of ids)
    localSql(`select private.complete_attachment_cleanup('${id}');`);
  assert.equal(
    checked(
      await member.client.rpc("reserve_attachment", {
        ...input,
        p_key: randomUUID(),
      }),
    ).state,
    "pending",
  );
  for (const role of ["anon", "authenticated", "service_role"])
    assert.throws(
      () =>
        localSql(
          `begin;set local role ${role};select * from private.attachment_cleanup_batch(1);rollback;`,
        ),
      /permission denied/,
    );
  checked(
    await admin.client.rpc("update_project", {
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
      await member.client.rpc("reserve_attachment", {
        ...input,
        p_key: randomUUID(),
      })
    ).error?.code,
    "55000",
  );
});
