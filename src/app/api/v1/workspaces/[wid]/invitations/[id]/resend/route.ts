import { mutateInvitation } from "@/lib/invitations-server";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  return mutateInvitation(request, wid, "resend", id);
}
