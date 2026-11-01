import { apiError, checkOrigin, json, readJson, ProjectError, uuid } from "@/lib/projects-server";
import { taskAccess, readTask, taskRpcError, validateTask, taskVersion, exactKeys } from "@/lib/tasks-server";
type Context = { params: Promise<{ wid: string; pid: string; tid: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { const { wid, pid, tid } = await params; return json({ data: await readTask(wid, pid, tid) }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    checkOrigin(request); const { wid, pid, tid } = await params; const { client } = await taskAccess(wid, pid, true);
    if (!uuid.test(tid)) throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
    const input = validateTask(await readJson(request), true);
    const result = await client.rpc("edit_task", { p_workspace_id: wid, p_project_id: pid, p_task_id: tid, p_title: input.title, p_description: input.description, p_priority: input.priority, p_assignee_id: input.assignee_id, p_due_date: input.due_date, p_version: input.version });
    if (result.error) throw taskRpcError(result.error);
    return json({ data: result.data });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    checkOrigin(request); const { wid, pid, tid } = await params; const { client } = await taskAccess(wid, pid, true);
    if (!uuid.test(tid)) throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
    const input = await readJson(request); exactKeys(input, ["version"]);
    const result = await client.rpc("delete_task", { p_workspace_id: wid, p_project_id: pid, p_task_id: tid, p_version: taskVersion(input.version) });
    if (result.error) throw taskRpcError(result.error);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
