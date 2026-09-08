#!/usr/bin/env node
/**
 * Repro + verify TC-CUS-CREATE-038 — port/route picker dropdown covers
 * the "+ Thêm" button when the trigger sits in the middle / bottom of the
 * viewport on /shipments/new (regression bug 2026-09-08).
 *
 * Behaviour under test:
 *   1. Login as `cus`.
 *   2. Open `/shipments/new`, pick a customer that has at least one port /
 *      route in the catalog.
 *   3. Scroll the page so the FCL row's "Cảng nâng" picker sits at the
 *      middle of the viewport.
 *   4. Click the picker — record the popover's `data-placement`, bounding
 *      rect, and whether the "+ Thêm" button is hit-testable (i.e. the
 *      element at the button's centre is the button itself, not the
 *      popover).
 *   5. Same with the picker near the bottom of the viewport (should flip
 *      upward so +Thêm is reachable).
 *
 * Usage:
 *   node scripts/repro-popover-covers-add.mjs          # baseline (records BEFORE/AFTER with a flag)
 *   node scripts/repro-popover-covers-add.mjs before   # screenshot tag = before
 *   node scripts/repro-popover-covers-add.mjs after    # screenshot tag = after
 */
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { login } from "./lib/http.mjs";
import { withSession, sleep, STANDARD_VIEWPORT } from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:7174";
const STAGE = process.argv[2] ?? "before";
const ARTIFACT_DIR = `qa/${new Date().toISOString().slice(0, 10)}_cus-create-popover-flip`;
mkdirSync(ARTIFACT_DIR, { recursive: true });

const log = [];
const note = (s) => { console.log(s); log.push(s); };

async function pickFirstCustomer(page) {
  return page.evaluate(() => {
    const handle = (() => {
      const input = document.querySelector('[role="combobox"][aria-label="Khách hàng"], input[aria-label="Khách hàng"]');
      if (!input) return null;
      input.focus();
      input.click();
      return true;
    })();
    return handle;
  });
}

async function selectFirstOption(page, label) {
  await page.evaluate((l) => {
    const handle = document.querySelector(`[role="combobox"][aria-label="${l}"], input[aria-label="${l}"]`);
    if (!handle) return;
    handle.focus();
    handle.click();
  }, label);
  await sleep(700);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.offsetParent !== null);
    if (opt) opt.click();
  });
  await sleep(500);
}

async function measureAtTrigger(page, label) {
  return page.evaluate((l) => {
    const findField = (needle) => {
      const inputs = [...document.querySelectorAll('[role="combobox"], input')];
      const match = inputs.find((inp) => {
        const aria = (inp.getAttribute("aria-label") || "").toLowerCase();
        const placeholder = (inp.placeholder || "").toLowerCase();
        const id = (inp.id || "").toLowerCase();
        return aria.includes(needle) || placeholder.includes(needle) || id.includes(needle);
      });
      return match;
    };
    const trigger = findField(l.toLowerCase());
    if (!trigger) return { ok: false, why: "trigger not found" };
    trigger.scrollIntoView({ block: "center" });
    trigger.click();
    // The AriaPopover mounts via portal — wait one frame for placement.
    return new Promise((resolve) => {
      setTimeout(() => {
        const popover = document.querySelector('[data-placement], [role="dialog"], [role="listbox"]');
        const popoverRect = popover?.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        // The +Thêm button is the next sibling of the field wrapper inside
        // .csc-route-picker (or .csc-customer-picker / .csc-shipping-line-picker).
        const fieldWrapper = trigger.closest('.csc-route-picker, .csc-customer-picker, .csc-shipping-line-picker');
        const addBtn = fieldWrapper?.querySelector('button.csc-utility-button--dashed, button[class*="__add"]');
        const addRect = addBtn?.getBoundingClientRect();
        const addHit = addBtn && (() => {
          const cx = addRect.left + addRect.width / 2;
          const cy = addRect.top + addRect.height / 2;
          const elAt = document.elementFromPoint(cx, cy);
          return {
            tag: elAt?.tagName,
            text: elAt?.textContent?.trim()?.slice(0, 40),
            classes: elAt?.className,
            isAddBtn: elAt === addBtn || addBtn?.contains(elAt) || elAt?.contains(addBtn),
          };
        })();
        resolve({
          ok: true,
          label: l,
          placement: popover?.dataset?.placement ?? null,
          trigger: { top: triggerRect.top, bottom: triggerRect.bottom, left: triggerRect.left, right: triggerRect.right, height: triggerRect.height },
          popover: popoverRect && {
            top: popoverRect.top, bottom: popoverRect.bottom, left: popoverRect.left, right: popoverRect.right,
            height: popoverRect.height, width: popoverRect.width,
          },
          addButton: addRect && { top: addRect.top, bottom: addRect.bottom, left: addRect.left, right: addRect.right, height: addRect.height, width: addRect.width },
          addHit,
          addVisible: addHit?.isAddBtn === true,
          coversAddBtn: popoverRect && addRect
            ? !(popoverRect.right < addRect.left || popoverRect.left > addRect.right ||
                popoverRect.bottom < addRect.top || popoverRect.top > addRect.bottom)
            : false,
        });
      }, 250);
    });
  }, label);
}

