import { AuthAccountForm } from "@/components/auth-account-form";
export const metadata = { title: "パスワード再設定" };
export default async function ForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthAccountForm mode="recover" error={params.error} sent={params.sent} />
  );
}
