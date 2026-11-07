import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  localSettings,
  login,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";

test("役職と自己紹介は本人だけが更新し、省略・空文字・Unicode境界を区別する", async () => {
  const settings = localSettings();
  const service = adminClient(settings);
  const actor = await login(settings, "viewer");
  const other = await login(settings, "member");
  const fields = "display_name,job_title,bio";
  const original = checked(
    await service
      .from("profiles")
      .select(fields)
      .eq("id", actor.user.id)
      .single(),
  );
  const otherBefore = checked(
    await service
      .from("profiles")
      .select(fields)
      .eq("id", other.user.id)
      .single(),
  );
  const history = checked(
    await service
      .from("activity_logs")
      .select("id,actor_display_name,changes")
      .eq("actor_id", actor.user.id)
      .order("id"),
  );
  try {
    const updated = checked(
      await actor.client.rpc("update_my_profile_details", {
        p_display_name: original.display_name,
        p_job_title: "　開発担当　",
        p_bio: "\nサンプルの自己紹介\n次の行　",
      }),
    );
    assert.equal(updated.id, actor.user.id);
    assert.equal(updated.job_title, "開発担当");
    assert.equal(updated.bio, "サンプルの自己紹介\n次の行");
    assert.deepEqual(
      checked(
        await other.client
          .from("profiles")
          .select("job_title,bio")
          .eq("id", actor.user.id)
          .single(),
      ),
      { job_title: updated.job_title, bio: updated.bio },
    );
    const outsider = await login(settings, "outside");
    assert.deepEqual(
      checked(
        await outsider.client
          .from("profiles")
          .select("job_title,bio")
          .eq("id", actor.user.id),
      ),
      [],
    );
    // 表示名だけの旧RPCも、追加項目を省略する新RPCも既存値を残す。
    const legacy = checked(
      await actor.client.rpc("update_my_profile", {
        p_display_name: original.display_name,
      }),
    );
    assert.equal(legacy.job_title, updated.job_title);
    assert.equal(legacy.bio, updated.bio);
    const partial = checked(
      await actor.client.rpc("update_my_profile_details", {
        p_display_name: original.display_name,
        p_job_title: "テスト担当",
      }),
    );
    assert.equal(partial.bio, updated.bio);
    assert.equal(partial.job_title, "テスト担当");
    const boundary = checked(
      await actor.client.rpc("update_my_profile_details", {
        p_display_name: original.display_name,
        p_job_title: "😀".repeat(80),
        p_bio: "😀".repeat(500),
      }),
    );
    assert.equal(boundary.job_title, "😀".repeat(80));
    assert.equal(boundary.bio, "😀".repeat(500));
    for (const input of [
      { p_display_name: " " },
      { p_display_name: null },
      { p_display_name: original.display_name, p_job_title: "😀".repeat(81) },
      { p_display_name: original.display_name, p_bio: "😀".repeat(501) },
    ]) {
      assert.equal(
        (await actor.client.rpc("update_my_profile_details", input)).error
          ?.code,
        "22023",
      );
    }
    const cleared = checked(
      await actor.client.rpc("update_my_profile_details", {
        p_display_name: original.display_name,
        p_job_title: " \n　",
        p_bio: "",
      }),
    );
    assert.equal(cleared.job_title, "");
    assert.equal(cleared.bio, "");
    assert.ok(
      (
        await actor.client.rpc("update_my_profile_details", {
          p_display_name: "変更不可",
          p_user_id: other.user.id,
          p_bio: "変更不可",
        })
      ).error,
    );
    for (const id of [actor.user.id, other.user.id]) {
      assert.equal(
        (
          await actor.client
            .from("profiles")
            .update({ job_title: "変更不可", bio: "変更不可" })
            .eq("id", id)
        ).error?.code,
        "42501",
      );
    }
    assert.deepEqual(
      checked(
        await service
          .from("profiles")
          .select(fields)
          .eq("id", other.user.id)
          .single(),
      ),
      otherBefore,
    );
    assert.deepEqual(
      checked(
        await service
          .from("activity_logs")
          .select("id,actor_display_name,changes")
          .eq("actor_id", actor.user.id)
          .order("id"),
      ),
      history,
    );
    const anon = createClient(settings.API_URL, settings.ANON_KEY, {
      auth: { persistSession: false },
    });
    assert.equal(
      (
        await anon.rpc("update_my_profile_details", {
          p_display_name: "変更不可",
          p_bio: "変更不可",
        })
      ).error?.code,
      "42501",
    );
    const unassigned = await login(settings, "unassigned");
    const own = checked(
      await unassigned.client
        .from("profiles")
        .select(fields)
        .eq("id", unassigned.user.id)
        .single(),
    );
    const saved = checked(
      await unassigned.client.rpc("update_my_profile_details", {
        p_display_name: own.display_name,
        p_job_title: own.job_title,
        p_bio: own.bio,
      }),
    );
    assert.equal(saved.id, unassigned.user.id);
  } finally {
    checked(
      await service.from("profiles").update(original).eq("id", actor.user.id),
    );
  }
});
