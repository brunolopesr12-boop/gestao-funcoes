import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * Testes ponta a ponta contra o app real + PostgreSQL local com RLS
 * (gateway em tests/local-supabase). Rode: npm run e2e
 */
const anonKey = execSync("node tests/local-supabase/server.mjs --anon-key").toString().trim();
const serviceKey = execSync("node tests/local-supabase/server.mjs --service-key").toString().trim();
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.mjs",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    ...devices["Desktop Chrome"],
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
  },
  webServer: {
    command: `npx next dev -p ${port} 2>&1 | tee .tools/next-dev.log`,
    url: `http://localhost:${port}/login`,
    timeout: 180_000,
    reuseExistingServer: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      CRON_SECRET: "e2e-cron",
      VILA_GPT_ADMIN_PIN: "123456",
    },
  },
});
