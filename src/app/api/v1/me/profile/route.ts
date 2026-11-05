import {supabaseServer} from "@/lib/supabase/server";
import {apiError,checkOrigin,json,readJson,ProjectError,rpcError} from "@/lib/projects-server";
import { exactKeys } from "@/lib/validation";

export async function PATCH(request:Request) {
  try {
    checkOrigin(request);
    const client=await supabaseServer();
    const {data,error}=await client.auth.getClaims();
    if(error||!data?.claims.sub)throw new ProjectError(401,"UNAUTHENTICATED","ログインしてください");
    const input=await readJson(request);exactKeys(input,["display_name"]);
    if(typeof input.display_name!=="string"||input.display_name.includes("\u0000")||!input.display_name.trim()||Array.from(input.display_name.trim()).length>80)
      throw new ProjectError(400,"INVALID_INPUT","表示名は前後の空白を除いて1〜80文字で入力してください");
    const result=await client.rpc("update_my_profile",{p_display_name:input.display_name.trim()});
    if(result.error)throw rpcError(result.error);
    return json({data:result.data});
  }catch(error){return apiError(error);}
}
