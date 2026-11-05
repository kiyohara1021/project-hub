import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { statusLabels, type ProjectStatus } from "@/lib/project-types";

import { ProfileEditor } from "@/components/profile-editor";

export const metadata = { title: "ログイン状況" };
export default async function Workspaces() {
  if (!supabaseConfig())
    return (
      <EmptyState
        title="DB接続は無効です"
        description="画面デモではログインやデータ保存は利用できません。"
      />
    );
  const client = await supabaseServer();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) redirect("/login");
  const profileResult = await client
    .from("profiles")
    .select("display_name")
    .eq("id", data.claims.sub)
    .single();
  const workspaceResult = await client
    .from("workspaces")
    .select("id,name")
    .order("created_at");
  if (workspaceResult.error || profileResult.error)
    throw new Error("Database read failed");
  const workspaces = await Promise.all(
    workspaceResult.data.map(async (workspace) => {
      const projects = await client
        .from("projects")
        .select("id,name,status")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(5);
      if (projects.error) throw new Error("Database read failed");
      return { ...workspace, projects: projects.data };
    }),
  );
  return (
    <>
      <PageHeading
        title="ログイン状況"
        description="ログイン中のユーザーと所属先を確認できます。"
      />
      <p className="mb-2 text-sm">
        ログイン中: {profileResult.data.display_name}
      </p>
      <p className="mb-4 break-all text-xs text-slate-500">
        ユーザーID: <span className="font-mono">{data.claims.sub}</span>
        （所属追加を依頼するときに管理者へ伝えてください）
      </p>
      <ProfileEditor displayName={profileResult.data.display_name} />
      <Link
        href="/projects"
        className="mb-5 inline-block text-sm text-blue-700 underline"
      >
        プロジェクト一覧へ →
      </Link>
      <form action="/auth/logout" method="post" className="mb-6">
        <Button variant="outline">ログアウト</Button>
      </form>
      {!workspaceResult.data.length ? (
        <EmptyState
          title="所属ワークスペースがありません"
          description="このユーザーには業務データの閲覧権限がありません。"
        />
      ) : (
        <div className="space-y-4">
          {workspaces.map((w) => (
            <Card key={w.id}>
              <CardContent className="pt-6">
                <section aria-labelledby={`workspace-${w.id}`}>
                  <h2
                    id={`workspace-${w.id}`}
                    className="text-lg font-semibold"
                  >
                    {w.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    最近作成されたプロジェクトを最大5件表示しています。
                  </p>
                  <ul className="mt-4 space-y-3">
                    {w.projects.map((p) => (
                      <li key={p.id} className="text-sm">
                        <span>{p.name}</span>
                        <span className="ml-3 text-slate-500">
                          {statusLabels[p.status as ProjectStatus] ?? p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/projects?${new URLSearchParams({ workspace: w.id })}`}
                    className="mt-4 inline-block text-sm text-blue-700 underline"
                  >
                    プロジェクト一覧へ →
                  </Link>
                  <p className="mt-4 break-all text-xs text-slate-500">
                    Workspace ID: {w.id}
                  </p>
                </section>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
