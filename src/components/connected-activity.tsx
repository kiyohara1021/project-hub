import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { readActivity } from "@/lib/activity-server";
import { ProjectError, uuid } from "@/lib/projects-server";
import {
  activityEntities,
  activityActions,
  entityLabels,
  actionLabels,
  changeSummary,
} from "@/lib/activity-types";
import { PageHeading, EmptyState } from "./page-parts";
import { Button } from "./ui/button";

export async function ConnectedActivity({
  search,
}: {
  search: Record<string, string | string[] | undefined>;
}) {
  if (!supabaseConfig()) return <EmptyState title="接続設定がありません" />;
  const client = await supabaseServer();
  const auth = await client.auth.getClaims();
  if (auth.error || !auth.data?.claims.sub) redirect("/login");
  const spaces = await client
    .from("workspaces")
    .select("id,name")
    .order("created_at")
    .order("id");
  if (spaces.error) throw new Error("Workspace read failed");
  if (Array.isArray(search.workspace)) notFound();
  const wid = search.workspace ?? spaces.data[0]?.id;
  if (!wid)
    return (
      <>
        <PageHeading
          title="操作履歴"
          description="所属先の操作を確認します。"
        />
        <EmptyState title="所属ワークスペースがありません" />
      </>
    );
  const workspace = spaces.data.find((s) => s.id === wid);
  if (!workspace) notFound();
  const query = new URLSearchParams();
  let invalid = false;
  for (const [key, value] of Object.entries(search)) {
    if (key === "workspace" || value === undefined) continue;
    if (typeof value !== "string") {
      invalid = true;
      break;
    }
    query.set(key, value);
  }
  let page;
  try {
    if (invalid) throw new ProjectError(400, "INVALID_INPUT", "");
    page = await readActivity(wid, query);
  } catch (e) {
    if (e instanceof ProjectError && e.status === 400)
      return (
        <>
          <PageHeading title="操作履歴" description={workspace.name} />
          <EmptyState title="検索条件を確認してください" />
          <Link
            href={`/activity?workspace=${wid}`}
            className="mt-4 inline-block text-blue-700 underline"
          >
            検索をリセット
          </Link>
        </>
      );
    throw e;
  }
  function href(updates: Record<string, string | null>) {
    const next = new URLSearchParams(query);
    next.set("workspace", wid);
    next.delete("cursor");
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/activity?${next}`;
  }
  const next = new URLSearchParams(query);
  next.set("workspace", wid);
  if (page.nextCursor) next.set("cursor", page.nextCursor);
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  return (
    <>
      <PageHeading
        title="操作履歴"
        description={`${workspace.name}の操作記録です。アーカイブ・削除済みの対象も含みます。`}
      />
      <form
        key={wid}
        action="/activity"
        className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4"
      >
        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
          <label htmlFor="activity-workspace" className="mb-2 block text-sm">
            ワークスペース
          </label>
          <select
            id="activity-workspace"
            name="workspace"
            defaultValue={wid}
            className="h-10 w-full rounded-md border px-2"
          >
            {spaces.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">所属先を切り替える</Button>
      </form>
      <form
        key={`${wid}-${query}`}
        action="/activity"
        className="mb-5 grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2"
      >
        <input type="hidden" name="workspace" value={wid} />
        <input type="hidden" name="limit" value={query.get("limit") ?? "25"} />
        {query.get("actor") && (
          <input type="hidden" name="actor" value={query.get("actor")!} />
        )}
        {query.get("project") && (
          <input type="hidden" name="project" value={query.get("project")!} />
        )}
        <div>
          <label htmlFor="activity-entity" className="mb-2 block text-sm">
            対象種別で絞り込み
          </label>
          <select
            id="activity-entity"
            name="entity"
            defaultValue={query.get("entity") ?? ""}
            className="h-10 w-full rounded-md border px-2"
          >
            <option value="">すべて</option>
            {activityEntities.map((e) => (
              <option key={e} value={e}>
                {entityLabels[e]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="activity-action" className="mb-2 block text-sm">
            操作で絞り込み
          </label>
          <select
            id="activity-action"
            name="action"
            defaultValue={query.get("action") ?? ""}
            className="h-10 w-full rounded-md border px-2"
          >
            <option value="">すべて</option>
            {activityActions.map((a) => (
              <option key={a} value={a}>
                {actionLabels[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="activity-from" className="mb-2 block text-sm">
            開始日（日本時間）
          </label>
          <input
            id="activity-from"
            name="from"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            defaultValue={query.get("from") ?? ""}
            className="h-10 w-full min-w-0 rounded-md border px-2"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="activity-to" className="mb-2 block text-sm">
            終了日（日本時間）
          </label>
          <input
            id="activity-to"
            name="to"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            defaultValue={query.get("to") ?? ""}
            className="h-10 w-full min-w-0 rounded-md border px-2"
          />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">
          開始日・終了日の両方を含みます。空欄側の期間は制限しません。
        </p>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <Button type="submit">絞り込む</Button>
          <Link
            href={`/activity?workspace=${wid}`}
            className="text-sm text-blue-700 underline"
          >
            リセット
          </Link>
          <span className="text-xs text-slate-500">
            操作者・プロジェクトの条件は、履歴内のリンクから指定できます。
          </span>
        </div>
      </form>
      <div className="mb-5 flex flex-wrap gap-3 text-sm">
        {query.get("actor") && (
          <Link
            href={href({ actor: null })}
            className="rounded-md border bg-white px-3 py-2 text-blue-700 underline"
          >
            操作者の絞り込みを解除
          </Link>
        )}
        {query.get("project") && (
          <Link
            href={href({ project: null })}
            className="rounded-md border bg-white px-3 py-2 text-blue-700 underline"
          >
            プロジェクトの絞り込みを解除
          </Link>
        )}
      </div>
      <p className="mb-5 text-xs leading-6 text-slate-500">
        日時は日本時間、操作者名は操作当時の記録です。変更内容は状態・ロールを表示し、本文などの詳細値は記録しません。この履歴は編集・削除できません。
      </p>
      {!page.data.length ? (
        <EmptyState
          title="操作履歴がありません"
          description="条件を変更するか、対象の操作後に再度確認してください。"
        />
      ) : (
        <ol aria-label="操作履歴の一覧" className="space-y-4">
          {page.data.map((event) => (
            <li key={event.id}>
              <article
                aria-label={`${entityLabels[event.entity_type]}の${actionLabels[event.action]}`}
                className="space-y-3 rounded-xl border bg-white p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="font-semibold">
                    {event.entity_type === "memberships" &&
                    event.action === "DELETE"
                      ? "メンバーの所属を解除"
                      : `${entityLabels[event.entity_type]}を${actionLabels[event.action]}`}
                  </h2>
                  <time
                    dateTime={event.created_at}
                    className="text-xs text-slate-500"
                  >
                    {dateTime(event.created_at)}
                  </time>
                </div>
                <p className="break-words text-sm">
                  操作者: {event.actor_display_name}
                </p>
                <p className="break-words text-sm">{changeSummary(event)}</p>
                <div className="flex flex-wrap gap-4 text-sm text-blue-700">
                  {event.actor_id && (
                    <Link
                      href={href({ actor: event.actor_id })}
                      className="underline"
                    >
                      この操作者で絞る
                    </Link>
                  )}
                  {event.project_id && (
                    <Link
                      href={href({ project: event.project_id })}
                      className="underline"
                    >
                      このプロジェクトで絞る
                    </Link>
                  )}
                  {event.project_id && uuid.test(event.project_id) && (
                    <Link
                      href={`/projects/${event.project_id}/${["issues", "issue_comments"].includes(event.entity_type) ? "issues" : "board"}?workspace=${wid}`}
                      className="underline"
                    >
                      現在のプロジェクトを開く
                    </Link>
                  )}
                </div>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer">記録の識別情報</summary>
                  <dl className="mt-3 space-y-2 break-all">
                    <div>
                      <dt>記録ID</dt>
                      <dd>{event.id}</dd>
                    </div>
                    <div>
                      <dt>対象ID</dt>
                      <dd>{event.entity_id}</dd>
                    </div>
                    {event.project_id && (
                      <div>
                        <dt>プロジェクトID</dt>
                        <dd>{event.project_id}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-2">
                    削除済みの対象は開けない場合があります。
                  </p>
                </details>
              </article>
            </li>
          ))}
        </ol>
      )}
      <nav
        aria-label="操作履歴のページ送り"
        className="mt-6 flex flex-wrap justify-between gap-4 text-sm"
      >
        <span>{page.data.length}件を表示</span>
        <div className="flex gap-4">
          {query.has("cursor") && (
            <Link href={href({})} className="text-blue-700 underline">
              最初のページ
            </Link>
          )}
          {page.nextCursor && (
            <Link
              href={`/activity?${next}`}
              className="text-blue-700 underline"
            >
              次のページ →
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}
