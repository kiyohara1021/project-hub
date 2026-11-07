import { attachmentGet, attachmentDelete } from "@/lib/attachment-handlers";
type Context = {
  params: Promise<{ wid: string; pid: string; tid: string; aid: string }>;
};
export async function GET(_request: Request, { params }: Context) {
  const { wid, pid, tid, aid } = await params;
  return attachmentGet({ wid, pid, target: tid }, "task", aid);
}
export async function DELETE(request: Request, { params }: Context) {
  const { wid, pid, tid, aid } = await params;
  return attachmentDelete(request, { wid, pid, target: tid }, "task", aid);
}
