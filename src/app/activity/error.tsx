"use client";
import { Button } from "@/components/ui/button";
export default function ActivityError() {
  return (
    <div role="alert" className="rounded-xl border bg-white p-8">
      <h1 className="text-xl font-semibold">操作履歴を表示できませんでした</h1>
      <p className="my-4 text-sm text-slate-500">
        接続を確認して、もう一度お試しください。
      </p>
      <Button onClick={() => window.location.reload()}>再試行する</Button>
    </div>
  );
}
