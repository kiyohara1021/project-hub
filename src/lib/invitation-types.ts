export type Invitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: "member" | "viewer";
  status: "pending" | "accepted" | "cancelled" | "expired";
  delivery: "pending" | "sent" | "failed";
  version: number;
  created_at: string;
  expires_at: string;
};
export type InvitationPage = { data: Invitation[]; nextCursor: string | null };
