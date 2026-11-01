import { notFound } from "next/navigation";
import Link from "next/link";
import { projects } from "@/lib/demo-data";
import { PageHeading } from "@/components/page-parts";
import { Kanban } from "@/components/kanban";
export const metadata = { title: "カンバン" };
export default async function Board({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = projects.find(p => p.id === id);
  if (!project) notFound();
  return <><PageHeading title="カンバン" description={`${project.name} · タスクのプレビューです。追加・移動・編集は未実装です。`} /><div className="mb-6 flex gap-5 text-sm text-blue-700"><Link href="/projects" className="hover:underline">← 一覧に戻る</Link><Link href={`/projects/${id}/issues`} className="hover:underline">このプロジェクトの課題 →</Link></div><Kanban populated={id === "demo-a"} /></>;
}
