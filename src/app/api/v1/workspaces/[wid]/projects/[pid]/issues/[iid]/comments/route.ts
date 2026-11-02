import {apiError,checkOrigin,json,readJson,ProjectError} from "@/lib/projects-server";
import {commentAccess,queryComments,validateComment,commentRpcError} from "@/lib/comments-server";
type Context={params:Promise<{wid:string;pid:string;iid:string}>};
export async function GET(request:Request,{params}:Context){
  try{const {wid,pid,iid}=await params;const {client}=await commentAccess(wid,pid,iid);return json(await queryComments(client,wid,pid,iid,new URL(request.url).searchParams));}
  catch(error){return apiError(error);}
}
export async function POST(request:Request,{params}:Context){
  try{
    checkOrigin(request);const {wid,pid,iid}=await params;const {client}=await commentAccess(wid,pid,iid,true);
    const key=request.headers.get("Idempotency-Key");if(!key||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw new ProjectError(400,"INVALID_KEY","送信キーを確認してください");
    const input=validateComment(await readJson(request));
    const result=await client.rpc("create_comment_once",{p_workspace_id:wid,p_project_id:pid,p_issue_id:iid,p_body:input.body,p_key:key});
    if(result.error)throw commentRpcError(result.error);return json({data:result.data},201);
  }catch(error){return apiError(error);}
}
