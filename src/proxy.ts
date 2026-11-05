import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig, authCookieOptions } from "@/lib/supabase/config";
import {
  createNonce,
  contentSecurityPolicy,
  cspResponseHeaders,
} from "@/lib/csp";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const development = process.env.NODE_ENV === "development";
  const policy = contentSecurityPolicy(nonce, development);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.delete("Content-Security-Policy-Report-Only");
  const nextResponse = () => {
    const result = NextResponse.next({ request: { headers: requestHeaders } });
    cspResponseHeaders(nonce, development).forEach((value, name) =>
      result.headers.set(name, value),
    );
    return result;
  };
  let response = nextResponse();
  const config = supabaseConfig();
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
    "/auth/:path*",
    "/api/v1/:path*",
  ],
};
