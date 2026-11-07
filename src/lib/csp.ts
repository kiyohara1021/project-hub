export const cspHeader = "Content-Security-Policy";

export function createNonce() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
  );
}

export function realtimeConnectSources(supabaseUrl?: string) {
  if (!supabaseUrl) return [];
  try {
    const parsed = new URL(supabaseUrl);
    const hosted =
      parsed.protocol === "https:" &&
      /^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname) &&
      !parsed.port;
    const local =
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "54321";
    if ((!hosted && !local) || parsed.origin !== supabaseUrl) throw new Error();
    return [parsed.origin, `${hosted ? "wss" : "ws"}://${parsed.host}`];
  } catch {
    throw new Error("Invalid Supabase realtime URL");
  }
}

export function contentSecurityPolicy(
  nonce: string,
  development = false,
  supabaseUrl?: string,
) {
  if (nonce.trim() !== nonce || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `connect-src 'self'${realtimeConnectSources(supabaseUrl)
      .map((origin) => ` ${origin}`)
      .join("")}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function cspResponseHeaders(
  nonce: string,
  development = false,
  supabaseUrl?: string,
) {
  return new Headers({
    [cspHeader]: contentSecurityPolicy(nonce, development, supabaseUrl),
    "Cache-Control": "private, no-store",
  });
}
