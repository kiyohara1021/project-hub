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
  { id: projectA, workspace_id: workspaceA, name: "架空プロジェクトA", status: "active" },
  { id: projectB, workspace_id: workspaceB, name: "架空プロジェクトB", status: "active" },
  { id: "77777777-7777-4777-8777-777777777777", workspace_id: workspaceA, name: "架空プロジェクトC", status: "planned" },
]));
checked(await admin.from("tasks").upsert({ id: "55555555-5555-4555-8555-555555555555", workspace_id: workspaceA, project_id: projectA, title: "入力項目を確認する", assignee_id: users.member }));
checked(await admin.from("issues").upsert({ id: "66666666-6666-4666-8666-666666666666", workspace_id: workspaceA, project_id: projectA, title: "表示文言を確認する", assignee_id: users.member }));
console.log("ローカルに架空ユーザー5名とデモデータを投入しました。");
