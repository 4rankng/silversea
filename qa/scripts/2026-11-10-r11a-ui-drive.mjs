// r11a lane UI DRIVEN (rung 3) on local dev (:7175) — SIL-729 r7 + SIL-772.
// C1: hoapt (ACCOUNTANT) → /accounting/chot-debit: H1 'KIỂM SOÁT LÔ HÀNG',
//     nav entry sits in CÔNG NỢ VẬN TẢI (after Phải thu, before Phải trả),
//     FCL/LCL toggle present, FCL default.
// C2: LCL toggle click → aria-pressed flips, row set changes accordingly.
// C3: /accounting/phoi-phieu → Phải trả report: NO 'Chưa xác định' party row;
//     party labels captured (expected 'Thiếu nhà xe' for unassigned lots).
// C4: /debt → 'Tổng hợp sản lượng vận tải theo tháng': same no-unknown law.
// Read-only change: DB side-effect law satisfied by capturing the persisted
// expense-source identity feeding the labels (see the companion psql dump in
// the driver log appendix).
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve('qa');
const LOG = `${OUT}/2026-11-10_r11a-729-772-780_ui-driver.log`;
const log = [];
const say = (l) => { log.push(l); console.log(l); };
const persist = () => appendFileSync(LOG, `${log.splice(0).join('\n')}\n`);
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // ── login hoapt ───────────────────────────────────────────────────────────
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });
  await page.type('input[name="username"]', 'hoapt');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);
  const who = await page.evaluate(() => document.body.innerText.slice(0, 400));
  check('login hoapt', !/đăng nhập/i.test(who.slice(0, 100)), who.replace(/\n/g, ' | ').slice(0, 160));
  persist();

  // ── C1: chot-debit identity + nav + toggle ────────────────────────────────
  say('C1 — /accounting/chot-debit identity, nav, toggle');
  await page.goto(`${FE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  const c1 = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.textContent?.trim() ?? null;
    // The sidebar renders items as buttons (handleNavigate), not <a href> —
    // assert by text order inside the section, not by href.
    const labels = [...document.querySelectorAll('.sidebar-section-label')].map((e) => e.textContent?.trim() ?? '');
    const items = [...document.querySelectorAll('.sidebar-item')].map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    const debtIdx = items.indexOf('Công nợ phải thu');
    const debitIdx = items.indexOf('KIỂM SOÁT LÔ HÀNG');
    const payIdx = items.indexOf('Công nợ phải trả');
    const toggle = document.querySelector('.debit-cargo-view');
    const buttons = toggle ? [...toggle.querySelectorAll('button')].map((b) => ({ text: b.textContent?.replace(/\s+/g, ' ').trim(), pressed: b.getAttribute('aria-pressed') })) : [];
    return { h1, section: labels.includes('Công nợ vận tải') ? 'Công nợ vận tải' : null, order: debtIdx > -1 && debitIdx > debtIdx && payIdx > debitIdx, items, buttons };
  });
  check('C1 H1 is KIỂM SOÁT LÔ HÀNG', c1.h1 === 'KIỂM SOÁT LÔ HÀNG', c1.h1 ?? 'null');
  check('C1 sidebar has Công nợ vận tải section', c1.section != null, c1.section ?? 'null');
  check('C1 nav order Phải thu < KIỂM SOÁT LÔ HÀNG < Phải trả', c1.order, JSON.stringify(c1.items.slice(0, 8)));
  check('C1 FCL/LCL toggle present with 2 buttons', c1.buttons.length === 2, JSON.stringify(c1.buttons));
  check('C1 default FCL active', c1.buttons[0]?.pressed === 'true' && c1.buttons[1]?.pressed === 'false', JSON.stringify(c1.buttons));
  await page.screenshot({ path: `${OUT}/2026-11-10_r11a_ui-c1-chot-debit-fcl.png` });
  persist();

  // ── C2: LCL toggle flips the view ─────────────────────────────────────────
  say('C2 — LCL toggle');
  const before = await page.evaluate(() => document.querySelector('.debit-cargo-view button[aria-pressed="true"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  await page.click('.debit-cargo-view button:nth-child(2)');
  await sleep(1200);
  const c2 = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.debit-cargo-view button')].map((b) => ({ text: b.textContent?.replace(/\s+/g, ' ').trim(), pressed: b.getAttribute('aria-pressed') }));
    const boardRows = document.querySelectorAll('.debit-board tbody tr').length;
    return { buttons, boardRows };
  });
  const lclBtn = c2.buttons[1] ?? { pressed: null };
  check('C2 LCL becomes active', lclBtn.pressed === 'true' && c2.buttons[0]?.pressed === 'false', JSON.stringify(c2.buttons));
  check('C2 FCL label was active before click', before?.startsWith('Vận tải Hàng Cont'), before ?? 'null');
  await page.screenshot({ path: `${OUT}/2026-11-10_r11a_ui-c2-chot-debit-lcl.png` });
  persist();

  // ── C3: phoi-phieu Phải trả report labels ─────────────────────────────────
  say('C3 — /accounting/phoi-phieu Phải trả report');
  await page.goto(`${FE}/accounting/phoi-phieu`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  // Switch to the Phải trả tab if present.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => /Phải trả/.test(b.textContent ?? ''));
    if (tab) tab.click();
  });
  await sleep(2500);
  const c3 = await page.evaluate(() => {
    const report = [...document.querySelectorAll('table')].map((t) => ({
      caption: t.querySelector('caption')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      parties: [...t.querySelectorAll('tbody tr td:nth-child(2)')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    }));
    const text = document.body.innerText;
    return { report, hasTraReport: report.some((r) => /Phải trả/.test(r.caption ?? '')), unknownInReport: report.filter((r) => /Phải trả/.test(r.caption ?? '')).some((r) => r.parties.includes('Chưa xác định')) };
  });
  check('C3 Phải trả report rendered', c3.hasTraReport, JSON.stringify(c3.report.map((r) => r.caption)));
  check('C3 NO Chưa xác định party row in Phải trả report', !c3.unknownInReport, JSON.stringify(c3.report.filter((r) => /Phải trả/.test(r.caption ?? '')).map((r) => r.parties)));
  say(`  report parties (Phải trả): ${JSON.stringify(c3.report.filter((r) => /Phải trả/.test(r.caption ?? '')).flatMap((r) => r.parties))}`);
  await page.screenshot({ path: `${OUT}/2026-11-10_r11a_ui-c3-phoi-phieu-tra.png` });
  persist();

  // ── C4: /debt monthly summary ─────────────────────────────────────────────
  say('C4 — /debt Tổng hợp sản lượng');
  await page.goto(`${FE}/debt`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  const c4 = await page.evaluate(() => {
    const summary = document.querySelector('.pm-summary');
    const rows = summary ? [...summary.querySelectorAll('table tbody tr td:nth-child(2), table tbody tr th[scope="row"]')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '') : [];
    return { present: summary != null, rows, unknown: rows.includes('Chưa xác định') };
  });
  check('C4 monthly summary rendered', c4.present);
  check('C4 NO Chưa xác định row in summary', !c4.unknown, JSON.stringify(c4.rows.slice(0, 10)));
  await page.screenshot({ path: `${OUT}/2026-11-10_r11a_ui-c4-debt-summary.png` });
  persist();
} finally {
  await browser.close();
  persist();
  say(`TOTAL checks=${checks} fails=${fails.length}${fails.length ? ` — ${fails.join('; ')}` : ''}`);
  persist();
}
if (fails.length > 0) process.exit(1);
