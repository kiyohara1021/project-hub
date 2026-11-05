import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  localSettings,
  adminClient,
  login,
  checked,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";

test("コメントは所属・現在のロール・投稿者で保護され、再送/競合/監査/親削除を扱う", async () => {
  const settings = localSettings(),
    service = adminClient(settings),
    owner = await login(settings, "admin"),
    member = await login(settings, "member"),
    viewer = await login(settings, "viewer"),
    peer = await login(settings, "unassigned"),
    outside = await login(settings, "outside");
  const anon = createClient(settings.API_URL, settings.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const wid = checked(
    await owner.client.rpc("create_workspace", {
      p_name: "コメント検証用スペース",
    }),
  );
  const originalName = checked(
    await service
      .from("profiles")
      .select("display_name")
      .eq("id", member.user.id)
      .single(),
  ).display_name;
  try {
    checked(
      await service.from("memberships").insert([
        { workspace_id: wid, user_id: member.user.id, role: "member" },
        { workspace_id: wid, user_id: viewer.user.id, role: "viewer" },
        { workspace_id: wid, user_id: peer.user.id, role: "member" },
      ]),
    );
    const project = checked(
      await owner.client.rpc("create_project", {
        p_workspace_id: wid,
        p_name: "コメント検証用プロジェクト",
      }),
    );
    const issue = checked(
      await service
        .from("issues")
        .insert({
          workspace_id: wid,
          project_id: project.id,
          title: "コメント検証用課題",
          status: "closed",
        })
        .select()
        .single(),
    );
    const scope = {
      p_workspace_id: wid,
      p_project_id: project.id,
      p_issue_id: issue.id,
    };
    const args = {
      ...scope,
      p_body: " \n調査内容\n次の対応\t ",
      p_key: randomUUID(),
    };
    for (const actor of [viewer, outside])
      assert.equal(
        (await actor.client.rpc("create_comment_once", args)).error?.code,
        "42501",
      );
    assert.ok((await anon.rpc("create_comment_once", args)).error);
    for (const body of [
      null,
      "",
      " \t\r\n\u00a0\u3000\ufeff",
      "a".repeat(5001),
    ])
      assert.equal(
        (
          await member.client.rpc("create_comment_once", {
            ...args,
            p_body: body,
          })
        ).error?.code,
        "22023",
      );
    for (const key of [null, "", "a".repeat(129), "bad key"])
      assert.equal(
        (
          await member.client.rpc("create_comment_once", {
            ...args,
            p_key: key,
          })
        ).error?.code,
        "22023",
      );
    assert.equal(
      (
        await member.client.rpc("create_comment_once", {
          ...args,
          p_issue_id: randomUUID(),
        })
      ).error?.code,
      "P0002",
    );
    assert.equal(
      localSql(
        `select count(*) from private.comment_requests where workspace_id='${wid}'`,
      ),
      "0",
    );
    const results = await Promise.all([
      member.client.rpc("create_comment_once", args),
      member.client.rpc("create_comment_once", args),
    ]);
    const comment = checked(results[0]);
    assert.deepEqual(checked(results[1]), comment);
    assert.equal(comment.body, "調査内容\n次の対応");
    assert.equal(comment.author_id, member.user.id);
    assert.equal(comment.author_display_name, originalName);
    assert.equal(comment.version, 1);
    const max = checked(
      await member.client.rpc("create_comment_once", {
        ...args,
        p_body: "😀".repeat(5000),
        p_key: randomUUID(),
      }),
    );
    assert.equal(Array.from(max.body).length, 5000);
    assert.equal(
      (
        await member.client.rpc("create_comment_once", {
          ...args,
          p_body: "本文違い",
        })
      ).error?.message,
      "IDEMPOTENCY_CONFLICT",
    );
    for (const actor of [owner, member, viewer, peer])
      assert.equal(
        checked(
          await actor.client
            .from("issue_comments")
            .select("id")
            .eq("workspace_id", wid),
        ).length,
        2,
      );
    assert.equal(
      checked(
        await outside.client
          .from("issue_comments")
          .select("id")
          .eq("workspace_id", wid),
      ).length,
      0,
    );
    assert.ok((await anon.from("issue_comments").select("id")).error);
    for (const actor of [owner, member, viewer]) {
      assert.ok(
        (
          await actor.client.from("issue_comments").insert({
            workspace_id: wid,
            project_id: project.id,
            issue_id: issue.id,
            author_id: member.user.id,
            author_display_name: "偽装",
            body: "拒否",
          })
        ).error,
      );
      assert.ok(
        (
          await actor.client
            .from("issue_comments")
            .update({ body: "拒否" })
            .eq("id", comment.id)
        ).error,
      );
      assert.ok(
        (
          await actor.client
            .from("issue_comments")
            .delete()
            .eq("id", comment.id)
        ).error,
      );
    }
    assert.throws(() =>
      localSql(
        "begin;set local role authenticated;select * from private.comment_requests;rollback;",
      ),
    );
    const edit = {
      ...scope,
      p_comment_id: comment.id,
      p_body: "編集後の調査内容",
      p_version: comment.version,
    };
    const remove = {
      ...scope,
      p_comment_id: comment.id,
      p_version: comment.version,
    };
    for (const actor of [peer, viewer, outside]) {
      assert.equal(
        (await actor.client.rpc("edit_comment", edit)).error?.code,
        "42501",
      );
      assert.equal(
        (await actor.client.rpc("delete_comment", remove)).error?.code,
        "42501",
      );
    }
    const otherIssue = checked(
      await service
        .from("issues")
        .insert({
          workspace_id: wid,
          project_id: project.id,
          title: "別のコメント検証課題",
        })
        .select()
        .single(),
    );
    const other = checked(
      await member.client.rpc("create_comment_once", {
        ...args,
        p_issue_id: otherIssue.id,
      }),
    );
    assert.notEqual(other.id, comment.id);
    assert.equal(
      (
        await member.client.rpc("edit_comment", {
          ...edit,
          p_issue_id: otherIssue.id,
        })
      ).error?.code,
      "P0002",
    );
    const otherProject = checked(
      await owner.client.rpc("create_project", {
        p_workspace_id: wid,
        p_name: "別のコメント検証プロジェクト",
      }),
    );
    assert.equal(
      (
        await member.client.rpc("create_comment_once", {
          ...args,
          p_project_id: otherProject.id,
        })
      ).error?.code,
      "P0002",
    );
    assert.ok(
      (
        await service.from("issue_comments").insert({
          workspace_id: wid,
          project_id: otherProject.id,
          issue_id: issue.id,
          author_id: member.user.id,
          author_display_name: originalName,
          body: "親子不一致",
        })
      ).error,
    );
    const peerComment = checked(
      await peer.client.rpc("create_comment_once", {
        ...args,
        p_body: "別の投稿者のコメント",
      }),
    );
    assert.notEqual(peerComment.id, comment.id);
    const concurrent = await Promise.all([
      member.client.rpc("edit_comment", edit),
      member.client.rpc("edit_comment", { ...edit, p_body: "同時編集" }),
    ]);
    const changed = checked(concurrent.find((result) => !result.error));
    assert.equal(concurrent.filter((result) => !result.error).length, 1);
    assert.equal(
      concurrent.find((result) => result.error).error?.code,
      "40001",
    );
    assert.equal(changed.version, 2);
    assert.equal(changed.created_at, comment.created_at);
    assert.equal(changed.author_id, comment.author_id);
    const adminEdit = checked(
      await owner.client.rpc("edit_comment", {
        ...edit,
        p_body: "管理者の編集",
        p_version: changed.version,
      }),
    );
    assert.equal(adminEdit.version, 3);
    assert.equal(adminEdit.author_id, member.user.id);
    assert.equal(adminEdit.author_display_name, originalName);
    const beforeInvalid = checked(
      await owner.client
        .from("activity_logs")
        .select("id")
        .eq("entity_id", comment.id),
    ).length;
    assert.equal(
      (
        await owner.client.rpc("edit_comment", {
          ...edit,
          p_body: " ",
          p_version: 3,
        })
      ).error?.code,
      "22023",
    );
    assert.equal(
      (await owner.client.rpc("delete_comment", remove)).error?.code,
      "40001",
    );
    assert.equal(
      checked(
        await owner.client
          .from("activity_logs")
          .select("id")
          .eq("entity_id", comment.id),
      ).length,
      beforeInvalid,
    );
    checked(
      await service
        .from("profiles")
        .update({ display_name: "変更後のテスト表示名" })
        .eq("id", member.user.id),
    );
    assert.equal(
      checked(
        await viewer.client
          .from("issue_comments")
          .select("author_display_name")
          .eq("id", comment.id)
          .single(),
      ).author_display_name,
      originalName,
    );
    // 降格した投稿者は自分のコメントも変更できない。
    checked(
      await owner.client.rpc("set_member_role", {
        p_workspace_id: wid,
        p_user_id: member.user.id,
        p_role: "viewer",
      }),
    );
    assert.equal(
      (await member.client.rpc("edit_comment", { ...edit, p_version: 3 })).error
        ?.code,
      "42501",
    );
    assert.equal(
      (await member.client.rpc("create_comment_once", args)).error?.code,
      "42501",
    );
    checked(
      await owner.client.rpc("remove_member", {
        p_workspace_id: wid,
        p_user_id: member.user.id,
      }),
    );
    assert.equal(
      checked(
        await member.client
          .from("issue_comments")
          .select("id")
          .eq("workspace_id", wid),
      ).length,
      0,
    );
    assert.equal(
      checked(
        await viewer.client
          .from("issue_comments")
          .select("author_display_name")
          .eq("id", comment.id)
          .single(),
      ).author_display_name,
      originalName,
    );
    checked(
      await service
        .from("memberships")
        .insert({ workspace_id: wid, user_id: member.user.id, role: "member" }),
    );
    checked(
      await owner.client.rpc("update_project", {
        p_workspace_id: wid,
        p_project_id: project.id,
        p_name: project.name,
        p_status: "archived",
        p_due_date: null,
        p_version: project.version,
      }),
    );
    for (const actor of [owner, member]) {
      assert.equal(
        (await actor.client.rpc("create_comment_once", args)).error?.code,
        "55000",
      );
      assert.equal(
        (await actor.client.rpc("edit_comment", { ...edit, p_version: 3 }))
          .error?.code,
        "55000",
      );
      assert.equal(
        (await actor.client.rpc("delete_comment", { ...remove, p_version: 3 }))
          .error?.code,
        "55000",
      );
    }
    assert.ok(
      checked(
        await viewer.client
          .from("issue_comments")
          .select("id")
          .eq("id", comment.id),
      ).length,
    );
    checked(
      await owner.client.rpc("update_project", {
        p_workspace_id: wid,
        p_project_id: project.id,
        p_name: project.name,
        p_status: "active",
        p_due_date: null,
        p_version: 2,
      }),
    );
    checked(
      await owner.client.rpc("delete_comment", { ...remove, p_version: 3 }),
    );
    assert.deepEqual(
      checked(await member.client.rpc("create_comment_once", args)),
      comment,
    );
    assert.equal(
      checked(
        await owner.client
          .from("issue_comments")
          .select("id")
          .eq("id", comment.id),
      ).length,
      0,
    );
    localSql(
      `update private.comment_requests set expires_at=clock_timestamp()-interval '1 second' where workspace_id='${wid}' and issue_id='${issue.id}' and request_key='${args.p_key}'`,
    );
    const recreated = checked(
      await member.client.rpc("create_comment_once", args),
    );
    assert.notEqual(recreated.id, comment.id);
    const audit = checked(
      await owner.client
        .from("activity_logs")
        .select("entity_type,action,changes")
        .eq("workspace_id", wid)
        .eq("entity_id", comment.id),
    );
    assert.equal(audit.filter((row) => row.action === "INSERT").length, 1);
    assert.equal(audit.filter((row) => row.action === "UPDATE").length, 2);
    assert.equal(audit.filter((row) => row.action === "DELETE").length, 1);
    assert.ok(audit.every((row) => row.entity_type === "issue_comments"));
    assert.ok(!JSON.stringify(audit).includes("調査内容"));
    assert.ok(!JSON.stringify(audit).includes(originalName));
    checked(
      await owner.client.rpc("delete_issue", {
        ...scope,
        p_version: issue.version,
      }),
    );
    assert.equal(
      checked(
        await owner.client
          .from("issue_comments")
          .select("id")
          .eq("issue_id", issue.id),
      ).length,
      0,
    );
    assert.equal(
      (await member.client.rpc("create_comment_once", args)).error?.code,
      "P0002",
    );
    assert.ok(
      checked(
        await owner.client
          .from("activity_logs")
          .select("id")
          .eq("entity_type", "issue_comments")
          .eq("entity_id", peerComment.id)
          .eq("action", "DELETE"),
      ).length,
    );
    assert.ok(
      Number(
        localSql(
          `select count(*) from private.comment_requests where workspace_id='${wid}' and issue_id='${issue.id}'`,
        ),
      ) > 0,
    );
  } finally {
    checked(
      await service
        .from("profiles")
        .update({ display_name: originalName })
        .eq("id", member.user.id),
    );
    localSql(
      `delete from private.comment_requests where workspace_id='${wid}'`,
    );
    for (const table of [
      "issue_comments",
      "issues",
      "tasks",
      "projects",
      "memberships",
      "activity_logs",
    ])
      checked(await service.from(table).delete().eq("workspace_id", wid));
    checked(await service.from("workspaces").delete().eq("id", wid));
  }
});
