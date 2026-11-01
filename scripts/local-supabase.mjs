import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// ローカルCLIの接続情報のみ。環境変数からリモートの管理鍵を受け取らない。
export function localSettings() {
  const settings = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const url = new URL(settings.API_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "54321" || url.protocol !== "http:") throw new Error("ローカルSupabaseだけが対象です");
  return settings;
}
export const workspaceA = "11111111-1111-4111-8111-111111111111";
export const workspaceB = "22222222-2222-4222-8222-222222222222";
export const projectA = "33333333-3333-4333-8333-333333333333";
export const projectB = "44444444-4444-4444-8444-444444444444";
export const demoPassword = "Local-Demo-Only-2026!";
export const aliases = ["admin", "member", "viewer", "outside", "unassigned"];
export function adminClient(settings) {
  return createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function login(settings, alias) {
  const client = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: `${alias}@example.invalid`, password: demoPassword });
  if (error) throw error;
  return { client, user: data.user };
}
export function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}
