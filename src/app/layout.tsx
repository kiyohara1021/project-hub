import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProjectHub", template: "%s | ProjectHub" },
  description: "架空データだけを使う個人非商用のプロジェクト管理デモ",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body><AppShell>{children}</AppShell></body></html>;
}
