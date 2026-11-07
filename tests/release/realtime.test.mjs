import test from "node:test";
import assert from "node:assert/strict";
import {
  contentSecurityPolicy,
  createNonce,
  realtimeConnectSources,
} from "../../src/lib/csp.ts";
import { publicSupabaseConfig } from "../../src/lib/supabase/public-config.ts";

test("RealtimeのCSP接続先は設定した1プロジェクトだけでPreviewはselfを維持する", () => {
  const url = "https://abcdefghijklmnopqrst.supabase.co";
  assert.deepEqual(realtimeConnectSources(url), [
    url,
    "wss://abcdefghijklmnopqrst.supabase.co",
  ]);
  assert.deepEqual(realtimeConnectSources("http://127.0.0.1:54321"), [
    "http://127.0.0.1:54321",
    "ws://127.0.0.1:54321",
  ]);
  const nonce = createNonce();
  assert.match(
    contentSecurityPolicy(nonce, false, url),
    /connect-src 'self' https:\/\/abcdefghijklmnopqrst\.supabase\.co wss:\/\/abcdefghijklmnopqrst\.supabase\.co;/,
  );
  assert.match(contentSecurityPolicy(nonce), /connect-src 'self';/);
  assert.ok(!contentSecurityPolicy(nonce).includes("supabase.co"));
  for (const invalid of [
    "https://example.invalid",
    `${url}/path`,
    `${url}/`,
    `${url}?secret=value`,
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://user:pass@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.invalid",
    "http://127.0.0.1:8000",
    "ws://127.0.0.1:54321",
  ])
    assert.throws(
      () => realtimeConnectSources(invalid),
      /Invalid Supabase realtime URL/,
    );
});

test("ブラウザへ渡すのは公開URLと公開鍵だけで管理鍵は拒否する", () => {
  const url = "https://abcdefghijklmnopqrst.supabase.co";
  assert.deepEqual(
    publicSupabaseConfig({
      url,
      key: "sb_publishable_test_key",
      origin: "https://app.example.invalid",
      secret: "not-forwarded",
    }),
    { url, key: "sb_publishable_test_key" },
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.test`;
    if (role === "anon")
      assert.equal(publicSupabaseConfig({ url, key }).key, key);
    else
      assert.throws(
        () => publicSupabaseConfig({ url, key }),
        /public Supabase key/,
      );
  }
  for (const key of ["sb_secret_test_key", "", "sb_publishable_", "invalid"])
    assert.throws(
      () => publicSupabaseConfig({ url, key }),
      /public Supabase key/,
    );
});
