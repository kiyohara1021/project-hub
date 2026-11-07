import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

export function selfServiceAuthEnabled() {
  return !!supabaseConfig() && process.env.SELF_SERVICE_AUTH_ENABLED === "true";
}

export class AuthFormError extends Error {
  constructor(public status: number) {
    super("Invalid authentication form");
  }
}

export async function readAuthForm(request: Request, fields: string[]) {
  const config = supabaseConfig();
  if (!config) throw new AuthFormError(503);
  if (request.headers.get("origin") !== config.origin)
    throw new AuthFormError(403);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new AuthFormError(415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthFormError(400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new AuthFormError(413);
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
  for (const key of data.keys())
    if (!fields.includes(key) || data.getAll(key).length !== 1)
      throw new AuthFormError(400);
  return data;
}

export function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPassword(password: string) {
  return (
    password.length >= 12 && password.length <= 128 && !password.includes("\0")
  );
}

export function authRedirect(path: string) {
  const config = supabaseConfig();
  if (!config) return new Response(null, { status: 503 });
  return NextResponse.redirect(new URL(path, config.origin), {
    status: 303,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function safeAuthNext(next: string | null) {
  if (next === "/reset-password") return next;
  if (next && /^\/invitations\/[A-Za-z0-9_-]{43}$/.test(next)) return next;
  return "/workspaces";
}

export function authFormFailure(error: unknown, fallback: string) {
  if (error instanceof AuthFormError)
    return new Response(null, {
      status: error.status,
      headers: { "Cache-Control": "no-store" },
    });
  return authRedirect(fallback);
}
