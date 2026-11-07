export const attachmentBucket = "project-attachments";
export const attachmentLimit = 3 * 1024 * 1024;
export type Attachment = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string | null;
  issue_id: string | null;
  uploader_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  state: "pending" | "ready";
  created_at: string;
};
export type ListedAttachment = Attachment & { canDelete: boolean };
