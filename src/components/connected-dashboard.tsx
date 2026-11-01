import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { readDashboard } from "@/lib/dashboard-server";
import { ProjectError } from "@/lib/projects-server";
import { taskLabels } from "@/lib/task-types";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function dateTime(value: string) { return new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false }).format(new Date(value)); }
const entityLabels: Record<string,string> = { projects:"プロジェクト",tasks:"タスク",issues:"課題",memberships:"メンバー" };
const actionLabels: Record<string,string> = { INSERT:"追加",UPDATE:"更新",DELETE:"削除" };

export async function ConnectedDashboard({ search }: { search: Record<string,string | string[] | undefined> }) {
  if (!supabaseConfig()) return <><PageHeading title="ダッシュボード" description="接続設定を確認してください。" /><EmptyState title="接続設定がありません" /></>;
  const client=await supabaseServer(); const auth=await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub) redirect("/login");
  const spaces=await client.from("workspaces").select("id,name").order("created_at").order("id");
  if (spaces.error) throw new Error("Workspace read failed");
  if (Object.keys(search).some(k=>k!=="workspace") || Array.isArray(search.workspace)) return <><PageHeading title="ダッシュボード" description="所属先の状況を確認できます。" /><EmptyState title="表示条件を確認してください" /><Link href="/dashboard" className="mt-4 inline-block text-blue-700 underline">表示条件をリセット</Link></>;
  if (!spaces.data.length) {
    if (search.workspace) notFound();
    return <><PageHeading title="ダッシュボード" description="所属先の状況を確認できます。" /><EmptyState title="所属ワークスペースがありません" description="管理者に所属の設定を依頼してください。" /></>;
  }
  const wid=search.workspace ?? spaces.data[0].id;
  const selected=spaces.data.find(w=>w.id===wid); if (!selected) notFound();
  let dashboard;
  try { dashboard=await readDashboard(wid); }
  catch (error) {
    if (error instanceof ProjectError && error.status===401) redirect("/login");
    if (error instanceof ProjectError && [400,404].includes(error.status)) notFound();
    throw error;
  }
  const {metrics}=dashboard;
  return <>
    <PageHeading title="ダッシュボード" description={`${selected.name}の作業状況です。アーカイブ済みプロジェクトは集計から除外しています。`} />
    <form key={wid} action="/dashboard" method="get" className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4"><div className="min-w-0 flex-1"><label htmlFor="dashboard-workspace" className="mb-2 block text-sm font-medium">ワークスペース</label><select id="dashboard-workspace" name="workspace" defaultValue={wid} className="h-10 w-full rounded-md border px-3 text-sm">{spaces.data.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></div><Button type="submit">最新の状況を取得</Button></form>
    <p className="mb-5 text-xs leading-5 text-slate-500">更新: {dateTime(dashboard.as_of)}（日本時間） · 期限の判定日: {dashboard.today}</p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      {label:"進行中プロジェクト",value:`${metrics.active_projects.toLocaleString("ja-JP")}件`,detail:"状態が進行中のプロジェクト"},
      {label:"完了率",value:`${metrics.completion_percent}%`,detail:`完了 ${metrics.task_done.toLocaleString("ja-JP")} / 全 ${metrics.task_total.toLocaleString("ja-JP")}タスク`},
      {label:"期限超過タスク",value:`${metrics.overdue_tasks.toLocaleString("ja-JP")}件`,detail:"今日より前が期限の未完了タスク"},
      {label:"未解決課題",value:`${metrics.open_issues.toLocaleString("ja-JP")}件`,detail:"未解決・調査中の課題"},
    ].map(m=><Card key={m.label} role="region" aria-label={m.label}><CardContent className="pt-6"><p className="text-sm text-slate-500">{m.label}</p><p className="mt-4 text-4xl font-bold tracking-tight">{m.value}</p><p className="mt-3 text-xs leading-5 text-slate-500">{m.detail}</p></CardContent></Card>)}</div>
    <div className="mt-6 grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2" role="region" aria-label="プロジェクト進捗"><CardHeader><CardTitle>プロジェクト進捗</CardTitle><p className="text-xs text-slate-500">新しい順に最大5件</p></CardHeader><CardContent className="space-y-6">{!dashboard.projects.length ? <p className="text-sm text-slate-500">集計対象のプロジェクトはありません。</p> : dashboard.projects.map(p=><div key={p.id}><div className="mb-2 flex items-start justify-between gap-3"><Link href={`/projects/${p.id}/board?workspace=${wid}`} className="break-words text-sm font-medium text-blue-700 hover:underline">{p.name} →</Link><span className="shrink-0 text-sm font-semibold">{p.completion_percent}%</span></div><div role="progressbar" aria-label={`${p.name}の進捗`} aria-valuenow={p.completion_percent} aria-valuemin={0} aria-valuemax={100} className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${p.completion_percent}%`}} /></div><p className="mt-2 text-xs text-slate-500">完了 {p.task_done.toLocaleString("ja-JP")} / 全 {p.task_total.toLocaleString("ja-JP")}タスク</p></div>)}<Link href={`/projects?workspace=${wid}`} className="inline-block text-sm text-blue-700 underline">プロジェクト一覧へ →</Link></CardContent></Card>
      <Card role="region" aria-label="自分のタスク"><CardHeader><CardTitle>自分のタスク</CardTitle><p className="text-xs text-slate-500">未完了・期限が近い順に最大5件</p></CardHeader><CardContent>{!dashboard.my_tasks.length ? <p className="text-sm text-slate-500">担当する未完了タスクはありません。</p> : <ul className="space-y-5">{dashboard.my_tasks.map(t=><li key={t.id}><Link href={`/projects/${t.project_id}/board?workspace=${wid}&assignee=${dashboard.viewer_id}&column=${t.status}`} className="break-words text-sm font-medium text-blue-700 hover:underline">{t.title}</Link><p className="mt-1 break-words text-xs leading-5 text-slate-500">{t.project_name} · {taskLabels[t.status]}</p><p className="mt-1 text-xs text-slate-500">期限: {t.due_date ?? "未設定"}</p></li>)}</ul>}</CardContent></Card>
    </div>
    <Card className="mt-6" role="region" aria-label="最近の操作"><CardHeader><CardTitle>最近の操作</CardTitle><p className="text-xs text-slate-500">ワークスペース全体の最新5件（アーカイブ含む）</p></CardHeader><CardContent>{!dashboard.recent_activity.length ? <p className="text-sm text-slate-500">操作履歴はまだありません。</p> : <ul className="space-y-4">{dashboard.recent_activity.map(a=><li key={a.id} className="text-sm leading-6"><time dateTime={a.created_at} className="mr-3 text-xs text-slate-500">{dateTime(a.created_at)}</time><span>{a.actor_display_name} が {entityLabels[a.entity_type] ?? "データ"}を{actionLabels[a.action] ?? "変更"}</span></li>)}</ul>}</CardContent></Card>
  </>;
}
