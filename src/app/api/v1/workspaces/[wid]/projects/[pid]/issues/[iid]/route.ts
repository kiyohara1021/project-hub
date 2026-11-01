import {apiError,checkOrigin,json,readJson,ProjectError,uuid} from "@/lib/projects-server";
import {issueAccess,readIssue,validateIssue} from "@/lib/issues-server";
import {taskRpcError,exactKeys,taskVersion} from "@/lib/tasks-server";
type Context={params:Promise<{wid:string;pid:string;iid:string}>};
export async function GET(_request:Request,{params}:Context) {
  try{const {wid,pid,iid}=await params;return json({data:await readIssue(wid,pid,iid)});}catch(error){return apiError(error);}
}
export async function PATCH(request:Request,{params}:Context) {
  try {
    checkOrigin(request);const {wid,pid,iid}=await params;const {client}=await issueAccess(wid,pid,true);
    if(!uuid.test(iid)) throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
    const input=validateIssue(await readJson(request),true);
    const result=await client.rpc("edit_issue",{p_workspace_id:wid,p_project_id:pid,p_issue_id:iid,p_title:input.title,p_description:input.description,p_status:input.status,p_priority:input.priority,p_assignee_id:input.assignee_id,p_due_date:input.due_date,p_version:input.version});
    if(result.error) throw taskRpcError(result.error);return json({data:result.data});
  }catch(error){return apiError(error);}
}
export async function DELETE(request:Request,{params}:Context) {
  try {
    checkOrigin(request);const {wid,pid,iid}=await params;const {client}=await issueAccess(wid,pid,true);
    if(!uuid.test(iid)) throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
    const input=await readJson(request);exactKeys(input,["version"]);
    const result=await client.rpc("delete_issue",{p_workspace_id:wid,p_project_id:pid,p_issue_id:iid,p_version:taskVersion(input.version)});
    if(result.error) throw taskRpcError(result.error);return new Response(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiError(error);}
}
