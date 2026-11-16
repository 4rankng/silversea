/**
 * SIL-847 + SIL-848 — visual verification driver (READ-ONLY).
 * Phases: `before` (staging, verify-on-current-build) / `after` (local, post-fix proof).
 *
 * Env: FRONT (default https://vantai.tingting.vip), API (default FRONT/api),
 *      ACCOUNTS (comma list, default "admin,dungnv,btdung,thanhdc").
 *
 * Checks (viewport 1440x900):
 *  S847-1  /shipments-debit rows R3N/R3M pairs — CƯỚC VẬN TẢI (AUTO) +
 *          TỔNG PHẢI THU KHÁCH must be BLANK (24/10 law), never fake '0'.
 *  S847-2  /my-trips R3P-677-R (or any 2-cont card) badge (ĐƠN bug / KẸP after).
 *  UI-01   /dispatch-detail CONTAINER + SỐ TỜ KHAI columns + headers clip.
 *  UI-02   /debt 'Tổng hợp sản lượng vận tải theo tháng' LẬP PHIẾU buttons.
 *  UI-03   /shipments TRẠNG THÁI signal spans clip.
 *  UI-04   /shipments-detail Số tờ khai 12-digit clip (table mode at 1600).
 *
 * Usage: node 2026-11-16-sil847-sil848-ui-verify.mjs before|after
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { login } from '../../../scripts/lib/http.mjs';
import { withSession } from '../../../scripts/lib/ui-driver.mjs';

const FRONT = process.env.FRONT ?? 'https://vantai.tingting.vip';
const API = process.env.API ?? `${FRONT}/api`;
const WHO = (process.env.ACCOUNTS ?? 'admin,dungnv,btdung,thanhdc').split(',');
const PHASE = process.argv[2] ?? 'before';
const DIR = `/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_sil847-sil848-ui-verify-${PHASE}`;
mkdirSync(DIR, { recursive: true });
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); console.log(s); };

// Column clip measurement — runs inside the page.
const measureColumns = (headers) => {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const result = [];
  for (const want of headers) {
    const target = norm(want);
    const ths = [...document.querySelectorAll('th')];
    const th = ths.find((t) => norm(t.textContent || '').includes(target));
    if (!th) { result.push({ header: want, found: false }); continue; }
    const table = th.closest('table');
    const row = th.closest('tr');
    const colIndex = [...row.children].indexOf(th);
    const bodyRows = table ? [...table.querySelectorAll('tbody tr')] : [];
    const cells = bodyRows.slice(0, 40).map((tr) => {
      const td = tr.children[colIndex];
      if (!td) return null;
      return {
        text: (td.textContent || '').trim().slice(0, 40),
        clipped: td.scrollWidth > td.clientWidth + 1,
        scrollW: td.scrollWidth, clientW: td.clientWidth,
        innerClipped: [...td.querySelectorAll('*')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
          .map((el) => ({ cls: el.className?.toString().slice(0, 40), text: (el.textContent || '').trim().slice(0, 24), scrollW: el.scrollWidth, clientW: el.clientWidth })).slice(0, 3),
      };
    }).filter(Boolean);
    const thClipped = th.scrollWidth > th.clientWidth + 1;
    const wrapper = table?.parentElement;
    result.push({
      header: want, found: true,
      headerText: (th.textContent || '').trim(),
      headerClipped: thClipped, headerLines: Math.round(th.getBoundingClientRect().height / 20),
      headerScrollW: th.scrollWidth, headerClientW: th.clientWidth,
      tableOverflowRight: wrapper ? (table.scrollWidth - wrapper.clientWidth) : null,
      clippedCells: cells.filter((c) => c.clipped || c.innerClipped.length).length,
      sampleClipped: cells.filter((c) => c.clipped || c.innerClipped.length).slice(0, 5),
      sampleFirst: cells.slice(0, 3),
    });
  }
  return result;
};

async function shot(page, name) {
  await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: true });
  log('SHOT', name);
}

async function main() {
  const accounts = {};
  for (const who of WHO) accounts[who] = await login(who, { backend: API, password: 'Abc123' });
  log('phase', PHASE, 'front', FRONT, 'logins ok', WHO.join(','));

  // ── S847-1: /shipments-debit fake-zero check ──
  await withSession(accounts.admin ?? accounts[WHO[0]], async (page) => {
    await page.goto(`${FRONT}/shipments-debit?customer=1&from=2026-01-01&to=2027-12-31&lock=ALL`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3500));
    await shot(page, 's847-1-shipments-debit');
    const rows = await page.evaluate(() => {
      const out = [];
      for (const tr of [...document.querySelectorAll('table tbody tr')]) {
        const tds = [...tr.children].map((td) => (td.textContent || '').trim());
        if (/R3[NM]-(KR|J)/.test(tds.join(' | '))) out.push({ cells: tds });
      }
      for (const art of [...document.querySelectorAll('article')]) {
        const t = (art.textContent || '').trim();
        if (/R3[NM]-(KR|J)/.test(t)) out.push({ card: t.slice(0, 220) });
      }
      return out;
    });
    log('S847-1 rows', JSON.stringify(rows));
  }, { artifactDir: DIR, name: 'session-debit' });

  // ── S847-2: /my-trips badge on a 2-cont card ──
  const driver = accounts.btdung ?? accounts.laixe ?? accounts.dvthuc;
  if (driver) {
    await withSession(driver, async (page) => {
      await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2', timeout: 90000 });
      await new Promise((r) => setTimeout(r, 3500));
      await shot(page, 's847-2-my-trips');
      const cards = await page.evaluate(() => {
        const out = [];
        for (const card of document.querySelectorAll('.driver-journey-card')) {
          const strips = [...card.querySelectorAll('.driver-journey-card__strip, [class*="strip"]')]
            .map((s) => (s.textContent || '').trim()).filter(Boolean);
          const tag = card.querySelector('.driver-journey-card__tag');
          const t = (card.textContent || '');
          if (/R3P-677-R/.test(t) || strips.length >= 2 || (tag && ['KẸP', 'ĐƠN'].includes(tag.textContent.trim()))) {
            out.push({ badge: tag?.textContent?.trim() ?? null, strips: strips.length, text: t.trim().slice(0, 200) });
          }
        }
        return out.slice(0, 8);
      });
      log('S847-2 cards', JSON.stringify(cards));
    }, { artifactDir: DIR, name: 'session-mytrips' });
  } else { log('S847-2 skipped: no driver account in this env'); }

  // ── UI-01: /dispatch-detail ──
  await withSession(accounts.dungnv ?? accounts.dieuvan ?? accounts.admin ?? accounts[WHO[0]], async (page) => {
    await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-01-dispatch-detail');
    const m = await page.evaluate(measureColumns, ['CONTAINER', 'SỐ TỜ KHAI']);
    log('UI-01 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-dispatch' });

  // ── UI-02: /debt — the LẬP PHIẾU buttons vs the canvas edge ──
  await withSession(accounts.admin ?? accounts[WHO[0]], async (page) => {
    await page.goto(`${FRONT}/debt`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-02-debt');
    const m = await page.evaluate(() => {
      const out = { overflow: [], buttons: [] };
      for (const table of document.querySelectorAll('table')) {
        const wrap = table.parentElement;
        const over = wrap ? table.scrollWidth - wrap.clientWidth : 0;
        out.overflow.push({ heads: [...table.querySelectorAll('th')].map((t) => (t.textContent || '').trim()).slice(0, 16), over });
      }
      for (const btn of document.querySelectorAll('button')) {
        if (/Lập phiếu/i.test(btn.textContent || '')) {
          const r = btn.getBoundingClientRect();
          out.buttons.push({
            text: (btn.textContent || '').trim().slice(0, 20),
            clipped: btn.scrollWidth > btn.clientWidth + 1,
            scrollW: btn.scrollWidth, clientW: btn.clientWidth,
            right: Math.round(r.right), viewport: window.innerWidth,
            beyondCanvas: r.right > window.innerWidth,
          });
        }
      }
      return out;
    });
    log('UI-02 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-debt' });

  // ── UI-03: /shipments TRẠNG THÁI signal spans ──
  await withSession(accounts.admin ?? accounts[WHO[0]], async (page) => {
    await page.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-03-shipments');
    const m = await page.evaluate(measureColumns, ['TRẠNG THÁI']);
    const spans = await page.evaluate(() => [...document.querySelectorAll('.cus-row-actions__signal, [class*="signal"]')]
      .slice(0, 20)
      .map((el) => ({ text: (el.textContent || '').trim().slice(0, 30), clipped: el.scrollWidth > el.clientWidth + 1, scrollW: el.scrollWidth, clientW: el.clientWidth })));
    log('UI-03 measure', JSON.stringify(m), 'signals', JSON.stringify(spans));
  }, { artifactDir: DIR, name: 'session-shipments' });

  // ── UI-04: /shipments-detail — clear filters, table mode at 1600 ──
  await withSession(accounts.admin ?? accounts[WHO[0]], async (page) => {
    await page.goto(`${FRONT}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3500));
    const cleared = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Xóa bộ lọc/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 3500));
    log('UI-04 filters cleared:', cleared);
    await shot(page, 'ui-04-shipments-detail-1440');
    await page.setViewport({ width: 1700, height: 900 });
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'ui-04-shipments-detail-1700');
    const m = await page.evaluate(measureColumns, ['TỜ KHAI']);
    log('UI-04 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-shdetail' });

  writeFileSync(join(DIR, 'verify.log'), out.join('\n') + '\n');
  log('DONE phase', PHASE);
}

main().catch((e) => { log('FATAL', e.stack || e.message); writeFileSync(join(DIR, 'verify.log'), out.join('\n') + '\n'); process.exit(1); });
