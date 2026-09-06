#!/usr/bin/env node
/**
 * CUS create FCL shipment — robust v3.
 * Uses click→type→wait→click-option flow for every combobox.
 */

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = "http://localhost:7174";
const BACKEND = "http://localhost:3001/api";
const ROOT = "qa/2026-09-05_o2c-smoke/cus-create";

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

async function pickCombobox(page, labelText, query, log) {
  // Click the input by label, clear, type, wait, click first option
  const inputHandle = await page.evaluateHandle((labelText) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const lab = labels.find((l) => new RegExp(labelText, 'i').test(l.textContent || ''));
    if (!lab) return null;
    const forId = lab.getAttribute('for');
    if (forId) return document.getElementById(forId);
    const wrap = lab.parentElement;
    return wrap?.querySelector('input, select, textarea');
  }, labelText);
  if (!inputHandle || (await inputHandle.evaluate((e) => e === null))) {
    log.push(`pickCombobox(${labelText}): input not found`);
    return null;
  }
  // Get an aria-label or nearby label info
  const meta = await inputHandle.evaluate((e) => ({
    tag: e.tagName,
    id: (e.id || '').slice(-20),
    ariaLabel: e.getAttribute('aria-label'),
    placeholder: e.placeholder?.slice(0, 30),
  }));
  log.push(`pickCombobox(${labelText}) → ${JSON.stringify(meta)}`);

  // Click via JS to open listbox
  await inputHandle.evaluate((e) => {
    e.focus();
    e.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  // Clear & type
  await inputHandle.evaluate((e) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(e, '');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.type(query, { delay: 40 });
  await new Promise((r) => setTimeout(r, 1100));

  // Inspect options
  const optInfo = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    return {
      count: opts.length,
      first: opts[0]?.textContent?.trim()?.slice(0, 60) || null,
      visible: opts.filter((o) => o.offsetParent !== null).length,
    };
  });
  log.push(`  options after type: ${JSON.stringify(optInfo)}`);

  // Click first visible option
  const picked = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]')).filter((o) => o.offsetParent !== null);
    if (opts.length === 0) return null;
    opts[0].click();
    return opts[0].textContent?.trim()?.slice(0, 60);
  });
  log.push(`  picked: ${picked}`);
  await new Promise((r) => setTimeout(r, 500));
  return picked;
}

async function fillPlain(page, labelText, value, log) {
  const ok = await page.evaluate(({ labelText, value }) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const lab = labels.find((l) => new RegExp(labelText, 'i').test(l.textContent || ''));
    if (!lab) return { ok: false, why: 'label not found' };
    const forId = lab.getAttribute('for');
    let el = forId ? document.getElementById(forId) : lab.parentElement?.querySelector('input, select, textarea');
    if (!el) return { ok: false, why: 'no input' };
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, tag: el.tagName };
  }, { labelText, value });
  log.push(`fillPlain(${labelText}=${value}): ${JSON.stringify(ok)}`);
  return ok;
}

const cusToken = await login("cus");
const customersRes = await api(cusToken, "GET", "/customers?limit=20");
const customer = customersRes.data.items?.find((c) => c.status === "ACTIVE" && !c.isCarrier) || customersRes.data.items?.[0];
console.log("Customer:", customer.id, customer.name);

mkdirSync(ROOT, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.error("PAGE-EXC:", e.message.slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") console.error("CONSOLE-ERR:", m.text().slice(0, 200));
});
await page.evaluateOnNewDocument((t) => localStorage.setItem("token", t), cusToken);

const log = [];

await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: join(ROOT, "01_form_loaded.png") });

// 1) Customer combobox
log.push("--- customer ---");
await pickCombobox(page, "Khách hàng", customer.name, log);

// 2) Select Import/Export
await fillPlain(page, "hình thức|xuất nhập", "IMPORT", log);

// 3) Bill/Booking
const billNo = "BK-QA-" + Date.now();
await fillPlain(page, "Bill", billNo, log);

// 4) Hãng tàu — leave optional
// 5) Số tờ khai — leave optional
// 6) Loại hàng — already default "Hàng nguyên container"

// 7) Container number
const containerNo = "MSCU" + String(Date.now()).slice(-7);
await fillPlain(page, "Số container", containerNo, log);

// 8) Loại container
await pickCombobox(page, "Loại container", "40", log);

// 9) Nhà máy — leave empty (optional)
// 10) Tuyến đường — required!
await pickCombobox(page, "Tuyến đường", "HN", log);

// 11) Cảng nâng — required
await pickCombobox(page, "Cảng nâng", "H", log);

// 12) Cảng hạ — required
await pickCombobox(page, "Cảng hạ", "H", log);

// 13) Weight
await fillPlain(page, "Trọng lượng", "25000", log);

// 14) Pickup datetime
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
const iso = tomorrow.toISOString().slice(0, 16);
await fillPlain(page, "Ngày giờ", iso, log);

await page.screenshot({ path: join(ROOT, "02_form_filled.png") });

// 15) Check submit button state
const submitState = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() || ''));
  return sub ? { text: sub.textContent.trim(), disabled: sub.disabled } : null;
});
log.push("submit state: " + JSON.stringify(submitState));

// 16) Click submit
if (submitState && !submitState.disabled) {
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() || ''));
    if (sub) sub.click();
  });
  // Wait for navigation or response
  const nav = page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null);
  await Promise.race([nav, new Promise((r) => setTimeout(r, 6000))]);
  log.push("post-submit URL: " + page.url());
}

await page.screenshot({ path: join(ROOT, "03_after_submit.png"), fullPage: true });

// 17) If still on /shipments/new, gather error messages
if (page.url().endsWith("/shipments/new")) {
  const errs = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[role="alert"], [class*="error" i], .text-red-500, .text-red-600, .text-red-700, [class*="invalid" i]'));
    return all.slice(0, 10).map((e) => e.textContent?.trim().slice(0, 100)).filter(Boolean);
  });
  log.push("error messages: " + JSON.stringify(errs));
}

await browser.close();

writeFileSync(join(ROOT, "result.json"), JSON.stringify({
  log,
  customer: { id: customer.id, name: customer.name },
  billNo,
  containerNo,
  submitState,
  finalUrl: log[log.length - 1],
}, null, 2));

console.log("\nFinal URL:", log.find((l) => l.startsWith("post-submit")));
process.exit(0);