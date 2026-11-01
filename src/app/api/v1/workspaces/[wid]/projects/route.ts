import { apiError, checkOrigin, json, projectAccess, readJson, readProjectPage, rpcError, validateProject, ProjectError } from "@/lib/projects-server";

export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  try { return json(await readProjectPage((await params).wid, new URL(request.url).searchParams)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  try {
    checkOrigin(request);
    const { wid } = await params; const client = await projectAccess(wid, true);
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new ProjectError(400, "INVALID_KEY", "送信キーを確認してください");
    const input = validateProject(await readJson(request));
    const result = await client.rpc("create_project_once", { p_workspace_id: wid, p_name: input.name, p_description: input.description, p_due_date: input.due_date, p_key: key });
    if (result.error) throw rpcError(result.error);
    return json({ data: result.data }, 201);
  } catch (error) { return apiError(error); }
}
