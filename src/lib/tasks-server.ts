import { exactKeys, parseVersion } from "./validation";
import {
  projectAccess,
  ProjectError,
  uuid,
  validateProject,
  rpcError,
} from "./projects-server";
import {
  priorities,
  taskStatuses,
  type Task,
  type TaskPage,
  type TaskStatus,
  type Priority,
} from "./task-types";

const fields =
  "id,workspace_id,project_id,title,description,status,priority,assignee_id,due_date,start_date,position,version";
export async function taskAccess(
  wid: string,
  pid: string,
  write = false,
  resource: "task" | "issue" = "task",
) {
  const client = await projectAccess(wid);
  if (!uuid.test(pid))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const project = await client
    .from("projects")
    .select("id,name,status,workspace_id,visibility")
    .eq("workspace_id", wid)
    .eq("id", pid)
    .maybeSingle();
  if (project.error)
    throw new ProjectError(
      500,
      "READ_FAILED",
      "プロジェクトを取得できませんでした",
    );
  if (!project.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  if (write) await projectAccess(wid, resource);
  if (write && project.data.status === "archived")
    throw new ProjectError(
      409,
      "PROJECT_ARCHIVED",
      "アーカイブ済みのプロジェクトは変更できません",
    );
  return { client, project: project.data };
}
export function taskRpcError(error: { code: string; message: string }) {
  if (error.code === "55000")
    return new ProjectError(
      409,
      "PROJECT_ARCHIVED",
      "アーカイブ済みのプロジェクトは変更できません",
    );
  if (error.code === "23503")
    return new ProjectError(
      400,
      "INVALID_ASSIGNEE",
      "担当者の所属を確認してください",
    );
  return rpcError(error);
}
export function validateTask(value: Record<string, unknown>, edit = false) {
  exactKeys(value, [
    "title",
    "description",
    "priority",
    "assignee_id",
    "due_date",
    ...(edit ? ["version"] : []),
    ...("start_date" in value ? ["start_date"] : []),
  ]);
  // 名前/本文/日付の上限はプロジェクトと共通。
  const common = validateProject({
    name: value.title,
    description: value.description,
    due_date: value.due_date,
  });
  if (
    typeof value.priority !== "string" ||
    !priorities.includes(value.priority as Priority) ||
    (value.assignee_id !== null &&
      (typeof value.assignee_id !== "string" || !uuid.test(value.assignee_id)))
  )
    throw new ProjectError(
      400,
      "INVALID_INPUT",
      "優先度と担当者を確認してください",
    );
  const startDate =
    "start_date" in value
      ? validateProject({
          name: value.title,
          description: "",
          due_date: value.start_date,
        }).due_date
      : undefined;
  if (startDate && common.due_date && startDate > common.due_date)
    throw new ProjectError(
      400,
      "INVALID_INPUT",
      "開始日は期限以前にしてください",
    );
  return {
    ...(startDate !== undefined ? { start_date: startDate } : {}),
    title: common.name,
    description: common.description,
    due_date: common.due_date,
    priority: value.priority as Priority,
    assignee_id: value.assignee_id as string | null,
    ...(edit ? { version: parseVersion(value.version) } : {}),
  };
}
export async function readTask(wid: string, pid: string, tid: string) {
  const { client } = await taskAccess(wid, pid);
  if (!uuid.test(tid))
    throw new ProjectError(400, "INVALID_INPUT", "IDを確認してください");
  const result = await client
    .from("tasks")
    .select(fields)
    .eq("workspace_id", wid)
    .eq("project_id", pid)
    .eq("id", tid)
    .maybeSingle();
  if (result.error)
    throw new ProjectError(500, "READ_FAILED", "タスクを取得できませんでした");
  if (!result.data)
    throw new ProjectError(404, "NOT_FOUND", "見つかりませんでした");
  return result.data as Task;
}
export async function queryTasks(
  client: Awaited<ReturnType<typeof projectAccess>>,
  wid: string,
  pid: string,
  query: URLSearchParams,
): Promise<TaskPage> {
  const status = query.get("status") ?? "todo";
  const priority = query.get("priority") ?? "";
  const assignee = query.get("assignee") ?? "";
  const limitText = query.get("limit") ?? "25";
  const limit = Number(limitText);
  const cursor = query.get("cursor");
  const invalid = () =>
    new ProjectError(400, "INVALID_INPUT", "検索条件を確認してください");
  if (
    [...query.keys()].some(
      (k) =>
        !["status", "priority", "assignee", "limit", "cursor"].includes(k) ||
        query.getAll(k).length > 1,
    ) ||
    !taskStatuses.includes(status as TaskStatus) ||
    (priority && !priorities.includes(priority as Priority)) ||
    (assignee && assignee !== "unassigned" && !uuid.test(assignee)) ||
    !/^\d+$/.test(limitText) ||
    limit < 1 ||
    limit > 100
  )
    throw invalid();
  let db = client
    .from("tasks")
    .select(fields)
    .eq("workspace_id", wid)
    .eq("project_id", pid)
    .eq("status", status)
    .order("position")
    .order("id")
    .limit(limit + 1);
  if (priority) db = db.eq("priority", priority);
  if (assignee)
    db =
      assignee === "unassigned"
        ? db.is("assignee_id", null)
        : db.eq("assignee_id", assignee);
  if (cursor) {
    if (cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(cursor))
      throw invalid();
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      );
      if (
        !Number.isSafeInteger(parsed.position) ||
        parsed.position < 0 ||
        typeof parsed.id !== "string" ||
        !uuid.test(parsed.id)
      )
        throw invalid();
      db = db.or(
        `position.gt.${parsed.position},and(position.eq.${parsed.position},id.gt.${parsed.id})`,
      );
    } catch {
      throw invalid();
    }
  }
  const result = await db;
  if (result.error)
    throw new ProjectError(500, "READ_FAILED", "タスクを取得できませんでした");
  const rows = result.data.slice(0, limit) as Task[];
  const last = rows.at(-1);
  return {
    data: rows,
    nextCursor:
      result.data.length > limit && last
        ? Buffer.from(
            JSON.stringify({ position: last.position, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
