#!/usr/bin/env node
/**
 * CUS create FCL shipment — robust v3.
 * Uses click→type→wait→click-option flow for every combobox.
 *
 * Output: qa/<date>_cus-create/cus-create/{01..03}_*.png + result.json
 */

import puppeteer from "puppeteer";
import { join } from "node:path";
import { api, login } from "./lib/http.mjs";
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  STANDARD_VIEWPORT,
  installPageLogging,
  pickCombobox,
  fillPlain,
  sleep,
  withSession,
  writeArtifact,
} from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:7174";
const BACKEND = process.env.BACKEND ?? "http://localhost:3001/api";
const ROOT = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_cus-create`;

const cusToken = await login("cus");
const customersRes = await api(cusToken, "GET", "/customers?limit=20");
const customer = customersRes.data.items?.find((c) => c.status === "ACTIVE" && !c.isCarrier) || customersRes.data.items?.[0];
console.log("Customer:", customer.id, customer.name);

const billNo = "BK-QA-" + Date.now();
const containerNo = "MSCU" + String(Date.now()).slice(-7);
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
const pickupIso = tomorrow.toISOString().slice(0, 16);

await withSession(cusToken, async (page, ctx) => {
  installPageLogging(page, ctx.log);

  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(3000);
  await page.screenshot({ path: join(ROOT, "01_form_loaded.png") });

  ctx.log.push("--- customer ---");
  await pickCombobox(page, "Khách hàng", customer.name, ctx.log);
  await fillPlain(page, "hình thức|xuất nhập", "IMPORT", ctx.log);
  await fillPlain(page, "Bill", billNo, ctx.log);
  await fillPlain(page, "Số container", containerNo, ctx.log);
  await pickCombobox(page, "Loại container", "40", ctx.log);
  await pickCombobox(page, "Tuyến đường", "HN", ctx.log);
  await pickCombobox(page, "Cảng nâng", "H", ctx.log);
  await pickCombobox(page, "Cảng hạ", "H", ctx.log);
  await fillPlain(page, "Trọng lượng", "25000", ctx.log);
  await fillPlain(page, "Ngày giờ", pickupIso, ctx.log);

  await page.screenshot({ path: join(ROOT, "02_form_filled.png") });

  const submitState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() ?? ""));
    return sub ? { text: sub.textContent.trim(), disabled: sub.disabled } : null;
  });
  ctx.log.push("submit state: " + JSON.stringify(submitState));

  if (submitState && !submitState.disabled) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() ?? ""));
      if (sub) sub.click();
    });
    const nav = page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 }).catch(() => null);
    await Promise.race([nav, sleep(6_000)]);
    ctx.log.push("post-submit URL: " + page.url());
  }

  await page.screenshot({ path: join(ROOT, "03_after_submit.png"), fullPage: true });

  if (page.url().endsWith("/shipments/new")) {
    const errs = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[role="alert"], [class*="error" i], .text-red-500, .text-red-600, .text-red-700, [class*="invalid" i]'));
      return all.slice(0, 10).map((e) => e.textContent?.trim().slice(0, 100)).filter(Boolean);
    });
    ctx.log.push("error messages: " + JSON.stringify(errs));
  }
}, { artifactDir: ROOT, name: "cus-create", puppeteerImpl: puppeteer });

writeArtifact(ROOT, "result.json", {
  customer: { id: customer.id, name: customer.name },
  billNo,
  containerNo,
  pickupIso,
});
console.log("\nDone. Artifacts:", ROOT);
process.exit(0);
