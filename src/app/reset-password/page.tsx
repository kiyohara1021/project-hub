import { redirect } from "next/navigation";
import { selfServiceAuthEnabled } from "@/lib/auth-forms";
import { supabaseServer } from "@/lib/supabase/server";
import { AuthAccountForm } from "@/components/auth-account-form";
export const metadata = { title: "新しいパスワード" };
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (selfServiceAuthEnabled()) {
    const client = await supabaseServer();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) redirect("/forgot-password");
  }
  const params = await searchParams;
  return <AuthAccountForm mode="password" error={params.error} />;
}
