import {apiError,checkOrigin,json,readJson,ProjectError,uuid} from "@/lib/projects-server";
import {commentAccess,validateComment,commentRpcError,readComment} from "@/lib/comments-server";
import { exactKeys, parseVersion } from "@/lib/validation";
type Context={params:Promise<{wid:string;pid:string;iid:string;cid:string}>};
export async function GET(_request:Request,{params}:Context){
  try{const {wid,pid,iid,cid}=await params;return json({data:await readComment(wid,pid,iid,cid)});}catch(error){return apiError(error);}
}
export async function PATCH(request:Request,{params}:Context){
  try{
    checkOrigin(request);const {wid,pid,iid,cid}=await params;const {client}=await commentAccess(wid,pid,iid,true);
    if(!uuid.test(cid))throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
    const input=validateComment(await readJson(request),true);
    const result=await client.rpc("edit_comment",{p_workspace_id:wid,p_project_id:pid,p_issue_id:iid,p_comment_id:cid,p_body:input.body,p_version:input.version});
    if(result.error)throw commentRpcError(result.error);return json({data:result.data});
  }catch(error){return apiError(error);}
}
export async function DELETE(request:Request,{params}:Context){
  try{
    checkOrigin(request);const {wid,pid,iid,cid}=await params;const {client}=await commentAccess(wid,pid,iid,true);
    if(!uuid.test(cid))throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
    const input=await readJson(request);exactKeys(input,["version"]);
    const result=await client.rpc("delete_comment",{p_workspace_id:wid,p_project_id:pid,p_issue_id:iid,p_comment_id:cid,p_version:parseVersion(input.version)});
    if(result.error)throw commentRpcError(result.error);return new Response(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiError(error);}
}
