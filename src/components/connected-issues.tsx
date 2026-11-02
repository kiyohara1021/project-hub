import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {supabaseConfig} from "@/lib/supabase/config";
import {issueAccess,queryIssues} from "@/lib/issues-server";
import {ProjectError} from "@/lib/projects-server";
import {issueStatuses,issueLabels,type Issue} from "@/lib/issue-types";
import {priorities,priorityLabels,type Assignee} from "@/lib/task-types";
import {PageHeading,EmptyState} from "@/components/page-parts";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {IssueEditor} from "./issue-editor";
import {IssueComments} from "./issue-comments";

function Content({issue}:{issue:Issue}) {return <><h2 className="break-words font-semibold">{issue.title}</h2>{issue.description&&<details className="mt-2 text-xs leading-6 text-slate-600"><summary className="cursor-pointer">説明を見る</summary><p className="mt-2 whitespace-pre-wrap break-words">{issue.description}</p></details>}</>;}
function IssueRows({rows,members,base,canWrite,userId,role,archived}:{rows:Issue[];members:Assignee[];base:string;canWrite:boolean;userId:string;role:string;archived:boolean}) {
  const memberName=(id:string|null)=>members.find(m=>m.id===id)?.name??"未割当";
  return <><table className="hidden w-full table-fixed border-collapse text-left text-sm xl:table"><caption className="sr-only">課題一覧</caption><colgroup>{[34,13,10,18,15,10].map((w,i)=><col key={i} style={{width:`${w}%`}}/>)}</colgroup><thead><tr>{["課題名","状態","優先度","担当者","期限","操作"].map(label=><th key={label} scope="col" className="border-b bg-slate-100 px-3 py-3 font-medium text-slate-600">{label}</th>)}</tr></thead><tbody>{rows.map(issue=><tr key={issue.id} className="align-top"><td className="border-b px-3 py-5"><Content issue={issue}/></td><td className="border-b px-3 py-5">{issueLabels[issue.status]}</td><td className="border-b px-3 py-5">{priorityLabels[issue.priority]}</td><td className="break-words border-b px-3 py-5">{memberName(issue.assignee_id)}</td><td className="border-b px-3 py-5">{issue.due_date??"未設定"}</td><td className="border-b px-3 py-5"><div className="flex flex-wrap gap-2">{canWrite&&<IssueEditor key={`${issue.id}-${issue.version}`} base={base} issue={issue} members={members}/>}<IssueComments key={`${base}-${issue.id}`} base={base} issue={issue} userId={userId} role={role} archived={archived}/></div></td></tr>)}</tbody></table>
    <ul className="grid gap-4 md:grid-cols-2 xl:hidden">{rows.map(issue=><li key={issue.id}><article aria-label={issue.title} className="h-full rounded-xl border bg-white p-4"><Content issue={issue}/><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">状態</dt><dd className="mt-1">{issueLabels[issue.status]}</dd></div><div><dt className="text-xs text-slate-500">優先度</dt><dd className="mt-1">{priorityLabels[issue.priority]}</dd></div><div><dt className="text-xs text-slate-500">担当者</dt><dd className="mt-1 break-words">{memberName(issue.assignee_id)}</dd></div><div><dt className="text-xs text-slate-500">期限</dt><dd className="mt-1">{issue.due_date??"未設定"}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2">{canWrite&&<IssueEditor key={`${issue.id}-${issue.version}`} base={base} issue={issue} members={members}/>}<IssueComments key={`${base}-${issue.id}`} base={base} issue={issue} userId={userId} role={role} archived={archived}/></div></article></li>)}</ul></>;
}

