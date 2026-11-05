import { apiError, checkOrigin, json, readJson, ProjectError, uuid } from "@/lib/projects-server";
import { taskAccess, taskRpcError } from "@/lib/tasks-server";
import { parseVersion, exactKeys } from "@/lib/validation";
import { taskStatuses, type TaskStatus } from "@/lib/task-types";
type Context = { params: Promise<{ wid: string; pid: string; tid: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    checkOrigin(request); const { wid, pid, tid } = await params; const { client } = await taskAccess(wid, pid, true);
    if (!uuid.test(tid)) throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
    const input = await readJson(request); exactKeys(input, ["status", "before_id", "version"]);
    if (typeof input.status !== "string" || !taskStatuses.includes(input.status as TaskStatus) || (input.before_id !== null && (typeof input.before_id !== "string" || !uuid.test(input.before_id)))) throw new ProjectError(400, "INVALID_INPUT", "移動先を確認してください");
    const result = await client.rpc("move_task", { p_workspace_id: wid, p_project_id: pid, p_task_id: tid, p_status: input.status, p_before_id: input.before_id, p_version: parseVersion(input.version) });
    if (result.error) throw taskRpcError(result.error);
    return json({ data: result.data });
  } catch (error) { return apiError(error); }
}
