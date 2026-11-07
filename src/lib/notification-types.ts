export const notificationChangedEvent = "projecthub:notifications-changed";
export type NotificationKind =
  "assigned_task" | "assigned_issue" | "issue_comment";
export type Notification = {
  id: string;
  workspace_id: string;
  project_id: string;
  entity_type: "tasks" | "issues";
  entity_id: string;
  kind: NotificationKind;
  created_at: string;
  read_at: string | null;
};
export type NotificationPage = {
  data: Notification[];
  nextCursor: string | null;
  unreadCount: number;
};
export const notificationLabels: Record<NotificationKind, string> = {
  assigned_task: "タスクの担当者になりました",
  assigned_issue: "課題の担当者になりました",
  issue_comment: "課題に新しいコメントがあります",
};
