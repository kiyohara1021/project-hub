import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  localSettings,
  login,
  checked,
  adminClient,
  workspaceA,
  workspaceB,
  projectA,
  projectB,
  aliases,
} from "../../scripts/local-supabase.mjs";

test("実JWTでワークスペース分離、RPC、制約、履歴を確認", async () => {
  const settings = localSettings();
  const admin = adminClient(settings);
  const accounts = {};
  for (const alias of aliases) accounts[alias] = await login(settings, alias);
  const tables = [
    "workspaces",
    "memberships",
    "projects",
    "tasks",
    "issues",
    "activity_logs",
  ];
  const anon = createClient(settings.API_URL, settings.ANON_KEY, {
    auth: { persistSession: false },
  });
  assert.ok(
    (
      await anon.auth.signUp({
        email: "signup-disabled@example.invalid",
        password: "Local-Demo-Only-2026!",
      })
    ).error,
  );
  assert.equal(
    (await anon.rpc("create_workspace", { p_name: "匿名作成不可" })).error
      ?.code,
    "42501",
  );
  for (const table of [...tables, "profiles"]) {
    const anonymous = await anon.from(table).select("*");
    assert.ok(anonymous.error || anonymous.data.length === 0, `anon ${table}`);
  }
  for (const alias of aliases) {
    const { client } = accounts[alias];
    const allowed =
      alias === "outside"
        ? workspaceB
        : alias === "unassigned"
          ? null
          : workspaceA;
    for (const table of tables) {
      const rows = checked(await client.from(table).select("*"));
      assert.ok(
        rows.every(
          (r) => (table === "workspaces" ? r.id : r.workspace_id) === allowed,
        ),
        `${alias}: ${table} leak`,
      );
      if (!allowed) assert.equal(rows.length, 0);
    }
    const profiles = checked(await client.from("profiles").select("id"));
    assert.equal(
      profiles.length,
      alias === "outside" || alias === "unassigned" ? 1 : 3,
    );
    assert.ok(profiles.some((p) => p.id === accounts[alias].user.id));
    for (const table of [...tables, "profiles"]) {
      const result = await client.from(table).insert({});
      assert.equal(
        result.error?.code,
        "42501",
        `${alias}: direct insert ${table}`,
      );
      assert.equal(
        (
          await client
            .from(table)
            .delete()
            .not(table === "memberships" ? "user_id" : "id", "is", null)
        ).error?.code,
        "42501",
        `${alias}: direct delete ${table}`,
      );
    }
  }
  const { client: owner } = accounts.admin;
  const { client: member } = accounts.member;
  const { client: viewer } = accounts.viewer;
  const denied = async (client, name, args, code = "42501") =>
    assert.equal((await client.rpc(name, args)).error?.code, code, name);
  for (const alias of ["member", "viewer", "outside", "unassigned"]) {
    const client = accounts[alias].client;
    await denied(client, "create_project", {
      p_workspace_id: workspaceA,
      p_name: "不許可のテスト用データ",
    });
    await denied(client, "set_member_role", {
      p_workspace_id: workspaceA,
      p_user_id: accounts.member.user.id,
      p_role: "admin",
    });
    await denied(client, "remove_member", {
      p_workspace_id: workspaceA,
      p_user_id: accounts.admin.user.id,
    });
    await denied(client, "update_project", {
      p_workspace_id: workspaceA,
      p_project_id: projectA,
      p_name: "変更不可",
      p_status: "active",
      p_due_date: null,
      p_version: 1,
    });
  }
  assert.equal(
    (
      await viewer
        .from("memberships")
        .update({ role: "admin" })
        .eq("user_id", accounts.viewer.user.id)
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await owner
        .from("projects")
        .update({ workspace_id: workspaceB })
        .eq("id", projectA)
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await owner
        .from("activity_logs")
        .update({ actor_id: accounts.viewer.user.id })
        .eq("workspace_id", workspaceA)
    ).error?.code,
    "42501",
  );
  await denied(owner, "create_project", {
    p_workspace_id: workspaceB,
    p_name: "他スペース",
  });
  await denied(
    owner,
    "set_member_role",
    {
      p_workspace_id: workspaceA,
      p_user_id: accounts.admin.user.id,
      p_role: "member",
    },
    "23514",
  );
  await denied(
    owner,
    "remove_member",
    { p_workspace_id: workspaceA, p_user_id: accounts.admin.user.id },
    "23514",
  );

  const created = checked(
    await owner.rpc("create_project", {
      p_workspace_id: workspaceA,
      p_name: "検証用のテスト用プロジェクト",
    }),
  );
  const args = {
    p_workspace_id: workspaceA,
    p_project_id: created.id,
    p_name: "検証用のテスト用プロジェクト更新",
    p_status: "active",
    p_due_date: "2026-11-20",
    p_version: 1,
  };
  const updated = checked(await owner.rpc("update_project", args));
  assert.equal(updated.version, 2);
  await denied(owner, "update_project", args, "40001");
  await denied(
    owner,
    "update_project",
    { ...args, p_project_id: projectB },
    "P0002",
  );
  await denied(
    owner,
    "create_project",
    { p_workspace_id: workspaceA, p_name: " " },
    "23514",
  );
  const events = checked(
    await owner.from("activity_logs").select("*").eq("entity_id", created.id),
  );
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.actor_id === accounts.admin.user.id));
  assert.ok(events.every((e) => !JSON.stringify(e.changes).includes("検証用")));

  // 管理接続でも複合FKが別スペースのプロジェクト/担当を拒否する。
  assert.equal(
    (
      await admin.from("tasks").insert({
        workspace_id: workspaceA,
        project_id: projectB,
        title: "別スペース",
      })
    ).error?.code,
    "23503",
  );
  assert.equal(
    (
      await admin.from("issues").insert({
        workspace_id: workspaceA,
        project_id: projectA,
        title: "別担当",
        assignee_id: accounts.outside.user.id,
      })
    ).error?.code,
    "23503",
  );
  // ロール解除時にはタスク・課題の担当解除と履歴を同時に保存する。
  checked(
    await owner.rpc("remove_member", {
      p_workspace_id: workspaceA,
      p_user_id: accounts.member.user.id,
    }),
  );
  assert.equal(checked(await member.from("projects").select("id")).length, 0);
  assert.equal(
    checked(await member.from("activity_logs").select("id")).length,
    0,
  );
  assert.equal(
    checked(
      await owner
        .from("tasks")
        .select("assignee_id")
        .eq("project_id", projectA),
    )[0].assignee_id,
    null,
  );
  assert.equal(
    checked(
      await owner
        .from("issues")
        .select("assignee_id")
        .eq("project_id", projectA),
    )[0].assignee_id,
    null,
  );

  // 新規作成者がadminになり、同時降格しても管理者が最低1人残る。
  const wid = checked(
    await accounts.unassigned.client.rpc("create_workspace", {
      p_name: "並行検証デモスペース",
    }),
  );
  checked(
    await admin.from("memberships").insert({
      workspace_id: wid,
      user_id: accounts.admin.user.id,
      role: "admin",
    }),
  );
  const concurrent = await Promise.all([
    owner.rpc("set_member_role", {
      p_workspace_id: wid,
      p_user_id: accounts.admin.user.id,
      p_role: "member",
    }),
    accounts.unassigned.client.rpc("set_member_role", {
      p_workspace_id: wid,
      p_user_id: accounts.unassigned.user.id,
      p_role: "member",
    }),
  ]);
  assert.equal(concurrent.filter((r) => !r.error).length, 1);
  const remaining = checked(
    await admin
      .from("memberships")
      .select("role")
      .eq("workspace_id", wid)
      .eq("role", "admin"),
  );
  assert.equal(remaining.length, 1);
  checked(await admin.from("memberships").delete().eq("workspace_id", wid));
  checked(await admin.from("activity_logs").delete().eq("workspace_id", wid));
  checked(await admin.from("workspaces").delete().eq("id", wid));
  // 後続の画面テストで利用する初期所属を復元する。
  checked(
    await admin.from("memberships").insert({
      workspace_id: workspaceA,
      user_id: accounts.member.user.id,
      role: "member",
    }),
  );
  checked(
    await admin
      .from("tasks")
      .update({ assignee_id: accounts.member.user.id })
      .eq("id", "55555555-5555-4555-8555-555555555555"),
  );
  checked(
    await admin
      .from("issues")
      .update({ assignee_id: accounts.member.user.id })
      .eq("id", "66666666-6666-4666-8666-666666666666"),
  );
});
