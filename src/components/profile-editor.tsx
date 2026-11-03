"use client";
import {useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {Button} from "./ui/button";
import {Input} from "./ui/input";

export function ProfileEditor({displayName}:{displayName:string}) {
  const router=useRouter();const [name,setName]=useState(displayName);const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");const [saved,setSaved]=useState(false);const alert=useRef<HTMLDivElement>(null);
  const length=Array.from(name.trim()).length;
  async function save(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError("");setSaved(false);
    try {
      const response=await fetch("/api/v1/me/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name:name.trim()})});
      const result=await response.json();
      if(!response.ok){setError(result.error?.message??"保存できませんでした。再試行してください。");setTimeout(()=>alert.current?.focus(),0);return;}
      setName(result.data.display_name);setSaved(true);router.refresh();
    }catch{setError("通信結果を確認できませんでした。再試行してください。");setTimeout(()=>alert.current?.focus(),0);}
    finally{setBusy(false);}
  }
  return <form onSubmit={save} className="mb-6 max-w-md space-y-2">
    <label htmlFor="profile-display-name" className="block text-sm">表示名</label>
    <div className="flex gap-2"><Input id="profile-display-name" value={name} onChange={event=>{setName(event.target.value);setSaved(false);}} required maxLength={80} autoComplete="nickname" disabled={busy} aria-describedby="profile-display-name-help"/><Button type="submit" disabled={busy||length===0||name.trim()===displayName}>{busy?"保存中…":"保存"}</Button></div>
    <p id="profile-display-name-help" className="text-xs text-slate-500">メンバー一覧や担当者に表示されます（1〜80文字）。操作履歴には記録した時点の名前が残ります。</p>
    {error&&<div ref={alert} tabIndex={-1} role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {saved&&<p role="status" className="text-sm text-green-700">表示名を保存しました。</p>}
  </form>;
}
