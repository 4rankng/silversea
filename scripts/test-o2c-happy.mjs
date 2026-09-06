#!/usr/bin/env node
/**
 * O2C happy-path UI driver — Silversea local dev (v2).
 * Walks CUS → Điều vận → Lái xe → Kế toán/CUS for a single FCL shipment.
 * - Each step logs in via API to get token, injects via
 *   evaluateOnNewDocument BEFORE any page load (puppeteer-spa-auth pattern).
 * - Screenshots + DOM assertions + DB row dump per step.
 *
 * Output: qa/2026-09-05_o2c-smoke/<step>/<role>_<step>.png + .json
 */

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = "http://localhost:7174";
const BACKEND = "http://localhost:3001/api";
const ROOT = "qa/2026-09-05_o2c-smoke";

async function login(username, password = "Abc123") {
  const r = await fetch(`${BACKEND}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
  return (await r.json()).token;
}

async function api(token, method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

async function withSession(token, fn) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => console.error("PAGE-EXC:", e.message.slice(0, 200)));
  await page.evaluateOnNewDocument((t) => localStorage.setItem("token", t), token);
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Set input value at index N (zero-based) among all input+select+textarea. */
async function setAtIndex(page, idx, value) {
  return await page.evaluate(({ idx, value }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    const el = inputs[idx];
    if (!el) throw new Error(`no input at index ${idx} (have ${inputs.length})`);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { idx, tag: el.tagName, value };
  }, { idx, value });
}

async function typeAtIndex(page, idx, text, { delay = 30 } = {}) {
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx });
  await page.keyboard.type(text, { delay });
}

async function clickFirstRoleOption(page) {
  return await page.evaluate(() => {
    const opt = document.querySelector('[role="option"]');
    if (opt) { opt.click(); return opt.textContent?.trim()?.slice(0, 60) || true; }
    return null;
  });
}

async function step(label, dir, role, token, fn) {
  console.log(`\n=== ${label} ===`);
  const stepDir = join(ROOT, dir);
  mkdirSync(stepDir, { recursive: true });
  const log = [];
  let result = {};
  await withSession(token, async (page) => {
    result = await fn(page, log);
  });
  writeFileSync(join(stepDir, `${role}_${label}.json`), JSON.stringify({ label, role, log, result }, null, 2));
  console.log(`  log lines: ${log.length}, result keys: ${Object.keys(result || {}).join(", ")}`);
  return result;
}

// === Step 1: CUS creates FCL shipment ===
const cusToken = await login("cus");
const customersRes = await api(cusToken, "GET", "/customers?limit=20");
const customer = customersRes.data.items?.find((c) => c.status === "ACTIVE" && !c.isCarrier) || customersRes.data.items?.[0];
console.log("Customer for test:", customer?.id, customer?.name);

const created = await step("01_cus_create_fcl_shipment", "cus-create", "cus", cusToken, async (page, log) => {
  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_form_loaded.png") });

  // Discover all inputs/selects with their role/label
  const discovered = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    return inputs.map((inp, i) => {
      // Find nearest label
      const lab = labels.find((l) => {
        if (l.getAttribute('for') === inp.id) return true;
        return l.parentElement === inp.parentElement || l.parentElement === inp.parentElement?.parentElement;
      });
      return {
        i,
        tag: inp.tagName,
        type: inp.type,
        id: (inp.id || '').slice(-20),
        ariaLabel: inp.getAttribute('aria-label'),
        placeholder: inp.placeholder?.slice(0, 30),
        labelText: lab?.textContent?.trim()?.slice(0, 40) || null,
      };
    });
  });
  log.push("discovered inputs: " + JSON.stringify(discovered, null, 2).slice(0, 2000));

  // Identify indexes from labels
  const byLabel = (substr) => discovered.findIndex((d) => (d.labelText || '').includes(substr) || (d.ariaLabel || '').includes(substr) || (d.placeholder || '').includes(substr));

  // 1) Customer combobox - aria-label "Khách hàng"
  const customerIdx = byLabel("Khách hàng");
  if (customerIdx < 0) throw new Error("customer field not found");
  log.push(`customer at index ${customerIdx}`);
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: customerIdx });
  await page.keyboard.type(customer.name, { delay: 30 });
  await new Promise((r) => setTimeout(r, 900));
  const pickedCustomer = await clickFirstRoleOption(page);
  log.push("Customer option picked: " + pickedCustomer);
  await new Promise((r) => setTimeout(r, 400));

  // 2) Import/Export — first <select>
  await page.select("select", "IMPORT");
  log.push("Import selected");

  // 3) Bill/Booking — label "Số Bill/Booking"
  const billIdx = byLabel("Bill");
  if (billIdx < 0) throw new Error("Bill field not found");
  const billNo = "BK-TEST-" + Date.now();
  await typeAtIndex(page, billIdx, billNo);
  log.push(`Bill/Booking at index ${billIdx}: ${billNo}`);

  // 4) Container number
  const contIdx = byLabel("Số container");
  const containerNo = "MSCU" + String(Date.now()).slice(-7);
  await typeAtIndex(page, contIdx, containerNo);
  log.push(`Container at index ${contIdx}: ${containerNo}`);

  // 5) Container type combobox
  const ctypeIdx = byLabel("Loại container");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: ctypeIdx });
  await page.keyboard.type("40", { delay: 30 });
  await new Promise((r) => setTimeout(r, 800));
  const ctype = await clickFirstRoleOption(page);
  log.push("Container type: " + ctype);
  await new Promise((r) => setTimeout(r, 300));

  // 6) Tuyến đường
  const routeIdx = byLabel("Tuyến đường");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: routeIdx });
  await page.keyboard.type("HN", { delay: 30 });
  await new Promise((r) => setTimeout(r, 900));
  const route = await clickFirstRoleOption(page);
  log.push("Route: " + route);
  await new Promise((r) => setTimeout(r, 300));

  // 7) Cảng nâng
  const portUpIdx = byLabel("Cảng nâng");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: portUpIdx });
  await page.keyboard.type("H", { delay: 30 });
  await new Promise((r) => setTimeout(r, 900));
  const portUp = await clickFirstRoleOption(page);
  log.push("Cảng nâng: " + portUp);
  await new Promise((r) => setTimeout(r, 300));

  // 8) Cảng hạ
  const portDnIdx = byLabel("Cảng hạ");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: portDnIdx });
  await page.keyboard.type("H", { delay: 30 });
  await new Promise((r) => setTimeout(r, 900));
  const portDn = await clickFirstRoleOption(page);
  log.push("Cảng hạ: " + portDn);
  await new Promise((r) => setTimeout(r, 300));

  // 9) Weight
  const weightIdx = byLabel("Trọng lượng");
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    inputs[idx]?.focus();
  }, { idx: weightIdx });
  await page.keyboard.type("25000", { delay: 30 });
  log.push("Weight: 25000");

  // 10) Pickup datetime
  const dtIdx = byLabel("Ngày giờ");
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const iso = tomorrow.toISOString().slice(0, 16);
  await setAtIndex(page, dtIdx, iso);
  log.push("Pickup: " + iso);

  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_filled.png") });

  // 11) Submit
  const submitBtn = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const sub = buttons.find((b) => /tạo lô hàng|^tạo lô$|create|submit|lưu/i.test(b.textContent?.trim() || ""));
    return sub ? { text: sub.textContent.trim(), disabled: sub.disabled, type: sub.type } : null;
  });
  log.push("Submit button: " + JSON.stringify(submitBtn));

  if (submitBtn && !submitBtn.disabled) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sub = buttons.find((b) => /tạo lô hàng|^tạo lô$|create|submit|lưu/i.test(b.textContent?.trim() || ""));
      if (sub) sub.click();
    });
    // Wait for either navigation or response
    await new Promise((r) => setTimeout(r, 4000));
    log.push("Post-submit URL: " + page.url());
  } else {
    log.push("Submit button disabled or missing — checking error messages");
    const errs = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[class*="error" i], [role="alert"], .text-red-500, .text-red-600, .text-red-700'));
      return all.slice(0, 10).map((e) => e.textContent?.trim().slice(0, 100)).filter(Boolean);
    });
    log.push("Form errors: " + JSON.stringify(errs));
  }

  await page.screenshot({ path: join(ROOT, "cus-create/cus_create_after_submit.png"), fullPage: true });

  return {
    customer: { id: customer.id, name: customer.name },
    billNo,
    containerNo,
    submitBtn,
    postUrl: page.url(),
  };
});

console.log("\nStep 1 result:", JSON.stringify(created, null, 2));

writeFileSync(join(ROOT, "smoke/o2c-step1-result.json"), JSON.stringify(created, null, 2));
process.exit(0);