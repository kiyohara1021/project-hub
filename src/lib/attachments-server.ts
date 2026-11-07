import { createHash } from "node:crypto";
import { ProjectError, uuid, rpcError } from "./projects-server";
import { taskAccess } from "./tasks-server";
import {
  attachmentLimit,
  attachmentBucket,
  type Attachment,
} from "./attachment-types";
export { attachmentBucket };
export const attachmentFields =
  "id,workspace_id,project_id,task_id,issue_id,uploader_id,file_name,content_type,size_bytes,sha256,state,created_at";
const types: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
};
export function attachmentError(error: { code: string; message: string }) {
  if (error.code === "54000")
    return new ProjectError(
      409,
      "ATTACHMENT_LIMIT",
      "添付ファイルは1件のタスク・課題につき20個までです。中断した送信の枠は、管理者の回収後に空きます",
    );
  if (error.code === "55000")
    return new ProjectError(
      409,
      "PROJECT_ARCHIVED",
      "アーカイブ済みのプロジェクトは変更できません",
    );
  return rpcError(error);
}
export function validateAttachment(
  name: string,
  type: string,
  bytes: Uint8Array,
) {
  const fileName = name.normalize("NFC").trim();
  if (
    !fileName ||
    Array.from(fileName).length > 180 ||
    /[\u0000-\u001f\u007f/\\]/.test(fileName) ||
    !bytes.length ||
    bytes.length > attachmentLimit
  )
    throw new ProjectError(
      bytes.length > attachmentLimit ? 413 : 400,
      "INVALID_FILE",
      "ファイル名と容量（1〜3MiB）を確認してください",
    );
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (!types[extension] || types[extension] !== type)
    throw new ProjectError(
      400,
      "INVALID_FILE",
      "PNG・JPEG・WebP・PDF・UTF-8テキストを選択してください",
    );
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  let valid = false;
  if (type === "image/png")
    valid =
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      );
  if (type === "image/jpeg")
    valid =
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255;
  if (type === "image/webp")
    valid =
      bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (type === "application/pdf")
    valid = bytes.length >= 5 && ascii(0, 5) === "%PDF-";
  if (type === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valid = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
    } catch {}
  }
  if (!valid)
    throw new ProjectError(
      400,
      "INVALID_FILE",
      "ファイルの形式と内容が一致しません",
    );
  return {
    fileName,
    contentType: type,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function readAttachmentForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;/i.test(contentType))
    throw new ProjectError(
      415,
      "INVALID_CONTENT_TYPE",
      "ファイルを選択してください",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new ProjectError(400, "INVALID_FILE", "ファイルを選択してください");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new ProjectError(413, "BODY_TOO_LARGE", "ファイルは3MiBまでです");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: data,
    }).formData();
  } catch {
    throw new ProjectError(
      400,
      "INVALID_FILE",
      "ファイルを読み取れませんでした",
    );
  }
  if (
    [...form.keys()].some((key) => key !== "file") ||
    form.getAll("file").length !== 1
  )
    throw new ProjectError(
      400,
      "INVALID_FILE",
      "ファイルを1個選択してください",
    );
  const file = form.get("file");
  if (!(file instanceof File))
    throw new ProjectError(400, "INVALID_FILE", "ファイルを選択してください");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, ...validateAttachment(file.name, file.type, bytes) };
}
export async function attachmentAccess(
  wid: string,
  pid: string,
  kind: "task" | "issue",
  target: string,
  write = false,
) {
  const access = await taskAccess(wid, pid, write, kind);
  if (!uuid.test(target))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const parent = await access.client
    .from(kind === "task" ? "tasks" : "issues")
    .select("id")
    .eq("workspace_id", wid)
    .eq("project_id", pid)
    .eq("id", target)
    .maybeSingle();
  if (parent.error)
    throw new ProjectError(500, "READ_FAILED", "添付先を確認できませんでした");
  if (!parent.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return access;
}
export async function attachmentList(
  access: Awaited<ReturnType<typeof attachmentAccess>>,
  wid: string,
  pid: string,
  kind: "task" | "issue",
  target: string,
) {
  const { client, project } = access;
  const claim = await client.auth.getClaims();
  const member = await client
    .from("memberships")
    .select("role")
    .eq("workspace_id", wid)
    .eq("user_id", claim.data?.claims.sub ?? "")
    .maybeSingle();
  if (claim.error || member.error || !member.data)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "添付ファイルを取得できませんでした",
    );
  const result = await client
    .from("attachments")
    .select(attachmentFields)
    .eq("workspace_id", wid)
    .eq("project_id", pid)
    .eq(kind === "task" ? "task_id" : "issue_id", target)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(20);
  if (result.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "添付ファイルを取得できませんでした",
    );
  const canWrite =
    project.status !== "archived" &&
    ["admin", "member"].includes(member.data.role);
  return {
    data: (result.data as Attachment[]).map((row) => ({
      ...row,
      canDelete:
        canWrite &&
        (row.uploader_id === claim.data?.claims.sub ||
          member.data!.role === "admin"),
    })),
    canUpload: canWrite,
  };
}
export async function findAttachment(
  access: Awaited<ReturnType<typeof attachmentAccess>>,
  wid: string,
  pid: string,
  kind: "task" | "issue",
  target: string,
  id: string,
) {
  if (!uuid.test(id))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const result = await access.client
    .from("attachments")
    .select(attachmentFields)
    .eq("workspace_id", wid)
    .eq("project_id", pid)
    .eq(kind === "task" ? "task_id" : "issue_id", target)
    .eq("id", id)
    .maybeSingle();
  if (result.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "添付ファイルを取得できませんでした",
    );
  if (!result.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return result.data as Attachment;
}
export async function uploadAttachment(
  access: Awaited<ReturnType<typeof attachmentAccess>>,
  wid: string,
  pid: string,
  kind: "task" | "issue",
  target: string,
  key: string,
  file: Awaited<ReturnType<typeof readAttachmentForm>>,
) {
  const { client } = access;
  const reservation = await client.rpc("reserve_attachment", {
    p_workspace_id: wid,
    p_project_id: pid,
    p_kind: kind,
    p_target_id: target,
    p_file_name: file.fileName,
    p_content_type: file.contentType,
    p_size_bytes: file.size,
    p_sha256: file.sha256,
    p_key: key,
  });
  if (reservation.error) throw attachmentError(reservation.error);
  const row = reservation.data as Attachment;
  if (row.state === "ready") return row;
  const stored = await client.storage
    .from(attachmentBucket)
    .upload(row.id, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });
  if (stored.error) {
    // 応答喪失後の同じ予約なら、保存済みの内容を照合して公開確定を続ける。
    const previous = await client.storage
      .from(attachmentBucket)
      .download(row.id);
    if (previous.error || previous.data.size > attachmentLimit)
      throw new ProjectError(
        503,
        "UPLOAD_FAILED",
        "送信結果を確認できませんでした。同じファイルで再試行してください。",
      );
    const original = validateAttachment(
      row.file_name,
      row.content_type,
      new Uint8Array(await previous.data.arrayBuffer()),
    );
    if (original.sha256 !== file.sha256)
      throw new ProjectError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "送信済みの内容と一致しません。ファイルを選び直してください。",
      );
  }
  const result = await client.rpc("finalize_attachment", { p_id: row.id });
  if (result.error) throw attachmentError(result.error);
  return result.data as Attachment;
}
export async function downloadAttachment(
  access: Awaited<ReturnType<typeof attachmentAccess>>,
  row: Attachment,
) {
  const stored = await access.client.storage
    .from(attachmentBucket)
    .download(row.id);
  if (stored.error || stored.data.size > attachmentLimit)
    throw new ProjectError(
      503,
      "DOWNLOAD_FAILED",
      "ファイルを取得できませんでした。再試行してください。",
    );
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  let checked: ReturnType<typeof validateAttachment>;
  try {
    checked = validateAttachment(row.file_name, row.content_type, bytes);
  } catch {
    throw new ProjectError(
      503,
      "DOWNLOAD_FAILED",
      "ファイルを確認できませんでした。管理者へ連絡してください。",
    );
  }
  if (checked.size !== row.size_bytes || checked.sha256 !== row.sha256)
    throw new ProjectError(
      503,
      "DOWNLOAD_FAILED",
      "ファイルを確認できませんでした。管理者へ連絡してください。",
    );
  const encoded = encodeURIComponent(row.file_name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(new Blob([bytes], { type: row.content_type }).stream(), {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="download.${row.file_name.split(".").at(-1)!.toLowerCase()}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
