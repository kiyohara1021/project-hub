import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const local = args.includes("--local");
const projectIndex = args.indexOf("--project-ref");
const project = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
const allowed = new Set([
  "--execute",
  "--local",
  "--project-ref",
  ...(project ? [project] : []),
]);
if (
  args.some((arg) => !allowed.has(arg)) ||
  (local ? !!project : !project || !/^[a-z]{20}$/.test(project))
) {
  console.error(
    "使い方: node scripts/cleanup-attachments.mjs (--local | --project-ref <ref>) [--execute]",
  );
  process.exit(1);
}
const scope = local ? ["--local"] : ["--linked", "--project-ref", project];
const directory = mkdtempSync(
  join(tmpdir(), "project-hub-attachment-cleanup-"),
);
function cli(parts) {
  return execFileSync(
    "pnpm",
    ["exec", "supabase", ...parts, "--experimental"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}
function sql(query) {
  const file = join(directory, "query.sql");
  writeFileSync(file, query);
  const output = JSON.parse(cli(["db", "query", ...scope, "--file", file]));
  if (!Array.isArray(output.rows))
    throw new Error("Unexpected database response");
  return output.rows;
}
try {
  const rows = sql(
    execute
      ? "select * from private.attachment_cleanup_batch(100);"
      : "select id,object_path,state,workspace_id,project_id,created_at,expires_at from private.attachment_objects where retry_after<=statement_timestamp() and (state='deleting' or (state='pending' and expires_at<=statement_timestamp())) order by retry_after,id limit 100;",
  );
  if (!execute) {
    console.log(
      JSON.stringify(
        { mode: "preview", count: rows.length, candidates: rows },
        null,
        2,
      ),
    );
    console.log(
      "削除する場合は同じ接続先に --execute を付けて再実行してください。",
    );
  } else {
    let deleted = 0,
      failed = 0;
    for (const row of rows) {
      if (
        typeof row.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          row.id,
        ) ||
        row.object_path !== row.id
      )
        throw new Error("Unexpected object path");
      try {
        cli([
          "storage",
          "rm",
          ...scope,
          "--yes",
          `ss:///project-attachments/${row.id}`,
        ]);
        sql(`select private.complete_attachment_cleanup('${row.id}'::uuid);`);
        deleted++;
      } catch {
        failed++;
        console.error(
          `添付ファイル ${row.id} の回収に失敗しました。接続を確認し、5分後以降に再実行してください。`,
        );
      }
    }
    console.log(
      JSON.stringify({
        mode: "execute",
        candidates: rows.length,
        deleted,
        failed,
      }),
    );
    if (failed) process.exitCode = 1;
  }
} catch {
  console.error(
    "添付ファイルの回収を実行できませんでした。CLI認証・接続先・migration018の適用状態を確認してください。",
  );
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
