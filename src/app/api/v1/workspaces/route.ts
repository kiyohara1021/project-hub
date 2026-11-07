import { supabaseServer } from "@/lib/supabase/server";
import {
  apiError,
  checkOrigin,
  idempotencyKey,
  json,
  readJson,
  ProjectError,
  rpcError,
} from "@/lib/projects-server";
import { exactKeys } from "@/lib/validation";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const client = await supabaseServer();
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims.sub)
      throw new ProjectError(401, "UNAUTHENTICATED", "ログインしてください");
    const key = idempotencyKey(request);
    const input = await readJson(request);
    exactKeys(input, ["name"]);
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      Array.from(input.name.trim()).length > 120 ||
      input.name.includes("\0")
    )
      throw new ProjectError(
        400,
        "INVALID_INPUT",
        "名前は前後の空白を除いて1〜120文字で入力してください",
      );
    const result = await client.rpc("create_workspace_once", {
      p_name: input.name.trim(),
      p_key: key,
    });
    if (result.error) throw rpcError(result.error);
    return json({ data: result.data }, 201);
  } catch (error) {
    return apiError(error);
  }
}
