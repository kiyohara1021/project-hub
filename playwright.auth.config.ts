import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/auth",
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    env: { APP_MODE: "connected", APP_ORIGIN: "http://127.0.0.1:3101" },
  },
});
