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
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { memberRoles, memberLabels, type MemberRole } from "@/lib/member-types";

export function MemberAdd({ wid }: { wid: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const request = useRef<{ key: string; body: string } | null>(null);
  function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    setConfirm(true);
  }
  async function save() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const body = JSON.stringify({ user_id: userId.trim(), role });
    if (!request.current || request.current.body !== body)
      request.current = { key: crypto.randomUUID(), body };
    try {
      const response = await fetch(`/api/v1/workspaces/${wid}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": request.current.key,
        },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error?.message ?? "追加できませんでした。再試行してください。",
        );
        if (result.error?.code === "INVALID_INPUT") {
          setConfirm(false);
          setTimeout(() => input.current?.focus(), 0);
        } else setTimeout(() => alert.current?.focus(), 0);
        return;
      }
      setOpen(false);
      setUserId("");
      setRole("viewer");
      setConfirm(false);
      request.current = null;
      router.refresh();
    } catch {
      setError(
        "通信結果を確認できませんでした。同じ入力で再試行すると二重登録を防げます。",
      );
      setTimeout(() => alert.current?.focus(), 0);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!sending.current) {
          setOpen(value);
          if (value) {
            setConfirm(false);
            setError("");
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>メンバーを追加</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>メンバーを追加</DialogTitle>
          <DialogDescription>
            事前登録済みユーザーのIDを指定してください。ユーザーの作成やメール送信は行いません。
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div
            ref={alert}
            tabIndex={-1}
            role="alert"
            className="rounded-md bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        <form onSubmit={review} className="space-y-4">
          <div>
            <label htmlFor="add-member-id" className="mb-2 block text-sm">
              登録済みユーザーID
            </label>
            <Input
              ref={input}
              id="add-member-id"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
              maxLength={36}
              autoComplete="off"
              spellCheck={false}
              disabled={busy || confirm}
              aria-describedby="add-member-id-help"
            />
            <p id="add-member-id-help" className="mt-2 text-xs text-slate-500">
              管理者が事前に確認したUUIDを入力してください。
            </p>
          </div>
          <div>
            <label htmlFor="add-member-role" className="mb-2 block text-sm">
              追加するロール
            </label>
            <select
              id="add-member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
              disabled={busy || confirm}
              className="h-10 w-full rounded-md border px-2"
            >
              {memberRoles.map((value) => (
                <option key={value} value={value}>
                  {memberLabels[value]}
                </option>
              ))}
            </select>
          </div>
          {confirm ? (
            <div
              role="status"
              className="space-y-3 rounded-md border p-3 text-sm"
            >
              <p className="break-all">ユーザーID: {userId}</p>
              <p>
                「{memberLabels[role]}
                」として追加します。このワークスペースの全プロジェクトを閲覧できるようになります。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  見直す
                </Button>
                <Button type="button" disabled={busy} onClick={save}>
                  {busy ? "追加中…" : "確認して追加"}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" disabled={busy}>
              追加内容を確認
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            キャンセル
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
