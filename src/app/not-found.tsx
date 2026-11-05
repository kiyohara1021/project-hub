import Link from "next/link";
export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-medium text-blue-700">404</p>
      <h1 className="my-4 text-2xl font-bold">ページが見つかりません</h1>
      <p className="mb-6 text-sm text-slate-500">URLをご確認ください。</p>
      <Link href="/projects" className="text-blue-700 underline">
        プロジェクト一覧へ戻る
      </Link>
    </div>
  );
}
