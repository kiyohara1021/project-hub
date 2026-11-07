import {
  apiError,
  checkOrigin,
  json,
  readJson,
  rpcError,
  uuid,
  ProjectError,
} from "@/lib/projects-server";
import {
  projectAccessAdmin,
  readProjectAccess,
} from "@/lib/project-access-server";
import { exactKeys, parseVersion } from "@/lib/validation";

type Context = { params: Promise<{ wid: string; pid: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { wid, pid } = await params;
    return json({ data: await readProjectAccess(wid, pid) });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    checkOrigin(request);
    const { wid, pid } = await params;
    const client = await projectAccessAdmin(wid, pid);
    const input = await readJson(request);
    exactKeys(input, ["visibility", "member_ids", "version"]);
    if (
      typeof input.visibility !== "string" ||
      !["workspace", "private"].includes(input.visibility) ||
      !Array.isArray(input.member_ids) ||
      input.member_ids.length > 100 ||
      input.member_ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      new Set(input.member_ids).size !== input.member_ids.length
    )
      throw new ProjectError(
        400,
        "INVALID_INPUT",
        "公開範囲と参加者を確認してください",
      );
    const result = await client.rpc("set_project_access", {
      p_workspace_id: wid,
      p_project_id: pid,
      p_visibility: input.visibility,
      p_member_ids: input.member_ids,
      p_version: parseVersion(input.version),
    });
    if (result.error) throw rpcError(result.error);
    return json({ data: result.data });
  } catch (error) {
    return apiError(error);
  }
}
