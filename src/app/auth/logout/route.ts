import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return new Response(null, { status: 503 });
  if (request.headers.get("origin") !== config.origin) return new Response(null, { status: 403 });
  const client = await supabaseServer();
  const { error } = await client.auth.signOut();
  if (error) return new Response("ログアウトできませんでした。再試行してください。", { status: 503 });
  return NextResponse.redirect(new URL("/login", config.origin), { status: 303, headers: { "Cache-Control": "no-store" } });
}
