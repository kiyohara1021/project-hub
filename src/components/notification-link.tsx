"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";
import { notificationChangedEvent } from "@/lib/notification-types";

export function NotificationLink({
  connected = false,
}: {
  connected?: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const path = usePathname();
  const query = useSearchParams().toString();
  const active =
    connected &&
    ![
      "/login",
      "/signup",
      "/confirm",
      "/forgot-password",
      "/reset-password",
    ].includes(path);
  useEffect(() => {
    if (!active) return;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch("/api/v1/me/notifications/unread-count", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0)
          throw new Error();
        if (!current.signal.aborted) setCount(data.unreadCount);
      } catch {
        if (!current.signal.aborted) setCount(null);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(notificationChangedEvent, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(notificationChangedEvent, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, path, query]);
  return (
    <Link
      href="/notifications"
      className="inline-flex shrink-0 items-center gap-1.5 text-sm text-blue-700 underline"
      aria-label={active && count !== null ? `通知（未読${count}件）` : "通知"}
    >
      <Bell size={16} aria-hidden="true" />
      <span>通知</span>
      {active && count !== null && count > 0 && (
        <span
          className="rounded-full bg-blue-700 px-1.5 py-0.5 text-xs text-white"
          aria-hidden="true"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
