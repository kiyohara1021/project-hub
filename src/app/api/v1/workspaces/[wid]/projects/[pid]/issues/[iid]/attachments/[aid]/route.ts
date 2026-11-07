import { attachmentGet, attachmentDelete } from "@/lib/attachment-handlers";
type Context = {
  params: Promise<{ wid: string; pid: string; iid: string; aid: string }>;
};
export async function GET(_request: Request, { params }: Context) {
  const { wid, pid, iid, aid } = await params;
  return attachmentGet({ wid, pid, target: iid }, "issue", aid);
}
export async function DELETE(request: Request, { params }: Context) {
  const { wid, pid, iid, aid } = await params;
  return attachmentDelete(request, { wid, pid, target: iid }, "issue", aid);
}
