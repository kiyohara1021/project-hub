import Link from "next/link";
import { EmptyState } from "@/components/page-parts";
import { taskLabels } from "@/lib/task-types";
import {
  addDays,
  taskBar,
  type GanttOptions,
  type GanttTask,
} from "@/lib/gantt";

export function GanttChart({
  tasks,
  options,
  base,
  workspace,
  cursor,
  nextCursor,
}: {
  tasks: GanttTask[];
  options: GanttOptions;
  base: string;
  workspace?: string;
  cursor?: string;
  nextCursor?: string | null;
}) {
  const count = options.unit === "day" ? 14 : 12;
  const step = options.unit === "day" ? 1 : 7;
  const previous = addDays(options.start, -count * step);
  const next = addDays(options.start, count * step);
  const link = (start: string, page?: string) => {
    const query = new URLSearchParams({ start, unit: options.unit });
    if (workspace) query.set("workspace", workspace);
    if (page) query.set("cursor", page);
    return `${base}?${query}`;
  };
  return (
    <>
      <form
        action={base}
        method="get"
        className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4"
      >
        {workspace && (
          <input type="hidden" name="workspace" value={workspace} />
        )}
        <div>
          <label
            htmlFor="gantt-start"
            className="mb-2 block text-sm font-medium"
          >
            表示の開始日
          </label>
          <input
            id="gantt-start"
            name="start"
            type="date"
            min="0001-01-01"
            max={options.unit === "day" ? "9999-12-18" : "9999-10-09"}
            defaultValue={options.start}
            required
            className="h-10 max-w-full rounded-md border px-3 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="gantt-unit"
            className="mb-2 block text-sm font-medium"
          >
            表示単位
          </label>
          <select
            id="gantt-unit"
            name="unit"
            defaultValue={options.unit}
            className="h-10 rounded-md border px-3 text-sm"
          >
            <option value="day">日（14日間）</option>
            <option value="week">週（12週間）</option>
          </select>
        </div>
        <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm text-white">
          表示する
        </button>
      </form>
      <nav
        aria-label="ガントの表示期間"
        className="mb-4 flex flex-wrap items-center gap-4 text-sm"
      >
        {previous && (
          <Link
            href={link(previous, cursor)}
            className="text-blue-700 underline"
          >
            ← 前の期間
          </Link>
        )}
        <p>
          {options.start}〜{options.end}
        </p>
        {next && addDays(next, count * step - 1) && (
          <Link href={link(next, cursor)} className="text-blue-700 underline">
            次の期間 →
          </Link>
        )}
      </nav>
      <p className="mb-3 text-sm text-slate-600">
        開始日と期限はカンバンのタスク編集で設定できます。日付が片方だけのタスクも一覧に表示します。
      </p>
      {!tasks.length ? (
        <EmptyState
          title="タスクはまだありません"
          description="カンバンでタスクを追加すると、ここに表示されます。"
        />
      ) : (
        <div
          role="region"
          aria-label="タスクの期間表（横にスクロールできます）"
          tabIndex={0}
          className="max-w-full overflow-x-auto rounded-xl border bg-white focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
            <caption className="sr-only">
              タスクの開始日と期限。{options.start}から{options.end}まで、
              {tasks.length}件を表示
            </caption>
            <colgroup>
              <col className="w-64" />
              {Array.from({ length: count }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 border-b bg-slate-100 p-3 text-left"
                >
                  タスク・期間
                </th>
                {Array.from({ length: count }, (_, i) => {
                  const day = addDays(options.start, i * step)!;
                  return (
                    <th
                      scope="col"
                      key={day}
                      className="border-b border-l bg-slate-100 p-2 font-medium"
                    >
                      <time dateTime={day}>
                        {day.slice(5).replace("-", "/")}
                      </time>
                      {options.unit === "week" && (
                        <span className="block text-xs">の週</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const bar = taskBar(task, options);
                return (
                  <tr key={task.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b bg-white p-3 text-left font-normal"
                    >
                      <span className="block break-words font-medium">
                        {task.title}
                      </span>
                      <span className="mt-1 block text-xs text-slate-600">
                        {taskLabels[task.status]}
                      </span>
                      <span className="mt-1 block text-xs text-slate-600">
                        開始日：{task.start_date ?? "未設定"}
                        <br />
                        期限：{task.due_date ?? "未設定"}
                      </span>
                    </th>
                    <td
                      colSpan={count}
                      className="relative border-b bg-slate-50 p-2 text-center"
                    >
                      {bar ? (
                        <span
                          aria-hidden="true"
                          className={`absolute top-1/2 h-7 -translate-y-1/2 rounded ${task.status === "done" ? "bg-emerald-600" : "bg-blue-600"}`}
                          style={{
                            left: `${bar.left}%`,
                            width: `${bar.width}%`,
                          }}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">
                          {!task.start_date || !task.due_date
                            ? "期間未設定"
                            : "表示期間外"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(cursor || nextCursor) && (
        <nav
          aria-label="ガントのページ送り"
          className="mt-4 flex gap-5 text-sm"
        >
          {cursor && (
            <Link
              href={link(options.start)}
              className="text-blue-700 underline"
            >
              最初のページ
            </Link>
          )}
          {nextCursor && (
            <Link
              href={link(options.start, nextCursor)}
              className="text-blue-700 underline"
            >
              次の25件 →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
