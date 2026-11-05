"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  priorities,
  priorityLabels,
  type Assignee,
  type Priority,
} from "@/lib/task-types";
import {
  issueStatuses,
  issueLabels,
  type Issue,
  type IssueStatus,
} from "@/lib/issue-types";

export function IssueEditor({
  base,
  issue,
  members,
}: {
  base: string;
  issue?: Issue;
  members: Assignee[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [priority, setPriority] = useState<Priority>(
    issue?.priority ?? "medium",
  );
  const [assignee, setAssignee] = useState(issue?.assignee_id ?? "");
  const [due, setDue] = useState(issue?.due_date ?? "");
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? "open");
  const [savedStatus, setSavedStatus] = useState<IssueStatus>(
    issue?.status ?? "open",
  );
  const [version, setVersion] = useState(issue?.version ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sending = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const id = issue?.id ?? "new-issue";
  async function save() {
    const body = JSON.stringify({
      title,
      description,
      priority,
      assignee_id: assignee || null,
      due_date: due || null,
      ...(issue ? { status, version } : {}),
    });
    if (!request.current || request.current.body !== body)
      request.current = { body, key: crypto.randomUUID() };
    setConfirmStatus(false);
    await mutate(
      issue ? "PATCH" : "POST",
      issue ? `${base}/${issue.id}` : base,
      body,
      request.current.key,
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    if (issue && status !== savedStatus) {
      setConfirmStatus(true);
      return;
    }
    void save();
  }
  async function mutate(
    method: string,
    url: string,
    body: string,
    key?: string,
  ) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body,
      });
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok) {
        setError(result?.error?.message ?? "保存できませんでした");
        setConflict(result?.error?.code === "VERSION_CONFLICT");
        return;
      }
      setOpen(false);
      setConfirmDelete(false);
      request.current = null;
      if (!issue) {
        setTitle("");
        setDescription("");
        setPriority("medium");
        setAssignee("");
        setDue("");
      }
      router.refresh();
    } catch {
      setError(
        "通信結果を確認できませんでした。同じ入力で再試行してください。",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (!issue || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`${base}/${issue.id}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "取得できませんでした");
        return;
      }
      const latest = result.data as Issue;
      setTitle(latest.title);
      setDescription(latest.description);
      setPriority(latest.priority);
      setAssignee(latest.assignee_id ?? "");
      setDue(latest.due_date ?? "");
      setStatus(latest.status);
      setSavedStatus(latest.status);
      setVersion(latest.version);
      setError("");
      setConflict(false);
      setConfirmStatus(false);
      setConfirmDelete(false);
    } catch {
      setError("最新版を取得できませんでした。再試行してください。");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const locked = busy || confirmStatus || confirmDelete;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!sending.current) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={issue ? "outline" : "default"}>
          {issue ? "編集" : "課題追加"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{issue ? "課題編集" : "課題追加"}</DialogTitle>
          <DialogDescription>
            課題の内容・担当者・期限を設定します。状態変更と削除は確認してから実行します。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-800"
            >
              <p>{error}</p>
              {conflict && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={reload}
                >
                  入力を破棄して最新版を読み直す
                </Button>
              )}
            </div>
          )}
          <div>
            <label
              htmlFor={`${id}-title`}
              className="mb-2 block text-sm font-medium"
            >
              課題名
            </label>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              disabled={locked}
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-description`}
              className="mb-2 block text-sm font-medium"
            >
              説明
            </label>
            <textarea
              id={`${id}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={3}
              disabled={locked}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${id}-priority`}
                className="mb-2 block text-sm font-medium"
              >
                優先度
              </label>
              <select
                id={`${id}-priority`}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                disabled={locked}
                className="h-10 w-full rounded-md border px-2 text-sm"
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${id}-assignee`}
                className="mb-2 block text-sm font-medium"
              >
                担当者
              </label>
              <select
                id={`${id}-assignee`}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                disabled={locked}
                className="h-10 w-full rounded-md border px-2 text-sm"
              >
                <option value="">未割当</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label
              htmlFor={`${id}-due`}
              className="mb-2 block text-sm font-medium"
            >
              期限（任意）
            </label>
            <Input
              id={`${id}-due`}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={locked}
            />
          </div>
          {issue && (
            <div>
              <label
                htmlFor={`${id}-status`}
                className="mb-2 block text-sm font-medium"
              >
                状態
              </label>
              <select
                id={`${id}-status`}
                value={status}
                onChange={(e) => setStatus(e.target.value as IssueStatus)}
                disabled={locked}
                className="h-10 w-full rounded-md border px-2 text-sm"
              >
                {issueStatuses.map((s) => (
                  <option key={s} value={s}>
                    {issueLabels[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {confirmStatus && (
            <div
              role="status"
              className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"
            >
              <p className="mb-3">
                状態を「{issueLabels[savedStatus]}」から「{issueLabels[status]}
                」に変更します。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmStatus(false)}
                  disabled={busy}
                >
                  変更を見直す
                </Button>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy}
                >
                  状態変更を確認して保存
                </Button>
              </div>
            </div>
          )}
          {issue && (
            <div className="rounded-md border border-red-200 p-3 text-sm">
              {confirmDelete ? (
                <>
                  <p className="mb-3 text-red-800">
                    「{issue.title}」を削除します。元に戻せません。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      削除をやめる
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          "DELETE",
                          `${base}/${issue.id}`,
                          JSON.stringify({ version }),
                        )
                      }
                    >
                      削除する
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || confirmStatus}
                  onClick={() => setConfirmDelete(true)}
                >
                  課題を削除…
                </Button>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={locked}>
              {busy ? "処理中…" : "保存する"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
