"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { priorities, priorityLabels, type Assignee, type Priority, type Task } from "@/lib/task-types";

export function TaskEditor({ base, task, members, disabled, onBusy, onSaved }: { base: string; task?: Task; members: Assignee[]; disabled: boolean; onBusy: (busy: boolean) => void; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [assignee, setAssignee] = useState(task?.assignee_id ?? "");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [version, setVersion] = useState(task?.version ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sending = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const fieldId = task?.id ?? "new-task";
  function lock(value: boolean) { sending.current = value; setBusy(value); onBusy(value); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const body = JSON.stringify({ title, description, priority, assignee_id: assignee || null, due_date: due || null, ...(task ? { version } : {}) });
    if (!request.current || request.current.body !== body) request.current = { body, key: crypto.randomUUID() };
    await mutate(task ? "PATCH" : "POST", task ? `${base}/${task.id}` : base, body, request.current.key);
  }
  async function mutate(method: string, url: string, body: string, key?: string) {
    if (sending.current) return;
    lock(true); setError(""); setConflict(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body });
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "保存できませんでした"); setConflict(result?.error?.code === "VERSION_CONFLICT"); return; }
      setOpen(false); setDeleting(false); request.current = null;
      if (!task) { setTitle(""); setDescription(""); setPriority("medium"); setAssignee(""); setDue(""); }
      await onSaved();
    } catch { setError("通信結果を確認できませんでした。同じ入力で再試行してください。"); }
    finally { lock(false); }
  }
  async function reload() {
    if (!task || sending.current) return;
    lock(true);
    try {
      const response = await fetch(`${base}/${task.id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "取得できませんでした"); return; }
      const latest = result.data as Task;
      setTitle(latest.title); setDescription(latest.description); setPriority(latest.priority); setAssignee(latest.assignee_id ?? ""); setDue(latest.due_date ?? ""); setVersion(latest.version);
      setConflict(false); setError(""); setDeleting(false);
    } catch { setError("最新版を取得できませんでした。再試行してください。"); }
    finally { lock(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!sending.current) setOpen(value); }}>
    <DialogTrigger asChild><Button variant={task ? "outline" : "default"} disabled={disabled}>{task ? "編集" : "タスク追加"}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{task ? "タスク編集" : "タスク追加"}</DialogTitle><DialogDescription>架空の内容だけを入力してください。状態変更はカードの状態メニューから行えます。</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <div role="alert" className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{conflict && <Button type="button" variant="outline" onClick={reload} disabled={busy}>入力を破棄して最新版を読み直す</Button>}</div>}
        <div><label htmlFor={`${fieldId}-title`} className="mb-2 block text-sm font-medium">タスク名</label><Input id={`${fieldId}-title`} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required disabled={busy} autoFocus /></div>
        <div><label htmlFor={`${fieldId}-description`} className="mb-2 block text-sm font-medium">説明</label><textarea id={`${fieldId}-description`} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} rows={3} disabled={busy} className="w-full rounded-md border px-3 py-2 text-sm" /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor={`${fieldId}-priority`} className="mb-2 block text-sm font-medium">優先度</label><select id={`${fieldId}-priority`} value={priority} onChange={e => setPriority(e.target.value as Priority)} disabled={busy} className="h-10 w-full rounded-md border px-2 text-sm">{priorities.map(p => <option key={p} value={p}>{priorityLabels[p]}</option>)}</select></div><div><label htmlFor={`${fieldId}-assignee`} className="mb-2 block text-sm font-medium">担当者</label><select id={`${fieldId}-assignee`} value={assignee} onChange={e => setAssignee(e.target.value)} disabled={busy} className="h-10 w-full rounded-md border px-2 text-sm"><option value="">未割当</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div></div>
        <div><label htmlFor={`${fieldId}-due`} className="mb-2 block text-sm font-medium">期限（任意）</label><Input id={`${fieldId}-due`} type="date" value={due} onChange={e => setDue(e.target.value)} disabled={busy} /></div>
        {task && <div className="rounded-md border border-red-200 p-3 text-sm">{deleting ? <><p className="mb-3 text-red-800">「{task.title}」を削除します。元に戻せません。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setDeleting(false)} disabled={busy}>削除をやめる</Button><Button type="button" variant="destructive" onClick={() => mutate("DELETE", `${base}/${task.id}`, JSON.stringify({ version }))} disabled={busy}>削除する</Button></div></> : <Button type="button" variant="outline" onClick={() => setDeleting(true)} disabled={busy}>タスクを削除…</Button>}</div>}
        <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>キャンセル</Button><Button type="submit" disabled={busy || deleting}>{busy ? "処理中…" : "保存する"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
