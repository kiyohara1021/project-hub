import { localSettings, adminClient, checked, aliases, demoPassword, workspaceA, workspaceB, projectA, projectB } from "./local-supabase.mjs";

const admin = adminClient(localSettings());
const existing = checked(await admin.auth.admin.listUsers({ perPage: 1000 })).users;
const users = {};
for (const [index, alias] of aliases.entries()) {
  const email = `${alias}@example.invalid`;
  const user = existing.find(u => u.email === email) ?? checked(await admin.auth.admin.createUser({ email, password: demoPassword, email_confirm: true })).user;
  users[alias] = user.id;
  checked(await admin.from("profiles").update({ display_name: `デモメンバー0${index + 1}` }).eq("id", user.id));
}
checked(await admin.from("workspaces").upsert([{ id: workspaceA, name: "デモスペースA" }, { id: workspaceB, name: "デモスペースB" }]));
checked(await admin.from("memberships").upsert([
  { workspace_id: workspaceA, user_id: users.admin, role: "admin" },
  { workspace_id: workspaceA, user_id: users.member, role: "member" },
  { workspace_id: workspaceA, user_id: users.viewer, role: "viewer" },
  { workspace_id: workspaceB, user_id: users.outside, role: "admin" },
]));
checked(await admin.from("projects").upsert([
  { id: projectA, workspace_id: workspaceA, name: "サンプルプロジェクトA", status: "active" },
  { id: projectB, workspace_id: workspaceB, name: "サンプルプロジェクトB", status: "active" },
  { id: "77777777-7777-4777-8777-777777777777", workspace_id: workspaceA, name: "サンプルプロジェクトC", status: "planned" },
]));
checked(await admin.from("tasks").upsert([
  { id: "55555555-5555-4555-8555-555555555555", workspace_id: workspaceA, project_id: projectA, title: "入力項目を確認する", description: "画面項目を整理します。", assignee_id: users.member, status: "todo", priority: "high", position: 1024, due_date: "2026-12-10" },
  { id: "88888888-8888-4888-8888-888888888888", workspace_id: workspaceA, project_id: projectA, title: "入力チェックを追加する", description: "フォームの入力条件を確認します。", assignee_id: users.member, status: "doing", priority: "medium", position: 1024, due_date: "2026-12-12" },
  { id: "99999999-9999-4999-8999-999999999999", workspace_id: workspaceA, project_id: projectA, title: "キーボード操作を確認する", description: "操作順とフォーカスを確認します。", assignee_id: users.member, status: "review", priority: "medium", position: 1024, due_date: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspace_id: workspaceA, project_id: projectA, title: "基本レイアウトを作成する", description: "デモ画面の共通レイアウトです。", assignee_id: users.member, status: "done", priority: "low", position: 1024, due_date: null },
]));
checked(await admin.from("issues").upsert({ id: "66666666-6666-4666-8666-666666666666", workspace_id: workspaceA, project_id: projectA, title: "表示文言を確認する", assignee_id: users.member }));
console.log("ローカルにテスト用ユーザー5名とデモデータを投入しました。");
