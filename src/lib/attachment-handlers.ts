import {
  apiError,
  checkOrigin,
  idempotencyKey,
  json,
  noContent,
  ProjectError,
} from "./projects-server";
import {
  attachmentAccess,
  attachmentList,
  findAttachment,
  readAttachmentForm,
  uploadAttachment,
  downloadAttachment,
  attachmentBucket,
  attachmentError,
} from "./attachments-server";
type Scope = { wid: string; pid: string; target: string };
export async function attachmentsGet(
  request: Request,
  scope: Scope,
  kind: "task" | "issue",
) {
  try {
    if (new URL(request.url).search)
      throw new ProjectError(
        400,
        "INVALID_INPUT",
        "表示条件を確認してください",
      );
    const access = await attachmentAccess(
      scope.wid,
      scope.pid,
      kind,
      scope.target,
    );
    return json(
      await attachmentList(access, scope.wid, scope.pid, kind, scope.target),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function attachmentsPost(
  request: Request,
  scope: Scope,
  kind: "task" | "issue",
) {
  try {
    checkOrigin(request);
    const access = await attachmentAccess(
      scope.wid,
      scope.pid,
      kind,
      scope.target,
      true,
    );
    const key = idempotencyKey(request);
    const file = await readAttachmentForm(request);
    return json(
      {
        data: await uploadAttachment(
          access,
          scope.wid,
          scope.pid,
          kind,
          scope.target,
          key,
          file,
        ),
      },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function attachmentGet(
  scope: Scope,
  kind: "task" | "issue",
  id: string,
) {
  try {
    const access = await attachmentAccess(
      scope.wid,
      scope.pid,
      kind,
      scope.target,
    );
    const row = await findAttachment(
      access,
      scope.wid,
      scope.pid,
      kind,
      scope.target,
      id,
    );
    return await downloadAttachment(access, row);
  } catch (error) {
    return apiError(error);
  }
}
export async function attachmentDelete(
  request: Request,
  scope: Scope,
  kind: "task" | "issue",
  id: string,
) {
  try {
    checkOrigin(request);
    const access = await attachmentAccess(
      scope.wid,
      scope.pid,
      kind,
      scope.target,
      true,
    );
    const row = await findAttachment(
      access,
      scope.wid,
      scope.pid,
      kind,
      scope.target,
      id,
    );
    const removed = await access.client.rpc("remove_attachment", {
      p_id: row.id,
    });
    if (removed.error) throw attachmentError(removed.error);
    // 公開を止めた後の物理消去。失敗しても台帳から管理用回収を続けられる。
    try {
      const physical = await access.client.storage
        .from(attachmentBucket)
        .remove([row.id]);
      if (!physical.error) {
        const completed = await access.client.rpc("finish_attachment_removal", {
          p_id: row.id,
        });
        if (!completed.error) return noContent();
      }
    } catch {}
    return json({ data: { id: row.id, deleted: true } }, 202);
  } catch (error) {
    return apiError(error);
  }
}
