import {projectAccess,ProjectError,uuid} from "./projects-server";
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
export async function readActivity(wid:string,query:URLSearchParams):Promise<ActivityPage> {
  const client=await projectAccess(wid);const invalid=()=>new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  const action=query.get("action")??"",entity=query.get("entity")??"",project=query.get("project")??"",actor=query.get("actor")??"";
  const raw=query.get("limit")??"25",limit=Number(raw),cursor=query.get("cursor");
  if([...query.keys()].some(k=>!["action","entity","project","actor","limit","cursor"].includes(k)||query.getAll(k).length>1)||
    (action&&!(activityActions as readonly string[]).includes(action))||(entity&&!(activityEntities as readonly string[]).includes(entity))||
    (project&&!uuid.test(project))||(actor&&!uuid.test(actor))||!/^\d+$/.test(raw)||limit<1||limit>100)throw invalid();
  let db=client.from("activity_logs").select("id,workspace_id,project_id,actor_id,actor_display_name,entity_type,entity_id,action,changes,created_at")
    .eq("workspace_id",wid).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit+1);
  if(action)db=db.eq("action",action);if(entity)db=db.eq("entity_type",entity);if(project)db=db.eq("project_id",project);if(actor)db=db.eq("actor_id",actor);
  if(cursor!==null){
    if(cursor.length>256||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw invalid();
    try{
      const value=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
      if(!value||typeof value.time!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.time)||!Number.isFinite(Date.parse(value.time))||value.time.startsWith("0000")||new Date(value.time).toISOString().slice(0,10)!==value.time.slice(0,10)||typeof value.id!=="string"||!uuid.test(value.id))throw invalid();
      db=db.or(`created_at.lt.${value.time},and(created_at.eq.${value.time},id.lt.${value.id})`);
    }catch{throw invalid();}
  }
  const result=await db;if(result.error)throw new ProjectError(500,"READ_FAILED","操作履歴を取得できませんでした");
  const data=result.data.slice(0,limit).map(row=>({...row,changes:{before:safeState(row.changes?.before,row.entity_type),after:safeState(row.changes?.after,row.entity_type)}})) as Activity[];
  const last=data.at(-1);return {data,nextCursor:result.data.length>limit&&last?Buffer.from(JSON.stringify({time:last.created_at,id:last.id})).toString("base64url"):null};
}
