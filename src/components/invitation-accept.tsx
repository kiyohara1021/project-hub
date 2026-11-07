"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
export function InvitationAccept({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch(`/api/v1/invitations/${token}/accept`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            const result = await r.json();
            if (!r.ok) throw Error();
            router.push(`/members?workspace=${result.data.workspace_id}`);
            router.refresh();
          } catch {
            setError(
              "招待を承諾できませんでした。招待の有効期限とログイン中のメールをご確認ください。",
            );
            setBusy(false);
          }
        }}
      >
        招待を承諾する
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
