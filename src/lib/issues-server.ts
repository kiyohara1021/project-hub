import { projectAccess, ProjectError, uuid, afterTimeCursor, encodeTimeCursor } from "./projects-server";
import { taskAccess, exactKeys, validateTask } from "./tasks-server";
import { priorities, type Priority } from "./task-types";
import { issueStatuses, type IssueStatus, type Issue, type IssuePage } from "./issue-types";

const fields="id,workspace_id,project_id,title,description,status,priority,assignee_id,due_date,version,created_at";
export function issueAccess(wid:string,pid:string,write=false) { return taskAccess(wid,pid,write,"issue"); }
export function validateIssue(value:Record<string,unknown>,edit=false) {
  exactKeys(value,["title","description","priority","assignee_id","due_date",...(edit?["status","version"]:[])]);
  const common={...value}; delete common.status;
  const input=validateTask(common,edit);
  if(edit && (typeof value.status!=="string" || !issueStatuses.includes(value.status as IssueStatus))) throw new ProjectError(400,"INVALID_INPUT","課題の状態を確認してください");
  return {...input,...(edit?{status:value.status as IssueStatus}:{})};
}
export async function readIssue(wid:string,pid:string,iid:string) {
  const {client}=await issueAccess(wid,pid);
  if(!uuid.test(iid)) throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
  const result=await client.from("issues").select(fields).eq("workspace_id",wid).eq("project_id",pid).eq("id",iid).maybeSingle();
  if(result.error) throw new ProjectError(500,"READ_FAILED","課題を取得できませんでした");
  if(!result.data) throw new ProjectError(404,"NOT_FOUND","見つかりませんでした");
  return result.data as Issue;
}
export async function queryIssues(client:Awaited<ReturnType<typeof projectAccess>>,wid:string,pid:string,query:URLSearchParams):Promise<IssuePage> {
  const status=query.get("status")??"unresolved"; const priority=query.get("priority")??""; const assignee=query.get("assignee")??""; const q=query.get("q")??"";
  const limitText=query.get("limit")??"25"; const limit=Number(limitText); const cursor=query.get("cursor");
  const invalid=()=>new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  if([...query.keys()].some(k=>!["q","status","priority","assignee","limit","cursor"].includes(k)||query.getAll(k).length>1)||![...issueStatuses,"unresolved","all"].includes(status)|| (priority&&!priorities.includes(priority as Priority)) || (assignee&&assignee!=="unassigned"&&!uuid.test(assignee)) || q.length>120 || !/^\d+$/.test(limitText)||limit<1||limit>100) throw invalid();
  let db=client.from("issues").select(fields).eq("workspace_id",wid).eq("project_id",pid).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit+1);
  if(status==="unresolved") db=db.in("status",["open","investigating"]); else if(status!=="all") db=db.eq("status",status);
  if(priority) db=db.eq("priority",priority);
  if(assignee) db=assignee==="unassigned"?db.is("assignee_id",null):db.eq("assignee_id",assignee);
  if(q) db=db.ilike("title",`%${q.replace(/[\\%_]/g,"\\$&")}%`);
  if(cursor) db=db.or(afterTimeCursor(cursor));
  const result=await db;
  if(result.error) throw new ProjectError(500,"READ_FAILED","課題を取得できませんでした");
  const rows=result.data.slice(0,limit) as Issue[]; const last=rows.at(-1);
  return {data:rows,nextCursor:result.data.length>limit&&last?encodeTimeCursor(last):null};
}
