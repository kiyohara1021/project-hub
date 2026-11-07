export type PublicSupabaseConfig = { url: string; key: string };

// Browserへ渡す前に公開鍵だけであることを再検査する。変数名だけでは判定しない。
export function publicSupabaseConfig(
  config: PublicSupabaseConfig,
): PublicSupabaseConfig {
  let allowed = /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key);
  if (!allowed) {
    try {
      const pieces = config.key.split(".");
      const payload = JSON.parse(
        Buffer.from(pieces[1], "base64url").toString("utf8"),
      );
      allowed = pieces.length === 3 && payload.role === "anon";
    } catch {
      allowed = false;
    }
  }
  if (!allowed) throw new Error("Realtime requires a public Supabase key");
  return { url: config.url, key: config.key };
}
