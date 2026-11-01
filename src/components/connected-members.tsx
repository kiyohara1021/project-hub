import Link from "next/link";
import {redirect,notFound} from "next/navigation";
import {supabaseServer} from "@/lib/supabase/server";
import {supabaseConfig} from "@/lib/supabase/config";
import {readMembers} from "@/lib/members-server";
import {ProjectError} from "@/lib/projects-server";
import {memberRoles,memberLabels} from "@/lib/member-types";
import {PageHeading,EmptyState} from "./page-parts";
import {Button} from "./ui/button";
import {MemberEditor} from "./member-editor";
export async function ConnectedMembers({search}:{search:Record<string,string|string[]|undefined>}) {
 if(!supabaseConfig())return <EmptyState title="接続設定がありません"/>;
 const client=await supabaseServer();const auth=await client.auth.getClaims();if(auth.error||!auth.data?.claims.sub)redirect("/login");
 const spaces=await client.from("workspaces").select("id,name").order("created_at").order("id");if(spaces.error)throw new Error("Workspace read failed");
 if(Array.isArray(search.workspace))notFound();const wid=search.workspace??spaces.data[0]?.id;
 if(!wid)return <><PageHeading title="メンバー" description="所属メンバーを確認します。"/><EmptyState title="所属ワークスペースがありません"/></>;
 const workspace=spaces.data.find(s=>s.id===wid);if(!workspace)notFound();
 const query=new URLSearchParams();for(const [k,v]of Object.entries(search)){if(k==="workspace"||v===undefined)continue;if(typeof v!=="string")return <EmptyState title="検索条件を確認してください"/>;query.set(k,v);}
 let page;try{page=await readMembers(wid,query);}catch(e){if(e instanceof ProjectError&&e.status===400)return <><EmptyState title="検索条件を確認してください"/><Link href={`/members?workspace=${wid}`} className="underline">検索をリセット</Link></>;throw e;}
 const me=await client.from("memberships").select("role").eq("workspace_id",wid).eq("user_id",auth.data.claims.sub).single();if(me.error)throw new Error("Membership read failed");
 const next=new URLSearchParams(query);next.set("workspace",wid);if(page.nextCursor)next.set("cursor",page.nextCursor);const first=new URLSearchParams(query);first.set("workspace",wid);first.delete("cursor");
 return <><PageHeading title="メンバー" description={`${workspace.name}の所属一覧です。招待・メール送信は未対応です。`}/>
 <form key={`${wid}-${query}`} action="/members" className="mb-6 grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2"><input type="hidden" name="limit" value={query.get("limit")??"25"}/><div><label htmlFor="members-workspace" className="mb-2 block text-sm">ワークスペース</label><select id="members-workspace" name="workspace" defaultValue={wid} className="h-10 w-full rounded-md border px-2">{spaces.data.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div><label htmlFor="members-role" className="mb-2 block text-sm">ロールで絞り込み</label><select id="members-role" name="role" defaultValue={query.get("role")??""} className="h-10 w-full rounded-md border px-2"><option value="">すべて</option>{memberRoles.map(r=><option key={r} value={r}>{memberLabels[r]}</option>)}</select></div><div className="flex gap-4"><Button type="submit">絞り込む</Button><Link href={`/members?workspace=${wid}`} className="text-sm text-blue-700 underline">リセット</Link></div></form>
 <p className="mb-5 text-sm text-slate-500">{me.data.role==="admin"?"管理者はロール変更と所属解除ができます。最後の管理者は保護されます。":"この一覧は読み取り専用です。"}</p>
 {!page.data.length?<EmptyState/>:<ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{page.data.map(m=><li key={m.user_id}><article aria-label={m.profiles.display_name} className="h-full space-y-4 rounded-xl border bg-white p-5"><h2 className="break-words font-semibold">{m.profiles.display_name}{m.user_id===auth.data.claims.sub&&"（自分）"}</h2><dl className="space-y-2 text-sm"><div><dt className="text-slate-500">ロール</dt><dd>{memberLabels[m.role]}</dd></div><div><dt className="text-slate-500">参加日（日本時間）</dt><dd>{new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo"}).format(new Date(m.joined_at))}</dd></div></dl>{me.data.role==="admin"&&<MemberEditor key={`${m.user_id}-${m.version}`} member={m} wid={wid} self={m.user_id===auth.data.claims.sub}/>}</article></li>)}</ul>}
 <nav aria-label="メンバーのページ送り" className="mt-6 flex flex-wrap justify-between gap-4 text-sm"><span>{page.data.length}件を表示</span><div className="flex gap-4">{query.has("cursor")&&<Link href={`/members?${first}`} className="text-blue-700 underline">最初のページ</Link>}{page.nextCursor&&<Link href={`/members?${next}`} className="text-blue-700 underline">次のページ →</Link>}</div></nav></>;
}
