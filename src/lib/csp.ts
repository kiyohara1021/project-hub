export const cspHeader = "Content-Security-Policy";

export function createNonce() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
  );
}

export function contentSecurityPolicy(nonce: string, development = false) {
  if (nonce.trim() !== nonce || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function cspResponseHeaders(nonce: string, development = false) {
  return new Headers({
    [cspHeader]: contentSecurityPolicy(nonce, development),
    "Cache-Control": "private, no-store",
  });
}
