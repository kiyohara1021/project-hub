import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { projectStatuses, type Project, type ProjectPage, type ProjectFields } from "./project-types";

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = "id,workspace_id,name,description,status,due_date,version,created_at";
export class ProjectError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } }); }
export function apiError(error: unknown) {
  const e = error instanceof ProjectError ? error : new ProjectError(500, "INTERNAL_ERROR", "処理できませんでした。再試行してください。");
  return json({ error: { code: e.code, message: e.message, requestId: crypto.randomUUID() } }, e.status);
}
export async function projectAccess(wid: string, write = false) {
  if (!supabaseConfig()) throw new ProjectError(503, "NOT_CONFIGURED", "接続が設定されていません");
  const client = await supabaseServer();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) throw new ProjectError(401, "UNAUTHENTICATED", "ログインしてください");
  if (!uuid.test(wid)) throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const member = await client.from("memberships").select("role").eq("workspace_id", wid).eq("user_id", data.claims.sub).maybeSingle();
  if (member.error) throw new ProjectError(500, "READ_FAILED", "所属を確認できませんでした");
  if (!member.data) throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  if (write && member.data.role !== "admin") throw new ProjectError(403, "FORBIDDEN", "管理者だけが変更できます");
  return client;
}
export function checkOrigin(request: Request) {
  if (!supabaseConfig()) throw new ProjectError(503, "NOT_CONFIGURED", "接続が設定されていません");
  if (request.headers.get("origin") !== supabaseConfig()?.origin) throw new ProjectError(403, "INVALID_ORIGIN", "この操作を許可できません");
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ProjectError(415, "INVALID_CONTENT_TYPE", "JSONで送信してください");
  const reader = request.body?.getReader();
  if (!reader) throw new ProjectError(400, "INVALID_INPUT", "入力を確認してください");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 32768) { await reader.cancel(); throw new ProjectError(413, "BODY_TOO_LARGE", "入力が大きすぎます"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ProjectError(400, "INVALID_INPUT", "JSONの形式を確認してください"); }
}
export function validateProject(value: Record<string, unknown>, edit = false): ProjectFields & { status?: Project["status"]; version?: number } {
  const keys = edit ? ["name", "description", "due_date", "status", "version"] : ["name", "description", "due_date"];
  const invalid = () => new ProjectError(400, "INVALID_INPUT", "名前・説明・期限・状態を確認してください");
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw invalid();
  if (typeof value.name !== "string" || !value.name.trim() || Array.from(value.name.trim()).length > 120 || typeof value.description !== "string" || Array.from(value.description).length > 5000) throw invalid();
  if (value.due_date !== null && (typeof value.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.due_date) || !Number.isFinite(Date.parse(value.due_date)) || new Date(value.due_date).toISOString().slice(0,10) !== value.due_date || value.due_date.startsWith("0000"))) throw invalid();
  if (edit && (typeof value.status !== "string" || !projectStatuses.includes(value.status as Project["status"]) || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 2147483647)) throw invalid();
  return { name: value.name.trim(), description: value.description, due_date: value.due_date as string | null, ...(edit ? { status: value.status as Project["status"], version: value.version as number } : {}) };
}
export function rpcError(error: { code: string; message: string }) {
  if (error.code === "40001") return new ProjectError(409, error.message === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "VERSION_CONFLICT", error.message === "IDEMPOTENCY_CONFLICT" ? "送信済みの内容と一致しません。新しい入力として送信してください。" : "他の操作で更新されました。最新版を読み直してください。");
  if (error.code === "42501") return new ProjectError(403, "FORBIDDEN", "この操作を許可できません");
  if (error.code === "P0002") return new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  if (["23514", "23502", "22023", "22007", "22008"].includes(error.code)) return new ProjectError(400, "INVALID_INPUT", "入力を確認してください");
  return new ProjectError(500, "WRITE_FAILED", "保存できませんでした。再試行してください。");
}
export async function readProject(wid: string, pid: string) {
  const client = await projectAccess(wid);
  if (!uuid.test(pid)) throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const result = await client.from("projects").select(fields).eq("workspace_id", wid).eq("id", pid).maybeSingle();
  if (result.error) throw new ProjectError(500, "READ_FAILED", "取得できませんでした");
  if (!result.data) throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return result.data as Project;
}
export async function readProjectPage(wid: string, query: URLSearchParams): Promise<ProjectPage> {
  const client = await projectAccess(wid);
  const limitText = query.get("limit") ?? "25"; const limit = Number(limitText);
  const q = query.get("q") ?? ""; const status = query.get("status") ?? "";
  const cursor = query.get("cursor");
  const invalid = () => new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  if ([...query.keys()].some(k => !["limit", "q", "status", "cursor"].includes(k) || query.getAll(k).length > 1) || !/^\d+$/.test(limitText) || limit < 1 || limit > 100 || q.length > 120 || (status && !projectStatuses.includes(status as Project["status"]))) throw invalid();
  let db = client.from("projects").select(fields).eq("workspace_id", wid).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (q) db = db.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  if (status) db = db.eq("status", status);
  if (cursor) {
    if (cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw invalid();
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof value.time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.time) || !Number.isFinite(Date.parse(value.time)) || value.time.startsWith("0000") || new Date(value.time).toISOString().slice(0,10) !== value.time.slice(0,10) || typeof value.id !== "string" || !uuid.test(value.id)) throw invalid();
      db = db.or(`created_at.lt.${value.time},and(created_at.eq.${value.time},id.lt.${value.id})`);
    } catch { throw invalid(); }
  }
  const result = await db;
  if (result.error) throw new ProjectError(500, "READ_FAILED", "一覧を取得できませんでした");
  const rows = result.data.slice(0, limit) as Project[]; const last = rows.at(-1);
  return { data: rows, nextCursor: result.data.length > limit && last ? Buffer.from(JSON.stringify({ time: last.created_at, id: last.id })).toString("base64url") : null };
}
