import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import { connectedMode } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "ProjectHub", template: "%s | ProjectHub" },
  description: "架空データだけを使う個人非商用のプロジェクト管理デモ",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body><AppShell connected={connectedMode()}>{children}</AppShell></body></html>;
}
