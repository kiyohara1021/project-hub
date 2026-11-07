"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ProfileEditor({
  displayName,
  jobTitle = "",
  bio = "",
}: {
  displayName: string;
  jobTitle?: string;
  bio?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [title, setTitle] = useState(jobTitle);
  const [introduction, setIntroduction] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const sending = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    setError("");
    setSaved(false);
    if (!name.trim() || Array.from(name.trim()).length > 80) {
      setError("表示名は前後の空白を除いて1〜80文字で入力してください");
      return;
    }
    if (
      Array.from(title.trim()).length > 80 ||
      Array.from(introduction.trim()).length > 500
    ) {
      setError(
        "役職・担当は80文字以内、自己紹介は500文字以内で入力してください",
      );
      return;
    }
    if ([name, title, introduction].some((value) => value.includes("\u0000"))) {
      setError("使用できない文字が含まれています");
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name,
          job_title: title,
          bio: introduction,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error?.message ?? "保存できませんでした。再試行してください。",
        );
        return;
      }
      setName(result.data.display_name);
      setTitle(result.data.job_title);
      setIntroduction(result.data.bio);
      setSaved(true);
      router.refresh();
    } catch {
      setError(
        "通信結果を確認できませんでした。入力を確認して再試行してください。",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="mb-6 max-w-md space-y-3 rounded-md border p-4"
      aria-label="プロフィールの変更"
    >
      <label
        htmlFor="profile-display-name"
        className="block text-sm font-medium"
      >
        表示名
      </label>
      <Input
        id="profile-display-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        required
        disabled={busy}
        aria-describedby="profile-name-help"
        autoComplete="nickname"
      />
      <p id="profile-name-help" className="text-xs text-slate-500">
        1〜80文字。メンバー一覧や今後の操作履歴に表示されます。
      </p>
      <label htmlFor="profile-job-title" className="block text-sm font-medium">
        役職・担当
      </label>
      <Input
        id="profile-job-title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setSaved(false);
        }}
        disabled={busy}
        aria-describedby="profile-title-help"
        autoComplete="organization-title"
      />
      <p id="profile-title-help" className="text-xs text-slate-500">
        任意・80文字以内。
      </p>
      <label htmlFor="profile-bio" className="block text-sm font-medium">
        自己紹介
      </label>
      <textarea
        id="profile-bio"
        value={introduction}
        onChange={(event) => {
          setIntroduction(event.target.value);
          setSaved(false);
        }}
        disabled={busy}
        rows={4}
        aria-describedby="profile-bio-help"
        className="block w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
      />
      <p id="profile-bio-help" className="text-xs text-slate-500">
        任意・500文字以内。本人と同じワークスペースの利用者が参照できます。
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          プロフィールを保存しました。
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "保存中…" : "プロフィールを保存"}
      </Button>
    </form>
  );
}
