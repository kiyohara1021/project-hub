import type { TaskStatus, Priority } from "./task-types";
export type DashboardData = {
  workspace_id: string;
  viewer_id: string;
  as_of: string;
  today: string;
  metrics: {
    active_projects: number;
    task_total: number;
    task_done: number;
    completion_percent: number;
    overdue_tasks: number;
    open_issues: number;
  };
  projects: {
    id: string;
    name: string;
    task_total: number;
    task_done: number;
    completion_percent: number;
  }[];
  my_tasks: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority;
    project_id: string;
    project_name: string;
    due_date: string | null;
  }[];
  recent_activity: {
    id: string;
    actor_display_name: string;
    entity_type: string;
    action: string;
    created_at: string;
  }[];
};
