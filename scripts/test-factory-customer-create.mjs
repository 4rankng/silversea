#!/usr/bin/env node
/**
 * Regression driver for the 2026-09-06 customer report (Frank Ng):
 *   A. Admin factories page (/config/factories) "Tạo mới" creates a site
 *      through the customer-picker dialog.
 *   B. CUS intake (/shipments/new): inline "Thêm khách hàng" (with the new
 *      address field) auto-selects the customer, then inline "Thêm nhà máy"
 *      creates + auto-selects the factory for the container row.
 *
 * Output: qa/<date>_factory-customer-creation/*.png + result.json
 */

import { join } from "node:path";
import { api, login } from "./lib/http.mjs";
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  STANDARD_VIEWPORT,
  clickFirstRoleOption,
  installPageLogging,
  clickButtonByText,
  fillPlain,
  pickCombobox,
  sleep,
  withSession,
  writeArtifact,
} from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:7174";
const ROOT = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_factory-customer-creation`;
const STAMP = new Date().toISOString().slice(5, 19).replace(/[-T:]/g, "") + String(Math.floor(Math.random() * 90) + 10);

/** Find an input/textarea inside the open [role="dialog"] whose nearest label matches. */
async function dialogInputHandle(page, labelText) {
  const handle = await page.evaluateHandle((needle) => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const labels = Array.from(dlg.querySelectorAll("label"));
    const lab = labels.find((l) => new RegExp(needle, "i").test(l.textContent ?? ""));
    if (!lab) return null;
    const scope = lab.parentElement ?? dlg;
    return scope.querySelector("input, select, textarea") ?? lab.querySelector("input, select, textarea");
  }, labelText);
  const isNull = await handle.evaluate((e) => e == null);
  return isNull ? null : handle;
}

/** Set a plain field inside the open dialog (prototype setter + events). */
async function dialogFill(page, labelText, value, log) {
  const handle = await dialogInputHandle(page, labelText);
  if (!handle) {
    log.push(`dialogFill(${labelText}): not found`);
    return false;
  }
  const ok = await handle.evaluate((el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : el.tagName === "SELECT" ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  log.push(`dialogFill(${labelText}=${value}): ${ok}`);
  return ok;
}

/** Drive a combobox inside the open dialog: click, (optionally) type a query, click first REAL
 *  option — skipping the "— Chọn … —" placeholder entry, which is itself a listbox option. */
async function dialogCombobox(page, labelText, query, log) {
  const handle = await dialogInputHandle(page, labelText);
  if (!handle) {
    log.push(`dialogCombobox(${labelText}): input not found`);
    return null;
  }
  await handle.evaluate((e) => { e.focus(); e.click(); });
  await sleep(600);
  if (query) {
    await handle.evaluate((e) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.keyboard.type(query, { delay: 40 });
    await sleep(900);
  } else {
    await sleep(400);
  }
  const picked = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'))
      .filter((o) => o.offsetParent !== null);
    const real = opts.find((o) => !/^[—-]/.test((o.textContent ?? "").trim()));
    if (!real) return null;
    real.click();
    return real.textContent?.trim()?.slice(0, 60) ?? true;
  });
  log.push(`dialogCombobox(${labelText}) picked: ${picked}`);
  await sleep(500);
  return picked;
}

/** Click a button inside the open dialog by text (avoids matching the page-level opener). */
async function dialogClickButton(page, pattern, log) {
  const clicked = await page.evaluate((patSrc) => {
    const re = new RegExp(patSrc, "i");
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const btn = [...dlg.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? ""));
    if (!btn) return null;
    btn.click();
    return btn.textContent?.trim() ?? true;
  }, pattern);
  log.push(`dialogClickButton(${pattern}): ${clicked}`);
  return clicked;
}

/** Container-row fields on the intake form render `hideLabel` + placeholder (no
 *  visible <label>), so fill them by placeholder substring instead of label. */
async function fillByPlaceholder(page, substr, value, log) {
  const ok = await page.evaluate((needle, val) => {
    const el = Array.from(document.querySelectorAll("input, textarea"))
      .find((i) => (i.placeholder ?? "").includes(needle) && i.offsetParent !== null);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, substr, value);
  log.push(`fillByPlaceholder(${substr}=${value}): ${ok}`);
  return ok;
}

/** Value-first container cells (`ShipmentContainerCell`) render the placeholder
 *  on the cell display while the mounted control carries no placeholder attr —
 *  find the owning td by its text, activate it, then set its input. */
async function fillCellField(page, cellPlaceholder, value, log) {
  const activated = await page.evaluate((needle) => {
    const td = Array.from(document.querySelectorAll("td"))
      .find((t) => (t.textContent ?? "").includes(needle));
    if (!td) return false;
    td.click();
    const input = td.querySelector("input");
    if (input) input.focus();
    return true;
  }, cellPlaceholder);
  await sleep(300);
  const ok = await page.evaluate((needle, val) => {
    const td = Array.from(document.querySelectorAll("td"))
      .find((t) => (t.textContent ?? "").includes(needle));
    const el = td?.querySelector("input");
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return true;
  }, cellPlaceholder, value);
  log.push(`fillCellField(${cellPlaceholder}=${value}): activated=${activated} set=${ok}`);
  return ok;
}
/** Pick an option in a combobox living inside a value-first cell whose
 *  placeholder only exists as the first option's label (e.g. "— Chọn loại —").
 *  Click the cell's input (openOnPress renders the full option list), then
 *  click the real option matching `query` by substring — no typing, which the
 *  focus-reveal chrome in these cells tends to swallow. */
async function pickInCell(page, cellText, query, log) {
  const focused = await page.evaluate((needle) => {
    const td = Array.from(document.querySelectorAll("td"))
      .find((t) => (t.textContent ?? "").includes(needle));
    const el = td?.querySelector("input");
    if (!el) return false;
    el.focus();
    el.click();
    return true;
  }, cellText);
  if (!focused) {
    log.push(`pickInCell(${cellText}): input not found`);
    return null;
  }
  await sleep(900);
  const picked = await page.evaluate((needle) => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'))
      .filter((o) => o.offsetParent !== null && !/^[—-]/.test((o.textContent ?? "").trim()));
    const real = opts.find((o) => (o.textContent?.includes(needle)));
    if (!real) return null;
    real.click();
    return real.textContent?.trim()?.slice(0, 60) ?? true;
  }, query);
  log.push(`pickInCell(${cellText}) picked: ${picked}`);
  await sleep(400);
  return picked;
}

/** Combobox variant of fillByPlaceholder: focus the placeholder-bearing search
 *  input, type a query, click the first real (non-"— Chọn —") option. */
async function pickByPlaceholder(page, substr, query, log) {
  const focused = await page.evaluate((needle) => {
    const el = Array.from(document.querySelectorAll("input"))
      .find((i) => (i.placeholder ?? "").includes(needle) && i.offsetParent !== null);
    if (!el) return false;
    el.focus();
    el.click();
    return true;
  }, substr);
  if (!focused) {
    log.push(`pickByPlaceholder(${substr}): input not found`);
    return null;
  }
  await sleep(500);
  await page.keyboard.type(query, { delay: 40 });
  await sleep(900);
  const picked = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'))
      .filter((o) => o.offsetParent !== null);
    const real = opts.find((o) => !/^[—-]/.test((o.textContent ?? "").trim()));
    if (!real) return null;
    real.click();
    return real.textContent?.trim()?.slice(0, 60) ?? true;
  });
  log.push(`pickByPlaceholder(${substr}) picked: ${picked}`);
  await sleep(400);
  return picked;
}

const result = { date: new Date().toISOString(), flowA: {}, flowB: {}, log: [] };

/** ISO-6346 container check digit — the backend rejects numbers whose format
 *  is right but check digit wrong ("Sai số kiểm tra"). Table per spec: A=10,
 *  B=12, … skipping multiples of 11. Verified against CSQU3054383 → 3. */
const ISO_LETTER_VALUES = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21,
  L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32,
  V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
function iso6346ContainerNo(ownerCode, sixDigits) {
  const serial = `${ownerCode}${sixDigits}`.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const value = /\d/.test(serial[i]) ? Number(serial[i]) : ISO_LETTER_VALUES[serial[i]];
    sum += value * 2 ** i;
  }
  const r = sum % 11;
  return serial + (r === 10 ? 0 : r);
}

// ─── Flow A: admin creates a factory from /config/factories ─────────────────
const adminToken = await login("admin");
const custRes = await api(adminToken, "GET", "/customers", undefined, { query: { page: 1, limit: 5 } });
const customer = custRes.data?.items?.[0];
result.flowA.customer = customer ? { id: customer.id, name: customer.name } : null;

const siteName = `Nhà máy QA ${STAMP}`;
const siteCode = `QA-NM-${STAMP}`;

await withSession(adminToken, async (page, ctx) => {
  installPageLogging(page, ctx.log);
  await page.goto(`${FRONTEND}/config/factories`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(2500);
  await page.screenshot({ path: join(ROOT, "A01_factories_page.png"), fullPage: true });

  const opened = await clickButtonByText(page, "Tạo mới");
  ctx.log.push(`Tạo mới clicked: ${opened}`);
  await sleep(900);
  await page.screenshot({ path: join(ROOT, "A02_create_dialog.png") });

  await dialogCombobox(page, "Khách hàng", "", ctx.log);
  await dialogFill(page, "Mã điểm vận hành", siteCode, ctx.log);
  await dialogFill(page, "Tên đầy đủ", siteName, ctx.log);
  await dialogFill(page, "Tên ngắn", `QA ${STAMP}`, ctx.log);
  await dialogFill(page, "Địa chỉ", "KCN Đình Vũ, Hải Phòng (QA)", ctx.log);
  await dialogCombobox(page, "Tuyến đường", "", ctx.log);
  await page.screenshot({ path: join(ROOT, "A03_dialog_filled.png") });
  await dialogClickButton(page, "^Thêm nhà máy$", ctx.log);

  await sleep(2500);
  await page.screenshot({ path: join(ROOT, "A04_after_create.png"), fullPage: true });
  result.flowA.dialogClosed = await page.evaluate(() => document.querySelector('[role="dialog"]') === null);
  result.flowA.validationError = await page.evaluate(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? null);
  result.flowA.rowVisible = await page.evaluate(
    (needle) => document.body.innerText.includes(needle), siteName,
  );

  const verify = await api(adminToken, "GET", "/shipments/operational-sites/admin");
  const created = (verify.data?.items ?? []).find((s) => s.code === siteCode);
  result.flowA.apiCreated = created ? { id: created.id, code: created.code, customerName: created.customerName } : null;
}, { artifactDir: ROOT, name: ".", headless: STANDARD_HEADLESS });

// ─── Flow B: CUS inline customer (with address) + inline factory ────────────
const cusToken = await login("cus");
const newCustomerName = `Công ty TNHH QA Long Giang ${STAMP}`;
const factoryName = `Nhà máy QA Long Giang ${STAMP}`;
const factoryCode = `QA-LG-${STAMP}`;

await withSession(cusToken, async (page, ctx) => {
  installPageLogging(page, ctx.log);
  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(3000);
  await page.screenshot({ path: join(ROOT, "B01_intake_form.png"), fullPage: true });

  // Inline customer create — includes the new address field.
  await clickButtonByText(page, "Thêm khách hàng");
  await sleep(900);
  await dialogFill(page, "Tên khách hàng", newCustomerName, ctx.log);
  await dialogFill(page, "Mã số thuế", `031${STAMP}`, ctx.log);
  await dialogFill(page, "Số điện thoại", "0225888000", ctx.log);
  await dialogFill(page, "Người liên hệ", "Ms. Giang", ctx.log);
  await dialogFill(page, "Địa chỉ / thông tin liên hệ khác", "Khu 3, KCN Đình Vũ, Hải Phòng", ctx.log);
  await page.screenshot({ path: join(ROOT, "B02_customer_dialog.png") });
  await dialogClickButton(page, "^Thêm khách hàng$", ctx.log);
  await sleep(2200);
  await page.screenshot({ path: join(ROOT, "B03_customer_autoselect.png") });

  result.flowB.customerAutoSelected = await page.evaluate((needle) => {
    const wrap = document.querySelector('[data-field="shipment-customer"]');
    return wrap ? (wrap.textContent ?? "").includes(needle.slice(0, 18)) : false;
  }, newCustomerName);
  const createdCust = await api(adminToken, "GET", "/customers", undefined, { query: { search: newCustomerName, limit: 10 } });
  const found = (createdCust.data?.items ?? []).find((c) => c.name === newCustomerName);
  result.flowB.customerCreated = found
    ? { id: found.id, contactInfo: found.contactInfo, createdByIntake: found.partnerId != null }
    : null;

  // Inline factory create for the just-created customer.
  await clickButtonByText(page, "Thêm nhà máy");
  await sleep(900);
  await dialogFill(page, "Mã điểm vận hành", factoryCode, ctx.log);
  await dialogFill(page, "Tên đầy đủ", factoryName, ctx.log);
  await dialogFill(page, "Tên ngắn", `LG ${STAMP}`, ctx.log);
  await dialogFill(page, "Địa chỉ", "Khu 3, KCN Đình Vũ, Hải Phòng", ctx.log);
  await dialogCombobox(page, "Tuyến đường", "", ctx.log);
  await page.screenshot({ path: join(ROOT, "B04_factory_dialog.png") });
  await dialogClickButton(page, "^Thêm nhà máy$", ctx.log);
  await sleep(3000);
  await page.screenshot({ path: join(ROOT, "B05_factory_autoselect.png"), fullPage: true });

  result.flowB.factoryDialogClosed = await page.evaluate(() => document.querySelector('[role="dialog"]') === null);
  result.flowB.factoryValidationError = await page.evaluate(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? null);
  // Site dropdowns label options by shortName (see ShipmentCreateWorkspace
  // site option mapping), so the auto-selected trigger shows the short name.
  result.flowB.factoryAutoSelected = await page.evaluate(
    (needle) => document.body.innerText.includes(needle), `LG ${STAMP}`,
  );
  if (found) {
    const sites = await api(cusToken, "GET", "/shipments/operational-sites", undefined, { query: { customerId: found.id } });
    const site = (sites.data?.items ?? []).find((s) => s.code === factoryCode);
    result.flowB.factoryCreated = site ? { id: site.id, code: site.code } : null;
  } else {
    // Customer lookup missed (pagination/search) — verify the site through the
    // admin directory instead so a catalog-page quirk cannot mask a real create.
    const dir = await api(adminToken, "GET", "/shipments/operational-sites/admin");
    const site = (dir.data?.items ?? []).find((s) => s.code === factoryCode);
    result.flowB.factoryCreated = site ? { id: site.id, code: site.code, viaAdminDir: true } : null;
  }

  // ── Flow C: finish the lot with the inline-created customer + factory ──
  // Identity-section fields have visible labels; container-row fields render
  // hideLabel + placeholder, so they are driven by placeholder instead.
  const billNo = `BK-QA-${STAMP}`;
  const containerNo = iso6346ContainerNo("MSCU", String(Date.now()).slice(-6));
  const pickupIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16);
  // Capture the save's HTTP outcome so a 400 is diagnosable from result.json.
  const saveResponses = [];
  page.on('response', async (res) => {
    try {
      if (res.url().includes('/api/shipments') && ['POST', 'PUT'].includes(res.request().method()) && !res.url().includes('operational-sites')) {
        let body = '';
        try { body = (await res.text()).slice(0, 500); } catch {}
        saveResponses.push({ status: res.status(), url: res.url().slice(-40), body });
      }
    } catch {}
  });

  await fillPlain(page, "hình thức|xuất nhập", "IMPORT", ctx.log);
  await fillPlain(page, "Bill", billNo, ctx.log);
  await fillCellField(page, "Nhập số container", containerNo, ctx.log);
  await pickInCell(page, "Chọn loại", "40", ctx.log);
  await pickByPlaceholder(page, "Chọn tuyến đường", "H", ctx.log);
  await pickByPlaceholder(page, "Chọn cảng nâng", "H", ctx.log);
  await pickByPlaceholder(page, "Chọn cảng hạ", "H", ctx.log);
  await fillCellField(page, "Nhập kg", "25000", ctx.log);
  await fillCellField(page, "Chọn ngày giờ", pickupIso, ctx.log);
  await page.screenshot({ path: join(ROOT, "C01_lot_form_filled.png"), fullPage: true });

  const submitState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() ?? ""));
    return sub ? { text: sub.textContent?.trim(), disabled: sub.disabled } : null;
  });
  ctx.log.push("flowC submit state: " + JSON.stringify(submitState));
  result.flowC = {};
  result.flowC.submitState = submitState;
  if (submitState && !submitState.disabled) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sub = buttons.find((b) => /tạo lô hàng|tạo lô/i.test(b.textContent?.trim() ?? ""));
      if (sub) sub.click();
    });
    const nav = page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 }).catch(() => null);
    await Promise.race([nav, sleep(6_000)]);
  }

  result.flowC.postSubmitUrl = page.url();
  result.flowC.factoryOnDetail = await page.evaluate(
    (needle) => document.body.innerText.includes(needle), `LG ${STAMP}`,
  );
  result.flowC.containerOnDetail = await page.evaluate(
    (needle) => document.body.innerText.includes(needle), containerNo,
  );
  await page.screenshot({ path: join(ROOT, "C02_lot_detail.png"), fullPage: true });
  result.flowC.saveResponses = saveResponses;
  // Quick-create returns 201 and keeps the user on the form for the durable
  // update steps, so assert on the persisted shipment instead of the URL.
  const created201 = saveResponses.find((r) => r.status === 201);
  result.flowC.savedShipment = created201 ? (created201.body.match(/"shipmentCode":"([^"]+)"/) ?? [null, null])[1] : null;
  if (created201) {
    const idMatch = created201.body.match(/"id":(\d+)/);
    if (idMatch) {
      const detail = await api(cusToken, "GET", `/shipments/${idMatch[1]}`);
      const detailJson = JSON.stringify(detail.data ?? {});
      result.flowC.containerSaved = detailJson.includes(containerNo);
      const factoryId = result.flowB.factoryCreated?.id;
      result.flowC.factoryLinked = factoryId != null
        ? new RegExp(`"operationalSiteId":${factoryId}\\b`).test(detailJson)
        : false;
    }
  }
  result.flowC.log = [...ctx.log];
  // Validation issues block save with red field hints — capture any so a
  // disabled submit is diagnosable from result.json alone.
  result.flowC.fieldErrors = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-field-id]'))
      .map((f) => ({ field: f.getAttribute("data-field-id"), text: (f.textContent ?? "").trim().slice(0, 120) }))
      .filter((f) => f.text),
  );
}, { artifactDir: ROOT, name: ".", headless: STANDARD_HEADLESS });

// ─── Flow D: admin config customer form captures shortName + paymentTermDays ──
const configCustName = `Công ty CP QA Đông Á ${STAMP}`;
await withSession(adminToken, async (page, ctx) => {
  installPageLogging(page, ctx.log);
  // useCRUD surfaces create errors on the page BEHIND the modal — capture the
  // POST outcome directly so a silent failure cannot pass as "dialog stayed open".
  const posts = [];
  page.on('response', async (res) => {
    try {
      if (res.url().includes('/api/customers') && res.request().method() === 'POST') {
        let body = '';
        try { body = (await res.text()).slice(0, 300); } catch {}
        posts.push({ status: res.status(), body });
      }
    } catch {}
  });
  await page.goto(`${FRONTEND}/config/customers`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(2500);
  await clickButtonByText(page, "Thêm khách hàng");
  await sleep(900);
  await dialogFill(page, "Tên khách hàng", configCustName, ctx.log);
  await dialogFill(page, "Tên ngắn", `Đông Á ${STAMP}`, ctx.log);
  await dialogFill(page, "Mã số thuế", `032${STAMP}`, ctx.log);
  await dialogFill(page, "Hạn thanh toán", "30", ctx.log);
  await page.screenshot({ path: join(ROOT, "D01_admin_customer_form.png") });
  result.flowD = {};
  result.flowD.submitClicked = await dialogClickButton(page, "^Thêm mới$", ctx.log);
  await sleep(2500);
  result.flowD.posts = posts;
  await page.screenshot({ path: join(ROOT, "D02_after_create.png"), fullPage: true });

  result.flowD.dialogClosed = await page.evaluate(() => document.querySelector('[role="dialog"]') === null);
  result.flowD.pageErrorText = await page.evaluate(() => {
    const err = document.querySelector('.crud-error, [role="alert"]');
    return err ? (err.textContent ?? '').trim().slice(0, 200) : null;
  });
  const found = await api(adminToken, "GET", "/customers", undefined, { query: { search: configCustName, limit: 5 } });
  const row = (found.data?.items ?? []).find((c) => c.name === configCustName);
  result.flowD.created = row
    ? { id: row.id, shortName: row.shortName, paymentTermDays: row.paymentTermDays }
    : null;
  result.flowD.pass = Boolean(
    row && row.shortName === `Đông Á ${STAMP}` && row.paymentTermDays === 30,
  );

  // Edit pass: clearing Tên ngắn must actually persist (regression for the
  // "shortName silently unclearable" review finding).
  if (row) {
    const rowClicked = await page.evaluate((nm) => {
      const tr = Array.from(document.querySelectorAll("tr"))
        .find((t) => (t.textContent ?? "").includes(nm));
      if (!tr) return false;
      tr.click();
      return true;
    }, configCustName);
    await sleep(900);
    await dialogFill(page, "Tên ngắn", "", ctx.log);
    await page.screenshot({ path: join(ROOT, "D03_edit_clear_shortname.png") });
    await dialogClickButton(page, "^Cập nhật$", ctx.log);
    await sleep(2200);
    const recheck = await api(adminToken, "GET", "/customers", undefined, { query: { search: configCustName, limit: 5 } });
    const updated = (recheck.data?.items ?? []).find((c) => c.name === configCustName);
    result.flowD.editRowClicked = rowClicked;
    result.flowD.shortNameCleared = updated ? !(updated.shortName ?? "").trim() : null;
  }
}, { artifactDir: ROOT, name: ".", headless: STANDARD_HEADLESS });

// ─── Flow E: inline port create from a container cell (Cảng nâng) ────────────
const qaPortName = `Cảng QA ${STAMP}`;
await withSession(cusToken, async (page, ctx) => {
  installPageLogging(page, ctx.log);
  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30_000 });
  await sleep(3000);

  // Any customer unlocks the FCL container row cells.
  await pickCombobox(page, "Khách hàng", "", ctx.log);
  await sleep(1200);

  const opened = await page.evaluate(() => {
    const td = Array.from(document.querySelectorAll("td"))
      .find((t) => (t.textContent ?? "").includes("Chọn cảng nâng"));
    if (!td) return "cell-not-found";
    const btn = [...td.querySelectorAll("button")].find((b) => /thêm/i.test(b.textContent ?? ""));
    if (!btn) return "button-not-found";
    btn.click();
    return "clicked";
  });
  await sleep(900);
  result.flowE = { openResult: opened };
  await dialogFill(page, "Tên cảng / bãi", qaPortName, ctx.log);
  await dialogFill(page, "Mã", `QA${STAMP.slice(0, 6)}`, ctx.log);
  await page.screenshot({ path: join(ROOT, "E01_port_dialog.png") });
  await dialogClickButton(page, "^Thêm cảng / bãi$", ctx.log);
  await sleep(2200);
  await page.screenshot({ path: join(ROOT, "E02_port_autoselect.png"), fullPage: true });

  result.flowE.portAutoSelected = await page.evaluate(
    (nm) => document.body.innerText.includes(nm), qaPortName,
  );
  result.flowE.routeCellHasAdd = await page.evaluate(() => {
    const td = Array.from(document.querySelectorAll("td"))
      .find((t) => (t.textContent ?? "").includes("Chọn tuyến đường"));
    return Boolean(td && [...td.querySelectorAll("button")].some((b) => /thêm/i.test(b.textContent ?? "")));
  });
  const portsRes = await api(adminToken, "GET", "/ports", undefined, { query: { limit: 100 } });
  const portRow = (portsRes.data?.items ?? []).find((p) => p.name === qaPortName);
  result.flowE.portCreated = portRow ? { id: portRow.id, code: portRow.code } : null;
}, { artifactDir: ROOT, name: ".", headless: STANDARD_HEADLESS });

result.flowA.pass = Boolean(result.flowA.apiCreated && result.flowA.rowVisible);
result.flowB.pass = Boolean(
  result.flowB.customerCreated?.contactInfo
  && result.flowB.customerAutoSelected
  && result.flowB.factoryCreated
  && result.flowB.factoryAutoSelected,
);
result.flowC.pass = Boolean(
  result.flowC?.savedShipment
  && result.flowC?.containerSaved
  && result.flowC?.factoryLinked,
);
result.flowD.pass = Boolean(result.flowD?.pass && result.flowD?.shortNameCleared === true);
result.flowE.pass = Boolean(
  result.flowE?.portCreated
  && result.flowE?.portAutoSelected
  && result.flowE?.routeCellHasAdd
  && result.flowE?.openResult === "clicked",
);
result.pass = result.flowA.pass && result.flowB.pass && (result.flowC?.pass ?? false) && (result.flowD?.pass ?? false) && (result.flowE?.pass ?? false);

writeArtifact(ROOT, "result.json", result);
console.log(`\nflowA (admin factories create):        ${result.flowA.pass ? "PASS" : "FAIL"} ${JSON.stringify(result.flowA.apiCreated ?? {})}`);
console.log(`flowB (CUS inline customer+factory):  ${result.flowB.pass ? "PASS" : "FAIL"} customer=${JSON.stringify(result.flowB.customerCreated ?? {})} factory=${JSON.stringify(result.flowB.factoryCreated ?? {})}`);
console.log(`flowC (CUS saves lot with both new):  ${result.flowC.pass ? "PASS" : "FAIL"} url=${result.flowC?.postSubmitUrl}`);
console.log(`flowD (admin customer form fields):   ${result.flowD.pass ? "PASS" : "FAIL"} ${JSON.stringify(result.flowD?.created ?? {})}`);
console.log(`flowE (inline port create from cell): ${result.flowE.pass ? "PASS" : "FAIL"} ${JSON.stringify(result.flowE ?? {})}`);
process.exit(result.pass ? 0 : 1);
