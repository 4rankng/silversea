/**
 * SIL-847 + SIL-848 — staging visual verification driver (READ-ONLY).
 * Phases: `before` (verify-on-current-build) / `after` (post-fix proof).
 *
 * Checks (viewport 1440x900):
 *  S847-1  /shipments-debit rows R3N/R3M pairs — CƯỚC VẬN TẢI (AUTO) +
 *          TỔNG PHẢI THU KHÁCH must be BLANK (24/10 law), never fake '0'.
 *  S847-2  /my-trips R3P-677-R card badge (ĐƠN bug / KẸP after fix).
 *  UI-01   /dispatch-detail CONTAINER + SỐ TỜ KHAI columns + headers clip.
 *  UI-02   /debt 'Tổng hợp sản lượng vận tải theo tháng' LẬP PHIẾU column.
 *  UI-03   /shipments TRẠNG THÁI column clip.
 *  UI-04   /shipments-detail Số tờ khai 12-digit clip.
 *
 * Usage: node 2026-11-16-sil847-sil848-ui-verify.mjs before|after
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { login } from '../../../scripts/lib/http.mjs';
import { withSession } from '../../../scripts/lib/ui-driver.mjs';

const FRONT = 'https://vantai.tingting.vip';
const API = 'https://vantai.tingting.vip/api';
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
      const cs = getComputedStyle(td);
      return {
        text: (td.textContent || '').trim().slice(0, 40),
        clipped: td.scrollWidth > td.clientWidth + 1,
        scrollW: td.scrollWidth, clientW: td.clientWidth,
        overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace,
      };
    }).filter(Boolean);
    const thClipped = th.scrollWidth > th.clientWidth + 1;
    const wrapper = table?.parentElement;
    result.push({
      header: want, found: true,
      headerText: (th.textContent || '').trim(),
      headerClipped: thClipped,
      headerScrollW: th.scrollWidth, headerClientW: th.clientWidth,
      tableOverflowRight: wrapper ? (table.scrollWidth - wrapper.clientWidth) : null,
      clippedCells: cells.filter((c) => c.clipped).length,
      sampleClipped: cells.filter((c) => c.clipped).slice(0, 5),
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
  for (const who of ['admin', 'dungnv', 'btdung', 'thanhdc']) {
    accounts[who] = await login(who, { backend: API, password: 'Abc123' });
  }
  log('phase', PHASE, 'logins ok');

  // ── S847-1: /shipments-debit fake-zero check (CUS surface; admin reads all) ──
  await withSession(accounts.admin, async (page) => {
    await page.goto(`${FRONT}/shipments-debit?customer=1&from=2026-01-01&to=2027-12-31&lock=ALL`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3500));
    await shot(page, 's847-1-shipments-debit');
    const rows = await page.evaluate(() => {
      const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const out = [];
      const trs = [...document.querySelectorAll('table tbody tr')];
      for (const tr of trs) {
        const tds = [...tr.children].map((td) => (td.textContent || '').trim());
        const joined = tds.join(' | ');
        if (/R3[NM]-(KR|J)/.test(joined)) out.push({ cells: tds });
      }
      // also the mobile record cards (article) if table absent
      for (const art of [...document.querySelectorAll('article')]) {
        const t = (art.textContent || '').trim();
        if (/R3[NM]-(KR|J)/.test(t)) out.push({ card: t.slice(0, 220) });
      }
      return out;
    });
    log('S847-1 rows', JSON.stringify(rows));
  }, { artifactDir: DIR, name: 'session-debit' });

  // ── S847-2: /my-trips R3P-677-R badge ──
  await withSession(accounts.btdung, async (page) => {
    await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3500));
    await shot(page, 's847-2-my-trips');
    const cards = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll('.driver-journey-card')) {
        const t = (card.textContent || '');
        if (/R3P-677-R/.test(t)) {
          const tag = card.querySelector('.driver-journey-card__tag');
          const strips = card.querySelectorAll('.driver-journey-card__container, [class*="container"]');
          out.push({ badge: tag?.textContent?.trim() ?? null, text: t.trim().slice(0, 260), strips: strips.length });
        }
      }
      return out;
    });
    log('S847-2 R3P-677-R cards', JSON.stringify(cards));
  }, { artifactDir: DIR, name: 'session-mytrips' });

  // ── UI-01: /dispatch-detail ──
  await withSession(accounts.dungnv, async (page) => {
    await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-01-dispatch-detail');
    const m = await page.evaluate(measureColumns, ['CONTAINER', 'SỐ TỜ KHAI', 'TỜ KHAI']);
    log('UI-01 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-dispatch' });

  // ── UI-02: /debt ──
  await withSession(accounts.admin, async (page) => {
    await page.goto(`${FRONT}/debt`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-02-debt');
    const m = await page.evaluate(() => {
      const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
      const out = { tables: [] };
      for (const table of document.querySelectorAll('table')) {
        const caption = table.querySelector('caption')?.textContent || table.closest('section,div')?.querySelector('h2,h3,h4')?.textContent || '';
        const heads = [...table.querySelectorAll('th')].map((t) => (t.textContent || '').trim());
        const wrap = table.parentElement;
        const lapPhieu = [...table.querySelectorAll('th')].find((t) => norm(t.textContent || '').includes('lap phieu'));
        let lap = null;
        if (lapPhieu) {
          const row = lapPhieu.closest('tr');
          const idx = [...row.children].indexOf(lapPhieu);
          const cells = [...table.querySelectorAll('tbody tr')].slice(0, 30).map((tr) => {
            const td = tr.children[idx];
            const btn = td?.querySelector('button,a');
            return {
              text: (td?.textContent || '').trim().slice(0, 30),
              clipped: td ? td.scrollWidth > td.clientWidth + 1 : null,
              cellRight: td?.getBoundingClientRect().right, tableRight: table.getBoundingClientRect().right,
              btnText: btn?.textContent?.trim() ?? null,
              btnClipped: btn ? (btn.scrollWidth > btn.clientWidth + 1 || btn.getBoundingClientRect().right > table.getBoundingClientRect().right) : null,
              btnRect: btn ? { l: btn.getBoundingClientRect().left, r: btn.getBoundingClientRect().right, w: btn.getBoundingClientRect().width } : null,
            };
          });
          lap = { headerClipped: lapPhieu.scrollWidth > lapPhieu.clientWidth + 1, cells: cells.slice(0, 6) };
        }
        out.tables.push({
          caption: caption.trim().slice(0, 80),
          heads: heads.slice(0, 14),
          tableOverflowRight: wrap ? table.scrollWidth - wrap.clientWidth : null,
          lapPhieu: lap,
        });
      }
      return out;
    });
    log('UI-02 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-debt' });

  // ── UI-03: /shipments ──
  await withSession(accounts.admin, async (page) => {
    await page.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-03-shipments');
    const m = await page.evaluate(measureColumns, ['TRẠNG THÁI', 'CHI TIẾT']);
    log('UI-03 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-shipments' });

  // ── UI-04: /shipments-detail ──
  await withSession(accounts.admin, async (page) => {
    await page.goto(`${FRONT}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    await shot(page, 'ui-04-shipments-detail');
    const m = await page.evaluate(measureColumns, ['TỜ KHAI', 'SỐ CONT', 'CONTAINER']);
    log('UI-04 measure', JSON.stringify(m));
  }, { artifactDir: DIR, name: 'session-shdetail' });

  writeFileSync(join(DIR, 'verify.log'), out.join('\n') + '\n');
  log('DONE phase', PHASE);
}

main().catch((e) => { log('FATAL', e.stack || e.message); writeFileSync(join(DIR, 'verify.log'), out.join('\n') + '\n'); process.exit(1); });
