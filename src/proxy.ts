import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig, authCookieOptions } from "@/lib/supabase/config";
import {
  createNonce,
  contentSecurityPolicy,
  cspResponseHeaders,
} from "@/lib/csp";

export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  const nonce = createNonce();
  const development = process.env.NODE_ENV === "development";
  const policy = contentSecurityPolicy(nonce, development, config?.url);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.delete("Content-Security-Policy-Report-Only");
  const nextResponse = () => {
    const result = NextResponse.next({ request: { headers: requestHeaders } });
    cspResponseHeaders(nonce, development, config?.url).forEach((value, name) =>
      result.headers.set(name, value),
    );
    if (
      request.nextUrl.pathname === "/confirm" ||
      request.nextUrl.pathname.startsWith("/invitations/") ||
      request.nextUrl.pathname === "/auth/confirm"
    )
      result.headers.set("Referrer-Policy", "strict-origin");
    return result;
  };
  let response = nextResponse();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions(config.origin),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        // Cookie refresh and the CSP must refer to the same downstream request.
        const cookie = request.headers.get("cookie");
        if (cookie) requestHeaders.set("cookie", cookie);
        else requestHeaders.delete("cookie");
        response = nextResponse();
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/activity",
    "/members",
    "/dashboard",
    "/projects/:path*",
    "/workspaces/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/confirm",
    "/notifications",
    "/invitations/:path*",
    "/auth/:path*",
    "/api/v1/:path*",
  ],
};
