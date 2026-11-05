"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ProfileEditor({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
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
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error?.message ?? "保存できませんでした。再試行してください。",
        );
        return;
      }
      setName(result.data.display_name);
      setSaved(true);
      router.refresh();
    } catch {
      setError(
        "通信結果を確認できませんでした。同じ表示名で再試行してください。",
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
      aria-label="表示名の変更"
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
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          表示名を保存しました。
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "保存中…" : "表示名を保存"}
      </Button>
    </form>
  );
}
