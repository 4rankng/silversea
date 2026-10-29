// SIL-561 verify — popover-dialog semantics: every adopted role=dialog popover
// (ColumnPicker, FilterDropdown, month picker, UDRP) opens with aria-modal +
// focus INSIDE the panel + an inert background, Escape returns focus to the
// trigger, and click-outside still dismisses (inert must not break it).
// Viewports 1280 / 768 / 390 on /shipments (+ /shipments-debit for the UDRP).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7199';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
const results = { checks: 0, fails: [] };
const check = (name, ok, detail = '') => {
  results.checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) results.fails.push(name);
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  // Probe one popover end-to-end: open → semantics → Escape → focus restore.
  const probe = (triggerSel, panelSel) => page.evaluate((ts, ps) => {
    document.querySelector(ts)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return new Promise((res) => setTimeout(() => {
      const panel = document.querySelector(ps);
      // A background BRANCH off the panel/trigger path is the honest inert
      // check — #root and the trigger's own path are stepped into, so count
      // the blocked branches instead of naming one per surface.
      const inertCount = document.querySelectorAll('[inert]').length;
      res({
        opened: !!panel,
        ariaModal: panel?.getAttribute('aria-modal') ?? null,
        focusInPanel: panel ? panel.contains(document.activeElement) : false,
        activeIsBody: document.activeElement === document.body,
        branchInert: inertCount >= 3,
        // SIL-561 fail 29/10: the background is FULLY inert now — `main`
        // carries the attribute (QA's probe) and the opener chain is NOT
        // exempt (platform modal semantics; the close path un-inerts before
        // restoring focus).
        mainInert: document.querySelector('main')?.hasAttribute('inert') ?? false,
        triggerInert: document.querySelector(ts)?.hasAttribute('inert') ?? false,
      });
    }, 350));
  }, triggerSel, panelSel);

  const escapeProbe = (triggerSel, panelSel) => page.evaluate((ts, ps) => {
    const panel = document.querySelector(ps);
    const before = document.querySelector(ts);
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return new Promise((res) => setTimeout(() => {
      res({
        closed: !document.querySelector(ps),
        focusOnTrigger: document.activeElement === before,
        branchInertAfter: document.querySelectorAll('[inert]').length >= 3,
      });
    }, 350));
  }, triggerSel, panelSel);

  for (const width of [1280, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    say(`@${width} /shipments`);

    // 1 — Column picker
    const hasColPicker = await page.$('.column-picker__trigger');
    if (hasColPicker) {
      const o = await probe('.column-picker__trigger', '.column-picker__popover');
      check(`@${width} column-picker aria-modal`, o.opened && o.ariaModal === 'true', `aria-modal=${o.ariaModal}`);
      check(`@${width} column-picker focus inside`, o.focusInPanel && !o.activeIsBody);
      check(`@${width} column-picker background inert (main carries it)`, o.mainInert && o.branchInert);
      if (width === 1280) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil561_ui-column-picker-1280-open.png`) });
      const c = await escapeProbe('.column-picker__trigger', '.column-picker__popover');
      check(`@${width} column-picker Escape restores trigger`, c.closed && c.focusOnTrigger, `focusOnTrigger=${c.focusOnTrigger}`);
      check(`@${width} column-picker inert released`, !c.branchInertAfter);

      // click-outside still dismisses
      const o2 = await probe('.column-picker__trigger', '.column-picker__popover');
      check(`@${width} column-picker reopens`, o2.opened);
      await page.mouse.click(10, 400);
      await new Promise((r) => setTimeout(r, 350));
      const stillOpen = await page.$('.column-picker__popover');
      check(`@${width} column-picker click-outside closes`, !stillOpen);
    } else {
      say(`  SKIP column-picker (trigger not mounted @${width})`);
    }

    // 2 — FilterDropdown (Bộ lọc)
    const hasFilter = await page.$('.filter-dropdown__trigger');
    if (hasFilter) {
      const o = await probe('.filter-dropdown__trigger', '.filter-dropdown__popover');
      check(`@${width} filter-dropdown aria-modal`, o.opened && o.ariaModal === 'true', `aria-modal=${o.ariaModal}`);
      check(`@${width} filter-dropdown focus inside`, o.focusInPanel && !o.activeIsBody);
      check(`@${width} filter-dropdown background inert (main carries it)`, o.mainInert && o.branchInert);
      if (width === 1280) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil561_ui-filter-dropdown-1280-open.png`) });
      const c = await escapeProbe('.filter-dropdown__trigger', '.filter-dropdown__popover');
      check(`@${width} filter-dropdown Escape restores trigger`, c.closed && c.focusOnTrigger, `focusOnTrigger=${c.focusOnTrigger}`);
      if (width === 390) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil561_ui-filter-dropdown-390-closed.png`) });
    } else {
      say(`  SKIP filter-dropdown (trigger not mounted @${width})`);
    }

    // 3 — Month picker (topbar)
    const hasMonth = await page.$('.topbar-date__trigger');
    if (hasMonth) {
      const o = await probe('.topbar-date__trigger', '.month-picker');
      check(`@${width} month-picker aria-modal`, o.opened && o.ariaModal === 'true', `aria-modal=${o.ariaModal}`);
      check(`@${width} month-picker focus inside`, o.focusInPanel && !o.activeIsBody);
      check(`@${width} month-picker background inert (main carries it)`, o.mainInert && o.branchInert);
      if (width === 390) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil561_ui-month-picker-390-open.png`) });
      // SIL-573 contract survives: Escape restores the trigger.
      const c = await escapeProbe('.topbar-date__trigger', '.month-picker');
      check(`@${width} month-picker Escape restores trigger`, c.closed && c.focusOnTrigger, `focusOnTrigger=${c.focusOnTrigger}`);
    } else {
      say(`  SKIP month-picker (trigger not mounted @${width})`);
    }
  }

  // 4 — UDRP on /shipments-debit
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const hasUdrp = await page.$('.udrp__trigger');
    if (!hasUdrp) { say(`  SKIP udrp @${width} (trigger not mounted)`); continue; }
    const o = await probe('.udrp__trigger', '.udrp__popover');
    check(`@${width} udrp aria-modal`, o.opened && o.ariaModal === 'true', `aria-modal=${o.ariaModal}`);
    check(`@${width} udrp focus inside`, o.focusInPanel && !o.activeIsBody);
    check(`@${width} udrp background inert (main carries it)`, o.mainInert && o.branchInert);
    if (width === 1280) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil561_ui-udrp-1280-open.png`) });
    const c = await escapeProbe('.udrp__trigger', '.udrp__popover');
    check(`@${width} udrp Escape restores trigger`, c.closed && c.focusOnTrigger, `focusOnTrigger=${c.focusOnTrigger}`);
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil561_ui-driver.log'), log.join('\n'));
  say(`TOTAL ${results.checks - results.fails.length}/${results.checks} PASS`);
  if (results.fails.length) process.exit(1);
}
