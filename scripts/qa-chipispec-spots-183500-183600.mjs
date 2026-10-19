#!/usr/bin/env node
/**
 * QA driver — cards 181026183500 (NCC default on Kiểm soát phơi phiếu) +
 * 181026183600 (PHÊ DUYỆT TẠM ỨNG on /advances).
 *
 * Phase `before` (repro on build 64f81514):
 *   - 183600: ketoan opens /advances → the PENDING row shows a title-case
 *     "Phê duyệt tạm ứng" button and NO "Chờ duyệt" filter pill → the spec
 *     token "PHÊ DUYỆT TẠM ỨNG" is not findable on this surface.
 *   - 183500: ketoan opens /accounting/phoi-phieu → Chi hộ dialog of a trip
 *     with an external carrier (UI-B77AP2-1, carrier-linked customer) →
 *     "＋ Thêm dòng" → Bên thực chi = Nhà cung cấp → the NCC select stays
 *     EMPTY (carrierSupplierId is null for the CUSTOMER carrier shape).
 *
 * Phase `after` (post-fix):
 *   - 183600: uppercase "PHÊ DUYỆT TẠM ỨNG" + "Chờ duyệt" pill present; click
 *     approve on the QA row → row status flips to RECORDED (DB-verified after).
 *   - 183500: the NCC select auto-fills the trip's carrier supplier by id.
 *
 * Usage: node scripts/qa-chipispec-spots-183500-183600.mjs before|after
 */
import { withSession } from "./lib/ui-driver.mjs";
import { login } from "./lib/http.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const phase = process.argv[2] ?? "before";
const dir = `qa/2026-10-19_chipispec-spots/${phase}`;
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = {};

async function clickByText(page, selector, text, { exact = false } = {}) {
  return page.evaluate(({ selector, text, exact }) => {
    const nodes = [...document.querySelectorAll(selector)];
    const hit = nodes.find((n) => {
      const t = (n.innerText || n.textContent || "").trim();
      return exact ? t === text : t.includes(text);
    });
    if (hit) {
      hit.scrollIntoView({ block: "center" });
      hit.click();
      return true;
    }
    return false;
  }, { selector, text, exact });
}

/** Set a controlled React input via the prototype setter + input events. */
async function setReactValue(page, selector, value) {
  return page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { selector, value });
}

/** ── Card 183600 ──────────────────────────────────────────────────────── */
async function advances(page) {
  console.log("=== 183600: /advances (ketoan) ===");
  await page.goto("http://localhost:7175/advances", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adv-page", { timeout: 15000 });
  await sleep(1200); // list fetch + render

  findings.pills = await page.evaluate(() => {
    const bar = document.querySelector(".adv-panel");
    return bar ? [...bar.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
  });
  findings.hasPendingPill = findings.pills.some((t) => t.includes("Chờ duyệt"));

  // The QA fixture row (created via the real Ops wallet flow).
  const row = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".adv-grid-row")];
    const hit = rows.find((r) => r.textContent.includes("QA 183600"));
    if (!hit) return null;
    const buttons = [...hit.querySelectorAll("button")].map((b) => b.textContent.trim());
    return { text: hit.textContent.slice(0, 160), buttons };
  });
  findings.pendingRow = row;
  findings.buttonTexts = row?.buttons ?? [];
  findings.hasSpecLabel = findings.buttonTexts.some((t) => t === "PHÊ DUYỆT TẠM ỨNG");
  await page.screenshot({ path: `${dir}/183600-advances-before-approve.png`, fullPage: false });
  console.log("pills:", findings.pills, "| pendingRow buttons:", findings.buttonTexts);
}

