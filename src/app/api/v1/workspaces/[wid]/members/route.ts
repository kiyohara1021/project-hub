import {apiError,json,checkOrigin,readJson,projectAccess,ProjectError,uuid,idempotencyKey} from "@/lib/projects-server";
import {readMembers,memberRpcError} from "@/lib/members-server";
import {exactKeys} from "@/lib/tasks-server";
import {memberRoles,type MemberRole} from "@/lib/member-types";

type Context={params:Promise<{wid:string}>};
export async function GET(request:Request,{params}:Context) {
  try{return json(await readMembers((await params).wid,new URL(request.url).searchParams));}catch(error){return apiError(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    checkOrigin(request);const {wid}=await params;const client=await projectAccess(wid,true);
    const key=idempotencyKey(request);
    const input=await readJson(request);exactKeys(input,["user_id","role"]);
    if(typeof input.user_id!=="string"||!uuid.test(input.user_id)||typeof input.role!=="string"||!memberRoles.includes(input.role as MemberRole))throw new ProjectError(400,"INVALID_INPUT","ユーザーIDとロールを確認してください");
    const result=await client.rpc("add_member_once",{p_workspace_id:wid,p_user_id:input.user_id,p_role:input.role,p_key:key});
    if(result.error)throw memberRpcError(result.error);return json({data:result.data},201);
  }catch(error){return apiError(error);}
}
