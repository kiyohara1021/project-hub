"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { attachmentLimit, type ListedAttachment } from "@/lib/attachment-types";

export function AttachmentsDialog({
  base,
  title,
}: {
  base: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ListedAttachment[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const sending = useRef(false);
  const selected = useRef<HTMLInputElement>(null);
  const pending = useRef<{ file: File; key: string } | null>(null);
  function lock(value: boolean) {
    sending.current = value;
    setBusy(value);
  }
  async function load() {
    const response = await fetch(base, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? "添付ファイルを取得できませんでした",
      );
    setRows(result.data);
    setCanUpload(result.canUpload);
    setLoaded(true);
  }
  async function refresh() {
    if (sending.current) return;
    lock(true);
    setError("");
    try {
      await load();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "添付ファイルを取得できませんでした",
      );
    } finally {
      lock(false);
    }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const file = selected.current?.files?.[0];
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }
    if (!file.size || file.size > attachmentLimit) {
      setError("ファイルは1〜3MiBで選択してください");
      return;
    }
    if (!pending.current || pending.current.file !== file)
      pending.current = { file, key: crypto.randomUUID() };
    lock(true);
    setError("");
    try {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch(base, {
        method: "POST",
        headers: { "Idempotency-Key": pending.current.key },
        body: data,
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.code === "IDEMPOTENCY_CONFLICT")
          pending.current = null;
        setError(result.error?.message ?? "ファイルを送信できませんでした");
        return;
      }
      pending.current = null;
      if (selected.current) selected.current.value = "";
      await load();
    } catch {
      setError(
        "送信結果を確認できませんでした。同じファイルで再試行してください。",
      );
    } finally {
      lock(false);
    }
  }
  async function remove(id: string) {
    if (sending.current) return;
    lock(true);
    setError("");
    try {
      const response = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        setError(result.error?.message ?? "ファイルを削除できませんでした");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
      setConfirm(null);
      await load();
    } catch {
      setError(
        "削除結果を確認できませんでした。再読み込みしてご確認ください。",
      );
    } finally {
      lock(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (sending.current) return;
        setOpen(value);
        setConfirm(null);
        if (value) void refresh();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">添付ファイル</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (sending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>添付ファイル</DialogTitle>
          <DialogDescription className="break-words">
            {title}に添付した資料を確認します。
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              再読み込み
            </Button>
          </div>
        )}
        <div aria-busy={busy} className="space-y-4">
          {!loaded && busy && (
            <p role="status" className="text-sm text-slate-500">
              添付ファイルを読み込んでいます…
            </p>
          )}
          {loaded && !rows.length && (
            <p className="rounded-md border p-4 text-sm text-slate-600">
              添付ファイルはありません
            </p>
          )}
          {!!rows.length && (
            <ul aria-label="添付ファイルの一覧" className="space-y-3">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 rounded-md border p-3">
                  <a
                    href={`${base}/${row.id}`}
                    download
                    className="block break-words text-sm text-blue-700 underline"
                  >
                    {row.file_name}
                  </a>
                  <p className="text-xs text-slate-500">
                    {(row.size_bytes / 1024).toFixed(1)} KiB
                  </p>
                  {row.canDelete &&
                    (confirm === row.id ? (
                      <div className="space-y-2 text-sm">
                        <p className="break-words">
                          「{row.file_name}」を削除します。元に戻せません。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirm(null)}
                          >
                            削除をやめる
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void remove(row.id)}
                          >
                            削除する
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm(row.id)}
                      >
                        削除…
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}
          {loaded && canUpload ? (
            <form onSubmit={upload} className="space-y-3 rounded-md border p-3">
              <label
                className="block text-sm font-medium"
                htmlFor={`attachment-${base}`}
              >
                添付するファイル
              </label>
              <input
                ref={selected}
                id={`attachment-${base}`}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.txt"
                disabled={busy || rows.length >= 20}
                className="block w-full min-w-0 text-sm file:mr-3 file:rounded file:border file:px-3 file:py-2"
                onChange={() => {
                  pending.current = null;
                  setError("");
                }}
              />
              <p className="text-xs leading-5 text-slate-600">
                PNG・JPEG・WebP・PDF・UTF-8テキスト、1個3MiBまで。1件のタスク・課題につき20個までです。送信を中断したファイルは、管理者の回収後に添付枠が空きます。
              </p>
              <Button type="submit" disabled={busy || rows.length >= 20}>
                {busy ? "処理中…" : "アップロード"}
              </Button>
            </form>
          ) : (
            loaded && (
              <p className="text-sm text-slate-600">
                添付ファイルは閲覧のみ利用できます。
              </p>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
