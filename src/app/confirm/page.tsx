import Link from "next/link";
import type { Metadata } from "next";
import { selfServiceAuthEnabled, safeAuthNext } from "@/lib/auth-forms";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
export const metadata: Metadata = {
  title: "メールの確認",
  referrer: "strict-origin",
};
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    next?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const valid =
    !params.error &&
    /^[A-Za-z0-9_-]{16,256}$/.test(params.token_hash ?? "") &&
    ["email", "recovery"].includes(params.type ?? "");
  return (
    <>
      <PageHeading
        title="メールの確認"
        description="下のボタンを押すと、メールアドレスの確認を完了します。"
      />
      {!selfServiceAuthEnabled() ? (
        <EmptyState
          title="現在は利用できません"
          description="この環境ではメール確認を利用できません。"
        />
      ) : !valid ? (
        <div role="alert" className="space-y-4">
          <p>
            この確認リンクは無効か、有効期限が切れています。新しいメールからお試しください。
          </p>
          <Link href="/signup" className="text-blue-700 underline">
            登録へ
          </Link>
          <Link
            href="/forgot-password"
            className="ml-4 text-blue-700 underline"
          >
            パスワード再設定へ
          </Link>
        </div>
      ) : (
        <form action="/auth/confirm" method="post" className="space-y-4">
          <input type="hidden" name="token_hash" value={params.token_hash} />
          <input type="hidden" name="type" value={params.type} />
          <input
            type="hidden"
            name="next"
            value={safeAuthNext(params.next ?? null)}
          />
          <p>
            確認後は、このメールに対応するアカウントでログインします。心当たりのあるメールから開いたことを確認してから進んでください。
          </p>
          <Button type="submit">
            {params.type === "recovery"
              ? "確認して再設定へ進む"
              : "メールアドレスを確認"}
          </Button>
        </form>
      )}
    </>
  );
}
