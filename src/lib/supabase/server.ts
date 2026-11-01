import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig, authCookieOptions } from "./config";

export async function supabaseServer() {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase connection is not configured");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions(config.origin),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        // Server ComponentではProxyが更新済み。Route Handlerでは書込を反映する。
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}
