import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-semibold tracking-wider text-blue-700">
        PROJECT HUB
      </p>
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

export function EmptyState({
  title = "該当するデータがありません",
  description = "検索条件を変えてお試しください。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed bg-white px-6 py-16 text-center"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function DataList({
  title,
  headings,
  rows,
}: {
  title: string;
  headings: string[];
  rows: string[][];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="hidden md:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {headings.map((h) => (
                  <th
                    scope="col"
                    key={h}
                    className="border-b bg-slate-50 px-4 py-3 font-medium text-slate-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b px-4 py-6">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-4 md:hidden">
          {rows.map((row, i) => (
            <li key={i} className="rounded-lg border p-4">
              <dl className="space-y-3">
                {row.map((cell, j) => (
                  <div key={j}>
                    <dt className="text-xs text-slate-500">{headings[j]}</dt>
                    <dd className="mt-1 break-words text-sm">{cell}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-slate-500">
          全{rows.length}件 · サンプルデータ
        </p>
      </CardContent>
    </Card>
  );
}
