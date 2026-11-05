import { projectAccess, ProjectError } from "./projects-server";
import type { DashboardData } from "./dashboard-types";

export async function readDashboard(wid: string) {
  const client = await projectAccess(wid);
  const result = await client.rpc("read_dashboard", { p_workspace_id: wid });
  if (result.error?.code === "P0002")
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  if (result.error || !result.data)
    throw new ProjectError(500, "READ_FAILED", "集計を取得できませんでした");
  return result.data as DashboardData;
}
