import { supabaseServer } from "./supabase/server";
import { supabaseConfig } from "./supabase/config";
import {
  afterTimeCursor,
  encodeTimeCursor,
  ProjectError,
  rpcError,
  uuid,
} from "./projects-server";
import type { NotificationPage } from "./notification-types";

export async function notificationAccess() {
  if (!supabaseConfig())
    throw new ProjectError(503, "NOT_CONFIGURED", "接続が設定されていません");
  const client = await supabaseServer();
  const auth = await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub)
    throw new ProjectError(401, "UNAUTHENTICATED", "ログインしてください");
  return client;
}

export async function readUnreadNotificationCount(
  query = new URLSearchParams(),
) {
  const client = await notificationAccess();
  if (query.size)
    throw new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  const result = await client
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (result.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "未読件数を取得できませんでした",
    );
  return result.count ?? 0;
}

export async function readNotifications(
  query: URLSearchParams,
): Promise<NotificationPage> {
  const client = await notificationAccess();
  const rawLimit = query.get("limit") ?? "25";
  const limit = Number(rawLimit);
  if (
    [...query.keys()].some(
      (key) =>
        !["limit", "cursor", "unread"].includes(key) ||
        query.getAll(key).length !== 1,
    ) ||
    !/^\d+$/.test(rawLimit) ||
    limit < 1 ||
    limit > 100 ||
    (query.has("unread") && query.get("unread") !== "1")
  )
    throw new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  let db = client
    .from("user_notifications")
    .select(
      "id,workspace_id,project_id,entity_type,entity_id,kind,created_at,read_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (query.get("unread") === "1") db = db.is("read_at", null);
  if (query.has("cursor")) db = db.or(afterTimeCursor(query.get("cursor")!));
  const [rows, count] = await Promise.all([
    db,
    client
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);
  if (rows.error || count.error)
    throw new ProjectError(500, "READ_FAILED", "通知を取得できませんでした");
  const data = rows.data.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      rows.data.length > limit && last ? encodeTimeCursor(last) : null,
    unreadCount: count.count ?? 0,
  };
}

export async function markNotificationRead(id: string) {
  const client = await notificationAccess();
  if (!uuid.test(id))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const result = await client.rpc("mark_notification_read", { p_id: id });
  if (result.error) throw rpcError(result.error);
  return result.data as string;
}

export async function markAllNotificationsRead() {
  const client = await notificationAccess();
  const result = await client.rpc("mark_all_notifications_read");
  if (result.error) throw rpcError(result.error);
  return result.data as number;
}
