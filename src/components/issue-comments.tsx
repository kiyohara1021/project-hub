"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import type { Issue } from "@/lib/issue-types";
import type { IssueComment, CommentPage } from "@/lib/comment-types";

type Props = {
  base: string;
  issue: Issue;
  userId: string;
  role: string;
  archived: boolean;
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));

export function IssueComments({ base, issue, userId, role, archived }: Props) {
  const id = useId();
  const endpoint = `${base}/${issue.id}/comments`;
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<IssueComment | null>(null);
  const [editBody, setEditBody] = useState("");
  const [removing, setRemoving] = useState<IssueComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const sending = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const newInput = useRef<HTMLTextAreaElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const canWrite = !archived && (role === "admin" || role === "member");
  const canChange = (comment: IssueComment) =>
    canWrite && (role === "admin" || comment.author_id === userId);
  function focusError() {
    setTimeout(() => alert.current?.focus(), 0);
  }
  function clearError() {
    setError("");
    setReadFailed(false);
    setConflict(false);
  }
  async function fetchPage(cursor: string | null = null): Promise<CommentPage> {
    const response = await fetch(
      `${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? "コメントを取得できませんでした。",
      );
    return result as CommentPage;
  }
  function applyPage(page: CommentPage, append = false) {
    setComments((current) =>
      append
        ? [
            ...current,
            ...page.data.filter(
              (row) => !current.some((existing) => existing.id === row.id),
            ),
          ]
        : page.data,
    );
    setNextCursor(page.nextCursor);
    setLoaded(true);
  }
  async function load(cursor: string | null = null) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    clearError();
    try {
      applyPage(await fetchPage(cursor), cursor !== null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "コメントを取得できませんでした。",
      );
      setReadFailed(true);
      setFailedCursor(cursor);
      focusError();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function validBody(value: string, input: HTMLTextAreaElement | null) {
    if (!value.trim() || Array.from(value.trim()).length > 5000) {
      setError("コメントは1〜5,000文字で入力してください。");
      setReadFailed(false);
      input?.focus();
      return false;
    }
    return true;
  }
  async function mutate(
    method: "POST" | "PATCH" | "DELETE",
    comment?: IssueComment,
  ) {
    if (sending.current) return;
    const text = method === "POST" ? body : editBody;
    if (
      method !== "DELETE" &&
      !validBody(text, method === "POST" ? newInput.current : editInput.current)
    )
      return;
    const payload = JSON.stringify(
      method === "DELETE"
        ? { version: comment!.version }
        : {
            body: text.trim(),
            ...(method === "PATCH" ? { version: comment!.version } : {}),
          },
    );
    if (
      method === "POST" &&
      (!request.current || request.current.body !== payload)
    )
      request.current = { body: payload, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    clearError();
    try {
      const response = await fetch(
        comment ? `${endpoint}/${comment.id}` : endpoint,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(method === "POST"
              ? { "Idempotency-Key": request.current!.key }
              : {}),
          },
          body: payload,
        },
      );
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok) {
        setError(result?.error?.message ?? "コメントを保存できませんでした。");
        setConflict(result?.error?.code === "VERSION_CONFLICT");
        focusError();
        return;
      }
      // 保存成功後の再取得が失敗しても、確定した操作は表示へ反映する。
      if (method === "DELETE")
        setComments((current) =>
          current.filter((row) => row.id !== comment!.id),
        );
      else
        setComments((current) =>
          [
            result.data as IssueComment,
            ...current.filter((row) => row.id !== result.data.id),
          ].sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          ),
        );
      if (method === "POST") {
        setBody("");
        request.current = null;
      }
      setEditing(null);
      setRemoving(null);
      setConflict(false);
      setTimeout(() => newInput.current?.focus(), 0);
      try {
        applyPage(await fetchPage());
      } catch {
        setError(
          "保存は完了しましたが、一覧を更新できませんでした。再試行してください。",
        );
        setReadFailed(true);
        setFailedCursor(null);
        focusError();
      }
    } catch {
      setError(
        method === "POST"
          ? "通信結果を確認できませんでした。同じ入力で再試行すると二重投稿を防げます。"
          : "通信結果を確認できませんでした。最新版を読み直してから再試行してください。",
      );
      setConflict(method !== "POST");
      focusError();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function reloadCurrent() {
    const target = editing ?? removing;
    if (!target || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/${target.id}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "最新版を取得できませんでした。");
        focusError();
        return;
      }
      const latest = result.data as IssueComment;
      if (editing) {
        setEditing(latest);
        setEditBody(latest.body);
      }
      if (removing) setRemoving(latest);
      setComments((current) =>
        current.map((row) => (row.id === latest.id ? latest : row)),
      );
      clearError();
      if (editing) setTimeout(() => editInput.current?.focus(), 0);
    } catch {
      setError("最新版を取得できませんでした。再試行してください。");
      focusError();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void mutate("POST");
  }
  function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (editing) void mutate("PATCH", editing);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (sending.current) return;
        setOpen(value);
        if (value && !editing && !removing) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">コメント</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (sending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>課題コメント</DialogTitle>
          <DialogDescription className="break-words">
            {issue.title}
            の調査経緯や対応内容を確認します。新しいコメントから表示します。
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div
            ref={alert}
            tabIndex={-1}
            role="alert"
            className="space-y-3 rounded-md bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error}</p>
            {readFailed && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load(failedCursor)}
              >
                再試行する
              </Button>
            )}
            {conflict && (editing || removing) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void reloadCurrent()}
              >
                入力を破棄して最新版を読み直す
              </Button>
            )}
          </div>
        )}
        {archived ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            アーカイブ済みのためコメントは閲覧のみ利用できます。
          </p>
        ) : (
          !canWrite && (
            <p className="text-sm text-slate-600">
              コメントは閲覧のみ利用できます。
            </p>
          )
        )}
        <div aria-busy={busy} className="space-y-4">
          {!loaded && busy && (
            <p role="status" className="text-sm text-slate-500">
              コメントを読み込んでいます…
            </p>
          )}
          {loaded && !comments.length && (
            <p className="rounded-md border p-4 text-sm text-slate-600">
              コメントはまだありません
            </p>
          )}
          {!!comments.length && (
            <ol aria-label="コメントの一覧" className="space-y-4">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <article
                    aria-label={`${comment.author_display_name}のコメント`}
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-slate-500">
                      <span className="break-words font-medium text-slate-700">
                        {comment.author_display_name}
                        {comment.author_id === userId && "（自分）"}
                      </span>
                      <time dateTime={comment.created_at}>
                        {dateTime(comment.created_at)}
                      </time>
                    </div>
                    {comment.version > 1 && (
                      <p className="text-xs text-slate-500">
                        編集済み{" "}
                        <time dateTime={comment.updated_at}>
                          {dateTime(comment.updated_at)}
                        </time>
                      </p>
                    )}
                    {editing?.id === comment.id ? (
                      <form onSubmit={submitEdit} className="space-y-3">
                        <label
                          htmlFor={`${id}-edit`}
                          className="block text-sm font-medium"
                        >
                          コメントを編集
                        </label>
                        <textarea
                          ref={editInput}
                          id={`${id}-edit`}
                          name="edited-comment"
                          value={editBody}
                          onChange={(event) => setEditBody(event.target.value)}
                          rows={4}
                          disabled={busy}
                          className="w-full rounded-md border p-3 text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" disabled={busy}>
                            {busy ? "保存中…" : "変更を保存"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setEditing(null);
                              setEditBody("");
                              clearError();
                            }}
                          >
                            編集をキャンセル
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        {comment.body}
                      </p>
                    )}
                    {removing?.id === comment.id ? (
                      <div
                        role="status"
                        className="space-y-3 rounded-md border border-red-200 p-3 text-sm"
                      >
                        <p>このコメントを削除します。元に戻せません。</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setRemoving(null);
                              clearError();
                            }}
                          >
                            削除をやめる
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void mutate("DELETE", removing)}
                          >
                            削除する
                          </Button>
                        </div>
                      </div>
                    ) : (
                      canChange(comment) &&
                      editing?.id !== comment.id && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={busy || !!editing || !!removing}
                            onClick={() => {
                              setEditing(comment);
                              setEditBody(comment.body);
                              clearError();
                              setTimeout(() => editInput.current?.focus(), 0);
                            }}
                          >
                            編集
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || !!editing || !!removing}
                            onClick={() => {
                              setRemoving(comment);
                              clearError();
                            }}
                          >
                            削除…
                          </Button>
                        </div>
                      )
                    )}
                  </article>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-3">
            {nextCursor && (
              <Button
                variant="outline"
                disabled={busy || !!editing || !!removing}
                onClick={() => void load(nextCursor)}
              >
                さらに読み込む
              </Button>
            )}
            {loaded && (
              <Button
                variant="outline"
                disabled={busy || !!editing || !!removing}
                onClick={() => void load()}
              >
                最新のコメントを取得
              </Button>
            )}
          </div>
        </div>
        {canWrite && (
          <form onSubmit={submit} className="space-y-3 border-t pt-4">
            <div>
              <label
                htmlFor={`${id}-body`}
                className="mb-2 block text-sm font-medium"
              >
                コメント本文
              </label>
              <textarea
                ref={newInput}
                id={`${id}-body`}
                name="comment-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                disabled={busy || !!editing || !!removing}
                aria-describedby={`${id}-help`}
                className="w-full rounded-md border p-3 text-sm"
              />
              <p id={`${id}-help`} className="mt-2 text-xs text-slate-500">
                1〜5,000文字。改行を含むテキストを投稿できます。
              </p>
            </div>
            <Button type="submit" disabled={busy || !!editing || !!removing}>
              {busy ? "処理中…" : "コメントを投稿"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
