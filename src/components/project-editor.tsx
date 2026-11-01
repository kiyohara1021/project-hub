"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { projectStatuses, statusLabels, type Project, type ProjectStatus } from "@/lib/project-types";

export function ProjectEditor({ workspaceId, project }: { workspaceId: string; project?: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [due, setDue] = useState(project?.due_date ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "planned");
  const [version, setVersion] = useState(project?.version ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const sending = useRef(false);
  const request = useRef<{ key: string; body: string } | null>(null);
  const base = `/api/v1/workspaces/${workspaceId}/projects`;
  const fieldId = project?.id ?? "new-project";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(""); setConflict(false);
    const body = JSON.stringify({ name, description, due_date: due || null, ...(project ? { status, version } : {}) });
    if (!request.current || request.current.body !== body) request.current = { key: crypto.randomUUID(), body };
    try {
      const response = await fetch(project ? `${base}/${project.id}` : base, {
        method: project ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key }, body,
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "保存できませんでした。再試行してください。");
        setConflict(result.error?.code === "VERSION_CONFLICT");
        return;
      }
      setOpen(false); request.current = null;
      if (!project) { setName(""); setDescription(""); setDue(""); }
      router.refresh();
    } catch { setError("通信結果を確認できませんでした。同じ入力で再試行すると二重登録を防げます。"); }
    finally { sending.current = false; setBusy(false); }
  }

  async function reload() {
    if (!project || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      const response = await fetch(`${base}/${project.id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "取得できませんでした"); return; }
      const latest = result.data as Project;
      setName(latest.name); setDescription(latest.description); setDue(latest.due_date ?? ""); setStatus(latest.status); setVersion(latest.version);
      setError(""); setConflict(false);
    } catch { setError("最新版を取得できませんでした。再試行してください。"); }
    finally { sending.current = false; setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!sending.current) setOpen(value); }}>
    <DialogTrigger asChild><Button variant={project ? "outline" : "default"}>{project ? "編集" : "プロジェクト作成"}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{project ? "プロジェクト編集" : "プロジェクト作成"}</DialogTitle><DialogDescription>架空の名前と情報だけを入力してください。{project && "アーカイブは削除の代わりに使い、状態を変更すると復元できます。"}</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        {error && <div role="alert" className="space-y-3 rounded-md bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{conflict && <Button type="button" variant="outline" disabled={busy} onClick={reload}>入力を破棄して最新版を読み直す</Button>}</div>}
        <div><label htmlFor={`${fieldId}-name`} className="mb-2 block text-sm font-medium">プロジェクト名</label><Input id={`${fieldId}-name`} value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy} autoFocus /></div>
        <div><label htmlFor={`${fieldId}-description`} className="mb-2 block text-sm font-medium">説明</label><textarea id={`${fieldId}-description`} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} disabled={busy} rows={4} className="w-full rounded-md border bg-white px-3 py-2 text-sm" /></div>
        <div><label htmlFor={`${fieldId}-due`} className="mb-2 block text-sm font-medium">期限（任意）</label><Input id={`${fieldId}-due`} type="date" value={due} onChange={e => setDue(e.target.value)} disabled={busy} /></div>
        {project && <div><label htmlFor={`${fieldId}-status`} className="mb-2 block text-sm font-medium">状態</label><select id={`${fieldId}-status`} value={status} onChange={e => setStatus(e.target.value as ProjectStatus)} disabled={busy} className="h-10 w-full rounded-md border bg-white px-3 text-sm">{projectStatuses.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></div>}
        <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>キャンセル</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存する"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
