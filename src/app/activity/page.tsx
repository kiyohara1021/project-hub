import { connectedMode } from "@/lib/supabase/config";
import { ConnectedActivity } from "@/components/connected-activity";
import { PageHeading, DataList } from "@/components/page-parts";
export const metadata = { title: "操作履歴" };
export default async function Activity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (connectedMode()) return <ConnectedActivity search={await searchParams} />;
  return (
    <>
      <PageHeading
        title="操作履歴"
        description="操作履歴の表示例です。サンプルデータを使って、履歴の見え方を確認できます。"
      />
      <DataList
        title="最近の操作"
        headings={["日時 / 操作者", "対象", "操作", "変更内容"]}
        rows={[
          [
            "11/01 10:30 デモメンバー01",
            "TASK-001",
            "状態更新",
            "未着手 → 進行中",
          ],
          ["11/01 09:20 デモメンバー02", "TASK-002", "担当変更", "未割当 → 02"],
          [
            "11/01 09:00 デモメンバー01",
            "サンプルプロジェクトA",
            "作成",
            "新規登録",
          ],
        ]}
      />
    </>
  );
}
