import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checked } from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
import { notificationFixture } from "../helpers/notification-fixture.mjs";

test("通知は現在の可視性と本人に限定し、割当・コメント・再送・既読・保持期限を扱う", async () => {
  const f = await notificationFixture();
  const rows = async (client = f.recipient.client) =>
    checked(
      await client
        .from("user_notifications")
        .select("*")
        .eq("workspace_id", f.wid)
        .order("id"),
    );
  try {
    const initial = await rows();
    assert.equal(initial.length, 2);
    assert.deepEqual(initial.map((row) => row.kind).sort(), [
      "assigned_issue",
      "assigned_task",
    ]);
    assert.deepEqual(await rows(f.owner.client), []);
    assert.deepEqual(await rows(f.member.client), []);
    assert.ok(
      initial.every(
        (row) =>
          !["title", "description", "body", "actor_display_name"].some(
            (key) => key in row,
          ),
      ),
    );
    checked(await f.owner.client.rpc("create_task_once", f.taskInput));
    assert.equal((await rows()).length, 2);
    const edit = async (assignee, task) =>
      checked(
        await f.owner.client.rpc("edit_task", {
          ...f.scope,
          p_task_id: task.id,
          p_title: task.title,
          p_description: task.description,
          p_priority: task.priority,
          p_assignee_id: assignee,
          p_due_date: task.due_date,
          p_version: task.version,
        }),
      );
    let task = await edit(f.recipient.user.id, f.task);
    assert.equal((await rows()).length, 2);
    task = await edit(f.owner.user.id, task);
    assert.deepEqual(await rows(f.owner.client), []);
    task = await edit(f.recipient.user.id, task);
    assert.equal(
      (await rows()).filter((row) => row.kind === "assigned_task").length,
      2,
    );

    const comment = async (actor, body, key = randomUUID()) =>
      checked(
        await actor.client.rpc("create_comment_once", {
          ...f.scope,
          p_issue_id: f.issue.id,
          p_body: body,
          p_key: key,
        }),
      );
    const key = randomUUID();
    const first = await comment(f.owner, "通知へ複製しないコメント本文", key);
    await comment(f.owner, "通知へ複製しないコメント本文", key);
    assert.equal(
      (await rows()).filter((row) => row.source_id === first.id).length,
      1,
    );
    await comment(f.recipient, "担当者本人の投稿");
    const third = await comment(f.member, "参加者の追加コメント");
    const thirdRows = checked(
      await f.service
        .from("user_notifications")
        .select("*")
        .eq("source_id", third.id),
    );
    assert.deepEqual(
      thirdRows.map((row) => row.recipient_id).sort(),
      [f.owner.user.id, f.recipient.user.id].sort(),
    );
    assert.equal(
      (await rows(f.member.client)).filter((row) => row.source_id === third.id)
        .length,
      0,
    );
    assert.ok(
      thirdRows.every(
        (row) => !JSON.stringify(row).includes("参加者の追加コメント"),
      ),
    );

    const one = (await rows())[0];
    assert.equal(
      checked(
        await f.recipient.client.rpc("mark_notification_read", {
          p_id: one.id,
        }),
      ),
      one.id,
    );
    const firstRead = (await rows()).find((row) => row.id === one.id).read_at;
    checked(
      await f.recipient.client.rpc("mark_notification_read", { p_id: one.id }),
    );
    assert.equal(
      (await rows()).find((row) => row.id === one.id).read_at,
      firstRead,
    );
    assert.equal(
      (await f.owner.client.rpc("mark_notification_read", { p_id: one.id }))
        .error?.code,
      "P0002",
    );
    assert.equal(
      (
        await f.recipient.client.rpc("mark_notification_read", {
          p_id: randomUUID(),
        })
      ).error?.code,
      "P0002",
    );
    assert.equal(
      (
        await f.recipient.client
          .from("user_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", one.id)
      ).error?.code,
      "42501",
    );
    assert.equal(
      (
        await f.recipient.client
          .from("user_notifications")
          .delete()
          .eq("id", one.id)
      ).error?.code,
      "42501",
    );
    const { id: ignoredId, ...forged } = one;
    void ignoredId;
    assert.equal(
      (await f.recipient.client.from("user_notifications").insert(forged)).error
        ?.code,
      "42501",
    );
    const ownerUnreadBefore = (await rows(f.owner.client)).filter(
      (row) => !row.read_at,
    ).length;
    const ownUnread = (await rows()).filter((row) => !row.read_at).length;
    assert.equal(
      checked(await f.recipient.client.rpc("mark_all_notifications_read")),
      ownUnread,
    );
    assert.equal((await rows()).filter((row) => !row.read_at).length, 0);
    assert.equal(
      (await rows(f.owner.client)).filter((row) => !row.read_at).length,
      ownerUnreadBefore,
    );
    const fresh = await comment(f.owner, "一括既読の後に届く通知");
    assert.equal(
      (await rows()).find((row) => row.source_id === fresh.id).read_at,
      null,
    );

    let project = checked(
      await f.owner.client.rpc("set_project_access", {
        ...f.scope,
        p_visibility: "private",
        p_member_ids: [f.recipient.user.id, f.member.user.id],
        p_version: f.project.version,
      }),
    );
    assert.ok((await rows()).length > 0);
    project = checked(
      await f.owner.client.rpc("set_project_access", {
        ...f.scope,
        p_visibility: "private",
        p_member_ids: [f.member.user.id],
        p_version: project.version,
      }),
    );
    assert.deepEqual(await rows(), []);
    assert.equal(
      (await f.recipient.client.rpc("mark_notification_read", { p_id: one.id }))
        .error?.code,
      "P0002",
    );
    const afterRevocation = await comment(f.member, "許可解除後のコメント");
    assert.equal(
      checked(
        await f.service
          .from("user_notifications")
          .select("id")
          .eq("source_id", afterRevocation.id)
          .eq("recipient_id", f.recipient.user.id),
      ).length,
      0,
    );
    checked(
      await f.owner.client.rpc("set_project_access", {
        ...f.scope,
        p_visibility: "workspace",
        p_member_ids: [],
        p_version: project.version,
      }),
    );
    assert.ok((await rows()).length > 0);
    checked(
      await f.service
        .from("memberships")
        .delete()
        .eq("workspace_id", f.wid)
        .eq("user_id", f.recipient.user.id),
    );
    assert.deepEqual(await rows(), []);
    checked(
      await f.service.from("memberships").insert({
        workspace_id: f.wid,
        user_id: f.recipient.user.id,
        role: "member",
      }),
    );

    checked(await f.service.from("issue_comments").delete().eq("id", first.id));
    assert.equal(
      checked(
        await f.service
          .from("user_notifications")
          .select("id")
          .eq("source_id", first.id),
      ).length,
      0,
    );
    checked(await f.service.from("issues").delete().eq("id", f.issue.id));
    assert.ok((await rows()).every((row) => row.entity_type === "tasks"));
    const before = (await rows()).length;
    const ancient = checked(
      await f.service
        .from("user_notifications")
        .insert(
          [1, 2].map((n) => ({
            recipient_id: f.recipient.user.id,
            workspace_id: f.wid,
            project_id: f.project.id,
            entity_type: "tasks",
            entity_id: task.id,
            kind: "assigned_task",
            source_id: randomUUID(),
            source_version: 1,
            created_at: `1970-01-0${n}T00:00:00Z`,
          })),
        )
        .select("id"),
    );
    assert.equal((await rows()).length, before);
    for (const value of ["null", "0", "10001"])
      assert.throws(
        () => localSql(`select private.purge_old_notifications(${value});`),
        /INVALID_INPUT/,
      );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.throws(
        () =>
          localSql(
            `begin; set local role ${role}; select private.purge_old_notifications(1); rollback;`,
          ),
        /permission denied/,
      );
    assert.equal(
      Number(localSql("select private.purge_old_notifications(1);")),
      1,
    );
    assert.equal(
      checked(
        await f.service
          .from("user_notifications")
          .select("id")
          .in(
            "id",
            ancient.map((row) => row.id),
          ),
      ).length,
      1,
    );
    localSql("select private.purge_old_notifications(10000);");
    assert.equal((await rows()).length, before);
    localSql(`do $boundary$
      declare expired_id uuid; valid_id uuid;
      begin
        insert into public.user_notifications(recipient_id,workspace_id,project_id,entity_type,entity_id,kind,source_id,source_version,created_at)
        values('${f.recipient.user.id}','${f.wid}','${f.project.id}','tasks','${task.id}','assigned_task',gen_random_uuid(),1,statement_timestamp()-interval '90 days') returning id into expired_id;
        insert into public.user_notifications(recipient_id,workspace_id,project_id,entity_type,entity_id,kind,source_id,source_version,created_at)
        values('${f.recipient.user.id}','${f.wid}','${f.project.id}','tasks','${task.id}','assigned_task',gen_random_uuid(),1,statement_timestamp()-interval '90 days'+interval '1 microsecond') returning id into valid_id;
        perform private.purge_old_notifications(10000);
        if exists(select 1 from public.user_notifications where id=expired_id) then raise exception 'Expired boundary remains'; end if;
        if not exists(select 1 from public.user_notifications where id=valid_id) then raise exception 'Valid boundary was deleted'; end if;
        delete from public.user_notifications where id=valid_id;
      end;
    $boundary$;`);
    checked(await f.service.from("tasks").delete().eq("id", task.id));
    assert.deepEqual(await rows(), []);
    const anon = createClient(f.settings.API_URL, f.settings.ANON_KEY, {
      auth: { persistSession: false },
    });
    assert.equal(
      (await anon.from("user_notifications").select("id")).error?.code,
      "42501",
    );
    assert.equal(
      (await anon.rpc("mark_all_notifications_read")).error?.code,
      "42501",
    );
  } finally {
    await f.cleanup();
  }
});
