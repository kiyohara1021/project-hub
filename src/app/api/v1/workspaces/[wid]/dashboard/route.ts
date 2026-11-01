import { apiError, json, ProjectError } from "@/lib/projects-server";
import { readDashboard } from "@/lib/dashboard-server";

export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new ProjectError(400,"INVALID_INPUT","集計条件は指定できません");
    return json({ data: await readDashboard((await params).wid) });
  } catch (error) { return apiError(error); }
}
