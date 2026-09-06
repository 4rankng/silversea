#!/usr/bin/env node
/**
 * O2C happy-path UI driver — Silversea local dev.
 * Walks CUS → Điều vận → Lái xe for a single FCL shipment.
 *
 * Each step logs in via API to get token, injects via
 * evaluateOnNewDocument BEFORE any page load (see scripts/lib/ui-driver.mjs).
 *
 * Output: qa/<date>_o2c-happy/<step>/<role>_<step>.png + .json
 */

import puppeteer from "puppeteer";
import { join } from "node:path";
import { api, login } from "./lib/http.mjs";
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  STANDARD_VIEWPORT,
  clickFirstRoleOption,
  clickButtonByText,
  findInputIndexByLabel,
  setAtIndex,
  sleep,
  typeAtIndex,
  withSession,
  writeArtifact,
} from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:7174";
const BACKEND = process.env.BACKEND ?? "http://localhost:3001/api";
const ROOT = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_o2c-happy`;

const cusToken = await login("cus");
const customersRes = await api(cusToken, "GET", "/customers?limit=20");
const customer = customersRes.data.items?.find((c) => c.status === "ACTIVE" && !c.isCarrier) || customersRes.data.items?.[0];
console.log("Customer for test:", customer?.id, customer?.name);

const billNo = "BK-TEST-" + Date.now();
const containerNo = "MSCU" + String(Date.now()).slice(-7);
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
const pickupIso = tomorrow.toISOString().slice(0, 16);

const created = await withSession(cusToken, async (page, ctx) => {
  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(2500);
  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_form_loaded.png") });

  // Discover input indexes
  const discovered = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label"));
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    return inputs.map((inp, i) => {
      const lab = labels.find((l) => {
        if (l.getAttribute("for") === inp.id) return true;
        return l.parentElement === inp.parentElement || l.parentElement === inp.parentElement?.parentElement;
      });
      return {
        i,
        tag: inp.tagName,
        type: inp.type,
        id: (inp.id || "").slice(-20),
        ariaLabel: inp.getAttribute("aria-label"),
        placeholder: inp.placeholder?.slice(0, 30),
        labelText: lab?.textContent?.trim()?.slice(0, 40) || null,
      };
    });
  });
  ctx.log.push("discovered inputs: " + JSON.stringify(discovered, null, 2).slice(0, 2000));
  const byLabel = (substr) => discovered.findIndex((d) => (d.labelText || "").includes(substr) || (d.ariaLabel || "").includes(substr) || (d.placeholder || "").includes(substr));

  // 1) Customer combobox
  const customerIdx = byLabel("Khách hàng");
  if (customerIdx < 0) throw new Error("customer field not found");
  ctx.log.push(`customer at index ${customerIdx}`);
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: customerIdx });
  await page.keyboard.type(customer.name, { delay: 30 });
  await sleep(900);
  ctx.log.push("Customer option picked: " + await clickFirstRoleOption(page));
  await sleep(400);

  // 2) Import/Export — first <select>
  await page.select("select", "IMPORT");
  ctx.log.push("Import selected");

  // 3) Bill/Booking
  const billIdx = byLabel("Bill");
  if (billIdx < 0) throw new Error("Bill field not found");
  await typeAtIndex(page, billIdx, billNo);
  ctx.log.push(`Bill/Booking at index ${billIdx}: ${billNo}`);

  // 4) Container number
  const contIdx = byLabel("Số container");
  await typeAtIndex(page, contIdx, containerNo);
  ctx.log.push(`Container at index ${contIdx}: ${containerNo}`);

  // 5) Container type
  const ctypeIdx = byLabel("Loại container");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: ctypeIdx });
  await page.keyboard.type("40", { delay: 30 });
  await sleep(800);
  ctx.log.push("Container type: " + await clickFirstRoleOption(page));
  await sleep(300);

  // 6) Tuyến đường
  const routeIdx = byLabel("Tuyến đường");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: routeIdx });
  await page.keyboard.type("HN", { delay: 30 });
  await sleep(900);
  ctx.log.push("Route: " + await clickFirstRoleOption(page));
  await sleep(300);

  // 7) Cảng nâng
  const portUpIdx = byLabel("Cảng nâng");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: portUpIdx });
  await page.keyboard.type("H", { delay: 30 });
  await sleep(900);
  ctx.log.push("Cảng nâng: " + await clickFirstRoleOption(page));
  await sleep(300);

  // 8) Cảng hạ
  const portDnIdx = byLabel("Cảng hạ");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: portDnIdx });
  await page.keyboard.type("H", { delay: 30 });
  await sleep(900);
  ctx.log.push("Cảng hạ: " + await clickFirstRoleOption(page));
  await sleep(300);

  // 9) Weight
  const weightIdx = byLabel("Trọng lượng");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx: weightIdx });
  await page.keyboard.type("25000", { delay: 30 });
  ctx.log.push("Weight: 25000");

  // 10) Pickup datetime
  const dtIdx = byLabel("Ngày giờ");
  await setAtIndex(page, dtIdx, pickupIso);
  ctx.log.push("Pickup: " + pickupIso);

  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_filled.png") });

  // 11) Submit
  const submitBtn = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const sub = buttons.find((b) => /tạo lô hàng|^tạo lô$|create|submit|lưu/i.test(b.textContent?.trim() ?? ""));
    return sub ? { text: sub.textContent.trim(), disabled: sub.disabled, type: sub.type } : null;
  });
  ctx.log.push("Submit button: " + JSON.stringify(submitBtn));

  if (submitBtn && !submitBtn.disabled) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sub = buttons.find((b) => /tạo lô hàng|^tạo lô$|create|submit|lưu/i.test(b.textContent?.trim() ?? ""));
      if (sub) sub.click();
    });
    await sleep(4000);
    ctx.log.push("Post-submit URL: " + page.url());
  } else {
    ctx.log.push("Submit button disabled or missing — checking error messages");
    const errs = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[class*="error" i], [role="alert"], .text-red-500, .text-red-600, .text-red-700'));
      return all.slice(0, 10).map((e) => e.textContent?.trim().slice(0, 100)).filter(Boolean);
    });
    ctx.log.push("Form errors: " + JSON.stringify(errs));
  }

  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_after_submit.png"), fullPage: true });

  return {
    customer: { id: customer.id, name: customer.name },
    billNo,
    containerNo,
    submitBtn,
    postUrl: page.url(),
  };
}, { artifactDir: ROOT, name: "01_cus_create_fcl_shipment", puppeteerImpl: puppeteer });

writeArtifact(ROOT, "o2c-step1-result.json", created);
console.log("\nStep 1 result:", JSON.stringify(created, null, 2));
process.exit(0);
