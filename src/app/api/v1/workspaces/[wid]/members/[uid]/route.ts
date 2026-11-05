import {apiError,checkOrigin,json,readJson,projectAccess,ProjectError,uuid,noContent} from "@/lib/projects-server";
import {readMember,memberRpcError} from "@/lib/members-server";
import { exactKeys, parseVersion } from "@/lib/validation";
import {memberRoles,type MemberRole} from "@/lib/member-types";
type Context={params:Promise<{wid:string;uid:string}>};
export async function GET(_request:Request,{params}:Context){try{const {wid,uid}=await params;return json({data:await readMember(wid,uid)});}catch(error){return apiError(error);}}
async function mutate(request:Request,{params}:Context,remove:boolean){try{
 checkOrigin(request);const {wid,uid}=await params;const client=await projectAccess(wid,true);if(!uuid.test(uid))throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
 const input=await readJson(request);exactKeys(input,remove?["version"]:["version","role"]);const version=parseVersion(input.version);
 if(!remove&&(typeof input.role!=="string"||!memberRoles.includes(input.role as MemberRole)))throw new ProjectError(400,"INVALID_INPUT","ロールを確認してください");
 const result=await client.rpc("change_member",{p_workspace_id:wid,p_user_id:uid,p_role:remove?null:input.role,p_version:version,p_remove:remove});if(result.error)throw memberRpcError(result.error);
 return noContent();
}catch(error){return apiError(error);}}
export function PATCH(request:Request,context:Context){return mutate(request,context,false);}
export function DELETE(request:Request,context:Context){return mutate(request,context,true);}
