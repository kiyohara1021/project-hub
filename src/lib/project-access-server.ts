import {
  projectAccess,
  readProject,
  ProjectError,
  rpcError,
} from "./projects-server";
import type { ProjectVisibility } from "./project-types";
import type { Assignee } from "./task-types";

export type ProjectAccessSettings = {
  visibility: ProjectVisibility;
  version: number;
  member_ids: string[];
  candidates: { id: string; name: string; role: string }[];
};

export async function readProjectAssignees(
  client: Awaited<ReturnType<typeof projectAccess>>,
  wid: string,
  pid: string,
): Promise<Assignee[]> {
  const result = await client.rpc("read_project_assignees", {
    p_workspace_id: wid,
    p_project_id: pid,
  });
  if (result.error) throw rpcError(result.error);
  return result.data as Assignee[];
}

export async function projectAccessAdmin(wid: string, pid: string) {
  // 閲覧を先に確認し、非公開と存在しないIDを同じ404にする。
  await readProject(wid, pid);
  return projectAccess(wid, true);
}

export async function readProjectAccess(
  wid: string,
  pid: string,
): Promise<ProjectAccessSettings> {
  const client = await projectAccessAdmin(wid, pid);
  const result = await client.rpc("read_project_access", {
    p_workspace_id: wid,
    p_project_id: pid,
  });
  if (result.error) throw rpcError(result.error);
  if (!result.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return result.data as ProjectAccessSettings;
}
