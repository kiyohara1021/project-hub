import {apiError,json} from "@/lib/projects-server";
import {readMembers} from "@/lib/members-server";
export async function GET(request:Request,{params}:{params:Promise<{wid:string}>}) {try{return json(await readMembers((await params).wid,new URL(request.url).searchParams));}catch(error){return apiError(error);}}
