import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  localSettings,
  login,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";

test("表示名は本人だけが変更でき、Unicode境界と既存履歴を維持する", async () => {
  const settings = localSettings(),
    service = adminClient(settings),
    actor = await login(settings, "viewer"),
    other = await login(settings, "member");
  const original = checked(
    await service
      .from("profiles")
      .select("display_name")
      .eq("id", actor.user.id)
      .single(),
  ).display_name;
  const otherName = checked(
    await service
      .from("profiles")
      .select("display_name")
      .eq("id", other.user.id)
      .single(),
  ).display_name;
  const wid = checked(
    await actor.client.rpc("create_workspace", { p_name: "表示名の履歴検証" }),
  );
  const history = checked(
    await service
      .from("activity_logs")
      .select("id,actor_display_name")
      .eq("workspace_id", wid),
  );
  assert.ok(history.length > 0);
  try {
    const updated = checked(
      await actor.client.rpc("update_my_profile", {
        p_display_name: "　 表示名の検証 \n",
      }),
    );
    assert.equal(updated.id, actor.user.id);
    assert.equal(updated.display_name, "表示名の検証");
    for (const name of [null, "", " \n　", "😀".repeat(81)])
      assert.equal(
        (await actor.client.rpc("update_my_profile", { p_display_name: name }))
          .error?.code,
        "22023",
      );
    assert.equal(
      checked(
        await actor.client.rpc("update_my_profile", {
          p_display_name: "😀".repeat(80),
        }),
      ).display_name,
      "😀".repeat(80),
    );
    // 他人のIDを指定する経路も、テーブルへの直接更新権限も提供しない。
    assert.ok(
      (
        await actor.client.rpc("update_my_profile", {
          p_display_name: "変更不可",
          p_user_id: other.user.id,
        })
      ).error,
    );
    assert.equal(
      (
        await actor.client
          .from("profiles")
          .update({ display_name: "変更不可" })
          .eq("id", other.user.id)
      ).error?.code,
      "42501",
    );
    assert.equal(
      checked(
        await service
          .from("profiles")
          .select("display_name")
          .eq("id", other.user.id)
          .single(),
      ).display_name,
      otherName,
    );
    assert.deepEqual(
      checked(
        await service
          .from("activity_logs")
          .select("id,actor_display_name")
          .eq("workspace_id", wid),
      ),
      history,
    );
    const anon = createClient(settings.API_URL, settings.ANON_KEY, {
      auth: { persistSession: false },
    });
    assert.equal(
      (await anon.rpc("update_my_profile", { p_display_name: "変更不可" }))
        .error?.code,
      "42501",
    );
    // ワークスペース無所属でも、自分のプロフィールは管理できる。
    const unassigned = await login(settings, "unassigned");
    const before = checked(
      await unassigned.client
        .from("profiles")
        .select("display_name")
        .eq("id", unassigned.user.id)
        .single(),
    );
    checked(
      await unassigned.client.rpc("update_my_profile", {
        p_display_name: before.display_name,
      }),
    );
  } finally {
    checked(
      await service
        .from("profiles")
        .update({ display_name: original })
        .eq("id", actor.user.id),
    );
    for (const table of ["memberships", "activity_logs"])
      checked(await service.from(table).delete().eq("workspace_id", wid));
    checked(await service.from("workspaces").delete().eq("id", wid));
  }
});
