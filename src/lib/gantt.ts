export type GanttUnit = "day" | "week";
export type GanttOptions = { start: string; end: string; unit: GanttUnit };
export type GanttTask = {
  id: string;
  title: string;
  status: "todo" | "doing" | "review" | "done";
  start_date?: string | null;
  due_date: string | null;
};
const dayMs = 86_400_000;
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function addDays(day: string, amount: number): string | null {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}
export function daysBetween(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / dayMs;
}
export function japaneseToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function ganttOptions(
  search: Record<string, string | string[] | undefined>,
  today = japaneseToday(),
): GanttOptions {
  if (
    Object.entries(search).some(
      ([key, value]) =>
        !["workspace", "start", "unit", "cursor"].includes(key) ||
        Array.isArray(value),
    )
  )
    throw new Error("表示条件を確認してください");
  const unit = search.unit ?? "day";
  const start = search.start ?? today;
  if (
    typeof start !== "string" ||
    !validDay(start) ||
    typeof unit !== "string" ||
    !["day", "week"].includes(unit)
  )
    throw new Error("表示条件を確認してください");
  const end = addDays(start, unit === "day" ? 13 : 83);
  if (!end) throw new Error("表示期間が日付の範囲を超えています");
  return { start, end, unit: unit as GanttUnit };
}
export function taskBar(task: GanttTask, range: GanttOptions) {
  if (!task.start_date || !task.due_date) return null;
  if (task.due_date < range.start || task.start_date > range.end) return null;
  const first = task.start_date < range.start ? range.start : task.start_date;
  const last = task.due_date > range.end ? range.end : task.due_date;
  const days = daysBetween(range.start, range.end) + 1;
  return {
    left: (daysBetween(range.start, first) / days) * 100,
    width: ((daysBetween(first, last) + 1) / days) * 100,
  };
}
