import { connectedMode } from "@/lib/supabase/config";
import { ConnectedMembers } from "@/components/connected-members";
import { PageHeading, DataList } from "@/components/page-parts";
export const metadata = { title: "メンバー" };
export default async function Members({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) { if(connectedMode())return <ConnectedMembers search={await searchParams}/>; return <><PageHeading title="メンバー" description="メンバー一覧の表示例です。ユーザー追加・権限変更は未接続です。" /><DataList title="メンバー一覧" headings={["表示名", "ロール", "担当タスク", "参加日"]} rows={[["デモメンバー01", "管理者", "4件", "2026/10/01"], ["デモメンバー02", "メンバー", "2件", "2026/10/02"], ["デモメンバー03", "閲覧者", "0件", "2026/10/03"]]} /></>; }
