export const taskStatuses = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskLabels: Record<TaskStatus, string> = {
  todo: "未着手",
  doing: "進行中",
  review: "レビュー",
  done: "完了",
};
export const priorities = ["low", "medium", "high"] as const;
export type Priority = (typeof priorities)[number];
export const priorityLabels: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
};
export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  version: number;
};
export type TaskPage = { data: Task[]; nextCursor: string | null };
export type Assignee = { id: string; name: string };
export type BoardPages = Record<TaskStatus, TaskPage>;
