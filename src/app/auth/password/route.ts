import { supabaseServer } from "@/lib/supabase/server";
import {
  selfServiceAuthEnabled,
  readAuthForm,
  validPassword,
  authRedirect,
  authFormFailure,
} from "@/lib/auth-forms";

export async function POST(request: Request) {
  if (!selfServiceAuthEnabled()) return new Response(null, { status: 503 });
  try {
    const form = await readAuthForm(request, [
      "password",
      "password_confirmation",
    ]);
    const password = form.get("password") ?? "";
    if (
      !validPassword(password) ||
      password !== form.get("password_confirmation")
    )
      return authRedirect("/reset-password?error=1");
    const client = await supabaseServer();
    const { data, error: authError } = await client.auth.getUser();
    if (authError || !data.user) return authRedirect("/forgot-password");
    const { error } = await client.auth.updateUser({ password });
    if (error) return authRedirect("/reset-password?error=1");
    return authRedirect("/workspaces?password_updated=1");
  } catch (error) {
    return authFormFailure(error, "/reset-password?error=1");
  }
}
