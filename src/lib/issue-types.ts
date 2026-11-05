import type { Priority } from "./task-types";
export const issueStatuses = [
  "open",
  "investigating",
  "resolved",
  "closed",
] as const;
export type IssueStatus = (typeof issueStatuses)[number];
export const issueLabels: Record<IssueStatus, string> = {
  open: "未解決",
  investigating: "調査中",
  resolved: "解決済み",
  closed: "終了",
};
export type Issue = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assignee_id: string | null;
  due_date: string | null;
  version: number;
  created_at: string;
};
export type IssuePage = { data: Issue[]; nextCursor: string | null };
