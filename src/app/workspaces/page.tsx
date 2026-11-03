import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProfileEditor } from "@/components/profile-editor";

export const metadata = { title: "ログイン状況" };
export default async function Workspaces() {
  if (!supabaseConfig()) return <EmptyState title="DB接続は無効です" description="画面デモではログインやデータ保存は利用できません。" />;
  const client = await supabaseServer();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) redirect("/login");
  const profileResult = await client.from("profiles").select("display_name").eq("id", data.claims.sub).single();
  const workspaceResult = await client.from("workspaces").select("id,name").order("created_at");
  const projectResult = await client.from("projects").select("id,workspace_id,name,status").order("created_at");
  if (workspaceResult.error || projectResult.error || profileResult.error) throw new Error("Database read failed");
  return <><PageHeading title="ログイン状況" description="ログイン中のユーザーと所属先を確認できます。" />
    <p className="mb-4 text-sm">ログイン中: {profileResult.data.display_name}</p>
    <ProfileEditor key={profileResult.data.display_name} displayName={profileResult.data.display_name} />
    <Link href="/projects" className="mb-5 inline-block text-sm text-blue-700 underline">プロジェクト一覧へ →</Link>
    <form action="/auth/logout" method="post" className="mb-6"><Button variant="outline">ログアウト</Button></form>
    {!workspaceResult.data.length ? <EmptyState title="所属ワークスペースがありません" description="このユーザーには業務データの閲覧権限がありません。" /> :
      <div className="space-y-4">{workspaceResult.data.map(w => <Card key={w.id}><CardContent className="pt-6"><h2 className="text-lg font-semibold">{w.name}</h2><ul className="mt-4 space-y-3">{projectResult.data.filter(p => p.workspace_id === w.id).map(p => <li key={p.id} className="text-sm"><span>{p.name}</span><span className="ml-3 text-slate-500">{p.status}</span></li>)}</ul><p className="mt-4 break-all text-xs text-slate-500">Workspace ID: {w.id}</p></CardContent></Card>)}</div>}
  </>;
}
