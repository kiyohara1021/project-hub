import { PageHeading } from "@/components/page-parts";
import { ProjectList } from "@/components/project-list";
export const metadata = { title: "プロジェクト一覧" };
export default function Projects() { return <><PageHeading title="プロジェクト一覧" description="プロジェクトを選ぶとカンバンを確認できます。作成・編集は次の段階で実装します。" /><ProjectList /></>; }
