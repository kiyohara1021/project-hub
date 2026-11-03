import {projectAccess,ProjectError,uuid,afterTimeCursor,encodeTimeCursor} from "./projects-server";
import {activityEntities,activityActions,type Activity,type ActivityPage,type ActivityState} from "./activity-types";
import {projectStatuses} from "./project-types";
import {taskStatuses} from "./task-types";
import {issueStatuses} from "./issue-types";
import {memberRoles} from "./member-types";

// 本文や将来の非公開フィールドを応答へ混入させない。
function safeState(value:unknown,entity:string):ActivityState {
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const raw=value as Record<string,unknown>;const result:ActivityState={};
  const statuses:readonly string[]=entity==="projects"?projectStatuses:entity==="tasks"?taskStatuses:entity==="issues"?issueStatuses:[];
  if(typeof raw.status==="string"&&statuses.includes(raw.status))result.status=raw.status;
  if(entity==="memberships"&&typeof raw.role==="string"&&(memberRoles as readonly string[]).includes(raw.role))result.role=raw.role;
  if(Number.isSafeInteger(raw.version)&&Number(raw.version)>0)result.version=Number(raw.version);
  return result;
}
// 日本時間の暦日を検証し、DBの日時比較に使う境界を返す。
function dateBoundary(value:string,end:boolean):string|null {
  if(!value)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith("0000"))throw new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  const utc=new Date(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(utc.getTime())||utc.toISOString().slice(0,10)!==value)throw new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  // PostgreSQLに暦日とオフセットを渡す。24:00は翌日0時で、年端もDB側で扱う。
  return `${value}T${end?"24":"00"}:00:00+09:00`;
}
export async function readActivity(wid:string,query:URLSearchParams):Promise<ActivityPage> {
  const client=await projectAccess(wid);const invalid=()=>new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  const action=query.get("action")??"",entity=query.get("entity")??"",project=query.get("project")??"",actor=query.get("actor")??"";
  const from=query.get("from")??"",to=query.get("to")??"";
  const start=dateBoundary(from,false),end=dateBoundary(to,true);
  if(from&&to&&from>to)throw invalid();
  const raw=query.get("limit")??"25",limit=Number(raw),cursor=query.get("cursor");
  if([...query.keys()].some(k=>!["action","entity","project","actor","from","to","limit","cursor"].includes(k)||query.getAll(k).length>1)||
    (action&&!(activityActions as readonly string[]).includes(action))||(entity&&!(activityEntities as readonly string[]).includes(entity))||
    (project&&!uuid.test(project))||(actor&&!uuid.test(actor))||!/^\d+$/.test(raw)||limit<1||limit>100)throw invalid();
  let db=client.from("activity_logs").select("id,workspace_id,project_id,actor_id,actor_display_name,entity_type,entity_id,action,changes,created_at")
    .eq("workspace_id",wid).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit+1);
  if(action)db=db.eq("action",action);if(entity)db=db.eq("entity_type",entity);if(project)db=db.eq("project_id",project);if(actor)db=db.eq("actor_id",actor);
  if(start)db=db.gte("created_at",start);if(end)db=db.lt("created_at",end);
  if(cursor!==null)db=db.or(afterTimeCursor(cursor));
  const result=await db;if(result.error)throw new ProjectError(500,"READ_FAILED","操作履歴を取得できませんでした");
  const data=result.data.slice(0,limit).map(row=>({...row,changes:{before:safeState(row.changes?.before,row.entity_type),after:safeState(row.changes?.after,row.entity_type)}})) as Activity[];
  const last=data.at(-1);return {data,nextCursor:result.data.length>limit&&last?encodeTimeCursor(last):null};
}
