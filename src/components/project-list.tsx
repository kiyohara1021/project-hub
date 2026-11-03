"use client";

import Link from "next/link";
import { useState } from "react";
import { projects } from "@/lib/demo-data";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/page-parts";

export function ProjectList() {
  const [query, setQuery] = useState("");
  const filtered = projects.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div className="mb-6 max-w-md"><label htmlFor="project-search" className="mb-2 block text-sm font-medium">プロジェクト名で検索</label><Input id="project-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="例: サンプルプロジェクトA" type="search" /><p className="mt-2 text-xs text-slate-500" role="status">{filtered.length}件のプロジェクト</p></div>
    {filtered.length === 0 ? <EmptyState /> : <div className="grid gap-4 lg:grid-cols-2">{filtered.map(p => <Card key={p.id}><CardContent className="pt-6"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">進行中</span><h2 className="mb-2 mt-5 text-lg font-semibold"><Link href={`/projects/${p.id}/board`} className="hover:text-blue-700 hover:underline">{p.name}</Link></h2><p className="text-sm text-slate-500">{p.description}</p><div className="mt-6 flex justify-between gap-3 text-sm"><span>完了率 {p.progress}%</span><span className="text-slate-500">期限 {p.due}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-blue-600" style={{width: `${p.progress}%`}} /></div><div className="mt-6 flex gap-5 text-sm font-medium text-blue-700"><Link href={`/projects/${p.id}/board`} className="hover:underline">カンバン →</Link><Link href={`/projects/${p.id}/issues`} className="hover:underline">課題一覧 →</Link></div></CardContent></Card>)}</div>}
  </>;
}
