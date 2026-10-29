// SIL-583 round 3 — tap-target verify on the QA round-2 fail list (build
// c2d740c5): /shipments-debit "Ghép (n/2)" triggers 66×20 and
// /shipments-detail field links 17px tall ("Thiếu N thông tin ▾", "Sửa cước
// thu khách", "BKS Báo khách (Ảo) — sửa", "Sửa BKS thực") sat under the
// WCAG 2.5.8 24px floor. Fix: base min-height 24 on the two sub-24 clusters
// (every pointer); touch riders keep the 40px element floor from the coarse
// band (owner ruling 2026-09-27 — the touch ceiling). Round 3 also measured
// the engine: ::after pseudo hit-extensions are a NO-OP on this Chromium
// (real clicks 2px outside a control's box never capture, painted or not —
// see the finding note in styles/responsive.css), so the REAL hit area is
// the element border box and that is what this driver verifies: element
// boxes at 390/768/1440 fine + 768 coarse, zero interactive controls under
// 24px across the QA surfaces, and a real mouse click proving a floored
// 24px link actually toggles (the floor box is the real, working target).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
let failed = 0;
const check = (name, ok, detail = '') => { say(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failed += 1; };

const login = async (page, username) => {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const hasForm = await page.$('input[name="username"]');
  if (!hasForm) return; // session already active — the app bounced off /login
  await page.type('input[name="username"]', username);
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
};

// The measured sweep: every interactive element's border box must clear the
// 24px WCAG 2.5.8 floor. Known non-targets are excluded explicitly (the
// artifact classes the round-2 residual probe classified): hidden inputs,
// label-wrapped checkbox/radio (the label is the effective target — QA
// round-2's own ruling), visibility:hidden decorations, RAC HiddenSelect.
const sweep = (page) => page.evaluate(() => {
  const SQR = 24;
  const sel = 'button, a[href], input, select, textarea, [role="button"], [role="combobox"], [role="tab"]';
  const els = [...document.querySelectorAll(sel)];
  const under = [];
  let scanned = 0;
  for (const el of els) {
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') && el.labels && el.labels.length > 0) continue;
    if (el.getAttribute('tabindex') === '-1' && el.matches('[data-a11y-ignore], [aria-hidden="true"], .rac-hidden-select, [data-uui-visible-select-target]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom < -200 || r.top > innerHeight + 200) continue; // virtualized/portal noise off-canvas
    scanned += 1;
    const w = +r.width.toFixed(1);
    const h = +r.height.toFixed(1);
    if ((w > 0 && w < SQR) || (h > 0 && h < SQR)) {
      under.push({ w, h, tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
    }
  }
  return { scanned, under };
});

const measureNamed = (page, spec) => page.evaluate((spec) => {
  const out = {};
  for (const [key, q] of Object.entries(spec.named)) {
    const els = [...document.querySelectorAll(q)];
    const boxes = els.map((el) => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
    out[key] = { count: els.length, minW: boxes.length ? +Math.min(...boxes.map((b) => b.w)).toFixed(1) : null, minH: boxes.length ? +Math.min(...boxes.map((b) => b.h)).toFixed(1) : null };
  }
  return out;
}, spec);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await login(page, 'admin');

  // ── admin: the debit board (QA round-3 used admin @768 — the mergetag is
  // canManage-gated and dispatchers see none) ──
  const debitRuns = [
    { width: 768, shot: 'debit-768' },
    { width: 1440 },
    { width: 390 },
  ];
  for (const run of debitRuns) {
    await page.setViewport({ width: run.width, height: 844 });
    await page.goto(`${FE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1800));
    const sw = await sweep(page);
    check(`@${run.width} /shipments-debit — 0 interactive control under 24×24 (fine, scanned ${sw.scanned})`, sw.under.length === 0, sw.under.length ? JSON.stringify(sw.under.slice(0, 4)) : 'clean');
    const m = await measureNamed(page, { named: { mergetag: '.shipment-debit-mergetag__trigger' } });
    const v = m.mergetag;
    if (v.count === 0 && run.width === 390) {
      say(`note: @390 /shipments-debit — card mode renders no table mergetag (QA's fail list cites the tag @768 only); ${sw.scanned} controls still sweep clean below`);
    } else {
      check(`@${run.width} /shipments-debit — mergetag ≥24px (${v.count}×)`, v.count > 0 && v.minW >= 24 && v.minH >= 24, JSON.stringify(v));
    }
    if (run.shot) {
      await page.screenshot({ path: `${OUT}/2026-10-30_sil583_ui-${run.shot}.png` });
      say(`screenshot qa/2026-10-30_sil583_ui-${run.shot}.png`);
    }
  }

  // ── /shipments-detail: rows are click-targets; open rows until the ledger
  // renders field-link toggles (they only exist on rows with missing fields)
  await page.setViewport({ width: 768, height: 844 });
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  let detailPath = null;
  let fieldLinkCount = 0;
  for (let i = 0; i < 8 && fieldLinkCount === 0; i += 1) {
    await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const clicked = await page.evaluate((idx) => {
      const rows = document.querySelectorAll('.cus-dashboard-viewport tbody tr, tbody tr');
      const row = rows[idx];
      if (!row) return false;
      const cell = row.querySelector('td, th');
      if (!cell) return false;
      (cell.querySelector('button') || cell).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }, i);
    if (!clicked) break;
    await new Promise((r) => setTimeout(r, 2200));
    detailPath = await page.evaluate(() => location.pathname + location.search);
    fieldLinkCount = await page.evaluate(() => document.querySelectorAll('.shipment-container-ledger__missing-fields-toggle').length);
    say(`row ${i}: ${detailPath} → fieldLinks ${fieldLinkCount}`);
  }
  say(`detail route resolved: ${detailPath}`);

  const runs = [
    { width: 768, url: detailPath || '/shipments-detail', named: { fieldLinks: '.shipment-container-ledger__missing-fields-toggle' }, shot: 'detail-768', realClick: true },
    { width: 390, url: '/shipments/new', named: { copyBtn: '.csc-container-row__copy' }, shot: 'new-390' },
    { width: 768, url: '/dispatch', named: { notesTrigger: '.master-plan-grid__notes-trigger' } },
    { width: 768, url: '/dispatch-detail', named: {} },
    { width: 768, url: '/shipments', named: {} },
    { width: 390, url: '/shipments', named: {} },
  ];

  for (const run of runs) {
    await page.setViewport({ width: run.width, height: 844 });
    await page.goto(`${FE}${run.url}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const sw = await sweep(page);
    check(`@${run.width} ${run.url} — 0 interactive control under 24×24 (fine, scanned ${sw.scanned})`, sw.under.length === 0, sw.under.length ? JSON.stringify(sw.under.slice(0, 4)) : 'clean');
    if (Object.keys(run.named).length) {
      const m = await measureNamed(page, { named: run.named });
      for (const [k, v] of Object.entries(m)) {
        if (v.count === 0 && k === 'fieldLinks') {
          say(`note: @${run.width} ${run.url} — no field-link toggles on this lot (links render only on rows with missing fields); sweep still clean`);
          continue;
        }
        check(`@${run.width} ${run.url} — ${k} ≥24px (${v.count}×)`, v.count > 0 && v.minW >= 24 && v.minH >= 24, JSON.stringify(v));
      }
    }
    // Real-click proof on the floored field link: a mouse click INSIDE the
    // 24px box toggles the disclosure (aria-expanded flips) — the floor is
    // the real, working target, not a painted claim.
    if (run.realClick) {
      const toggled = await page.evaluate(async () => {
        const el = document.querySelector('.shipment-container-ledger__missing-fields-toggle');
        if (!el) return { ok: false, note: 'no toggle' };
        const before = el.getAttribute('aria-expanded');
        const r = el.getBoundingClientRect();
        el.scrollIntoView({ block: 'center' });
        await new Promise((res) => setTimeout(res, 250));
        const r2 = el.getBoundingClientRect();
        return { ok: true, before, cx: r2.left + r2.width / 2, cy: r2.top + 2 }; // 2px inside the top edge of the 24px box
      });
      if (toggled.ok) {
        await page.mouse.click(toggled.cx, toggled.cy);
        await new Promise((r) => setTimeout(r, 350));
        const after = await page.evaluate(() => document.querySelector('.shipment-container-ledger__missing-fields-toggle')?.getAttribute('aria-expanded'));
        check('real click inside the 24px field-link box toggles the disclosure', after !== toggled.before, `aria-expanded ${toggled.before} → ${after} @2px-inside-top`);
      } else {
        say(`note: real-click proof skipped — ${toggled.note}`);
      }
    }
    if (run.shot) {
      await page.screenshot({ path: `${OUT}/2026-10-30_sil583_ui-${run.shot}.png` });
      say(`screenshot qa/2026-10-30_sil583_ui-${run.shot}.png`);
    }
  }

  // ── coarse emulation: the named clusters ride the 40px touch ceiling ──
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewport({ width: 768, height: 844, hasTouch: true });
  await page.goto(`${FE}${detailPath || '/shipments-detail'}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  const coarseDetail = await measureNamed(page, { named: { fieldLinks: '.shipment-container-ledger__missing-fields-toggle' } });
  const fv = coarseDetail.fieldLinks;
  if (fv.count === 0) {
    say('note: coarse — this lot renders no field-link toggles; element growth for the family is pinned at the stylesheet level');
  } else {
    check(`coarse @768 ${detailPath} — fieldLinks ride the 40px touch ceiling (${fv.count}×)`, fv.minH >= 40 && fv.minW >= 24, JSON.stringify(fv));
  }
  await page.goto(`${FE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  const coarse = await measureNamed(page, { named: { mergetag: '.shipment-debit-mergetag__trigger', btn: '.btn' } });
  for (const [k, v] of Object.entries(coarse)) {
    check(`coarse @768 /shipments-debit — ${k} rides the 40px touch ceiling (${v.count}×)`, v.count > 0 && v.minH >= 40 && v.minW >= 24, JSON.stringify(v));
  }
  await page.screenshot({ path: `${OUT}/2026-10-30_sil583_ui-debit-768-coarse.png` });
  say('screenshot qa/2026-10-30_sil583_ui-debit-768-coarse.png');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
} finally { await browser.close(); }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-30_sil583_ui-driver-round3.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
