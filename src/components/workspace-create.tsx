"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function WorkspaceCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending.current) {
          setOpen(value);
          if (value) setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="mb-6">ワークスペースを作成</Button>
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (pending.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>ワークスペースを作成</DialogTitle>
          <DialogDescription>
            作成すると、あなたが管理者になります。メンバーは後から追加できます。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            const value = name.trim();
            if (!value || Array.from(value).length > 120) {
              setError("名前は前後の空白を除いて1〜120文字で入力してください");
              return;
            }
            const payload = JSON.stringify({ name: value });
            if (receipt.current && receipt.current.payload !== payload) {
              setError(
                "前の送信結果を確認するため、同じ名前で再試行してください。",
              );
              return;
            }
            receipt.current ??= { payload, key: crypto.randomUUID() };
            pending.current = true;
            setBusy(true);
            setError("");
            try {
              const response = await fetch("/api/v1/workspaces", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Idempotency-Key": receipt.current.key,
                },
                body: payload,
              });
              const body = await response.json();
              if (!response.ok) {
                if (response.status < 500) receipt.current = null;
                setError(
                  body.error?.message ??
                    "作成できませんでした。もう一度お試しください。",
                );
                return;
              }
              receipt.current = null;
              setOpen(false);
              setName("");
              router.push(
                `/dashboard?${new URLSearchParams({ workspace: body.data.id })}`,
              );
              router.refresh();
            } catch {
              setError(
                "送信結果を確認できませんでした。同じ名前で再試行してください。",
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div>
            <label
              htmlFor="workspace-name"
              className="mb-2 block text-sm font-medium"
            >
              ワークスペース名
            </label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={busy}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "作成中…" : "作成する"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
