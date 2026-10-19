#!/usr/bin/env node
/**
 * 2026-10-18 — card 181026143000 width sweep for the two changed surfaces
 * (direction-aware kho quick-add dialog title + shared dashed "+ Thêm kho"
 * button): 390 / 768 / 1440. Read-only for the DB — every dialog is cancelled.
 * Run: node testplan/qa/scripts/2026-10-18-181026143000-widths.mjs
 */
import { login } from '../../../scripts/lib/http.mjs';
import { withSession, sleep, clickButtonByText } from '../../../scripts/lib/ui-driver.mjs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const QA = join(ROOT, 'qa');
const token = await login('admin', { backend: 'http://localhost:3002/api' });
const log = [];
const expectOk = (cond, label, detail = '') => { log.push(`${cond ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); };

await withSession(token, async (page) => {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewport({ width, height });
    await page.goto('http://localhost:7175/shipments/new', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('input[type=radio]')).some((r) => /Hàng lẻ/.test(r.closest('label')?.textContent ?? '')), { timeout: 20000 });
    await page.click('[data-field-id="shipment-customer"] input');
    await sleep(400);
    await page.evaluate(() => {
      const active = document.activeElement;
      const list = active?.getAttribute('aria-controls') ? document.getElementById(active.getAttribute('aria-controls')) : document.querySelector('[role="listbox"]');
      list?.querySelector('[role="option"]')?.click();
    });
    await sleep(500);
    await page.evaluate(() => {
      const radio = Array.from(document.querySelectorAll('input[type=radio]')).find((r) => /Hàng lẻ/.test(r.closest('label')?.textContent ?? ''));
      radio?.click();
    });
    await page.waitForSelector('[data-field-id="shipment-pickup-warehouse"]', { timeout: 8000 });
    // direction = Xuất khẩu
    await page.click('#shipment-trade-direction');
    await sleep(300);
    await page.evaluate(() => {
      const list = document.querySelector('[role="listbox"]');
      Array.from(list?.querySelectorAll('[role="option"]') ?? []).find((o) => o.textContent?.trim() === 'Xuất khẩu')?.click();
    });
    await sleep(400);
    // shared dashed button present + visible at this width
    const btn = await page.evaluate(() => {
      // Match the DASHED utility button by class — an empty-catalog customer
      // also renders an inline "Thêm kho" hint link (borderless, classless).
      const b = [...document.querySelectorAll('button.csc-utility-button--dashed')]
        .find((x) => x.textContent?.trim() === 'Thêm kho');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { cls: b.className, visible: r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), vw: window.innerWidth };
    });
    expectOk(btn && btn.visible && btn.cls.includes('csc-utility-button--dashed'), `${width}px "+ Thêm kho" visible via shared dashed class`, JSON.stringify(btn));
    expectOk(!btn || btn.h <= 40, `${width}px "+ Thêm kho" height ≤ 40px (control budget)`, btn ? `${btn.h}px` : 'n/a');
    // dialog opens with the Xuất khẩu title and fits the viewport
    await clickButtonByText(page, 'Thêm kho$');
    await page.waitForSelector('[role="dialog"] button', { timeout: 8000 });
    await sleep(300);
    const dlg = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const title = d?.getAttribute('aria-label') ?? d?.querySelector('.modal__title')?.textContent?.trim() ?? null;
      const box = d?.querySelector('.modal__content')?.getBoundingClientRect();
      return { title, fits: box ? box.left >= 0 && box.right <= window.innerWidth : false, vw: window.innerWidth };
    });
    expectOk(dlg.title === 'Thêm kho trả hàng', `${width}px dialog title Xuất khẩu`, dlg.title);
    expectOk(dlg.fits, `${width}px dialog fits viewport`, JSON.stringify(dlg));
    await page.screenshot({ path: join(QA, `2026-10-18_181026143000_ui-width-${width}.png`) });
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      [...(d?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Hủy')?.click();
    });
    await sleep(300);
  }
}, { name: 'widths', headless: 'new' });

await appendFile(join(QA, '2026-10-18_181026143000_widths.log'), log.join('\n') + '\n');
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
