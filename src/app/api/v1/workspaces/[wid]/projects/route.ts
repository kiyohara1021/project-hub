import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, requestId: crypto.randomUUID() } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  if (!supabaseConfig()) return failure(503, "NOT_CONFIGURED", "接続が設定されていません");
  const client = await supabaseServer();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return failure(401, "UNAUTHENTICATED", "ログインしてください");
  const { wid } = await params;
  const query = new URL(request.url).searchParams;
  const limitText = query.get("limit") ?? "25";
  const limit = Number(limitText);
  const cursor = query.get("cursor");
  if ([...query.keys()].some(k => k !== "limit" && k !== "cursor") || !uuid.test(wid) || !/^\d+$/.test(limitText) || limit < 1 || limit > 100 || (cursor !== null && !uuid.test(cursor))) return failure(400, "INVALID_INPUT", "パラメーターを確認してください");
  const membership = await client.from("workspaces").select("id").eq("id", wid).maybeSingle();
  if (membership.error) return failure(500, "READ_FAILED", "一覧を取得できませんでした");
  if (!membership.data) return failure(404, "NOT_FOUND", "見つかりませんでした");
  // P2-1はIDの安定ソート。created_atとの複合カーソルはP3で検索と合わせて追加する。
  let dbQuery = client.from("projects").select("id,name,status,due_date,version").eq("workspace_id", wid).order("id").limit(limit + 1);
  if (cursor) dbQuery = dbQuery.gt("id", cursor);
  const result = await dbQuery;
  if (result.error) return failure(500, "READ_FAILED", "一覧を取得できませんでした");
  const rows = result.data.slice(0, limit);
  return NextResponse.json({ data: rows, nextCursor: result.data.length > limit ? rows.at(-1)?.id : null }, { headers: { "Cache-Control": "private, no-store" } });
}
