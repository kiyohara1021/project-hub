import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import {
  selfServiceAuthEnabled,
  readAuthForm,
  validEmail,
  authRedirect,
  authFormFailure,
} from "@/lib/auth-forms";

export async function POST(request: Request) {
  if (!selfServiceAuthEnabled()) return new Response(null, { status: 503 });
  try {
    const form = await readAuthForm(request, ["email"]);
    const email = (form.get("email") ?? "").trim().toLowerCase();
    if (!validEmail(email)) return authRedirect("/forgot-password?error=1");
    const client = await supabaseServer();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${supabaseConfig()!.origin}/confirm?next=/reset-password`,
    });
    if (
      error?.code === "user_not_found" ||
      error?.code === "email_not_confirmed"
    )
      return authRedirect("/forgot-password?sent=1");
    if (error)
      return authRedirect(
        error.status === 429
          ? "/forgot-password?error=rate_limit"
          : "/forgot-password?error=1",
      );
    return authRedirect("/forgot-password?sent=1");
  } catch (error) {
    return authFormFailure(error, "/forgot-password?error=1");
  }
}
