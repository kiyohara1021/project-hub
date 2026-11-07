import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  localSettings,
  adminClient,
  checked,
} from "../../scripts/local-supabase.mjs";
const origin = "http://127.0.0.1:3101";
const password = "Signup-Local-Only-2026!";

async function confirmation(
  request: APIRequestContext,
  email: string,
  subject: string,
) {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(
        "http://127.0.0.1:54324/api/v1/messages",
      );
      expect(response.ok()).toBe(true);
      const data = await response.json();
      const message = data.messages?.find(
        (message: { ID: string; Subject: string; To: { Address: string }[] }) =>
          message.Subject.includes(subject) &&
          message.To.some((to) => to.Address.toLowerCase() === email),
      );
      id = message?.ID;
      return !!id;
    })
    .toBe(true);
  const response = await request.get(
    `http://127.0.0.1:54324/api/v1/message/${id}`,
  );
  const message = await response.json();
  const html = message.HTML as string;
  const href = html.match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
  expect(href).toBeTruthy();
  const url = new URL(href!);
  expect(url.origin).toBe(origin);
  expect(url.pathname).toBe("/confirm");
  return url;
}

test("登録確認は別ブラウザのPOSTで完了し、本人の作業場所を再送可能に作成する", async ({
  page,
  request,
  browser,
}) => {
  const email = `signup-${crypto.randomUUID()}@example.invalid`;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/signup");
  await page.getByLabel("表示名", { exact: true }).fill("新しい利用者");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "確認メールを送る", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signup\?sent=1$/);
  expect(
    (
      await request.post(`${origin}/auth/login`, {
        headers: { origin },
        form: { email, password },
        maxRedirects: 0,
      })
    ).headers().location,
  ).toBe(`${origin}/login?error=1`);
  const url = await confirmation(request, email, "メールアドレス確認");
  // Merely following the link must not consume the token or grant a session.
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    const confirmationResponse = await recipient.goto(url.toString());
    expect(confirmationResponse!.headers()["referrer-policy"]).toBe(
      "strict-origin",
    );
    expect(
      (
        await context.request.post(`${origin}/api/v1/workspaces`, {
          headers: { origin, "Idempotency-Key": crypto.randomUUID() },
          data: { name: "確認前" },
        })
      ).status(),
    ).toBe(401);
    await recipient
      .getByRole("button", { name: "メールアドレスを確認", exact: true })
      .click();
    await expect(recipient).toHaveURL(/\/workspaces$/);
    await expect(
      recipient.getByText("ログイン中: 新しい利用者", { exact: true }),
    ).toBeVisible();
    await expect(
      recipient.getByText("所属ワークスペースがありません", { exact: true }),
    ).toBeVisible();
    await recipient
      .getByRole("button", { name: "ワークスペースを作成", exact: true })
      .click();
    await recipient.getByLabel("ワークスペース名").fill("最初のワークスペース");
    await recipient
      .getByRole("button", { name: "作成する", exact: true })
      .click();
    await expect(recipient).toHaveURL(/\/dashboard\?workspace=/);
    const wid = new URL(recipient.url()).searchParams.get("workspace")!;
    const registered = checked(
      await adminClient(localSettings()).auth.admin.listUsers({
        perPage: 1000,
      }),
    ).users;
    const profile = registered.find(
      (user: { id: string; email?: string }) => user.email === email,
    );
    expect(profile).toBeTruthy();
    expect(
      checked(
        await adminClient(localSettings())
          .from("memberships")
          .select("role")
          .eq("workspace_id", wid)
          .eq("user_id", profile.id),
      ),
    ).toEqual([{ role: "admin" }]);
    const key = crypto.randomUUID();
    const payload = { name: "再送のワークスペース" };
    const [a, b] = await Promise.all([
      context.request.post(`${origin}/api/v1/workspaces`, {
        headers: { origin, "Idempotency-Key": key },
        data: payload,
      }),
      context.request.post(`${origin}/api/v1/workspaces`, {
        headers: { origin, "Idempotency-Key": key },
        data: payload,
      }),
    ]);
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(201);
    expect(await a.json()).toEqual(await b.json());
    expect(
      (
        await context.request.post(`${origin}/api/v1/workspaces`, {
          headers: { origin, "Idempotency-Key": key },
          data: { name: "別の名前" },
        })
      ).status(),
    ).toBe(409);
    await recipient.goto(url.toString());
    await recipient
      .getByRole("button", { name: "メールアドレスを確認", exact: true })
      .click();
    await expect(recipient).toHaveURL(/\/confirm\?error=1$/);
  } finally {
    await context.close();
  }
});

test("パスワード再設定の確認後は新しいパスワードで認証できる", async ({
  page,
  request,
}) => {
  const email = `recover-${crypto.randomUUID()}@example.invalid`;
  const service = adminClient(localSettings());
  checked(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    }),
  );
  await page.goto("/forgot-password");
  await page.getByLabel("メールアドレス").fill(email);
  await page
    .getByRole("button", { name: "再設定の案内を送る", exact: true })
    .click();
  await expect(page).toHaveURL(/\/forgot-password\?sent=1$/);
  const url = await confirmation(request, email, "パスワード再設定");
  await page.goto(url.toString());
  await page
    .getByRole("button", { name: "確認して再設定へ進む", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reset-password$/);
  const changed = "Changed-Local-Only-2026!";
  await page.getByLabel("パスワード", { exact: true }).fill(changed);
  await page.getByLabel("パスワード（確認）", { exact: true }).fill(changed);
  await page
    .getByRole("button", { name: "パスワードを保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspaces\?password_updated=1$/);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(changed);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});

test("アカウントフォームはOrigin・入力上限・不正トークン・外部遷移を拒否する", async ({
  request,
  page,
}) => {
  for (const route of ["signup", "recover", "confirm", "password"]) {
    expect(
      (
        await request.post(`${origin}/auth/${route}`, {
          headers: { origin: "https://other.example" },
          form: { email: "test@example.invalid" },
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(`${origin}/auth/${route}`, {
          headers: { origin },
          data: { email: "test@example.invalid" },
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(415);
    expect(
      (
        await request.post(`${origin}/auth/${route}`, {
          headers: {
            origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          data: "email=" + "a".repeat(4097),
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(413);
  }
  expect(
    (
      await request.post(`${origin}/auth/signup`, {
        headers: {
          origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: "email=a%40example.invalid&email=b%40example.invalid&password=Enough-Password-2026!&display_name=Test",
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(400);
  const invalid = await request.post(`${origin}/auth/confirm`, {
    headers: { origin },
    form: {
      token_hash: "invalid",
      type: "email",
      next: "https://other.example",
    },
    maxRedirects: 0,
  });
  expect(invalid.headers().location).toBe(`${origin}/confirm?error=1`);
  await page.goto(
    "/confirm?token_hash=" +
      "a".repeat(64) +
      "&type=email&next=https://other.example",
  );
  await expect(page.locator('input[name="next"]')).toHaveValue("/workspaces");
  expect(
    (
      await request.post(`${origin}/api/v1/workspaces`, {
        headers: { origin, "Idempotency-Key": crypto.randomUUID() },
        data: { name: "匿名" },
      })
    ).status(),
  ).toBe(401);
});
