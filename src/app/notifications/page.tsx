import Link from "next/link";
import { redirect } from "next/navigation";
import { connectedMode } from "@/lib/supabase/config";
import { readNotifications } from "@/lib/notifications-server";
import { ProjectError } from "@/lib/projects-server";
import { PageHeading, EmptyState } from "@/components/page-parts";
import { NotificationsList } from "@/components/notifications-list";

export const metadata = { title: "通知" };
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const heading = (
    <PageHeading
      title="通知"
      description="自分への担当割当と、参加中の課題の新しいコメントを確認できます。"
    />
  );
  if (!connectedMode())
    return (
      <>
        {heading}
        <EmptyState
          title="通知はありません"
          description="画面デモでは通知の作成・既読の保存は利用できません。"
        />
      </>
    );
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.set(key, value);
  }
  let page;
  try {
    page = await readNotifications(query);
  } catch (error) {
    if (error instanceof ProjectError && error.status === 401)
      redirect("/login");
    if (error instanceof ProjectError && error.status === 400)
      return (
        <>
          {heading}
          <EmptyState title="検索条件を確認してください" />
          <Link
            href="/notifications"
            className="mt-4 inline-block text-blue-700 underline"
          >
            検索をリセット
          </Link>
        </>
      );
    throw error;
  }
  const next = new URLSearchParams(query);
  if (page.nextCursor) next.set("cursor", page.nextCursor);
  const first = new URLSearchParams(query);
  first.delete("cursor");
  return (
    <>
      {heading}
      <NotificationsList
        key={query.toString()}
        page={page}
        unreadOnly={query.get("unread") === "1"}
      />
      <nav
        aria-label="通知のページ送り"
        className="mt-6 flex flex-wrap justify-between gap-4 text-sm text-blue-700 underline"
      >
        {query.has("cursor") && (
          <Link href={`/notifications${first.size ? `?${first}` : ""}`}>
            最初のページ
          </Link>
        )}
        {page.nextCursor && (
          <Link href={`/notifications?${next}`}>次のページ</Link>
        )}
      </nav>
    </>
  );
}
