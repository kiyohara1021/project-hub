import {apiError,checkOrigin,json,readJson,idempotencyKey} from "@/lib/projects-server";
import {issueAccess,queryIssues,validateIssue} from "@/lib/issues-server";
import {taskRpcError} from "@/lib/tasks-server";
type Context={params:Promise<{wid:string;pid:string}>};
export async function GET(request:Request,{params}:Context) {
  try {const {wid,pid}=await params;const {client}=await issueAccess(wid,pid);return json(await queryIssues(client,wid,pid,new URL(request.url).searchParams));}
  catch(error){return apiError(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    checkOrigin(request);const {wid,pid}=await params;const {client}=await issueAccess(wid,pid,true);
    const key = idempotencyKey(request);
    const input=validateIssue(await readJson(request));
    const result=await client.rpc("create_issue_once",{p_workspace_id:wid,p_project_id:pid,p_title:input.title,p_description:input.description,p_priority:input.priority,p_assignee_id:input.assignee_id,p_due_date:input.due_date,p_key:key});
    if(result.error) throw taskRpcError(result.error);return json({data:result.data},201);
  } catch(error){return apiError(error);}
}
