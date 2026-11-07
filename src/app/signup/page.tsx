import { safeAuthNext } from "@/lib/auth-forms";
import { AuthAccountForm } from "@/components/auth-account-form";
export const metadata = { title: "アカウント登録" };
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthAccountForm
      mode="signup"
      error={params.error}
      sent={params.sent}
      next={
        safeAuthNext(params.next ?? null).startsWith("/invitations/")
          ? safeAuthNext(params.next ?? null)
          : undefined
      }
    />
  );
}
