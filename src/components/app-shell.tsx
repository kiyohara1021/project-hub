"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Columns3,
  CircleAlert,
  Users,
  History,
  PanelsTopLeft,
  CalendarRange,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/projects", label: "プロジェクト一覧", icon: FolderKanban },
  { href: "/projects/demo-a/board", label: "カンバン", icon: Columns3 },
  { href: "/projects/demo-a/issues", label: "課題一覧", icon: CircleAlert },
  {
    href: "/projects/demo-a/gantt",
    label: "ガントチャート",
    icon: CalendarRange,
  },
  { href: "/members", label: "メンバー", icon: Users },
  { href: "/activity", label: "操作履歴", icon: History },
];

function Navigation({
  mobile = false,
  connected = false,
}: {
  mobile?: boolean;
  connected?: boolean;
}) {
  const path = usePathname();
  const query = useSearchParams();
  return (
    <nav aria-label="メインメニュー" className="space-y-2">
      {links.map(({ href, label, icon: Icon }) => {
        const workspace = query.get("workspace");
        const scoped = workspace
          ? `?${new URLSearchParams({ workspace })}`
          : "";
        let target =
          connected &&
          [
            "ダッシュボード",
            "プロジェクト一覧",
            "メンバー",
            "操作履歴",
          ].includes(label)
            ? `${href}${scoped}`
            : href;
        const projectRoute = path.match(
          /^\/projects\/([^/]+)\/(board|issues|gantt)$/,
        );
        const suffix =
          label === "カンバン"
            ? "board"
            : label === "課題一覧"
              ? "issues"
              : label === "ガントチャート"
                ? "gantt"
                : null;
        if (connected && suffix)
          target = projectRoute
            ? `/projects/${projectRoute[1]}/${suffix}${scoped}`
            : `/projects${scoped}`;
        const active =
          connected && label === "ガントチャート"
            ? path.endsWith("/gantt")
            : connected && label === "カンバン"
              ? path.endsWith("/board")
              : connected && label === "課題一覧"
                ? path.endsWith("/issues")
                : path === href;
        const link = (
          <Link
            href={target}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"}`}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        );
        return mobile ? (
          <SheetClose key={href} asChild>
            {link}
          </SheetClose>
        ) : (
          <div key={href}>{link}</div>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  connected = false,
}: {
  children: React.ReactNode;
  connected?: boolean;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-50 rounded bg-white p-3 focus:not-sr-only"
      >
        本文へ移動
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-[#14233e] px-4 py-8 md:flex">
        <Link
          href="/dashboard"
          className="px-3 text-2xl font-bold tracking-tight text-white"
        >
          ProjectHub
        </Link>
        <p className="px-3 pt-2 text-xs text-slate-400">プロジェクト管理</p>
        <div className="my-8 rounded-lg bg-slate-700/60 px-4 py-4 text-sm text-white">
          ワークスペース
        </div>
        <Navigation connected={connected} />
      </aside>
      <div className="md:pl-60">
        <header className="flex min-h-20 items-center justify-between gap-3 border-b bg-white px-4 md:px-10">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="md:hidden"
                  aria-label="メニューを開く"
                >
                  <PanelsTopLeft size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 bg-[#14233e] p-6 text-white"
              >
                <SheetTitle className="text-xl text-white">
                  ProjectHub
                </SheetTitle>
                <SheetDescription className="mb-4 text-slate-300">
                  画面を選択してください。
                </SheetDescription>
                <Navigation mobile connected={connected} />
              </SheetContent>
            </Sheet>
            <span className="text-sm text-slate-500">ProjectHub</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <Link
              href="/workspaces"
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              アカウント
            </Link>
          </div>
        </header>
        {!connected && (
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs leading-5 text-blue-900 md:px-10">
            プレビュー環境ではログイン・データ保存は利用できません。
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto min-h-[80vh] max-w-7xl px-4 py-8 outline-none md:px-10"
        >
          {children}
        </main>
        <footer className="px-4 py-8 text-xs text-slate-500 md:px-10">
          ProjectHub
        </footer>
      </div>
    </>
  );
}
