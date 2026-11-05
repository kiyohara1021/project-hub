import { projectAccess, ProjectError, uuid, rpcError } from "./projects-server";
import {
  memberRoles,
  type Member,
  type MemberRole,
  type MemberPage,
} from "./member-types";
export const memberFields =
  "user_id,role,version,joined_at,profiles!memberships_user_id_fkey(display_name)";
export async function readMembers(wid: string, query: URLSearchParams) {
  const client = await projectAccess(wid);
  const role = query.get("role") ?? "";
  const cursor = query.get("cursor");
  const raw = query.get("limit") ?? "25";
  const limit = Number(raw);
  if (
    [...query.keys()].some(
      (k) =>
        !["role", "cursor", "limit"].includes(k) || query.getAll(k).length > 1,
    ) ||
    (role && !memberRoles.includes(role as MemberRole)) ||
    (cursor !== null && !uuid.test(cursor)) ||
    !/^\d+$/.test(raw) ||
    limit < 1 ||
    limit > 100
  )
    throw new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  const result = await client.rpc("read_members", {
    p_workspace_id: wid,
    p_role: role || null,
    p_cursor: cursor,
    p_limit: limit,
  });
  if (result.error?.code === "P0002")
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  if (result.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "メンバーを取得できませんでした",
    );
  return result.data as MemberPage;
}
export async function readMember(wid: string, uid: string) {
  const client = await projectAccess(wid);
  if (!uuid.test(uid))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const result = await client
    .from("memberships")
    .select(memberFields)
    .eq("workspace_id", wid)
    .eq("user_id", uid)
    .maybeSingle();
  if (result.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "メンバーを取得できませんでした",
    );
  if (!result.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return result.data as unknown as Member;
}
export function memberRpcError(error: { code: string; message: string }) {
  return error.message === "ALREADY_MEMBER"
    ? new ProjectError(
        409,
        "ALREADY_MEMBER",
        "このユーザーは既に所属しています。一覧で現在のロールを確認してください。",
      )
    : error.message === "LAST_ADMIN"
      ? new ProjectError(
          409,
          "LAST_ADMIN",
          "最後の管理者は変更・所属解除できません。先に別のメンバーを管理者にしてください。",
        )
      : rpcError(error);
}
