import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { localSettings } from "./local-supabase.mjs";

const settings = localSettings();
if (
  existsSync(".env.local") &&
  !readFileSync(".env.local", "utf8").includes(
    `SUPABASE_URL=${settings.API_URL}\n`,
  )
) {
  throw new Error(
    "既存の.env.localは変更しません。退避してから実行してください。",
  );
}
writeFileSync(
  ".env.local",
  `APP_MODE=connected\nSELF_SERVICE_AUTH_ENABLED=true\nAPP_ORIGIN=http://127.0.0.1:3000\nSUPABASE_URL=${settings.API_URL}\nSUPABASE_PUBLISHABLE_KEY=${settings.PUBLISHABLE_KEY ?? settings.ANON_KEY}\n`,
  { mode: 0o600 },
);
console.log("管理鍵を含まないローカル接続設定を.env.localへ保存しました。");
