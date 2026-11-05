export type IssueComment = {
  id: string;
  workspace_id: string;
  project_id: string;
  issue_id: string;
  author_id: string;
  author_display_name: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type CommentPage = { data: IssueComment[]; nextCursor: string | null };
