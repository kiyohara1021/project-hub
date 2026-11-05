import {ProjectError,uuid,rpcError} from "./projects-server";
import {issueAccess} from "./issues-server";
import { exactKeys, parseVersion } from "./validation";
import type {IssueComment,CommentPage} from "./comment-types";

const fields="id,workspace_id,project_id,issue_id,author_id,author_display_name,body,version,created_at,updated_at";
export async function commentAccess(wid:string,pid:string,iid:string,write=false){
  const access=await issueAccess(wid,pid,write);
  if(!uuid.test(iid))throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
  const issue=await access.client.from("issues").select("id").eq("workspace_id",wid).eq("project_id",pid).eq("id",iid).maybeSingle();
  if(issue.error)throw new ProjectError(500,"READ_FAILED","課題を取得できませんでした");
  if(!issue.data)throw new ProjectError(404,"NOT_FOUND","見つかりませんでした");
  return access;
}
export function validateComment(input:Record<string,unknown>,edit=false){
  exactKeys(input,["body",...(edit?["version"]:[])]);
  if(typeof input.body!=="string"||input.body.includes("\u0000")||!input.body.trim()||Array.from(input.body.trim()).length>5000)throw new ProjectError(400,"INVALID_INPUT","コメントは1〜5,000文字で入力してください");
  return {body:input.body.trim(),...(edit?{version:parseVersion(input.version)}:{})};
}
export function commentRpcError(error:{code:string;message:string}){
  if(error.code==="55000")return new ProjectError(409,"PROJECT_ARCHIVED","アーカイブ済みのプロジェクトは変更できません");
  return rpcError(error);
}
export async function queryComments(client:Awaited<ReturnType<typeof issueAccess>>["client"],wid:string,pid:string,iid:string,query:URLSearchParams):Promise<CommentPage>{
  const raw=query.get("limit")??"25",limit=Number(raw),cursor=query.get("cursor");
  const invalid=()=>new ProjectError(400,"INVALID_INPUT","検索条件を確認してください");
  if([...query.keys()].some(k=>!["limit","cursor"].includes(k)||query.getAll(k).length>1)||!/^\d+$/.test(raw)||limit<1||limit>100)throw invalid();
  let db=client.from("issue_comments").select(fields).eq("workspace_id",wid).eq("project_id",pid).eq("issue_id",iid).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit+1);
  if(cursor!==null){
    if(cursor.length>256||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw invalid();
    try {
      const value=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
      if(!value||typeof value.time!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.time)||!Number.isFinite(Date.parse(value.time))||value.time.startsWith("0000")||new Date(value.time).toISOString().slice(0,10)!==value.time.slice(0,10)||typeof value.id!=="string"||!uuid.test(value.id))throw invalid();
      db=db.or(`created_at.lt.${value.time},and(created_at.eq.${value.time},id.lt.${value.id})`);
    }catch{throw invalid();}
  }
  const result=await db;if(result.error)throw new ProjectError(500,"READ_FAILED","コメントを取得できませんでした");
  const data=result.data.slice(0,limit) as IssueComment[],last=data.at(-1);
  return {data,nextCursor:result.data.length>limit&&last?Buffer.from(JSON.stringify({time:last.created_at,id:last.id})).toString("base64url"):null};
}

export async function readComment(wid:string,pid:string,iid:string,cid:string):Promise<IssueComment>{
  const {client}=await commentAccess(wid,pid,iid);
  if(!uuid.test(cid))throw new ProjectError(400,"INVALID_INPUT","IDを確認してください");
  const result=await client.from("issue_comments").select(fields).eq("workspace_id",wid).eq("project_id",pid).eq("issue_id",iid).eq("id",cid).maybeSingle();
  if(result.error)throw new ProjectError(500,"READ_FAILED","コメントを取得できませんでした");
  if(!result.data)throw new ProjectError(404,"NOT_FOUND","見つかりませんでした");
  return result.data as IssueComment;
}
