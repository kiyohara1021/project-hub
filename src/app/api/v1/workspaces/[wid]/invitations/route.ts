import { apiError, json } from "@/lib/projects-server";
import { listInvitations, mutateInvitation } from "@/lib/invitations-server";
type Context = { params: Promise<{ wid: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    return json(
      await listInvitations(
        (await params).wid,
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  return mutateInvitation(request, (await params).wid, "create");
}
