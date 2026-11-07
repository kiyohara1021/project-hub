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
import { Button } from "@/components/ui/button";
import { visibilityLabels, type ProjectVisibility } from "@/lib/project-types";
import type { ProjectAccessSettings } from "@/lib/project-access-server";

export function ProjectAccessEditor({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ProjectAccessSettings | null>(null);
  const [visibility, setVisibility] = useState<ProjectVisibility>("workspace");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const requestId = useRef(0);
  const sending = useRef(false);
  const base = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/access`;

  async function load() {
    const id = ++requestId.current;
    setLoading(true);
    setReadFailed(false);
    setError("");
    setConflict(false);
    try {
      const response = await fetch(base, { cache: "no-store" });
      const result = await response.json();
      if (id !== requestId.current) return;
      if (!response.ok) {
        setReadFailed(true);
        setError(result.error?.message ?? "公開範囲を取得できませんでした");
        return;
      }
      const value = result.data as ProjectAccessSettings;
      setSettings(value);
      setVisibility(value.visibility);
      setSelected(value.member_ids);
    } catch {
      if (id === requestId.current) {
        setReadFailed(true);
        setError("公開範囲を取得できませんでした。再試行してください。");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || sending.current || loading || readFailed) return;
    if (selected.length > 100) {
      setError("参加者は100人以内で選んでください");
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const response = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility,
          member_ids: selected,
          version: settings.version,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "公開範囲を保存できませんでした");
        setConflict(result.error?.code === "VERSION_CONFLICT");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(
        "通信結果を確認できませんでした。再試行の前に最新版を読み直してください。",
      );
      setConflict(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (sending.current) return;
        setOpen(value);
        if (value) {
          setSettings(null);
          void load();
        } else {
          requestId.current++;
          setLoading(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">公開範囲</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (sending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>プロジェクトの公開範囲</DialogTitle>
          <DialogDescription>
            管理者は常に閲覧できます。指定した参加者の権限は、ワークスペースのロールに従います。
          </DialogDescription>
        </DialogHeader>
        {loading && <p role="status">公開範囲を読み込んでいます…</p>}
        {error && (
          <div
            role="alert"
            className="space-y-3 rounded-md bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error}</p>
            {(!settings || conflict || readFailed) && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || loading}
                onClick={() => void load()}
              >
                {conflict ? "入力を破棄して最新版を読み直す" : "再試行する"}
              </Button>
            )}
          </div>
        )}
        {settings && (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label
                htmlFor={`access-${projectId}`}
                className="mb-2 block text-sm font-medium"
              >
                公開範囲
              </label>
              <select
                id={`access-${projectId}`}
                value={visibility}
                disabled={busy || loading}
                onChange={(event) =>
                  setVisibility(event.target.value as ProjectVisibility)
                }
                className="h-10 w-full rounded-md border bg-white px-3 text-sm"
              >
                {(["workspace", "private"] as const).map((value) => (
                  <option key={value} value={value}>
                    {visibilityLabels[value]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset
              disabled={busy || loading}
              className="space-y-3 rounded-md border p-3"
            >
              <legend className="px-1 text-sm font-medium">
                非公開時の参加者（最大100人）
              </legend>
              <p className="text-xs text-slate-500">
                参加解除や非公開への変更で閲覧できなくなる人のタスク・課題は、未割当に変更されます。
              </p>
              {!settings.candidates.some(
                (candidate) => candidate.role !== "admin",
              ) && (
                <p className="text-sm text-slate-500">
                  管理者以外の所属者はいません。
                </p>
              )}
              {settings.candidates
                .filter((candidate) => candidate.role !== "admin")
                .map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-start gap-3 break-words text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(candidate.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, candidate.id]
                            : current.filter((id) => id !== candidate.id),
                        )
                      }
                      className="mt-1"
                    />
                    <span>
                      {candidate.name}
                      <span className="ml-2 text-xs text-slate-500">
                        {candidate.role === "viewer" ? "閲覧者" : "メンバー"}
                      </span>
                    </span>
                  </label>
                ))}
            </fieldset>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  requestId.current++;
                  setOpen(false);
                }}
              >
                キャンセル
              </Button>
              <Button
                type="submit"
                disabled={busy || loading || conflict || readFailed}
              >
                {busy ? "保存中…" : "保存する"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
