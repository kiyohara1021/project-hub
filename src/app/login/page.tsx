import Link from "next/link";
import { supabaseConfig } from "@/lib/supabase/config";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "ログイン" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  ログインできませんでした。入力内容と接続状況をご確認ください。
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
      <Link
        href="/dashboard"
        className="mt-6 inline-block text-sm text-blue-700 underline"
      >
        ダッシュボードへ
      </Link>
    </>
  );
}
