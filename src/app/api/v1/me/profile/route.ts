import {apiError,json,checkOrigin,readJson,rpcError,ProjectError} from "@/lib/projects-server";
import {exactKeys} from "@/lib/tasks-server";
import {supabaseServer} from "@/lib/supabase/server";
// 本人の表示名だけを変える。対象のユーザーはセッションから決め、入力では受け取らない。
export async function PATCH(request:Request) {
  try {
    checkOrigin(request);const client=await supabaseServer();
    const {data,error}=await client.auth.getClaims();
    if(error||!data?.claims.sub)throw new ProjectError(401,"UNAUTHENTICATED","ログインしてください");
    const input=await readJson(request);exactKeys(input,["display_name"]);
    if(typeof input.display_name!=="string"||!input.display_name.trim()||Array.from(input.display_name.trim()).length>80)throw new ProjectError(400,"INVALID_INPUT","表示名は1〜80文字で入力してください");
    const result=await client.rpc("update_my_profile",{p_display_name:input.display_name});
    if(result.error)throw rpcError(result.error);return json({data:{display_name:result.data.display_name}});
  }catch(error){return apiError(error);}
}
