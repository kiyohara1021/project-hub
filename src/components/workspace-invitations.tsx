"use client";
import { useState } from "react";
import type { InvitationPage, Invitation } from "@/lib/invitation-types";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
export function WorkspaceInvitations({
  wid,
  initial,
  enabled,
}: {
  wid: string;
  initial: InvitationPage;
  enabled: boolean;
}) {
  const [page, setPage] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  async function load(cursor?: string) {
    const r = await fetch(
      `/api/v1/workspaces/${wid}/invitations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!r.ok) throw Error();
    setPage(await r.json());
  }
  async function mutate(
    action: "create" | "resend" | "cancel",
    body: object,
    row?: Invitation,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        `/api/v1/workspaces/${wid}/invitations${row ? `/${row.id}/${action}` : ""}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": action === "create" ? key : crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const result = await r.json();
      if (!r.ok) {
        setMessage(result.error?.message ?? "処理できませんでした");
        return;
      }
      setKey(crypto.randomUUID());
      setMessage(
        action === "cancel"
          ? "招待を取り消しました"
          : result.data.delivery === "sent"
            ? "認証サービスが送信を受け付けました。到着を保証するものではありません。"
            : "送信状況を確認できません。再送すると旧リンクは無効になります。",
      );
      await load();
    } catch {
      setMessage(
        "結果を確認できません。一覧を再読込し、必要なら再送してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mb-8 space-y-4 rounded-xl border bg-white p-4"
      aria-label="メール招待"
    >
      <h2 className="font-semibold">メール招待</h2>
      <p className="text-sm text-slate-600">
        招待先本人がメールを確認し承諾すると所属します。有効期限は7日です。再送すると旧リンクは無効になります。
      </p>
      {enabled ? (
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void mutate("create", {
              email: f.get("email"),
              role: f.get("role"),
            });
          }}
        >
          <label className="min-w-0 flex-1">
            宛先メール
            <Input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            招待ロール
            <select className="block h-10 rounded-md border px-2" name="role">
              <option value="member">メンバー</option>
              <option value="viewer">閲覧者</option>
            </select>
          </label>
          <Button disabled={busy} type="submit">
            招待を送る
          </Button>
        </form>
      ) : (
        <p>この環境ではメール招待の送信・承諾を利用できません。</p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          void load().catch(() => setMessage("一覧を取得できませんでした"));
        }}
      >
        招待一覧を再読込
      </Button>
      <ul className="space-y-3">
        {page.data.map((i) => (
          <li className="space-y-2 rounded border p-3" key={i.id}>
            <p className="break-all">{i.email}</p>
            <p className="text-sm">
              {i.role === "member" ? "メンバー" : "閲覧者"} /{" "}
              {
                {
                  pending: "未承諾",
                  accepted: "承諾済み",
                  cancelled: "取消済み",
                  expired: "期限切れ",
                }[i.status]
              }{" "}
              / 送信:{" "}
              {
                { pending: "状況未確定", sent: "受付済み", failed: "失敗" }[
                  i.delivery
                ]
              }
            </p>
            <p className="text-xs">
              期限:{" "}
              {new Date(i.expires_at).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
              （日本時間）
            </p>
            {enabled && ["pending", "expired"].includes(i.status) && (
              <div className="flex gap-3">
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void mutate("resend", { version: i.version }, i)
                  }
                >
                  再送
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void mutate("cancel", { version: i.version }, i)
                  }
                >
                  取消
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => {
            void load(page.nextCursor!).catch(() =>
              setMessage("一覧を取得できませんでした"),
            );
          }}
        >
          次の招待
        </Button>
      )}
    </section>
  );
}
