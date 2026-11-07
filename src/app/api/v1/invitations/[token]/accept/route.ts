import {
  checkOrigin,
  readJson,
  json,
  apiError,
  rpcError,
} from "@/lib/projects-server";
import { exactKeys } from "@/lib/validation";
import { invitationClient, invitationHash } from "@/lib/invitations-server";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    checkOrigin(request);
    const client = await invitationClient();
    exactKeys(await readJson(request), []);
    const r = await client.rpc("accept_workspace_invitation", {
      p_token_hash: invitationHash((await params).token),
    });
    if (r.error) throw rpcError(r.error);
    return json({ data: r.data });
  } catch (e) {
    return apiError(e);
  }
}
