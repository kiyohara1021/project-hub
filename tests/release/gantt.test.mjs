import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  ganttOptions,
  taskBar,
} from "../../src/lib/gantt.ts";

test("ガントの暦日計算はうるう年・年境界・日付範囲と不正な条件を扱う", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("0001-01-01", -1), null);
  assert.equal(addDays("9999-12-31", 1), null);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.deepEqual(ganttOptions({ unit: "week", start: "2026-11-01" }), {
    start: "2026-11-01",
    end: "2027-01-23",
    unit: "week",
  });
  for (const search of [
    { start: "2026-02-30" },
    { start: "0000-01-01" },
    { start: "9999-12-31" },
    { unit: "month" },
    { unit: ["day", "week"] },
    { unknown: "x" },
  ])
    assert.throws(() => ganttOptions(search));
});
test("期間の棒は両端を含み、表示範囲内へ切り詰める", () => {
  const range = ganttOptions({ start: "2026-11-01" });
  const task = {
    id: "a",
    title: "期間確認",
    status: "todo",
    start_date: "2026-10-01",
    due_date: "2026-12-01",
  };
  assert.deepEqual(taskBar(task, range), { left: 0, width: 100 });
  const single = taskBar(
    { ...task, start_date: "2026-11-14", due_date: "2026-11-14" },
    range,
  );
  assert.equal(single.left, (13 / 14) * 100);
  assert.equal(single.width, (1 / 14) * 100);
  assert.equal(taskBar({ ...task, start_date: null }, range), null);
  assert.equal(taskBar({ ...task, start_date: "2026-12-01" }, range), null);
});
