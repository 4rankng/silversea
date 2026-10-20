// FB-066 lần 3 (card 201026101600) — repro/evidence driver for the QA R27
// surface: INSIDE the "Phân bổ nhà xe" dialog (master plan), both field-sets
// (FCL cont body + LCL BKS body). Proves (before) / checks (after):
//   1. a "+ Thêm nhanh biển số xe" affordance next to the BKS picker;
//   2. typing an unregistered plate offers a "Thêm mới: <số>" dropdown option;
//   3. the quick-add flow selects the created plate WITHOUT closing the
//      allocation dialog (nested QuickAddVehicleDialog).
// Run: QA_BASE=http://localhost:7175 QA_API=http://localhost:3002/api \
//      node testplan/qa/scripts/2026-10-20-fb066-lan3-dialog-repro.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb066-lan3-dialog');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLATE = process.env.QA_PLATE || '29C-066.99';

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login: ${res.status}`);
  return body.token;
};

// Snapshot the top-most dialog: field-set identity, quick-add affordances,
// BKS inputs and any listbox currently open.
const dialogState = (page) => page.evaluate(() => {
  const dlgs = [...document.querySelectorAll('[role=dialog]')];
  const dlg = dlgs.at(-1);
  if (!dlg) return { dialogOpen: false, dialogCount: 0 };
  const text = (sel) => dlg.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const buttons = [...dlg.querySelectorAll('button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const quickAdd = [...dlg.querySelectorAll('button')].find((b) => /Thêm nhanh/i.test(b.textContent ?? ''));
  const bksInputs = [...dlg.querySelectorAll('input')].filter((i) => /BKS/i.test(i.getAttribute('aria-label') ?? '')
    || /BKS/i.test(i.closest('label,[class*=field]')?.textContent ?? ''));
  const listbox = document.querySelector('[role=listbox]');
  return {
    dialogOpen: true,
    dialogCount: dlgs.length,
    eyebrow: text('.dispatch-allocation-popover__eyebrow'),
    shipment: text('.dispatch-allocation-popover__shipment strong'),
    isFclBody: Boolean(dlg.querySelector('[aria-label="Phân bổ theo nhà xe theo ngày"]')),
    isLclBody: Boolean(dlg.querySelector('.dispatch-allocation-lcl__fields')),
    quickAddRendered: Boolean(quickAdd),
    quickAddVisible: Boolean(quickAdd) && quickAdd.offsetParent !== null,
    quickAddText: quickAdd?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    bksInputs: bksInputs.map((i) => ({ aria: i.getAttribute('aria-label'), value: i.value, placeholder: i.placeholder })),
    buttons: buttons.slice(0, 14),
    openListboxOptions: listbox ? [...listbox.querySelectorAll('[role=option]')].map((o) => o.textContent?.replace(/\s+/g, ' ').trim()) : null,
  };
});

const openAllocation = async (page) => {
  const triggers = await page.$$('.master-plan-grid__allocation-trigger');
  return triggers;
};

const typeIntoBks = async (page, nameRe, text) => {
  const handle = await page.evaluateHandle((reSrc) => {
    const re = new RegExp(reSrc);
    const inputs = [...document.querySelectorAll('[role=dialog] input')];
    return inputs.find((i) => re.test(i.getAttribute('aria-label') ?? '')
      || re.test(i.closest('label,[class*=field],[class*=group]')?.textContent ?? '')) ?? null;
  }, nameRe.source);
  const el = handle.asElement();
  if (!el) return { typed: false };
  await el.click();
  await sleep(300);
  await page.keyboard.type(text, { delay: 25 });
  await sleep(700);
  return { typed: true };
};

const closeDialog = async (page) => {
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog]')].at(-1);
    if (!dlg) return;
    const btn = [...dlg.querySelectorAll('button')].find((b) => /^(Hủy|Đóng)$/.test(b.textContent?.trim() ?? ''));
    btn?.click();
  });
  await sleep(700);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const token = await login('dieuvan');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => log('page-error', { message: err.message }));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(8000);

  const triggers = await openAllocation(page);
  log('grid-ready', { allocationTriggers: triggers.length });
  if (triggers.length === 0) throw new Error('no allocation trigger rendered');

  let fclShot = false;
  let lclShot = false;
  const findings = [];
  for (let idx = 0; idx < Math.min(triggers.length, 12); idx += 1) {
    const again = (await openAllocation(page))[idx];
    if (!again) break;
    await again.click();
    await sleep(1500);
    const state = await dialogState(page);
    if (!state.dialogOpen) { log('dialog-not-open', { idx }); continue; }
    findings.push({ idx, ...state });
    log('dialog-open', { idx, ...state });

    if (state.isFclBody && !fclShot) {
      fclShot = true;
      await page.screenshot({ path: path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-fcl-dialog.png`) });
    }
    if (state.isLclBody && !lclShot) {
      lclShot = true;
      await page.screenshot({ path: path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-lcl-dialog.png`) });

      // Type an UNREGISTERED plate into "BKS thực" and dump the dropdown.
      const typed = await typeIntoBks(page, /BKS thực/, PLATE);
      const afterType = await dialogState(page);
      log('lcl-typed-unregistered-plate', { typed, ...afterType });
      await page.screenshot({ path: path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-lcl-typed-plate-dropdown.png`) });

      // Quick-add affordance: click it and record the nested dialog.
      const clicked = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role=dialog]')].at(-1);
        const btn = dlg ? [...dlg.querySelectorAll('button')].find((b) => /Thêm nhanh/i.test(b.textContent ?? '')) : null;
        if (!btn) return false;
        btn.click();
        return true;
      });
      await sleep(1200);
      const nested = await dialogState(page);
      log('lcl-quickadd-clicked', { clicked, nested });
      await page.screenshot({ path: path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-lcl-quickadd-nested.png`) });

      if (nested.dialogOpen && nested.dialogCount > state.dialogCount) {
        // FULL quick-add flow (after-phase): enter the plate, apply, and
        // assert the created plate landed in the BKS ô while the allocation
        // dialog stands (rung-3 side effect = the catalog create).
        await page.evaluate((plate) => {
          const input = document.getElementById('quick-add-vehicle-plate');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            setter?.call(input, plate);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, PLATE);
        await sleep(400);
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Áp dụng');
          btn?.click();
        });
        await sleep(2000);
        const afterApply = await dialogState(page);
        log('lcl-quickadd-applied', afterApply);
        await page.screenshot({ path: path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-lcl-after-quickadd-apply.png`) });
      } else {
        // Close whatever top dialog opened (never the allocation dialog).
        await page.evaluate(() => {
          const dlg = [...document.querySelectorAll('[role=dialog]')].at(-1);
          if (!dlg) return;
          const btn = [...dlg.querySelectorAll('button')].find((b) => /^(Hủy|Đóng|Thoát)$/.test(b.textContent?.trim() ?? ''));
          btn?.click();
        });
        await sleep(800);
      }
    }
    await closeDialog(page);
    if (fclShot && lclShot) break;
  }

  fs.writeFileSync(path.join(OUT, 'dialog-findings.json'), JSON.stringify(findings, null, 2));
  log('run-complete', { fclShot, lclShot });
} catch (err) {
  log('driver-error', { message: err.message, stack: err.stack?.slice(0, 400) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, `${process.env.SHOT_PREFIX ?? 'before'}-dialog-driver.log`), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
