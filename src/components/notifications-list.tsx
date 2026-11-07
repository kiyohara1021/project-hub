"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  notificationChangedEvent,
  notificationLabels,
  type NotificationPage,
} from "@/lib/notification-types";
import { Button } from "./ui/button";
import { EmptyState } from "./page-parts";

export function NotificationsList({
  page,
  unreadOnly = false,
}: {
  page: NotificationPage;
  unreadOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const sending = useRef(false);
  const notice = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  async function mark(id?: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch(
        id
          ? `/api/v1/me/notifications/${id}/read`
          : "/api/v1/me/notifications/read-all",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error?.message ??
            "既読にできませんでした。再試行してください。",
        );
        alert.current?.focus();
        return;
      }
      setSaved(
        id
          ? "通知を既読にしました。"
          : "参照できる通知をすべて既読にしました。",
      );
      notice.current?.focus();
      window.dispatchEvent(new Event(notificationChangedEvent));
      router.refresh();
    } catch {
      setError("通信結果を確認できませんでした。もう一度お試しください。");
      alert.current?.focus();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-label="通知の未読件数">未読 {page.unreadCount}件</p>
        <Button
          variant="outline"
          disabled={busy || page.unreadCount === 0}
          onClick={() => void mark()}
        >
          すべて既読にする
        </Button>
      </div>
      <nav
        aria-label="通知の絞り込み"
        className="flex gap-4 text-sm text-blue-700 underline"
      >
        <Link
          href="/notifications"
          aria-current={!unreadOnly ? "page" : undefined}
        >
          すべて
        </Link>
        <Link
          href="/notifications?unread=1"
          aria-current={unreadOnly ? "page" : undefined}
        >
          未読のみ
        </Link>
      </nav>
      <p
        ref={alert}
        role="alert"
        tabIndex={-1}
        className="text-sm text-red-700"
      >
        {error}
      </p>
      <p ref={notice} role="status" tabIndex={-1} className="text-sm">
        {saved}
      </p>
      {!page.data.length ? (
        <EmptyState
          title={unreadOnly ? "未読の通知はありません" : "通知はありません"}
          description="担当の割当や参加中の課題へのコメントがあると表示します。"
        />
      ) : (
        <ol aria-label="通知の一覧" className="space-y-3">
          {page.data.map((row) => (
            <li key={row.id}>
              <article
                aria-label={notificationLabels[row.kind]}
                className="space-y-3 rounded-xl border bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <time dateTime={row.created_at}>
                    {dateTime(row.created_at)}
                  </time>
                  <span>{row.read_at ? "既読" : "未読"}</span>
                </div>
                <p className="text-sm font-medium">
                  {notificationLabels[row.kind]}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/projects/${row.project_id}/${row.entity_type === "tasks" ? "board" : "issues"}?${new URLSearchParams({ workspace: row.workspace_id, ...(row.entity_type === "issues" ? { status: "all" } : {}) })}`}
                    className="text-sm text-blue-700 underline"
                  >
                    {row.entity_type === "tasks"
                      ? "カンバンを開く"
                      : "課題一覧を開く"}
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || row.read_at !== null}
                    onClick={() => void mark(row.id)}
                  >
                    {row.read_at ? "既読" : "既読にする"}
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
