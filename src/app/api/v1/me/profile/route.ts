import { supabaseServer } from "@/lib/supabase/server";
import {
  apiError,
  checkOrigin,
  json,
  readJson,
  ProjectError,
  rpcError,
} from "@/lib/projects-server";
import { exactKeys } from "@/lib/validation";

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const client = await supabaseServer();
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims.sub)
      throw new ProjectError(401, "UNAUTHENTICATED", "ログインしてください");
    const input = await readJson(request);
    const fields = ["display_name", "job_title", "bio"];
    const keys = Object.keys(input);
    exactKeys(
      input,
      fields.filter((key) => key === "display_name" || keys.includes(key)),
    );
    if (
      typeof input.display_name !== "string" ||
      input.display_name.includes("\u0000") ||
      !input.display_name.trim() ||
      Array.from(input.display_name.trim()).length > 80
    )
      throw new ProjectError(
        400,
        "INVALID_INPUT",
        "表示名は前後の空白を除いて1〜80文字で入力してください",
      );
    for (const [field, label, max] of [
      ["job_title", "役職・担当", 80],
      ["bio", "自己紹介", 500],
    ] as const) {
      if (
        field in input &&
        (typeof input[field] !== "string" ||
          input[field].includes("\u0000") ||
          Array.from(input[field].trim()).length > max)
      )
        throw new ProjectError(
          400,
          "INVALID_INPUT",
          `${label}は${max}文字以内で入力してください`,
        );
    }
    const extended = "job_title" in input || "bio" in input;
    const result = extended
      ? await client.rpc("update_my_profile_details", {
          p_display_name: input.display_name.trim(),
          p_job_title:
            typeof input.job_title === "string" ? input.job_title.trim() : null,
          p_bio: typeof input.bio === "string" ? input.bio.trim() : null,
        })
      : await client.rpc("update_my_profile", {
          p_display_name: input.display_name.trim(),
        });
    if (result.error) throw rpcError(result.error);
    const profile = result.data;
    return json({
      data: extended
        ? {
            id: profile.id,
            display_name: profile.display_name,
            job_title: profile.job_title,
            bio: profile.bio,
          }
        : { id: profile.id, display_name: profile.display_name },
    });
  } catch (error) {
    return apiError(error);
  }
}
