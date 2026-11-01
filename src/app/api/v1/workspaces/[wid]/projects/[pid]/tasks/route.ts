import { apiError, checkOrigin, json, readJson, ProjectError } from "@/lib/projects-server";
import { taskAccess, queryTasks, taskRpcError, validateTask } from "@/lib/tasks-server";
type Context = { params: Promise<{ wid: string; pid: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { wid, pid } = await params; const { client } = await taskAccess(wid, pid);
    return json(await queryTasks(client, wid, pid, new URL(request.url).searchParams));
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    checkOrigin(request); const { wid, pid } = await params; const { client } = await taskAccess(wid, pid, true);
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new ProjectError(400, "INVALID_KEY", "送信キーを確認してください");
    const input = validateTask(await readJson(request));
    const result = await client.rpc("create_task_once", { p_workspace_id: wid, p_project_id: pid, p_title: input.title, p_description: input.description, p_priority: input.priority, p_assignee_id: input.assignee_id, p_due_date: input.due_date, p_key: key });
    if (result.error) throw taskRpcError(result.error);
    return json({ data: result.data }, 201);
  } catch (error) { return apiError(error); }
}
