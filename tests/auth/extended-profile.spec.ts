import { test, expect } from "@playwright/test";
import {
  localSettings,
  login as dbLogin,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";

const origin = "http://127.0.0.1:3101";

test("追加プロフィールAPIは入力を検証し、既存APIと省略項目を維持する", async ({
  page,
}) => {
  const settings = localSettings();
  const service = adminClient(settings);
  const actor = await dbLogin(settings, "viewer");
  const original = checked(
    await service
      .from("profiles")
      .select("display_name,job_title,bio")
      .eq("id", actor.user.id)
      .single(),
  );
  try {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("viewer@example.invalid");
    await page
      .getByLabel("パスワード", { exact: true })
      .fill("Local-Demo-Only-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
    const api = "/api/v1/me/profile",
      headers = { origin };
    for (const extra of [
      { job_title: null },
      { bio: null },
      { job_title: 1 },
      { bio: false },
      { job_title: "😀".repeat(81) },
      { bio: "😀".repeat(501) },
      { job_title: "a\u0000b" },
      { bio: "a\u0000b" },
      { user_id: actor.user.id },
    ]) {
      expect(
        (
          await page.request.patch(api, {
            headers,
            data: { display_name: original.display_name, ...extra },
          })
        ).status(),
      ).toBe(400);
    }
    const saved = await page.request.patch(api, {
      headers,
      data: {
        display_name: original.display_name,
        job_title: "　開発担当　",
        bio: "\n自己紹介\n次の行　",
      },
    });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).data).toEqual({
      id: actor.user.id,
      display_name: original.display_name,
      job_title: "開発担当",
      bio: "自己紹介\n次の行",
    });
    const partial = await page.request.patch(api, {
      headers,
      data: { display_name: original.display_name, job_title: "" },
    });
    expect((await partial.json()).data).toEqual({
      id: actor.user.id,
      display_name: original.display_name,
      job_title: "",
      bio: "自己紹介\n次の行",
    });
    const legacy = await page.request.patch(api, {
      headers,
      data: { display_name: original.display_name },
    });
    expect((await legacy.json()).data).toEqual({
      id: actor.user.id,
      display_name: original.display_name,
    });
    expect(
      checked(
        await service
          .from("profiles")
          .select("bio")
          .eq("id", actor.user.id)
          .single(),
      ).bio,
    ).toBe("自己紹介\n次の行");
  } finally {
    checked(
      await service.from("profiles").update(original).eq("id", actor.user.id),
    );
  }
});

test("360pxのプロフィール編集は追加項目を保存し、失敗時の入力と再表示を維持する", async ({
  page,
}) => {
  const settings = localSettings();
  const service = adminClient(settings);
  const actor = await dbLogin(settings, "unassigned");
  const original = checked(
    await service
      .from("profiles")
      .select("display_name,job_title,bio")
      .eq("id", actor.user.id)
      .single(),
  );
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("unassigned@example.invalid");
    await page
      .getByLabel("パスワード", { exact: true })
      .fill("Local-Demo-Only-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
    const form = page.getByRole("form", { name: "プロフィールの変更" });
    await form.getByLabel("役職・担当", { exact: true }).fill("  テスト担当  ");
    await form
      .getByLabel("自己紹介", { exact: true })
      .fill("自己紹介の1行目\n<script>文字列のまま</script>");
    let fail = true;
    await page.route("**/api/v1/me/profile", async (route) => {
      if (fail) {
        fail = false;
        return route.abort();
      }
      return route.continue();
    });
    await form
      .getByRole("button", { name: "プロフィールを保存", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("再試行");
    await expect(form.getByLabel("役職・担当", { exact: true })).toHaveValue(
      "  テスト担当  ",
    );
    await expect(form.getByLabel("自己紹介", { exact: true })).toHaveValue(
      "自己紹介の1行目\n<script>文字列のまま</script>",
    );
    await form
      .getByRole("button", { name: "プロフィールを保存", exact: true })
      .click();
    await expect(form.getByRole("status")).toHaveText(
      "プロフィールを保存しました。",
    );
    await expect(form.getByLabel("役職・担当", { exact: true })).toHaveValue(
      "テスト担当",
    );
    await page.reload();
    await expect(form.getByLabel("役職・担当", { exact: true })).toHaveValue(
      "テスト担当",
    );
    await expect(form.getByLabel("自己紹介", { exact: true })).toHaveValue(
      "自己紹介の1行目\n<script>文字列のまま</script>",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    checked(
      await service.from("profiles").update(original).eq("id", actor.user.id),
    );
  }
});
