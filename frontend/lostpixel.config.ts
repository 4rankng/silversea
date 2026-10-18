import type { Config } from "lost-pixel";

// Visual regression baselines cho các màn chính (QA gate sau mỗi deploy).
//   pnpm visual:base   — chụp baseline (chạy 1 lần / khi UI cố ý đổi)
//   pnpm visual:check  — diff against baseline (gate sau deploy)
// Env: VISUAL_BASE_URL (mặc định staging), VISUAL_USER/VISUAL_PASS (mặc định QA dispatcher).

const BASE = process.env.VISUAL_BASE_URL ?? "https://vantai.tingting.vip";
const USER = process.env.VISUAL_USER ?? "dungnv";
const PASS = process.env.VISUAL_PASS ?? "Abc123";

let authed = false;

async function login(page: import("playwright").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#password-input", { timeout: 20_000 });
  const idInput = page.locator('input:not([type="password"])').first();
  await idInput.fill(USER);
  await page.fill("#password-input", PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dispatch|shipments|driver/, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  authed = true;
}

export const config: Config = {
  pageShots: {
    baseUrl: BASE,
    pages: [
      { path: "/dispatch", name: "dispatch-master-plan", waitBeforeScreenshot: 5_000, threshold: 0.0005 },
      { path: "/dispatch-detail", name: "dispatch-detail-plan", waitBeforeScreenshot: 5_000, threshold: 0.0005 },
      { path: "/shipments", name: "cus-shipments", waitBeforeScreenshot: 5_000, threshold: 0.0005 },
    ],
  },
  beforeScreenshot: async (page) => {
    if (!authed) await login(page);
  },
  failOnDifference: true,
};
