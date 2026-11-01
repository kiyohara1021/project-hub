import {statusLabels} from "./project-types";
import {taskLabels} from "./task-types";
import {issueLabels} from "./issue-types";
import {memberLabels} from "./member-types";

export const activityEntities=["projects","tasks","issues","memberships"] as const;
export const activityActions=["INSERT","UPDATE","DELETE"] as const;
export type ActivityEntity=typeof activityEntities[number];
export type ActivityAction=typeof activityActions[number];
export const entityLabels:Record<ActivityEntity,string>={projects:"プロジェクト",tasks:"タスク",issues:"課題",memberships:"メンバー"};
export const actionLabels:Record<ActivityAction,string>={INSERT:"追加",UPDATE:"更新",DELETE:"削除"};
export type ActivityState={status?:string;role?:string;version?:number};
export type Activity={id:string;workspace_id:string;project_id:string|null;actor_id:string|null;actor_display_name:string;entity_type:ActivityEntity;entity_id:string;action:ActivityAction;changes:{before:ActivityState;after:ActivityState};created_at:string};
export type ActivityPage={data:Activity[];nextCursor:string|null};

export function changeSummary(event:Activity) {
  const labels:Record<string,string>=event.entity_type==="projects"?statusLabels:event.entity_type==="tasks"?taskLabels:issueLabels;
  const state=(value:ActivityState)=>value.role?`ロール: ${memberLabels[value.role as keyof typeof memberLabels]??"不明"}`:value.status?`状態: ${labels[value.status]??"不明"}`:"";
  const before=state(event.changes.before),after=state(event.changes.after);
  if(event.action==="INSERT")return after||"新規登録";
  if(event.action==="DELETE")return before?`${before} → 削除`:"削除";
  if(before!==after)return `${before||"未設定"} → ${after||"未設定"}`;
  return "内容を更新（詳細値は記録対象外）";
}
