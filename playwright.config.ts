import { defineConfig, devices } from "@playwright/test";

// E2E_PORT / E2E_CHAIN_PORT let a second run use its own previews (and build dirs) next to a running one.
const PORT = Number(process.env.E2E_PORT || 5190);
const CHAIN_PORT = Number(process.env.E2E_CHAIN_PORT || 5191);
const DIST = process.env.E2E_PORT ? `scratch/e2e-dist-${PORT}` : "scratch/e2e-dist";
const CHAIN_DIST = process.env.E2E_CHAIN_PORT ? `scratch/e2e-chain-dist-${CHAIN_PORT}` : "scratch/e2e-chain-dist";
const CHAIN_URL = `http://localhost:${CHAIN_PORT}/third-chair/`;
const DESKTOP = { width: 1280, height: 720 };

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}/third-chair/`,
    trace: "retain-on-failure",
  },
  projects: [
    // Chain suite: one guest hand on the short-window test contract (testnet-test.json).
    {
      name: "chain",
      testMatch: /chain\.spec\.ts/,
      timeout: 360_000,
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP, baseURL: CHAIN_URL },
    },
    {
      name: "chain-firefox",
      testMatch: /chain\.spec\.ts/,
      timeout: 360_000,
      use: { ...devices["Desktop Firefox"], viewport: DESKTOP, baseURL: CHAIN_URL },
    },
    {
      // Playwright WebKit, not Apple Safari.
      name: "chain-webkit",
      testMatch: /chain\.spec\.ts/,
      timeout: 360_000,
      use: { ...devices["Desktop Safari"], viewport: DESKTOP, baseURL: CHAIN_URL },
    },
    {
      // Real Chromium engine (Playwright). Not a substitute for branded Chrome + extensions.
      name: "practice",
      testMatch: /practice\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP },
    },
    {
      // Real Firefox/Gecko via Playwright.
      name: "practice-firefox",
      testMatch: /practice\.spec\.ts/,
      use: { ...devices["Desktop Firefox"], viewport: DESKTOP },
    },
    {
      // Playwright WebKit — NOT Apple Safari (extensions, ITP, and shipping WebKit differ).
      name: "practice-webkit",
      testMatch: /practice\.spec\.ts/,
      use: { ...devices["Desktop Safari"], viewport: DESKTOP },
    },
    {
      // Viewport/UA/touch emulation on Chromium — NOT physical Android Chrome.
      name: "practice-mobile-chrome-emulation",
      testMatch: /practice\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      // Viewport/UA/touch emulation on WebKit — NOT physical iOS Safari.
      name: "practice-mobile-safari-emulation",
      testMatch: /practice\.spec\.ts/,
      use: { ...devices["iPhone 14"] },
    },
  ],
  // A production build served by vite preview: no dependency re-optimization reloads mid-test.
  webServer: [
    {
      command: `npx vite build --base /third-chair/ --outDir ${DIST} --emptyOutDir --logLevel warn && npx vite preview --base /third-chair/ --outDir ${DIST} --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/third-chair/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The chain suite talks to the short-window test contract, never the live one.
      command: `VITE_DEPLOYMENT=testnet-test.json npx vite build --base /third-chair/ --outDir ${CHAIN_DIST} --emptyOutDir --logLevel warn && npx vite preview --base /third-chair/ --outDir ${CHAIN_DIST} --port ${CHAIN_PORT} --strictPort`,
      url: CHAIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
