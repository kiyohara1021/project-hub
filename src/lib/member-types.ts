export const memberRoles = ["admin", "member", "viewer"] as const;
export type MemberRole = (typeof memberRoles)[number];
export const memberLabels: Record<MemberRole, string> = {
  admin: "管理者",
  member: "メンバー",
  viewer: "閲覧者",
};
export type Member = {
  user_id: string;
  role: MemberRole;
  version: number;
  joined_at: string;
  profiles: { display_name: string };
};

export type MemberWithAssignments = Member & {
  task_count: number;
  issue_count: number;
};
export type MemberPage = {
  data: MemberWithAssignments[];
  nextCursor: string | null;
};
