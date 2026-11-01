import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { readProjectPage, ProjectError } from "@/lib/projects-server";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProjectEditor } from "./project-editor";
import { projectStatuses, statusLabels, type ProjectStatus } from "@/lib/project-types";

export async function ConnectedProjectList({ search }: { search: Record<string, string | string[] | undefined> }) {
  if (!supabaseConfig()) return <EmptyState title="接続設定がありません" description="ローカル接続設定を確認してください。" />;
  const client = await supabaseServer();
  const auth = await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub) redirect("/login");
  const workspaces = await client.from("workspaces").select("id,name").order("created_at").order("id");
  if (workspaces.error) throw new Error("Workspace read failed");
  if (!workspaces.data.length) return <><PageHeading title="プロジェクト一覧" description="所属先のプロジェクトを表示します。" /><EmptyState title="所属ワークスペースがありません" description="管理者に所属の設定を依頼してください。" /></>;
  const workspaceId = typeof search.workspace === "string" ? search.workspace : workspaces.data[0].id;
  if (!workspaces.data.some(w => w.id === workspaceId) || Array.isArray(search.workspace)) notFound();
  const member = await client.from("memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", auth.data.claims.sub).maybeSingle();
  if (member.error) throw new Error("Membership read failed");
  if (!member.data) notFound();
  const canEdit = member.data.role === "admin";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === "workspace" || value === undefined) continue;
    if (Array.isArray(value)) return <EmptyState title="検索条件を確認してください" description="重複した条件は指定できません。" />;
    query.set(key, value);
  }
  let page;
  try { page = await readProjectPage(workspaceId, query); }
  catch (error) {
    if (error instanceof ProjectError && error.status === 404) notFound();
    if (error instanceof ProjectError && error.status === 401) redirect("/login");
    if (error instanceof ProjectError && error.status === 400) return <><EmptyState title="検索条件を確認してください" description="条件が無効です。検索をリセットしてください。" /><Link href={`/projects?workspace=${workspaceId}`} className="mt-5 inline-block text-blue-700 underline">検索をリセット</Link></>;
    throw error;
  }
  const next = new URLSearchParams(query); next.set("workspace", workspaceId);
  if (page.nextCursor) next.set("cursor", page.nextCursor);
  const first = new URLSearchParams(query); first.set("workspace", workspaceId); first.delete("cursor");
  return <>
    <PageHeading title="プロジェクト一覧" description="ログイン中のユーザーが所属するワークスペースのプロジェクトです。" />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{canEdit ? "管理者として作成・編集できます。" : "閲覧のみ利用できます。"}</p>{canEdit && <ProjectEditor key={workspaceId} workspaceId={workspaceId} />}</div>
    <form key={`${workspaceId}:${query}`} action="/projects" method="get" className="mb-6 grid items-end gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <div><label htmlFor="workspace" className="mb-2 block text-sm font-medium">ワークスペース</label><select id="workspace" name="workspace" defaultValue={workspaceId} className="h-10 w-full rounded-md border px-2 text-sm">{workspaces.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <div><label htmlFor="project-search" className="mb-2 block text-sm font-medium">プロジェクト名で検索</label><Input id="project-search" name="q" defaultValue={query.get("q") ?? ""} type="search" maxLength={120} /></div>
      <div><label htmlFor="project-status" className="mb-2 block text-sm font-medium">状態で絞り込み</label><select id="project-status" name="status" defaultValue={query.get("status") ?? ""} className="h-10 w-full rounded-md border px-2 text-sm"><option value="">すべて</option>{projectStatuses.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></div>
      <div className="flex gap-3"><Button type="submit">検索する</Button><Link href={`/projects?workspace=${workspaceId}`} className="self-center text-sm text-blue-700 underline">リセット</Link></div>
    </form>
    {!page.data.length ? <EmptyState /> : <div className="grid gap-4 lg:grid-cols-2">{page.data.map(p => <Card key={p.id}><CardContent className="pt-6"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">{statusLabels[p.status as ProjectStatus]}</span><h2 className="mb-3 mt-4 break-words text-lg font-semibold">{p.name}</h2><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-500">{p.description || "説明はまだありません。"}</p><div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm">期限: {p.due_date ?? "未設定"}</p>{canEdit && <ProjectEditor key={`${p.id}-${p.version}`} workspaceId={workspaceId} project={p} />}</div></CardContent></Card>)}</div>}
    <nav aria-label="プロジェクトのページ送り" className="mt-6 flex items-center justify-between gap-3 text-sm"><span>{page.data.length}件を表示</span><div className="flex gap-5">{query.has("cursor") && <Link href={`/projects?${first}`} className="text-blue-700 underline">最初のページ</Link>}{page.nextCursor && <Link href={`/projects?${next}`} className="text-blue-700 underline">次のページ →</Link>}</div></nav>
  </>;
}
