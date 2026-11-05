import test from "node:test";
import assert from "node:assert/strict";
import {
  createNonce,
  cspResponseHeaders,
  contentSecurityPolicy,
} from "../../src/lib/csp.ts";

test("CSPは要求ごとにnonceを生成し、応答にはReport-Onlyだけを設定する", () => {
  const nonce = createNonce();
  const nextNonce = createNonce();
  assert.notEqual(nonce, nextNonce);
  assert.equal(Buffer.from(nonce, "base64").length, 16);
  const headers = cspResponseHeaders(nonce);
  assert.equal(headers.get("Content-Security-Policy"), null);
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  const policy = headers.get("Content-Security-Policy-Report-Only");
  assert.ok(
    policy.includes(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`),
  );
  assert.ok(policy.includes(`style-src-elem 'self' 'nonce-${nonce}'`));
  assert.ok(policy.includes("style-src-attr 'unsafe-inline'"));
  assert.ok(policy.includes("connect-src 'self'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!policy.match(/script-src[^;]*'unsafe-inline'/));
});

test("evalは開発時だけ許可し、不正なnonceを拒否する", () => {
  const nonce = createNonce();
  assert.ok(contentSecurityPolicy(nonce, true).includes("'unsafe-eval'"));
  assert.ok(!contentSecurityPolicy(nonce, false).includes("'unsafe-eval'"));
  for (const invalid of ["", "a' 'unsafe-inline", "<script>", "a b", "a\n"])
    assert.throws(() => contentSecurityPolicy(invalid));
});
