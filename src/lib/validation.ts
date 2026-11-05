import { ProjectError } from "./projects-server";

export function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw new ProjectError(400, "INVALID_INPUT", "入力項目を確認してください");
}
export function parseVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647) throw new ProjectError(400, "INVALID_INPUT", "更新情報を確認してください");
  return value as number;
}
