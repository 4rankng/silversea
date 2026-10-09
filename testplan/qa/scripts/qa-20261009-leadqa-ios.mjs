// Lead QA rung — card 20261009_3 (iOS safe-area / bottom sheet) on staging ef4c1d63.
// Mobile viewports 390x844 + 430x932: (1) lot-detail page fills the viewport, no dead band;
// (2) the ledger editor docks as a bottom sheet (flush bottom, top radius, safe-area padding).
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';
const BASE = 'https://vantai.tingting.vip';
const dir = 'testplan/qa/evidence/2026-10-09_round8-leadqa';
mkdirSync(dir, { recursive: true });
const log = `${dir}/driver-leadqa-ios.log`;
const step = (s, o) => appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), step: s, ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
if (!token) throw new Error('login failed');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const [w, h] of [[390, 844], [430, 932]]) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);
    // AC1: page chain fills the viewport — no unstyled dead band at the bottom
    const fill = await page.evaluate(() => {
      const page_ = document.querySelector('.shipments-detail-page');
      const de = document.documentElement;
      window.scrollTo(0, de.scrollHeight);
      // what actually paints 2px above the physical bottom edge?
      const probe = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 2);
      let n = probe, bg = 'rgba(0, 0, 0, 0)';
      while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } n = n.parentElement; }
      return {
        innerH: window.innerHeight,
        scrollH: de.scrollHeight,
        fillsViewport: de.scrollHeight >= window.innerHeight - 2,
        bottomPaints: !!probe && bg !== 'rgba(0, 0, 0, 0)',
        bottomPainter: probe ? probe.tagName + '.' + (probe.className || '').toString().slice(0, 30) : null,
        bottomBg: bg,
        pageMinH: page_ ? getComputedStyle(page_).minHeight : null,
      };
    });
    await sleep(400);
    step('ac1', { w, h, ...fill });
    await page.screenshot({ path: `${dir}/ios-list-${w}.png` });
    step('ac1-verdict', { w, pass: fill.fillsViewport && fill.bottomPaints });

    // AC2: open the ledger editor (Chỉnh sửa khách hàng và lộ trình) — must dock
    const trigger = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Chỉnh sửa ô')));
    const el = trigger.asElement();
    if (!el) throw new Error('ledger edit trigger not found');
    await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await sleep(300);
    const bb = await el.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(1500);
    const sheet = await page.evaluate(() => {
      const editor = document.querySelector('.shipment-container-ledger__inline-editor--sheet');
      const backdrop = document.querySelector('.shipment-container-ledger__sheet-backdrop');
      const cs = editor ? getComputedStyle(editor) : null;
      const r = editor ? editor.getBoundingClientRect() : null;
      return {
        editorFound: !!editor,
        backdrop: !!backdrop,
        pos: cs?.position, bottom: r ? Math.round(window.innerHeight - r.bottom) : null,
        topRadius: cs ? cs.borderTopLeftRadius + '/' + cs.borderTopRightRadius : null,
        bottomRadius: cs ? cs.borderBottomLeftRadius + '/' + cs.borderBottomRightRadius : null,
        pb: cs?.paddingBottom, h: r ? Math.round(r.height) : null, width: r ? Math.round(r.width) : null,
      };
    });
    step('ac2', { w, ...sheet });
    await page.screenshot({ path: `${dir}/ios-sheet-${w}.png` });
    const docked = sheet.editorFound && sheet.pos === 'fixed' && sheet.bottom <= 2 ? sheet : null;
    step('ac2-verdict', { w, docked: docked ?? null, pass: !!docked });
    // close the sheet for the next viewport
    await page.keyboard.press('Escape');
    await sleep(800);
  }
  step('DONE', { verdict: 'IOS-RUNG-COMPLETE' });
} finally {
  await browser.close();
}
console.log('IOS RUNG DONE');
