import { attachmentsGet, attachmentsPost } from "@/lib/attachment-handlers";
type Context = { params: Promise<{ wid: string; pid: string; tid: string }> };
export async function GET(request: Request, { params }: Context) {
  const { wid, pid, tid } = await params;
  return attachmentsGet(request, { wid, pid, target: tid }, "task");
}
export async function POST(request: Request, { params }: Context) {
  const { wid, pid, tid } = await params;
  return attachmentsPost(request, { wid, pid, target: tid }, "task");
}
