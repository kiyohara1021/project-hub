import { supabaseServer } from "@/lib/supabase/server";
import {
  selfServiceAuthEnabled,
  readAuthForm,
  safeAuthNext,
  authRedirect,
  authFormFailure,
} from "@/lib/auth-forms";

export async function POST(request: Request) {
  if (!selfServiceAuthEnabled()) return new Response(null, { status: 503 });
  try {
    const form = await readAuthForm(request, ["token_hash", "type", "next"]);
    const token_hash = form.get("token_hash") ?? "";
    const type = form.get("type");
    const next = safeAuthNext(form.get("next"));
    if (
      !/^[A-Za-z0-9_-]{16,256}$/.test(token_hash) ||
      (type !== "email" && type !== "recovery")
    )
      return authRedirect("/confirm?error=1");
    const client = await supabaseServer();
    const { error } = await client.auth.verifyOtp({ token_hash, type });
    if (error) return authRedirect("/confirm?error=1");
    return authRedirect(
      type === "recovery"
        ? "/reset-password"
        : next === "/reset-password"
          ? "/workspaces"
          : next,
    );
  } catch (error) {
    return authFormFailure(error, "/confirm?error=1");
  }
}
