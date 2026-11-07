import { createHash, randomBytes } from "node:crypto";
import { supabaseServer } from "./supabase/server";
import { supabaseConfig } from "./supabase/config";
import { selfServiceAuthEnabled, validEmail } from "./auth-forms";
import {
  projectAccess,
  ProjectError,
  rpcError,
  decodeTimeCursor,
  encodeTimeCursor,
  uuid,
  checkOrigin,
  readJson,
  idempotencyKey,
  json,
  apiError,
} from "./projects-server";
import { exactKeys, parseVersion } from "./validation";
import type { Invitation, InvitationPage } from "./invitation-types";
export function invitationEnabled() {
  if (!selfServiceAuthEnabled())
    throw new ProjectError(
      503,
      "UNAVAILABLE",
      "この環境では招待を利用できません",
    );
}
export function invitationHash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ProjectError(404, "NOT_FOUND", "招待を利用できません");
  return createHash("sha256").update(token).digest("hex");
}
function invitationError(e: { code: string; message: string }) {
  return e.code === "23505"
    ? new ProjectError(
        409,
        "INVITATION_EXISTS",
        "この宛先には有効な招待があります",
      )
    : rpcError(e);
}
export async function listInvitations(
  wid: string,
  q: URLSearchParams,
): Promise<InvitationPage> {
  const client = await projectAccess(wid, true);
  const raw = q.get("limit") ?? "25";
  const limit = Number(raw);
  if (
    [...q.keys()].some(
      (k) => !["limit", "cursor"].includes(k) || q.getAll(k).length > 1,
    ) ||
    !/^\d+$/.test(raw) ||
    limit < 1 ||
    limit > 100
  )
    throw new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  const cursor = q.has("cursor") ? decodeTimeCursor(q.get("cursor")!) : null;
  const r = await client.rpc("list_workspace_invitations", {
    p_workspace_id: wid,
    p_limit: limit + 1,
    p_before_time: cursor?.time ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (r.error) throw invitationError(r.error);
  const rows = (r.data as Invitation[]).slice(0, limit);
  return {
    data: rows,
    nextCursor:
      r.data.length > limit && rows.length
        ? encodeTimeCursor(rows[rows.length - 1])
        : null,
  };
}
export async function mutateInvitation(
  request: Request,
  wid: string,
  action: "create" | "resend" | "cancel",
  id?: string,
) {
  try {
    checkOrigin(request);
    invitationEnabled();
    const client = await projectAccess(wid, true);
    const key = idempotencyKey(request);
    const input = await readJson(request);
    const token = randomBytes(32).toString("base64url");
    let result;
    if (action === "create") {
      exactKeys(input, ["email", "role"]);
      if (
        typeof input.email !== "string" ||
        !validEmail(input.email.trim()) ||
        typeof input.role !== "string" ||
        !["member", "viewer"].includes(input.role)
      )
        throw new ProjectError(
          400,
          "INVALID_INPUT",
          "メールアドレスとロールを確認してください",
        );
      result = await client.rpc("prepare_workspace_invitation", {
        p_workspace_id: wid,
        p_email: input.email,
        p_role: input.role,
        p_token_hash: invitationHash(token),
        p_key: key,
      });
    } else {
      exactKeys(input, ["version"]);
      if (!id || !uuid.test(id))
        throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
      result = await client.rpc("update_workspace_invitation", {
        p_workspace_id: wid,
        p_invitation_id: id,
        p_action: action,
        p_version: parseVersion(input.version),
        p_token_hash: action === "resend" ? invitationHash(token) : null,
        p_key: key,
      });
    }
    if (result.error) throw invitationError(result.error);
    let data = result.data as Invitation & { replayed: boolean };
    if (action !== "cancel" && !data.replayed) {
      let delivery = "failed";
      try {
        const sent = await client.auth.signInWithOtp({
          email: data.email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${supabaseConfig()!.origin}/confirm?next=${encodeURIComponent(`/invitations/${token}`)}`,
          },
        });
        delivery = sent.error ? "failed" : "sent";
      } catch {
        /* Result is deliberately recorded without provider error details. */
      }
      const recorded = await client.rpc("record_invitation_delivery", {
        p_workspace_id: wid,
        p_invitation_id: data.id,
        p_version: data.version,
        p_delivery: delivery,
      });
      if (!recorded.error) data = { ...recorded.data, replayed: false };
    }
    return json({ data }, action === "create" ? 201 : 200);
  } catch (e) {
    return apiError(e);
  }
}
export async function invitationClient() {
  invitationEnabled();
  const client = await supabaseServer();
  const auth = await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub)
    throw new ProjectError(401, "UNAUTHENTICATED", "ログインしてください");
  return client;
}
