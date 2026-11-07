import { attachmentsGet, attachmentsPost } from "@/lib/attachment-handlers";
type Context = { params: Promise<{ wid: string; pid: string; iid: string }> };
export async function GET(request: Request, { params }: Context) {
  const { wid, pid, iid } = await params;
  return attachmentsGet(request, { wid, pid, target: iid }, "issue");
}
export async function POST(request: Request, { params }: Context) {
  const { wid, pid, iid } = await params;
  return attachmentsPost(request, { wid, pid, target: iid }, "issue");
}
