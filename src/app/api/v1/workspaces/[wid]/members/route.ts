import {apiError,json,checkOrigin,readJson,projectAccess,ProjectError,uuid} from "@/lib/projects-server";
import {readMembers} from "@/lib/members-server";
export async function GET(request:Request,{params}:{params:Promise<{wid:string}>}) {try{return json(await readMembers((await params).wid,new URL(request.url).searchParams));}catch(error){return apiError(error);}}

import {exactKeys} from "@/lib/tasks-server";
import {memberRoles,type MemberRole} from "@/lib/member-types";
import {memberRpcError} from "@/lib/members-server";
export async function POST(request:Request,{params}:{params:Promise<{wid:string}>}) {
  try {
    checkOrigin(request);const {wid}=await params;const client=await projectAccess(wid,true);
    const key=request.headers.get("Idempotency-Key");
    if(!key||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw new ProjectError(400,"INVALID_KEY","送信キーを確認してください");
    const input=await readJson(request);exactKeys(input,["user_id","role"]);
    if(typeof input.user_id!=="string"||!uuid.test(input.user_id)||typeof input.role!=="string"||!memberRoles.includes(input.role as MemberRole))throw new ProjectError(400,"INVALID_INPUT","ユーザーIDとロールを確認してください");
    const result=await client.rpc("add_member_once",{p_workspace_id:wid,p_user_id:input.user_id,p_role:input.role,p_key:key});
    if(result.error)throw memberRpcError(result.error);return json({data:result.data},201);
  }catch(error){return apiError(error);}
}
