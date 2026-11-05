import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfig } from "@/lib/supabase/config";
import { taskAccess, queryTasks } from "@/lib/tasks-server";
import { ProjectError } from "@/lib/projects-server";
import { PageHeading, EmptyState } from "@/components/page-parts";
import {
  taskStatuses,
  priorities,
  priorityLabels,
  type BoardPages,
  type TaskStatus,
} from "@/lib/task-types";
import { ConnectedKanban } from "./connected-kanban";

export async function ConnectedBoardPage({
  id,
  search,
}: {
  id: string;
  search: Record<string, string | string[] | undefined>;
}) {
  if (!supabaseConfig())
    return (
      <EmptyState
        title="接続設定がありません"
        description="ローカル接続設定を確認してください。"
      />
    );
  if (id === "demo-a" || !search.workspace) redirect("/projects");
  if (typeof search.workspace !== "string") notFound();
  const wid = search.workspace;
  let access;
  try {
    access = await taskAccess(wid, id);
  } catch (error) {
    if (error instanceof ProjectError && error.status === 401)
      redirect("/login");
    if (error instanceof ProjectError && [400, 404].includes(error.status))
      notFound();
    throw error;
  }
  const { client, project } = access;
  const column = search.column ?? "todo";
  if (
    typeof column !== "string" ||
    !taskStatuses.includes(column as TaskStatus)
  )
    return (
      <>
        <EmptyState title="表示する状態を確認してください" />
        <Link
          href={`/projects/${id}/board?workspace=${wid}`}
          className="mt-4 inline-block text-blue-700 underline"
        >
          表示をリセット
        </Link>
      </>
    );
  const filters = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === "workspace" || key === "column" || value === undefined)
      continue;
    if (typeof value !== "string" || !["assignee", "priority"].includes(key))
      return (
        <EmptyState
          title="検索条件を確認してください"
          description="担当者・優先度を選び直してください。"
        />
      );
    if (value) filters.set(key, value);
  }
  let pages;
  try {
    pages = await Promise.all(
      taskStatuses.map((status) =>
        queryTasks(
          client,
          wid,
          id,
          new URLSearchParams({ ...Object.fromEntries(filters), status }),
        ),
      ),
    );
  } catch (error) {
    if (error instanceof ProjectError && error.status === 400)
      return (
        <>
          <EmptyState title="検索条件を確認してください" />
          <Link
            href={`/projects/${id}/board?workspace=${wid}`}
            className="mt-4 inline-block text-blue-700 underline"
          >
            検索をリセット
          </Link>
        </>
      );
    throw error;
  }
  const user = await client.auth.getClaims();
  const memberRows = await client
    .from("memberships")
    .select("user_id,role")
    .eq("workspace_id", wid);
  if (memberRows.error) throw new Error("Member read failed");
  const profiles = await client
    .from("profiles")
    .select("id,display_name")
    .in(
      "id",
      memberRows.data.map((m) => m.user_id),
    );
  if (profiles.error) throw new Error("Profile read failed");
  const members = profiles.data.map((p) => ({
    id: p.id,
    name: p.display_name,
  }));
  const role = memberRows.data.find(
    (m) => m.user_id === user.data?.claims.sub,
  )?.role;
  const canWrite =
    ["admin", "member"].includes(role ?? "") && project.status !== "archived";
  const initial = Object.fromEntries(
    taskStatuses.map((s, i) => [s, pages[i]]),
  ) as BoardPages;
  return (
    <>
      <PageHeading
        title="カンバン"
        description={`${project.name} · 所属ワークスペースのタスクを表示しています。`}
      />
      <div className="mb-6 flex flex-wrap gap-5 text-sm text-blue-700">
        <Link href={`/projects?workspace=${wid}`} className="underline">
          ← プロジェクト一覧へ
        </Link>
        <Link
          href={`/projects/${id}/issues?workspace=${wid}`}
          className="underline"
        >
          課題一覧へ →
        </Link>
      </div>
      {project.status === "archived" && (
        <p
          role="status"
          className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          アーカイブ済みのため閲覧のみ利用できます。
        </p>
      )}
      <form
        key={filters.toString()}
        action={`/projects/${id}/board`}
        method="get"
        className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4"
      >
        <input type="hidden" name="workspace" value={wid} />
        <input type="hidden" name="column" value={column} />
        <div className="min-w-0 flex-1">
          <label
            htmlFor="assignee-filter"
            className="mb-2 block text-sm font-medium"
          >
            担当者で絞り込み
          </label>
          <select
            id="assignee-filter"
            name="assignee"
            defaultValue={filters.get("assignee") ?? ""}
            className="h-10 w-full rounded-md border px-2 text-sm"
          >
            <option value="">すべて</option>
            <option value="unassigned">未割当</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label
            htmlFor="priority-filter"
            className="mb-2 block text-sm font-medium"
          >
            優先度で絞り込み
          </label>
          <select
            id="priority-filter"
            name="priority"
            defaultValue={filters.get("priority") ?? ""}
            className="h-10 w-full rounded-md border px-2 text-sm"
          >
            <option value="">すべて</option>
            {priorities.map((p) => (
              <option key={p} value={p}>
                {priorityLabels[p]}
              </option>
            ))}
          </select>
        </div>
        <button
          className="h-10 rounded-lg bg-slate-900 px-4 text-sm text-white"
          type="submit"
        >
          絞り込む
        </button>
        <Link
          href={`/projects/${id}/board?workspace=${wid}`}
          className="self-center text-sm text-blue-700 underline"
        >
          リセット
        </Link>
      </form>
      <ConnectedKanban
        key={`${id}:${filters}:${project.status}:${column}`}
        base={`/api/v1/workspaces/${wid}/projects/${id}/tasks`}
        initial={initial}
        members={members}
        canWrite={canWrite}
        assignee={filters.get("assignee") ?? ""}
        priority={filters.get("priority") ?? ""}
        initialColumn={column as TaskStatus}
      />
    </>
  );
}
