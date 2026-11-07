export const projectStatuses = ["planned", "active", "archived"] as const;
export type ProjectVisibility = "workspace" | "private";
export const visibilityLabels: Record<ProjectVisibility, string> = {
  workspace: "ワークスペース全員",
  private: "管理者と指定した参加者",
};
export type ProjectStatus = (typeof projectStatuses)[number];
export const statusLabels: Record<ProjectStatus, string> = {
  planned: "計画中",
  active: "進行中",
  archived: "アーカイブ",
};
export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  due_date: string | null;
  version: number;
  created_at: string;
};
export type ProjectPage = { data: Project[]; nextCursor: string | null };
export type ProjectFields = {
  name: string;
  description: string;
  due_date: string | null;
};
