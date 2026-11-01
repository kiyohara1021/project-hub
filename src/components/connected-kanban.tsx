"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TaskEditor } from "./task-editor";
import { taskStatuses, taskLabels, priorityLabels, type Task, type TaskStatus, type TaskPage, type BoardPages, type Assignee } from "@/lib/task-types";

export function ConnectedKanban({ base, initial, members, canWrite, assignee, priority }: { base: string; initial: BoardPages; members: Assignee[]; canWrite: boolean; assignee: string; priority: string }) {
  const router = useRouter();
  const [pages, setPages] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>("todo");
  const locked = useRef(false);
  function lock(value: boolean) { locked.current = value; setBusy(value); }
  function query(status: TaskStatus, cursor?: string | null) {
    const q = new URLSearchParams({ status });
    if (assignee) q.set("assignee", assignee); if (priority) q.set("priority", priority); if (cursor) q.set("cursor", cursor);
    return q;
  }
  async function loadPage(status: TaskStatus, cursor?: string | null): Promise<TaskPage> {
    const response = await fetch(`${base}?${query(status, cursor)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "一覧を取得できませんでした");
    return result;
  }
  async function refresh() {
    try {
      const next = await Promise.all(taskStatuses.map(s => loadPage(s)));
      setPages(Object.fromEntries(taskStatuses.map((s,i) => [s,next[i]])) as BoardPages);
      setError("");
    } catch { setError("一覧を取得できませんでした。再読み込みしてください。"); }
  }
  async function afterSave() { setNotice("タスクを保存しました。"); await refresh(); }
  async function more(status: TaskStatus) {
    if (locked.current) return;
    lock(true); setError("");
    try {
      const next = await loadPage(status, pages[status].nextCursor);
      setPages(current => ({ ...current, [status]: { ...next, data: [...current[status].data, ...next.data.filter(t => !current[status].data.some(old => old.id === t.id))] } }));
    } catch { setError("追加のタスクを取得できませんでした。再試行してください。"); }
    finally { lock(false); }
  }
  async function move(task: Task, status: TaskStatus, before: string | null = null) {
    if (locked.current || !canWrite || before === task.id) return;
    const previous = pages;
    lock(true); setError(""); setNotice("");
    const optimistic = Object.fromEntries(taskStatuses.map(s => [s, { ...pages[s], data: pages[s].data.filter(t => t.id !== task.id) }])) as BoardPages;
    const at = before ? optimistic[status].data.findIndex(t => t.id === before) : optimistic[status].data.length;
    optimistic[status].data.splice(at < 0 ? optimistic[status].data.length : at, 0, { ...task, status });
    setPages(optimistic);
    try {
      const response = await fetch(`${base}/${task.id}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, before_id: before, version: task.version }) });
      const result = await response.json();
      if (!response.ok) { setPages(previous); setError(result.error?.message ?? "移動できませんでした"); return; }
      setNotice("タスクの位置を保存しました。"); await refresh();
    } catch { setPages(previous); setError("通信結果を確認できませんでした。再読み込みして位置を確認してください。"); }
    finally { lock(false); }
  }
  function drop(event: DragEvent, status: TaskStatus, before: string | null = null) {
    event.preventDefault(); event.stopPropagation();
    const id = event.dataTransfer.getData("application/x-project-hub-task");
    const task = taskStatuses.flatMap(s => pages[s].data).find(t => t.id === id);
    if (task) void move(task, status, before);
  }
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{canWrite ? "状態メニュー・上へボタンでも移動できます。" : "このカンバンは読み取り専用です。"}</p>{canWrite && <TaskEditor base={base} members={members} disabled={busy} onBusy={lock} onSaved={afterSave} />}</div>
    {error && <div role="alert" className="mb-5 rounded-md bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><Button variant="outline" className="mt-3" disabled={busy} onClick={async () => { lock(true); await refresh(); router.refresh(); lock(false); }}>一覧を再読み込み</Button></div>}
    <p role="status" aria-live="polite" className="mb-4 min-h-5 text-sm text-blue-800">{busy ? "処理中です…" : notice}</p>
    <div className="mb-5 md:hidden"><label htmlFor="mobile-column" className="mb-2 block text-sm font-medium">表示する状態</label><select id="mobile-column" value={mobileColumn} onChange={e => setMobileColumn(e.target.value as TaskStatus)} className="h-11 w-full rounded-md border bg-white px-3 text-sm">{taskStatuses.map(s => <option key={s} value={s}>{taskLabels[s]}</option>)}</select></div>
    <div aria-busy={busy} className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">{taskStatuses.map(status => <section key={status} aria-label={taskLabels[status]} onDragOver={e => { if (canWrite && !busy) e.preventDefault(); }} onDrop={e => drop(e,status)} className={`min-w-0 rounded-xl bg-slate-200/60 p-3 ${mobileColumn !== status ? "hidden md:block" : ""}`}>
      <h2 className="mb-4 flex items-center justify-between px-1 text-sm font-semibold">{taskLabels[status]}<span className="rounded-full bg-white px-2 py-0.5 text-xs">{pages[status].data.length}{pages[status].nextCursor ? "+" : ""}</span></h2>
      {!pages[status].data.length && <p className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500">タスクはありません。</p>}
      <ul className="space-y-3">{pages[status].data.map((task,index) => <li key={task.id} draggable={canWrite && !busy} onDragStart={event => { event.dataTransfer.effectAllowed="move"; event.dataTransfer.setData("application/x-project-hub-task",task.id); }} onDragOver={event => { if (canWrite && !busy) event.preventDefault(); }} onDrop={event => drop(event,status,task.id)}>
        <article aria-label={task.title} className="rounded-xl border bg-white p-4 shadow-sm"><h3 className="break-words text-sm font-semibold leading-6">{task.title}</h3>{task.description && <details className="mt-3 text-xs leading-5 text-slate-600"><summary className="cursor-pointer">説明を見る</summary><p className="mt-2 whitespace-pre-wrap break-words">{task.description}</p></details>}<p className="mt-3 text-xs text-blue-700">優先度: {priorityLabels[task.priority]}</p><p className="mt-2 text-xs text-slate-500">{members.find(m => m.id === task.assignee_id)?.name ?? "未割当"}</p><p className="mt-2 text-xs text-slate-500">期限: {task.due_date ?? "未設定"}</p>
          {canWrite && <div className="mt-4 space-y-3"><label className="block text-xs text-slate-500">状態を変更<select aria-label={`${task.title}の状態`} value={task.status} disabled={busy} onChange={e => void move(task,e.target.value as TaskStatus)} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm">{taskStatuses.map(s => <option key={s} value={s}>{taskLabels[s]}</option>)}</select></label><div className="flex flex-wrap gap-2"><TaskEditor key={`${task.id}-${task.version}`} base={base} task={task} members={members} disabled={busy} onBusy={lock} onSaved={afterSave} /><Button variant="outline" disabled={busy || index === 0} onClick={() => void move(task,status,pages[status].data[index-1]?.id ?? null)}>上へ</Button></div></div>}
        </article>
      </li>)}</ul>
      {pages[status].nextCursor && <Button variant="outline" className="mt-4 w-full" disabled={busy} onClick={() => void more(status)}>さらに読み込む</Button>}
    </section>)}</div>
  </>;
}
