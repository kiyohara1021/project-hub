import { execFileSync } from "node:child_process";
import { localSettings } from "./local-supabase.mjs";

// ローカル検証専用。アプリからは使用せず、テスト内の固定SQLのみを渡す。
export function localSql(sql) {
  localSettings();
  return execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_project-hub",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
