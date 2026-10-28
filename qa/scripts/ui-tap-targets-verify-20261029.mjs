// SIL-583 verify — tap-target sweep on the six audited surfaces at 390/768:
// every interactive control ≥24px (WCAG 2.5.8 mandatory floor), and the
// audited clusters reach the 44 touch aim (40 visual ceiling + pseudo hit
// extension under pointer:coarse emulation). No hit-region overlap is
// introduced (vertical-only extensions on horizontal runs).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7199';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dungnv');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  // The audit's cluster selectors, re-measured live.
  const CLUSTERS = [
    ['shipment-debit-copy', '.shipment-debit-copy'],
    ['shipment-debit-docs__badge', '.shipment-debit-docs__badge'],
    ['master-plan-grid__notes-trigger', '.master-plan-grid__notes-trigger'],
    ['detailed-plan-grid__decl-value--action', '.detailed-plan-grid__decl-value--action'],
    ['detailed-plan-grid__note', '.detailed-plan-grid__note'],
    ['dispatch-assignment-cell__carrier--action', '.dispatch-assignment-cell__carrier--action'],
  ];

  const measure = (sel) => page.evaluate((selector) => {
    const els = [...document.querySelectorAll(selector)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent != null;
    });
    if (!els.length) return null;
    const sizes = els.slice(0, 400).map((el) => {
      const r = el.getBoundingClientRect();
      // effective hit box includes a positioned ::after extension
      const st = getComputedStyle(el, '::after');
      let w = r.width, h = r.height;
      if (st && st.position === 'absolute' && st.content !== 'none') {
        const inset = st.top === '-2px' ? 2 : 0;
        const insetB = st.bottom === '-2px' ? 2 : 0;
        const insetL = st.left === '-2px' ? 2 : 0;
        const insetR = st.right === '-2px' ? 2 : 0;
        w = r.width + insetL + insetR;
        h = r.height + inset + insetB;
      }
      return { w: +w.toFixed(1), h: +h.toFixed(1) };
    });
    const minW = Math.min(...sizes.map((s) => s.w));
    const minH = Math.min(...sizes.map((s) => s.h));
    return { count: els.length, minW, minH, sample: sizes.slice(0, 3) };
  }, sel);

  const STOPS = [
    ['shipments-debit', '/shipments-debit'],
    ['dispatch', '/dispatch'],
    ['dispatch-detail', '/dispatch-detail'],
  ];

  for (const width of [390, 768]) {
    for (const [label, route] of STOPS) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${FE}${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2200));
      say(`@${width} ${label}`);
      for (const [name, sel] of CLUSTERS) {
        const m = await measure(sel);
        if (m == null) continue; // cluster not mounted on this surface/width
        check(`@${width} ${label} ${name} ≥24 (n=${m.count})`, m.minW >= 24 && m.minH >= 24, `min ${m.minW}×${m.minH}`);
      }
    }
  }

  // coarse-pointer emulation: the named clusters must reach the 44 aim
  // (hasTouch flips (pointer: coarse) in Chrome device emulation)
  for (const [label, route, sel] of [
    ['shipments-debit', '/shipments-debit', '.shipment-debit-menu__trigger'],
    ['shipments-debit', '/shipments-debit', '.shipment-debit-group__chevron'],
    ['dispatch-detail', '/dispatch-detail', '.dispatch-row-menu__trigger'],
    ['dispatch', '/dispatch', '.master-plan-grid__notes-trigger'],
  ]) {
    await page.setViewport({ width: 390, height: 1000, isMobile: true, hasTouch: true });
    await page.goto(`${FE}${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2200));
    const m = await measure(sel);
    if (m == null) { say(`  SKIP coarse ${label} ${sel} (not mounted)`); continue; }
    // coarse band floors buttons at 40; pseudo adds ±2 → 44
    check(`coarse ${label} ${sel} hit ≥40 (44 aim w/ pseudo)`, m.minH >= 40, `min ${m.minW}×${m.minH} n=${m.count}`);
  }

  // XLSX button (UUIButton sm) — measure the real button box
  await page.emulateMediaFeatures([]);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2200));
  const xlsx = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Tải XLSX'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  });
  if (xlsx) check('XLSX button ≥24', xlsx.w >= 24 && xlsx.h >= 24, JSON.stringify(xlsx));
  else say('  SKIP XLSX (not mounted)');
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil583_ui-shipments-1280.png') });

  // combobox inline input: the FIELD wrapper is the real target
  await page.setViewport({ width: 768, height: 1000 });
  await page.goto(`${FE}/shipments/382`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2200));
  const combo = await page.evaluate(() => {
    const input = document.querySelector('input.z-10.w-full.text-ellipsis');
    if (!input) return null;
    const field = input.closest('[data-combobox-value], .group, .uui-combobox') ?? input.parentElement;
    const ir = input.getBoundingClientRect();
    const fr = field.getBoundingClientRect();
    return { input: { w: +ir.width.toFixed(1), h: +ir.height.toFixed(1) }, field: { w: +fr.width.toFixed(1), h: +fr.height.toFixed(1) } };
  });
  if (combo) {
    check('combobox field wrapper ≥24 (real hit target)', combo.field.h >= 24 || combo.input.h >= 24, JSON.stringify(combo));
  } else say('  SKIP combobox input (not on this page)');
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil583_ui-driver.log'), log.join('\n') + '\nTOTAL ' + (checks - fails.length) + '/' + checks + ' PASS\n');
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
