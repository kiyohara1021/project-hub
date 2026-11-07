import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { selfServiceAuthEnabled } from "@/lib/auth-forms";
import { invitationHash } from "@/lib/invitations-server";
import { InvitationAccept } from "@/components/invitation-accept";
export const metadata = {
  title: "ワークスペース招待",
  referrer: "strict-origin" as const,
  robots: { index: false, follow: false },
};
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const unavailable = (
    <p>この招待は利用できません。招待元の管理者へお問い合わせください。</p>
  );
  if (!selfServiceAuthEnabled()) return unavailable;
  let hash;
  try {
    hash = invitationHash(token);
  } catch {
    return unavailable;
  }
  const client = await supabaseServer();
  const auth = await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub) {
    const q = new URLSearchParams({ next: `/invitations/${token}` });
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">ワークスペース招待</h1>
        <p>招待先のメールアドレスでログインし、招待を確認してください。</p>
        <Link className="text-blue-700 underline" href={`/login?${q}`}>
          ログイン
        </Link>
        <Link className="ml-4 text-blue-700 underline" href={`/signup?${q}`}>
          アカウント登録
        </Link>
      </section>
    );
  }
  const result = await client.rpc("read_workspace_invitation", {
    p_token_hash: hash,
  });
  if (result.error || !result.data) return unavailable;
  const invite = result.data;
  return (
    <section className="max-w-xl space-y-5">
      <h1 className="break-words text-2xl font-bold">
        {invite.workspace_name}への招待
      </h1>
      <p>ロール: {invite.role === "member" ? "メンバー" : "閲覧者"}</p>
      <p>
        期限:{" "}
        {new Date(invite.expires_at).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        })}
        （日本時間）
      </p>
      {invite.status === "accepted" ? (
        <p>この招待は承諾済みです。</p>
      ) : (
        <InvitationAccept token={token} />
      )}
    </section>
  );
}
