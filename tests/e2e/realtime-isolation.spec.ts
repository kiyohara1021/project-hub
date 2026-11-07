import { test, expect } from "@playwright/test";

test("画面デモではRealtimeや認証サービスへ接続しない", async ({ page }) => {
  const sockets: string[] = [];
  const external: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  page.on("request", (request) => {
    if (/supabase\.co/.test(request.url())) external.push(request.url());
  });
  for (const path of ["/dashboard", "/projects", "/projects/demo-a/gantt"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  expect(sockets).toEqual([]);
  expect(external).toEqual([]);
  await expect(page.getByRole("status", { name: "同期状態" })).toHaveCount(0);
});
