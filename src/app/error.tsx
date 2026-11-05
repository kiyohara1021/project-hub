"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-white p-8">
      <h1 className="text-xl font-semibold">画面を表示できませんでした</h1>
      <p className="my-4 text-sm text-slate-500">
        時間をおいて、もう一度お試しください。
      </p>
      <Button onClick={reset}>再試行する</Button>
    </div>
  );
}
