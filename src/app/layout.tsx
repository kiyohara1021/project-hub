import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CspNonce } from "@/components/csp-nonce";
import "./globals.css";
import { connectedMode, supabaseConfig } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";
import { publicSupabaseConfig } from "@/lib/supabase/public-config";
import { RealtimeProvider } from "@/components/realtime-provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "ProjectHub", template: "%s | ProjectHub" },
  description: "プロジェクト・タスク・課題をまとめて管理するアプリ",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialAt = new Date().toISOString();
  const config = supabaseConfig();
  let bootstrap = null;
  if (config) {
    const client = await supabaseServer();
    const { data, error } = await client.auth.getClaims();
    if (!error && data?.claims.sub)
      bootstrap = {
        userId: data.claims.sub,
        config: publicSupabaseConfig(config),
      };
  }
  const shell = <AppShell connected={connectedMode()}>{children}</AppShell>;
  return (
    <html lang="ja">
      <body>
        <CspNonce />
        {bootstrap ? (
          <RealtimeProvider
            key={bootstrap.userId}
            config={bootstrap.config}
            userId={bootstrap.userId}
            initialAt={initialAt}
          >
            {shell}
          </RealtimeProvider>
        ) : (
          shell
        )}
      </body>
    </html>
  );
}
