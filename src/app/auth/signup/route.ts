import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import {
  selfServiceAuthEnabled,
  safeAuthNext,
  readAuthForm,
  validEmail,
  validPassword,
  authRedirect,
  authFormFailure,
} from "@/lib/auth-forms";

export async function POST(request: Request) {
  if (!selfServiceAuthEnabled()) return new Response(null, { status: 503 });
  let next = "/workspaces";
  const location = (query: string) =>
    `/signup?${query}${next.startsWith("/invitations/") ? `&next=${encodeURIComponent(next)}` : ""}`;
  try {
    const form = await readAuthForm(request, [
      "email",
      "password",
      "display_name",
      "next",
    ]);
    next = safeAuthNext(form.get("next"));
    if (next === "/reset-password") next = "/workspaces";
    const email = (form.get("email") ?? "").trim().toLowerCase();
    const password = form.get("password") ?? "";
    const displayName = (form.get("display_name") ?? "").trim();
    if (
      !validEmail(email) ||
      !validPassword(password) ||
      !displayName ||
      Array.from(displayName).length > 80 ||
      displayName.includes("\0")
    )
      return authRedirect(location("error=1"));
    const client = await supabaseServer();
    const { error, data } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${supabaseConfig()!.origin}/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    // A confirmation-disabled project must not silently provide an unverified session.
    if (data.session) {
      await client.auth.signOut();
      return authRedirect(location("error=configuration"));
    }
    if (error?.code === "user_already_exists" || error?.code === "email_exists")
      return authRedirect(location("sent=1"));
    if (error)
      return authRedirect(
        error.status === 429
          ? location("error=rate_limit")
          : location("error=1"),
      );
    return authRedirect(location("sent=1"));
  } catch (error) {
    return authFormFailure(error, location("error=1"));
  }
}
