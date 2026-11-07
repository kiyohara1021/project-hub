import { test, expect } from "@playwright/test";
import {
  localSettings,
  adminClient,
  checked,
  demoPassword,
} from "../../scripts/local-supabase.mjs";
import { localSql } from "../../scripts/local-sql.mjs";
const origin = "http://127.0.0.1:3101";
test("メール招待は別ブラウザで確認し明示承諾するまで所属を追加しない", async ({
  page,
  request,
  browser,
}) => {
  const service = adminClient(localSettings());
  const email = `invitation-${crypto.randomUUID()}@example.invalid`;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.request.post(`${origin}/auth/login`, {
    headers: { origin },
    form: { email: "admin@example.invalid", password: demoPassword },
  });
  const space = await page.request.post(`${origin}/api/v1/workspaces`, {
    headers: { origin, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "招待のテスト用ワークスペース" },
  });
  expect(space.status()).toBe(201);
  const wid = (await space.json()).data.id;
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  try {
    await page.goto(`/members?workspace=${wid}`);
    await page.getByLabel("宛先メール").fill(email);
    await page.getByRole("button", { name: "招待を送る", exact: true }).click();
    await expect(
      page.getByText(
        "認証サービスが送信を受け付けました。到着を保証するものではありません。",
      ),
    ).toBeVisible();
    let mailId = "";
    await expect
      .poll(async () => {
        const r = await request.get("http://127.0.0.1:54324/api/v1/messages");
        const messages = await r.json();
        mailId =
          messages.messages?.find(
            (m: { ID: string; To: { Address: string }[] }) =>
              m.To.some((t) => t.Address.toLowerCase() === email),
          )?.ID ?? "";
        return !!mailId;
      })
      .toBe(true);
    const mail = await (
      await request.get(`http://127.0.0.1:54324/api/v1/message/${mailId}`)
    ).json();
    const link = mail.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
    const url = new URL(link);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/confirm");
    const next = url.searchParams.get("next")!;
    expect(next).toMatch(/^\/invitations\/[A-Za-z0-9_-]{43}$/);
    const recipient = await context.newPage();
    await recipient.goto(next);
    await expect(
      recipient.getByRole("link", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await expect(
      recipient.getByText("招待のテスト用ワークスペースへの招待", {
        exact: true,
      }),
    ).toHaveCount(0);
    await recipient.goto(link);
    expect(
      (
        await context.request.post(`${origin}/api/v1${next}/accept`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
    await recipient
      .getByRole("button", { name: "メールアドレスを確認", exact: true })
      .click();
    await expect(recipient).toHaveURL(`${origin}${next}`);
    await expect(
      recipient.getByRole("heading", {
        name: "招待のテスト用ワークスペースへの招待",
      }),
    ).toBeVisible();
    expect(
      checked(
        await service
          .from("memberships")
          .select("user_id")
          .eq("workspace_id", wid),
      ),
    ).toHaveLength(1);
    await recipient
      .getByRole("button", { name: "招待を承諾する", exact: true })
      .click();
    await expect(recipient).toHaveURL(`${origin}/members?workspace=${wid}`);
    expect(
      checked(
        await service
          .from("memberships")
          .select("user_id")
          .eq("workspace_id", wid),
      ),
    ).toHaveLength(2);
    expect(
      await recipient.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    localSql(`begin;
      delete from private.invitation_requests where workspace_id='${wid}';
      delete from private.workspace_requests where workspace_id='${wid}';
      delete from private.workspace_invitations where workspace_id='${wid}';
      delete from public.memberships where workspace_id='${wid}';
      delete from public.activity_logs where workspace_id='${wid}';
      delete from public.workspaces where id='${wid}';
      commit;`);
  }
});
