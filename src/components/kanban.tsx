"use client";
import { useState } from "react";
import { columns, tasks } from "@/lib/demo-data";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/page-parts";

export function Kanban({ populated }: { populated: boolean }) {
  const [column, setColumn] = useState<string>(columns[0]);
  if (!populated)
    return (
      <EmptyState
        title="タスクはまだありません"
        description="このプロジェクトのタスクは今後追加します。現在はプレビュー表示です。"
      />
    );
  return (
    <>
      <div className="mb-5 md:hidden">
        <label
          htmlFor="board-column"
          className="mb-2 block text-sm font-medium"
        >
          表示する状態
        </label>
        <select
          id="board-column"
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          className="h-11 w-full rounded-md border bg-white px-3 text-sm"
        >
          {columns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((c) => (
          <section
            key={c}
            aria-label={c}
            className={`min-w-0 rounded-xl bg-slate-200/60 p-3 ${column !== c ? "hidden md:block" : ""}`}
          >
            <h2 className="mb-4 flex items-center justify-between px-1 text-sm font-semibold">
              {c}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs">
                {tasks.filter((t) => t.status === c).length}
              </span>
            </h2>
            <ul className="space-y-3">
              {tasks
                .filter((t) => t.status === c)
                .map((t) => (
                  <li key={t.id}>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-[11px] text-slate-500">{t.id}</p>
                        <h3 className="my-3 text-sm font-semibold leading-6">
                          {t.title}
                        </h3>
                        <p className="text-xs text-blue-700">優先度: 中</p>
                        <p className="mt-4 text-xs text-slate-500">
                          {t.assignee}
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
