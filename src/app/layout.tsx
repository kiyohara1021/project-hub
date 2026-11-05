import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import { connectedMode } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "ProjectHub", template: "%s | ProjectHub" },
  description: "プロジェクト・タスク・課題をまとめて管理するアプリ",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <AppShell connected={connectedMode()}>{children}</AppShell>
      </body>
    </html>
  );
}
