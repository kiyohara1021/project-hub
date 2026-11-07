import Link from "next/link";
import { selfServiceAuthEnabled } from "@/lib/auth-forms";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AuthAccountForm({
  mode,
  error,
  sent,
  next,
}: {
  mode: "signup" | "recover" | "password";
  error?: string;
  sent?: string;
  next?: string;
}) {
  const signup = mode === "signup";
  const recover = mode === "recover";
  const title = signup
    ? "アカウント登録"
    : recover
      ? "パスワード再設定の案内"
      : "新しいパスワード";
  return (
    <>
      <PageHeading
        title={title}
        description={
          signup
            ? "メールアドレスを確認して利用を開始します。"
            : recover
              ? "登録済みのメールアドレスへ再設定の案内を送ります。"
              : "新しいパスワードを設定してください。"
        }
      />
      {!selfServiceAuthEnabled() ? (
        <EmptyState
          title="現在は利用できません"
          description="この環境ではアカウント登録・パスワード再設定を利用できません。"
        />
      ) : (
        <Card className="max-w-md">
          <CardContent className="pt-6">
            {sent ? (
              <div role="status" className="space-y-3">
                <p>
                  {signup
                    ? "受付を完了しました。確認メールが届いた場合は、メールのリンクから確認を完了してください。"
                    : "受付を完了しました。登録がある場合は、再設定の案内がメールで届きます。"}
                </p>
                <p className="text-sm text-slate-600">
                  メールが届かない場合は、迷惑メールと入力したアドレスを確認してください。しばらく待ってから再度お試しください。
                </p>
                <Link
                  className="text-blue-700 underline"
                  href={
                    signup
                      ? `/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`
                      : "/forgot-password"
                  }
                >
                  もう一度入力する
                </Link>
              </div>
            ) : (
              <form
                action={`/auth/${signup ? "signup" : recover ? "recover" : "password"}`}
                method="post"
                className="space-y-5"
              >
                {signup && next && (
                  <input type="hidden" name="next" value={next} />
                )}
                {error && (
                  <p role="alert" className="text-sm text-red-700">
                    {error === "rate_limit"
                      ? "試行が制限されています。しばらく待ってから、もう一度お試しください。"
                      : error === "configuration"
                        ? "メール確認の設定を確認できませんでした。管理者へお問い合わせください。"
                        : "処理できませんでした。入力内容と接続状況をご確認ください。"}
                  </p>
                )}
                {signup && (
                  <div>
                    <label
                      htmlFor="display_name"
                      className="mb-2 block text-sm font-medium"
                    >
                      表示名
                    </label>
                    <Input
                      id="display_name"
                      name="display_name"
                      maxLength={80}
                      autoComplete="nickname"
                      required
                    />
                  </div>
                )}
                {mode !== "password" && (
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
                      autoComplete="email"
                      maxLength={254}
                      required
                    />
                  </div>
                )}
                {!recover && (
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
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      aria-describedby="password-hint"
                      required
                    />
                    <p
                      id="password-hint"
                      className="mt-2 text-sm text-slate-600"
                    >
                      12〜128文字で入力してください。
                    </p>
                  </div>
                )}
                {mode === "password" && (
                  <div>
                    <label
                      htmlFor="password_confirmation"
                      className="mb-2 block text-sm font-medium"
                    >
                      パスワード（確認）
                    </label>
                    <Input
                      id="password_confirmation"
                      name="password_confirmation"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </div>
                )}
                <Button type="submit">
                  {signup
                    ? "確認メールを送る"
                    : recover
                      ? "再設定の案内を送る"
                      : "パスワードを保存"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
      <Link
        href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        className="mt-6 inline-block text-sm text-blue-700 underline"
      >
        ログインへ
      </Link>
    </>
  );
}
