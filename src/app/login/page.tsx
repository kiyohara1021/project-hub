import Link from "next/link";
import { selfServiceAuthEnabled, safeAuthNext } from "@/lib/auth-forms";
import { supabaseConfig } from "@/lib/supabase/config";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "ログイン" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeAuthNext(rawNext ?? null);
  const invitationNext = next.startsWith("/invitations/") ? next : "";
  return (
    <>
      <PageHeading
        title="ログイン"
        description="登録済みのアカウントでログインしてください。"
      />
      {!supabaseConfig() ? (
        <EmptyState
          title="接続設定がありません"
          description="この環境ではログインを利用できません。画面デモをご覧ください。"
        />
      ) : (
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <form action="/auth/login" method="post" className="space-y-5">
              {invitationNext && (
                <input type="hidden" name="next" value={invitationNext} />
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error === "rate_limit"
                    ? "ログインの試行が制限されています。しばらく待ってから、もう一度お試しください。"
                    : "ログインできませんでした。入力内容と接続状況をご確認ください。"}
                </p>
              )}
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium"
                >
                  メールアドレス
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={254}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium"
                >
                  パスワード
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </div>
              <Button type="submit">ログイン</Button>
            </form>
          </CardContent>
        </Card>
      )}
      {selfServiceAuthEnabled() && (
        <div className="mt-6 flex flex-wrap gap-4 text-sm text-blue-700 underline">
          <Link
            href={
              invitationNext
                ? `/signup?next=${encodeURIComponent(invitationNext)}`
                : "/signup"
            }
          >
            アカウント登録
          </Link>
          <Link href="/forgot-password">パスワードを忘れた方</Link>
        </div>
      )}
      <Link
        href="/dashboard"
        className="mt-6 inline-block text-sm text-blue-700 underline"
      >
        ダッシュボードへ
      </Link>
    </>
  );
}