/** ── Card 183500 ──────────────────────────────────────────────────────── */
async function phoiPhieu(page) {
  console.log("=== 183500: /accounting/phoi-phieu (ketoan) ===");
  // Local dev DB carries a QA fixture flood; the truck-assignments table
  // (275KB payload → thousands of rendered rows) OOMs the renderer. The
  // target surfaces here are the row dialogs, so those payloads are stubbed.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/phoi-phieu\/(report|stk)|truck-assignments/.test(url)) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], rows: [], totals: {}, grand: {}, total: 0, assignments: [], unassignedTrucks: [], accountants: [] }) });
    } else req.continue();
  });
  await page.goto("http://localhost:7175/accounting/phoi-phieu", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Poll instead of waitForSelector — the board page crashed headless Chrome
  // once mid-wait (Target closed); evaluate-poll recovers deterministically.
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await sleep(1000);
    ready = await page.evaluate(() => {
      const row = [...document.querySelectorAll("table tbody tr")].find((r) => r.textContent.includes("UI-LCL-B77AP2-1"));
      return Boolean(row);
    }).catch(() => false);
  }
  if (!ready) { findings.phoiError = "board row UI-LCL-B77AP2-1 never appeared"; return; }
  await sleep(800);

  // Open the Chi hộ detail dialog of the UI-LCL-B77AP2-1 lot row (external
  // carrier "UI Nhà xe B77AP2", CUSTOMER shape with linked_supplier_id=8368).
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    const hit = rows.find((r) => r.textContent.includes("UI-LCL-B77AP2-1"));
    if (!hit) return { ok: false, reason: "row not found" };
    const cells = [...hit.querySelectorAll("td")];
    // Chi hộ column per qa-cac-chi-phi.mjs precedent: nth-child(7) carries the
    // "Xem chi tiết" button; fall back to any labeled button in the row.
    let btn = cells[6]?.querySelector("button") ?? null;
    if (!btn) {
      btn = [...hit.querySelectorAll("button")].find((b) => /xem chi tiết|chi hộ/i.test(`${b.getAttribute("aria-label") || ""} ${b.title || ""}`));
    }
    if (!btn) return { ok: false, reason: "detail button not found", rowButtons: [...hit.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.title || b.textContent.trim()).slice(0, 8) };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true };
  });
  console.log("chi-ho open:", JSON.stringify(opened));
  if (!opened.ok) { findings.chiHoError = opened; return; }
  await sleep(1200);

  // "＋ Thêm dòng" swaps the dialog surface for the expense create drawer.
  await clickByText(page, "button", "Thêm dòng");
  await sleep(1500); // catalog fetch

  const drawer = await page.evaluate(() => {
    const drawerEl = document.querySelector(".expense-create-drawer, [class*='expense'][class*='drawer']");
    return { open: Boolean(drawerEl) };
  });
  console.log("drawer open:", JSON.stringify(drawer));
  if (!drawer.open) { findings.drawerError = "ExpenseCreateDrawer not detected"; await page.screenshot({ path: `${dir}/183500-drawer-missing.png` }); return; }

  // Bên thực chi → Nhà cung cấp
  await clickByText(page, "[role='combobox'], button", "Bên thực chi");
  await sleep(400);
  await clickByText(page, "[role='option']", "Nhà cung cấp", { exact: true });
  await sleep(500);

  findings.ncc = await page.evaluate(() => {
    // The supplier select next to "Bên thực chi": find its combobox and read
    // the selected option text (listbox pattern prints the choice in the trigger).
    const combos = [...document.querySelectorAll("[role='combobox'], button")];
    const nccTrigger = combos.find((b) => /Nhà cung cấp|Chọn nhà cung cấp|^—?$/.test((b.innerText || "").trim()) && !/Bên thực chi/.test(b.innerText));
    return {
      triggerText: nccTrigger ? nccTrigger.innerText.trim() : null,
      allComboTexts: combos.map((b) => b.innerText.trim()).filter(Boolean).slice(0, 12),
    };
  });
  await page.screenshot({ path: `${dir}/183500-ncc-after-pick.png`, fullPage: false });
  console.log("NCC select:", JSON.stringify(findings.ncc));
}

async function approveAfter(page) {
  console.log("=== 183600 after-fix: click PHÊ DUYỆT TẠM ỨNG ===");
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".adv-grid-row")];
    const hit = rows.find((r) => r.textContent.includes("QA 183600"));
    const btn = hit && [...hit.querySelectorAll("button")].find((b) => b.textContent.trim() === "PHÊ DUYỆT TẠM ỨNG");
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  });
  findings.approveClicked = clicked;
  if (!clicked) return;
  await sleep(2000); // POST + invalidate + refetch
  findings.rowAfter = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".adv-grid-row")];
    const hit = rows.find((r) => r.textContent.includes("QA 183600"));
    return hit ? hit.textContent.slice(0, 160) : "ROW GONE (may be on another page)";
  });
  await page.screenshot({ path: `${dir}/183600-advances-after-approve.png`, fullPage: false });
  console.log("approve clicked:", clicked, "| row after:", findings.rowAfter);
}

const token = await login("ketoan", {});
// One browser session per surface — in-page cross-route navigation after the
// /advances polling page stalled goto in earlier runs. Per-phase try/catch so
// one surface failing still leaves the other's artifacts on disk.
await withSession(token, async (page) => {
  page.setDefaultNavigationTimeout(60000);
  try {
    await advances(page);
    if (phase === "after") await approveAfter(page);
  } catch (cause) {
    findings.advancesError = String(cause).slice(0, 300);
    console.log("advances phase error:", findings.advancesError);
  }
}, { name: dir, artifactDir: dir });

await withSession(token, async (page) => {
  page.setDefaultNavigationTimeout(60000);
  try {
    await phoiPhieu(page);
  } catch (cause) {
    findings.phoiError = String(cause).slice(0, 300);
    console.log("phoi-phieu phase error:", findings.phoiError);
  }
}, { name: dir, artifactDir: dir });

writeFileSync(`${dir}/driver-findings.json`, JSON.stringify(findings, null, 2));
console.log("FINDINGS:", JSON.stringify(findings, null, 2));
