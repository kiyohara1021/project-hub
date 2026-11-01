import { spawnSync } from "node:child_process";
const result = spawnSync("pnpm", ["exec", "supabase", "start"], { encoding: "utf8" });
if (result.status !== 0) {
  console.error("ローカルSupabaseの起動に失敗しました。Dockerの起動状態とポート54320〜54322を確認してください。");
  process.exit(1);
}
console.log("ローカルSupabaseを起動しました（接続鍵は表示しません）。");