export async function ConnectedIssues({id,search}:{id:string;search:Record<string,string|string[]|undefined>}) {
  if(!supabaseConfig())return <EmptyState title="接続設定がありません" description="ローカル接続設定を確認してください。"/>;
  if(id==="demo-a"||!search.workspace)redirect("/projects");if(typeof search.workspace!=="string")notFound();const wid=search.workspace;
  let access;
  try{access=await issueAccess(wid,id);}catch(error){if(error instanceof ProjectError&&error.status===401)redirect("/login");if(error instanceof ProjectError&&[400,404].includes(error.status))notFound();throw error;}
  const {client,project}=access;const query=new URLSearchParams();
  for(const [key,value] of Object.entries(search)){if(key==="workspace"||value===undefined)continue;if(typeof value!=="string")return <EmptyState title="検索条件を確認してください" description="重複した条件は指定できません。"/>;query.set(key,value);}
  let page;
  try{page=await queryIssues(client,wid,id,query);}catch(error){if(error instanceof ProjectError&&error.status===400)return <><PageHeading title="課題一覧" description={project.name}/><EmptyState title="検索条件を確認してください"/><Link href={`/projects/${id}/issues?workspace=${wid}`} className="mt-4 inline-block text-blue-700 underline">検索をリセット</Link></>;throw error;}
  const auth=await client.auth.getClaims();const memberRows=await client.from("memberships").select("user_id,role").eq("workspace_id",wid);if(memberRows.error)throw new Error("Member read failed");
  const profiles=await client.from("profiles").select("id,display_name").in("id",memberRows.data.map(m=>m.user_id));if(profiles.error)throw new Error("Profile read failed");
  const members=profiles.data.map(p=>({id:p.id,name:p.display_name}));const role=memberRows.data.find(m=>m.user_id===auth.data?.claims.sub)?.role;const canWrite=["admin","member"].includes(role??"")&&project.status!=="archived";
  const base=`/api/v1/workspaces/${wid}/projects/${id}/issues`;const first=new URLSearchParams(query);first.set("workspace",wid);first.delete("cursor");const next=new URLSearchParams(query);next.set("workspace",wid);if(page.nextCursor)next.set("cursor",page.nextCursor);
  return <><PageHeading title="課題一覧" description={`${project.name} · 所属ワークスペースの課題を表示しています。`}/>
    <div className="mb-6 flex flex-wrap gap-5 text-sm text-blue-700"><Link href={`/projects?workspace=${wid}`} className="underline">← プロジェクト一覧へ</Link><Link href={`/projects/${id}/board?workspace=${wid}`} className="underline">カンバンへ →</Link></div>
    {project.status==="archived"&&<p role="status" className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">アーカイブ済みのため閲覧のみ利用できます。</p>}
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{canWrite?"解決・再開などの状態変更は編集から行えます。":"この一覧は読み取り専用です。"}</p>{canWrite&&<IssueEditor key={id} base={base} members={members}/>}</div>
    <form key={query.toString()} action={`/projects/${id}/issues`} method="get" className="mb-6 grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"><input type="hidden" name="workspace" value={wid}/><input type="hidden" name="limit" value={query.get("limit")??"25"}/>
      <div><label htmlFor="issue-search" className="mb-2 block text-sm font-medium">課題名で検索</label><Input id="issue-search" name="q" type="search" defaultValue={query.get("q")??""} maxLength={120}/></div>
      <div><label htmlFor="issue-status" className="mb-2 block text-sm font-medium">状態で絞り込み</label><select id="issue-status" name="status" defaultValue={query.get("status")??"unresolved"} className="h-10 w-full rounded-md border px-2 text-sm"><option value="unresolved">未解決・調査中</option><option value="all">すべて</option>{issueStatuses.map(s=><option key={s} value={s}>{issueLabels[s]}</option>)}</select></div>
      <div><label htmlFor="issue-priority" className="mb-2 block text-sm font-medium">優先度で絞り込み</label><select id="issue-priority" name="priority" defaultValue={query.get("priority")??""} className="h-10 w-full rounded-md border px-2 text-sm"><option value="">すべて</option>{priorities.map(p=><option key={p} value={p}>{priorityLabels[p]}</option>)}</select></div>
      <div><label htmlFor="issue-assignee" className="mb-2 block text-sm font-medium">担当者で絞り込み</label><select id="issue-assignee" name="assignee" defaultValue={query.get("assignee")??""} className="h-10 w-full rounded-md border px-2 text-sm"><option value="">すべて</option><option value="unassigned">未割当</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <div className="flex items-center gap-4 sm:col-span-2 xl:col-span-4"><Button type="submit">絞り込む</Button><Link href={`/projects/${id}/issues?workspace=${wid}`} className="text-sm text-blue-700 underline">リセット</Link></div>
    </form>
    {!page.data.length?<EmptyState/>:<IssueRows rows={page.data} members={members} base={base} canWrite={canWrite} userId={auth.data?.claims.sub??""} role={role??""} archived={project.status==="archived"}/>}
    <nav aria-label="課題のページ送り" className="mt-6 flex justify-between gap-3 text-sm"><span>{page.data.length}件を表示</span><div className="flex gap-5">{query.has("cursor")&&<Link href={`/projects/${id}/issues?${first}`} className="text-blue-700 underline">最初のページ</Link>}{page.nextCursor&&<Link href={`/projects/${id}/issues?${next}`} className="text-blue-700 underline">次のページ →</Link>}</div></nav>
  </>;
}
