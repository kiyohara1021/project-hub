import {
  apiError,
  checkOrigin,
  json,
  projectAccess,
  readJson,
  readProject,
  rpcError,
  validateProject,
  ProjectError,
  uuid,
} from "@/lib/projects-server";

type Context = { params: Promise<{ wid: string; pid: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { wid, pid } = await params;
    return json({ data: await readProject(wid, pid) });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    checkOrigin(request);
    const { wid, pid } = await params;
    await readProject(wid, pid);
    const client = await projectAccess(wid, true);
    if (!uuid.test(pid))
      throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
    const input = validateProject(await readJson(request), true);
    const result = await client.rpc("edit_project", {
      p_workspace_id: wid,
      p_project_id: pid,
      p_name: input.name,
      p_description: input.description,
      p_status: input.status,
      p_due_date: input.due_date,
      p_version: input.version,
    });
    if (result.error) throw rpcError(result.error);
    return json({ data: result.data });
  } catch (error) {
    return apiError(error);
  }
}
