import { PageHeading } from "@/components/page-parts";
import { ProjectList } from "@/components/project-list";
import { connectedMode } from "@/lib/supabase/config";
import { ConnectedProjectList } from "@/components/connected-project-list";
export const metadata = { title: "プロジェクト一覧" };
export default async function Projects({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (connectedMode()) return <ConnectedProjectList search={await searchParams} />;
  return <><PageHeading title="プロジェクト一覧" description="架空の固定プレビューです。プロジェクトを選ぶとカンバンを確認できます。" /><ProjectList /></>;
}
