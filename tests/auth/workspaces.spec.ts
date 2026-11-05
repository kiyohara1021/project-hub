import { test, expect } from "@playwright/test";
import {
  localSettings,
  adminClient,
  checked,
  login as dbLogin,
} from "../../scripts/local-supabase.mjs";

test("ログイン状況は所属先ごとに最新5件を表示し、一覧へ案内する", async ({
  page,
}) => {
  const service = adminClient(localSettings());
  const viewer = await dbLogin(localSettings(), "viewer");
  const spaces = [0, 1, 2].map((i) => ({
    id: crypto.randomUUID(),
    name: `件数確認スペース${i}`,
  }));
  checked(await service.from("workspaces").insert(spaces));
  try {
    checked(
      await service.from("memberships").insert(
        spaces.slice(0, 2).map((w) => ({
          workspace_id: w.id,
          user_id: viewer.user.id,
          role: "viewer",
        })),
      ),
    );
    const projects = spaces.flatMap((w, spaceIndex) =>
      Array.from({ length: 7 }, (_, i) => ({
        id: crypto.randomUUID(),
        workspace_id: w.id,
        name: `件数確認${spaceIndex}-${i}`,
        status: "active",
        created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      })),
    );
    checked(await service.from("projects").insert(projects));
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("viewer@example.invalid");
    await page
      .getByLabel("パスワード", { exact: true })
      .fill("Local-Demo-Only-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const [index, space] of spaces.slice(0, 2).entries()) {
      const region = page.getByRole("region", {
        name: space.name,
        exact: true,
      });
      await expect(region.getByRole("listitem")).toHaveCount(5);
      await expect(region.getByRole("listitem")).toHaveText(
        [6, 5, 4, 3, 2].map((i) => `件数確認${index}-${i}進行中`),
      );
      await expect(
        region.getByRole("link", { name: "プロジェクト一覧へ →", exact: true }),
      ).toHaveAttribute("href", `/projects?workspace=${space.id}`);
    }
    await expect(
      page.getByRole("region", { name: spaces[2].name, exact: true }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("region", { name: spaces[0].name, exact: true })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`workspace=${spaces[0].id}`));
    await expect(
      page.getByRole("heading", { name: "件数確認0-0", exact: true }),
    ).toBeVisible();
  } finally {
    const ids = spaces.map((w) => w.id);
    checked(await service.from("projects").delete().in("workspace_id", ids));
    checked(await service.from("memberships").delete().in("workspace_id", ids));
    checked(
      await service.from("activity_logs").delete().in("workspace_id", ids),
    );
    checked(await service.from("workspaces").delete().in("id", ids));
  }
});
