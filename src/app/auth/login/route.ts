import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return new Response(null, { status: 503 });
  if (request.headers.get("origin") !== config.origin)
    return new Response(null, { status: 403 });
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return new Response(null, { status: 415 });
  const failed = () =>
    NextResponse.redirect(new URL("/login?error=1", config.origin), {
      status: 303,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    const reader = request.body?.getReader();
    if (!reader) return failed();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data = new URLSearchParams(new TextDecoder().decode(bytes));
    const email = data.get("email");
    const password = data.get("password");
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 128 ||
      !email.includes("@") ||
      !password
    )
      return failed();
    const client = await supabaseServer();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return failed();
    return NextResponse.redirect(new URL("/workspaces", config.origin), {
      status: 303,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return failed();
  }
}
