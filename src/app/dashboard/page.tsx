import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeading } from "@/components/page-parts";
import { projects, tasks } from "@/lib/demo-data";
import { connectedMode } from "@/lib/supabase/config";
import { ConnectedDashboard } from "@/components/connected-dashboard";

export const metadata = { title: "ダッシュボード" };
export default async function Dashboard({searchParams}:{searchParams:Promise<Record<string,string | string[] | undefined>>}) {
  if (connectedMode()) return <ConnectedDashboard search={await searchParams} />;
  return <><PageHeading title="ダッシュボード" description="デモスペースの作業状況をひと目で確認できます。サンプルデータを表示しています。" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["進行中プロジェクト", "3"], ["完了率（サンプル）", "50%"], ["期限超過タスク", "2"], ["未解決課題", "3"]].map(([label, value]) => <Card key={label}><CardContent className="pt-6"><p className="text-sm text-slate-500">{label}</p><p className="mt-4 text-4xl font-bold tracking-tight">{value}</p></CardContent></Card>)}</div>
    <div className="mt-6 grid gap-6 xl:grid-cols-3"><Card className="xl:col-span-2"><CardHeader><CardTitle>プロジェクト進捗</CardTitle></CardHeader><CardContent className="space-y-7">{projects.map(p => <div key={p.id}><div className="mb-3 flex items-center justify-between gap-3"><Link href={`/projects/${p.id}/board`} className="flex items-center gap-2 text-sm font-medium hover:text-blue-700">{p.name}<ArrowUpRight size={15} /></Link><span className="text-sm font-semibold">{p.progress}%</span></div><div role="progressbar" aria-label={`${p.name}の進捗`} aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${p.progress}%` }} /></div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>自分のタスク</CardTitle></CardHeader><CardContent><ul className="space-y-5">{tasks.filter(t => t.assignee === "デモメンバー01" && t.status !== "完了").map(t => <li key={t.id}><p className="text-sm font-medium">{t.title}</p><p className="mt-1 text-xs text-slate-500">{t.id} · {t.status}</p></li>)}</ul></CardContent></Card></div>
    <Card className="mt-6"><CardHeader><CardTitle>最近の操作</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><p>11/01 10:30 · デモメンバー01 がタスクの状態を変更</p><p className="text-slate-500">11/01 09:20 · デモメンバー02 が担当を変更</p><Link href="/activity" className="inline-block font-medium text-blue-700 hover:underline">操作履歴をすべて見る →</Link></CardContent></Card>
  </>;
}
