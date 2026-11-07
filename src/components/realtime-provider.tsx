"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import type { PublicSupabaseConfig } from "@/lib/supabase/public-config";
import { Button } from "@/components/ui/button";

type Pending = { kind: "data" | "access"; editing: boolean };
type Connection = "connecting" | "connected" | "disconnected";

export function RealtimeProvider({
  config,
  userId,
  initialAt,
  children,
}: {
  config: PublicSupabaseConfig;
  userId: string;
  initialAt: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogHost, setDialogHost] = useState<HTMLElement | null>(null);
  const dialogHostRef = useRef<HTMLElement | null>(null);
  const [, startTransition] = useTransition();
  const snapshotAt = useRef(initialAt);

  useEffect(() => {
    const client = createBrowserClient(config.url, config.key, {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: window.location.protocol === "https:",
      },
    });
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let ready = false;
    let subscribedOnce = false;
    let catchup = false;
    let pendingKind: Pending["kind"] | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let authGeneration = 0;
    let dragging = false;
    let loggingOut = false;
    const dirty = new Set<HTMLFormElement>();

    const editing = () => {
      for (const form of dirty) if (!form.isConnected) dirty.delete(form);
      return (
        dirty.size > 0 ||
        dragging ||
        !!document.querySelector(
          '[role="dialog"][data-state="open"], [aria-busy="true"]',
        )
      );
    };
    const flush = () => {
      if (
        disposed ||
        !pendingKind ||
        timer ||
        !ready ||
        document.visibilityState === "hidden" ||
        editing()
      )
        return;
      timer = setTimeout(() => {
        timer = null;
        if (
          disposed ||
          !pendingKind ||
          !ready ||
          document.visibilityState === "hidden" ||
          editing()
        )
          return;
        pendingKind = null;
        setPending(null);
        startTransition(() => router.refresh());
      }, 200);
    };
    const invalidate = (kind: Pending["kind"] = "data") => {
      if (disposed || loggingOut) return;
      if (kind === "access" || !pendingKind) pendingKind = kind;
      setPending({ kind: pendingKind, editing: editing() });
      flush();
    };
    const stopChannel = () => {
      ready = false;
      const previous = channel;
      channel = null;
      if (previous) void client.removeChannel(previous);
    };
    const syncSession = async (session: Session | null) => {
      const generation = ++authGeneration;
      if (disposed || loggingOut) return;
      if (!session || session.user.id !== userId) {
        stopChannel();
        void client.realtime.disconnect();
        setConnection("disconnected");
        invalidate("access");
        // 購読は解除済み。入力がなければ失効したセッションの画面を再取得する。
        if (!editing()) startTransition(() => router.refresh());
        return;
      }
      try {
        await client.realtime.setAuth(session.access_token);
      } catch {
        if (!disposed) {
          stopChannel();
          catchup = true;
          setConnection("disconnected");
          invalidate();
        }
        return;
      }
      if (disposed || loggingOut || generation !== authGeneration || channel)
        return;
      const subscription = client.channel(
        `projecthub-updates-${userId}-${crypto.randomUUID()}`,
      );
      channel = subscription;
      subscription
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "realtime_updates",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (disposed || loggingOut || channel !== subscription) return;
            ready = true;
            setConnection("connected");
            invalidate(payload.new.kind === "access" ? "access" : "data");
          },
        )
        .subscribe((status) => {
          if (disposed || loggingOut || channel !== subscription) return;
          if (status === "SUBSCRIBED") {
            ready = true;
            setConnection("connected");
            if (subscribedOnce || catchup) invalidate();
            else {
              // サーバー描画と購読開始の間に届いた通知も確認する。
              void (async () => {
                const { data, error } = await client
                  .from("realtime_updates")
                  .select("kind")
                  .eq("user_id", userId)
                  .gte("created_at", snapshotAt.current)
                  // accessを先頭にし、購読開始前の失効も専用の案内にする。
                  .order("kind", { ascending: true })
                  .limit(1);
                if (disposed || channel !== subscription) return;
                if (error) {
                  ready = false;
                  setConnection("disconnected");
                  invalidate();
                } else if (data.length)
                  invalidate(data[0].kind === "access" ? "access" : "data");
              })();
            }
            subscribedOnce = true;
            catchup = false;
            flush();
          } else if (
            ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)
          ) {
            ready = false;
            catchup = true;
            setConnection("disconnected");
            invalidate();
          }
        });
    };
    const auth = client.auth.onAuthStateChange((_event, session) => {
      // Authのロック中に同じSDKへ再入しない。
      queueMicrotask(() => {
        void syncSession(session);
      });
    });
    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = target.closest("form");
      if (form) dirty.add(form);
    };
    const onSubmit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const action = new URL(event.target.action, location.href);
      if (
        action.origin === location.origin &&
        action.pathname === "/auth/logout"
      ) {
        loggingOut = true;
        authGeneration++;
        stopChannel();
        void client.realtime.disconnect();
      }
    };
    const onOffline = () => {
      ready = false;
      catchup = true;
      setConnection("disconnected");
      invalidate();
    };
    const onResume = () => {
      if (document.visibilityState === "hidden" || disposed || loggingOut)
        return;
      if (catchup) stopChannel();
      void client.auth
        .getSession()
        .then(({ data }) => syncSession(data.session))
        .catch(() => {
          if (!disposed) {
            ready = false;
            setConnection("disconnected");
            invalidate();
          }
        });
      flush();
    };
    const onDragStart = () => {
      dragging = true;
    };
    const onDragEnd = () => {
      dragging = false;
      flush();
    };
    const syncDialogHost = () => {
      if (disposed) return;
      const dialogs = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][data-state="open"]',
      );
      const nextHost = dialogs.item(dialogs.length - 1);
      if (dialogHostRef.current !== nextHost) {
        dialogHostRef.current = nextHost;
        setDialogHost(nextHost);
      }
    };
    const observer = new MutationObserver(() => {
      syncDialogHost();
      flush();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy", "data-state"],
    });
    syncDialogHost();
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("offline", onOffline);
    return () => {
      disposed = true;
      authGeneration++;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      auth.data.subscription.unsubscribe();
      stopChannel();
      void client.realtime.disconnect();
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragend", onDragEnd, true);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      window.removeEventListener("offline", onOffline);
    };
  }, [config.url, config.key, userId, router]);

  const notice = (pending || connection === "disconnected") && (
    <aside
      aria-label="画面の更新"
      role="status"
      aria-live="polite"
      className={`space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 ${dialogHost ? "" : "mx-4 my-4 md:ml-64 md:mr-10"}`}
    >
      <p className="font-medium">
        {connection === "disconnected"
          ? "更新の受信が止まっています"
          : pending?.kind === "access"
            ? "所属や公開範囲が変更されました"
            : "更新があります"}
      </p>
      <p>
        {pending?.editing
          ? "入力内容は保持しています。再読込すると入力を破棄します。"
          : connection === "disconnected"
            ? "再接続後に最新の表示を取得します。手動で読み直すこともできます。"
            : "最新の表示を取得しています。"}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => window.location.reload()}
      >
        {pending?.editing ? "入力を破棄して再読込" : "再読込"}
      </Button>
    </aside>
  );

  return (
    <>
      <span role="status" aria-label="同期状態" className="sr-only">
        {connection === "connected"
          ? "接続済み"
          : connection === "connecting"
            ? "接続中"
            : "接続が切れています"}
      </span>
      {dialogHost ? createPortal(notice, dialogHost) : notice}
      {children}
    </>
  );
}