const main = async () => {
  const token = await login("cus");
  note(`logged in as cus, token-len=${token.length}`);

  const measurements = await withSession(token, async (page) => {
    page.on("pageerror", (e) => note(`PAGE-EXC: ${e.message?.slice(0, 200)}`));
    page.on("console", (m) => { if (m.type() === "error") note(`CONSOLE-ERR: ${m.text().slice(0, 200)}`); });

    await page.setViewport(STANDARD_VIEWPORT);
    await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: "networkidle2", timeout: 30_000 });
    await sleep(800);

    // Pick a customer that we know has catalog ports/routes.
    await selectFirstOption(page, "Khách hàng");
    await sleep(400);
    // Make sure we're in FCL mode (default) — verify by checking the input shape.
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_00-form-loaded.png`), fullPage: false });
    note(`captured 00-form-loaded.png`);

    // Scroll to bring the FCL container row to mid-viewport.
    await page.evaluate(() => {
      const target = document.querySelector('[role="combobox"][aria-label*="Cảng nâng"], input[aria-label*="Cảng nâng"]');
      if (target) target.scrollIntoView({ block: "center" });
    });
    await sleep(400);

    // Mid-viewport measurement for Cảng nâng
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_01-mid-before-click.png`), fullPage: false });
    const midCangNang = await measureAtTrigger(page, "Cảng nâng");
    note(`mid-Cảng nâng: ${JSON.stringify(midCangNang)}`);
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_02-mid-after-click.png`), fullPage: false });

    // Close any open popover before next measurement
    await page.keyboard.press("Escape");
    await sleep(400);

    // Move trigger to bottom of viewport
    await page.evaluate(() => {
      const target = document.querySelector('[role="combobox"][aria-label*="Cảng nâng"], input[aria-label*="Cảng nâng"]');
      if (target) {
        target.scrollIntoView({ block: "end" });
        // Force trigger near bottom of viewport
        window.scrollBy(0, 200);
      }
    });
    await sleep(400);

    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_03-bottom-before-click.png`), fullPage: false });
    const bottomCangNang = await measureAtTrigger(page, "Cảng nâng");
    note(`bottom-Cảng nâng: ${JSON.stringify(bottomCangNang)}`);
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_04-bottom-after-click.png`), fullPage: false });

    // Also check Cảng hạ and Tuyến đường in the mid position
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.evaluate(() => {
      const target = document.querySelector('[role="combobox"][aria-label*="Tuyến đường"], input[aria-label*="Tuyến đường"]');
      if (target) target.scrollIntoView({ block: "center" });
    });
    await sleep(400);
    const midTuyen = await measureAtTrigger(page, "Tuyến đường");
    note(`mid-Tuyến đường: ${JSON.stringify(midTuyen)}`);
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_05-mid-tuyen-after-click.png`), fullPage: false });

    // Also check Khách hàng picker — its +Thêm khách hàng button sits below
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.evaluate(() => {
      const target = document.querySelector('[role="combobox"][aria-label*="Khách hàng"], input[aria-label*="Khách hàng"]');
      if (target) target.scrollIntoView({ block: "center" });
    });
    await sleep(400);
    const midCustomer = await measureAtTrigger(page, "Khách hàng");
    note(`mid-Khách hàng: ${JSON.stringify(midCustomer)}`);
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_06-mid-khach-hang-after-click.png`), fullPage: false });

    // And Cảng hạ
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.evaluate(() => {
      const target = document.querySelector('[role="combobox"][aria-label*="Cảng hạ"], input[aria-label*="Cảng hạ"]');
      if (target) target.scrollIntoView({ block: "center" });
    });
    await sleep(400);
    const midCangHa = await measureAtTrigger(page, "Cảng hạ");
    note(`mid-Cảng hạ: ${JSON.stringify(midCangHa)}`);
    await page.screenshot({ path: join(ARTIFACT_DIR, `${STAGE}_07-mid-cang-ha-after-click.png`), fullPage: false });

    return {
      viewport: STANDARD_VIEWPORT,
      midCangNang,
      bottomCangNang,
      midTuyen,
      midCustomer,
      midCangHa,
    };
  }, { viewport: STANDARD_VIEWPORT });

  const artifact = {
    stage: STAGE,
    timestamp: new Date().toISOString(),
    measurements,
    summary: {
      midCangNangPlacement: measurements.midCangNang?.placement,
      midCangNangAddVisible: measurements.midCangNang?.addVisible,
      midCangNangCoversAdd: measurements.midCangNang?.coversAddBtn,
      bottomCangNangPlacement: measurements.bottomCangNang?.placement,
      bottomCangNangAddVisible: measurements.bottomCangNang?.addVisible,
      midTuyenPlacement: measurements.midTuyen?.placement,
      midTuyenAddVisible: measurements.midTuyen?.addVisible,
      midCustomerPlacement: measurements.midCustomer?.placement,
      midCustomerAddVisible: measurements.midCustomer?.addVisible,
      midCangHaPlacement: measurements.midCangHa?.placement,
      midCangHaAddVisible: measurements.midCangHa?.addVisible,
    },
  };
  writeFileSync(join(ARTIFACT_DIR, `${STAGE}_measurements.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(ARTIFACT_DIR, `${STAGE}_driver.log`), log.join("\n") + "\n");
  console.log(JSON.stringify(artifact.summary, null, 2));
};

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});