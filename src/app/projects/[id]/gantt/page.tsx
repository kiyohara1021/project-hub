import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { projects, tasks as demoTasks } from "@/lib/demo-data";
import { connectedMode } from "@/lib/supabase/config";
import { taskAccess } from "@/lib/tasks-server";
import { ProjectError, uuid } from "@/lib/projects-server";
import { ganttOptions, type GanttTask } from "@/lib/gantt";
import { GanttChart } from "@/components/gantt-chart";
import { EmptyState, PageHeading } from "@/components/page-parts";

export const metadata = { title: "ガントチャート" };
export default async function Gantt({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  let options;
  try {
    options = ganttOptions(search);
  } catch {
    return (
      <>
        <EmptyState
          title="表示条件を確認してください"
          description="開始日と表示単位を選び直してください。"
        />
        <Link
          href={`/projects/${id}/gantt${typeof search.workspace === "string" ? `?${new URLSearchParams({ workspace: search.workspace })}` : ""}`}
          className="mt-4 inline-block text-blue-700 underline"
        >
          表示をリセット
        </Link>
      </>
    );
  }
  const base = `/projects/${id}/gantt`;
  let name: string;
  let rows: GanttTask[];
  let nextCursor: string | null = null;
  let workspace: string | undefined;
  const cursor = typeof search.cursor === "string" ? search.cursor : undefined;
  let archived = false;
  if (connectedMode()) {
    if (!search.workspace || id.startsWith("demo-")) redirect("/projects");
    if (typeof search.workspace !== "string") notFound();
    workspace = search.workspace;
    let access;
    try {
      access = await taskAccess(workspace, id);
    } catch (error) {
      if (error instanceof ProjectError && error.status === 401)
        redirect("/login");
      if (error instanceof ProjectError && [400, 404].includes(error.status))
        notFound();
      throw error;
    }
    name = access.project.name;
    archived = access.project.status === "archived";
    if (cursor && !uuid.test(cursor))
      return <EmptyState title="ページ送りの条件を確認してください" />;
    let query = access.client
      .from("tasks")
      .select("id,title,status,start_date,due_date")
      .eq("workspace_id", workspace)
      .eq("project_id", id)
      .order("id")
      .limit(26);
    if (cursor) query = query.gt("id", cursor);
    const result = await query;
    if (result.error)
      throw new ProjectError(
        500,
        "READ_FAILED",
        "タスクの期間を取得できませんでした",
      );
    rows = result.data.slice(0, 25) as GanttTask[];
    if (result.data.length > 25) nextCursor = rows.at(-1)!.id;
  } else {
    const project = projects.find((p) => p.id === id);
    if (!project) notFound();
    name = project.name;
    rows =
      id === "demo-a"
        ? demoTasks.map((task, i) => ({
            id: task.id,
            title: task.title,
            status: (
              ["todo", "todo", "doing", "doing", "review", "done"] as const
            )[i],
            start_date: `2026-11-${String(1 + i * 2).padStart(2, "0")}`,
            due_date: `2026-11-${String(6 + i * 3).padStart(2, "0")}`,
          }))
        : [];
  }
  const suffix = workspace ? `?${new URLSearchParams({ workspace })}` : "";
  return (
    <>
      <PageHeading
        title="ガントチャート"
        description={`${name} · タスクの開始日と期限を比較します。`}
      />
      <div className="mb-6 flex flex-wrap gap-5 text-sm text-blue-700">
        <Link href={`/projects/${id}/board${suffix}`} className="underline">
          ← カンバンへ
        </Link>
        <Link href={`/projects/${id}/issues${suffix}`} className="underline">
          課題一覧へ →
        </Link>
      </div>
      {archived && (
        <p
          role="status"
          className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          アーカイブ済みのため閲覧のみ利用できます。
        </p>
      )}
      <GanttChart
        tasks={rows}
        options={options}
        base={base}
        workspace={workspace}
        cursor={cursor}
        nextCursor={nextCursor}
      />
    </>
  );
}
