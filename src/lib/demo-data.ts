export const projects = [
  { id: "demo-a", name: "架空プロジェクトA", description: "画面と入力の基本を整える", progress: 60, due: "2026/11/20" },
  { id: "demo-b", name: "架空プロジェクトB", description: "検索と一覧の使いやすさを考える", progress: 40, due: "2026/11/25" },
  { id: "demo-c", name: "架空プロジェクトC", description: "操作と表示を確認する", progress: 50, due: "2026/12/10" },
] as const;

export const columns = ["未着手", "進行中", "レビュー", "完了"] as const;
export const tasks = [
  { id: "TASK-001", title: "画面項目を整理する", status: "未着手", assignee: "デモメンバー01" },
  { id: "TASK-002", title: "一覧の余白を調整する", status: "未着手", assignee: "デモメンバー02" },
  { id: "TASK-003", title: "入力チェックを追加する", status: "進行中", assignee: "デモメンバー01" },
  { id: "TASK-004", title: "検索条件を保存する", status: "進行中", assignee: "デモメンバー02" },
  { id: "TASK-005", title: "キーボード操作を確認する", status: "レビュー", assignee: "デモメンバー01" },
  { id: "TASK-006", title: "基本レイアウトを作成する", status: "完了", assignee: "デモメンバー01" },
] as const;
