export function connectedMode() { return process.env.APP_MODE === "connected"; }

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const origin = process.env.APP_ORIGIN;
  if (!connectedMode() || !url || !key || !origin) return null;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return null;
  } catch { return null; }
  return { url, key, origin };
}
