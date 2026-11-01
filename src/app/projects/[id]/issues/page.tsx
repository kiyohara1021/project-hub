import { notFound } from "next/navigation";
import Link from "next/link";
import { projects } from "@/lib/demo-data";
import { PageHeading, DataList, EmptyState } from "@/components/page-parts";
export const metadata = { title: "課題一覧" };
export default async function Issues({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = projects.find(p => p.id === id);
  if (!project) notFound();
  return <><PageHeading title="課題一覧" description={`${project.name} · 課題の状況を確認するプレビューです。`} /><Link href={`/projects/${id}/board`} className="mb-6 inline-block text-sm text-blue-700 hover:underline">← カンバンに戻る</Link>{id !== "demo-a" ? <EmptyState title="課題はまだありません" description="現在は架空プロジェクトAにだけサンプルを用意しています。" /> : <DataList title="未解決の課題" headings={["課題 / 優先度", "状態", "担当", "期限"]} rows={[["ISS-001 入力仕様を確認 / 高", "調査中", "デモメンバー01", "2026/11/05"], ["ISS-002 空表示を改善 / 中", "未解決", "デモメンバー02", "2026/11/10"], ["ISS-003 文言を統一 / 低", "未解決", "未割当", "2026/11/15"]]} />}</>;
}
