import { apiError, json } from "@/lib/projects-server";
import { readActivity } from "@/lib/activity-server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ wid: string }> },
) {
  try {
    return json(
      await readActivity((await params).wid, new URL(request.url).searchParams),
    );
  } catch (error) {
    return apiError(error);
  }
}
