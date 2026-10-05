// Lead QA wave 2 (evening) — cards 380, 386, 369 + 385 route-level check.
// MUTATION SURFACE: none. One drill-down navigation tap (369); no writes anywhere.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_lead-qa-wave2-380-385-386-369';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });
const admin = await loginApi('admin', 'Abc123');
const adminTok = admin.token ?? admin.accessToken ?? admin?.data?.token;
const hoapt = await loginApi('hoapt', 'Abc123');
const hoaptTok = hoapt.token ?? hoapt.accessToken ?? hoapt?.data?.token;

const { browser, page } = await launch({ width: 1440, height: 1000 });
async function section(name, fn) {
  try { await fn(); log(`section:${name}`, { ok: true }); }
  catch (err) { log(`section:${name}`, { ok: false, error: String(err).slice(0, 300) }); }
}
const wrapCheck = () => page.evaluate(() => {
  const out = [];
  for (const td of document.querySelectorAll('.record-table tbody td, table tbody td')) {
    const txt = (td.textContent || '').trim();
    if (!/\d{1,3}(\.\d{3})+(\s?₫)?$/.test(txt)) continue;
    const range = document.createRange();
    range.selectNodeContents(td);
    const lines = [...range.getClientRects()].filter((r) => r.width > 2).length;
    if (lines > 1) out.push({ text: txt.slice(0, 24), lines });
  }
  return { brokenCells: out.length, samples: out.slice(0, 3) };
});

try {
  // ===== 380: /debt + /payables summaries =====
  await section('380-summary', async () => {
    await auth(page, adminTok, '/debt');
    await sleep(1500);
    const read = () => page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const heads = [...document.querySelectorAll('table thead th, table thead td')].map(t);
      const body = t(document.body);
      const btn = [...document.querySelectorAll('button')].find((b) => /Lập Phiếu/.test(t(b)));
      return {
        hasPhaiThu: /PHẢI THU/i.test(body), hasPhaiTra: /PHẢI TRẢ/i.test(body),
        hasTonCuoi: /TỒN CUỐI KỲ|Tồn cuối kỳ/i.test(body), hasDaThanhToan: /ĐÃ THANH TOÁN/i.test(body),
        hasVatBand: /Tổng hợp công nợ theo tháng/i.test(body),
        lapPhieu: btn ? { disabled: btn.disabled, title: btn.getAttribute('title') } : null,
        dateInputs: [...document.querySelectorAll('input[type="date"]')].length,
        tfoot: !!document.querySelector('table tfoot'),
        rowSample: [...document.querySelectorAll('table tbody tr')].slice(0, 2).map((r) => t(r).slice(0, 110)),
      };
    });
    const debt = await read();
    log('380-debt', debt);
    await shot(page, `${EV}/380-debt-summary-w1440.png`);
    for (const w of [1280, 1920, 2560]) { await setViewport(page, w); await shot(page, `${EV}/380-debt-w${w}.png`); }
    await setViewport(page, 1440);
    await auth(page, adminTok, '/payables');
    await sleep(1500);
    const pay = await read();
    log('380-payables', pay);
    await shot(page, `${EV}/380-payables-summary-w1440.png`);
  });

  // ===== 386: invoice-tracking money cells one line (fixture row live) =====
  await section('386-nowrap', async () => {
    await auth(page, adminTok, '/accounting/invoice-tracking');
    await sleep(1800);
    const rowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      const c = await wrapCheck();
      log(`386-wrap@${w}`, { rowCount, ...c });
      await shot(page, `${EV}/386-invoice-w${w}.png`);
    }
    await setViewport(page, 1440);
  });

  // ===== 369: /accounting?view=overview =====
  await section('369-overview', async () => {
    await auth(page, adminTok, '/accounting?view=overview');
    await sleep(2000);
    const o = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(document.body);
      const nums = (s) => (s.match(/[\d.]+(\s?₫)?/g) || []).map((x) => x.replace(/[^\d]/g, '')).filter(Boolean).map(Number);
      const cards = [...document.querySelectorAll('[class*="card"], section, article')].filter((c) => /Quá hạn/.test(t(c)) && /Trong hạn/.test(t(c)));
      const parsed = cards.slice(0, 2).map((c) => {
        const txt = t(c);
        const total = nums(txt)[0];
        const over = (txt.match(/Quá hạn\s*([\d.]+)/) || [])[1];
        const within = (txt.match(/Trong hạn\s*([\d.]+)/) || [])[1];
        return { text: txt.slice(0, 120), total, over: Number((over || '0').replace(/\./g, '')), within: Number((within || '0').replace(/\./g, '')) };
      });
      return {
        hasCards: cards.length >= 2,
        cards: parsed,
        hasChart: /Tuần \d{2}\/\d{2}/.test(body) || !!document.querySelector('svg [class*="chart"], svg[aria-description], [class*="chart"] svg'),
        legend: /Số lượng/.test(body) && /Tiền cược/.test(body) && /Đã hoàn cược/.test(body),
        asOf: /Số liệu tính đến/.test(body),
      };
    });
    log('369-contract', o);
    await shot(page, `${EV}/369-overview-w1440.png`);
    for (const w of [768, 390]) { await setViewport(page, w, Math.max(900, w)); await shot(page, `${EV}/369-overview-w${w}.png`); }
    await setViewport(page, 1440, 1000);
    const okMath = o.cards.length === 2 && o.cards.every((c) => c.total === 0 || Math.abs(c.total - (c.over + c.within)) <= 1);
    log('369-identity', { okMath });
    // drill-down: tap the overdue count link on card 1 (navigation only)
    const link = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button, [role="link"], [class*="count"], span')].filter((e) => /Quá hạn/.test(e.textContent || '') && (e.querySelector('a, button') || e.tagName === 'A' || e.tagName === 'BUTTON'));
      const el = els[0]?.querySelector('a, button') || els[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (link) {
      await tapAt(page, link.x, link.y, { label: '369 drill-down overdue' });
      await sleep(1800);
      const landed = await page.evaluate(() => ({ url: location.pathname + location.search, rows: document.querySelectorAll('table tbody tr').length }));
      log('369-drilldown', landed);
      await shot(page, `${EV}/369-drilldown-w1440.png`);
    }
  });

  // ===== 385: /hr/roster route + /salary tabs (hoapt) =====
  await section('385-route', async () => {
    await auth(page, hoaptTok, '/hr/roster');
    await sleep(1800);
    const roster = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(document.body);
      return {
        h1: t(document.querySelector('h1')),
        notFound: /Không tìm thấy trang|404/.test(body),
        hasSearch: !!document.querySelector('input[type="search"], input[placeholder*="Tìm"]'),
        hasBoPhan: /Bộ phận/.test(body),
        rowCount: document.querySelectorAll('table tbody tr').length,
      };
    });
    log('385-roster', roster);
    await shot(page, `${EV}/385-roster-w1440.png`);
    await auth(page, hoaptTok, '/salary');
    await sleep(1800);
    const tabs = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const btns = [...document.querySelectorAll('[role="tab"], button')].map(t).filter((x) => /^(Lái xe|Văn phòng)$/.test(x));
      const office = [...document.querySelectorAll('[role="tab"], button')].find((b) => t(b) === 'Văn phòng');
      return { tabs: btns };
    });
    log('385-salary-tabs', tabs);
    const officeTab = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="tab"], button')].find((x) => (x.textContent || '').trim() === 'Văn phòng');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (officeTab) {
      await tapAt(page, officeTab.x, officeTab.y, { label: '385 office tab' });
      await sleep(1200);
      const after = await page.evaluate(() => {
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        return { emptyState: /Chưa có dữ liệu chấm công|Chờ chốt trường dữ liệu/.test(t(document.body)), dashCells: [...document.querySelectorAll('td')].filter((d) => t(d) === '—').length };
      });
      log('385-office-view', after);
      await shot(page, `${EV}/385-salary-office-w1440.png`);
    }
    for (const w of [1280, 1920, 2560]) { await setViewport(page, w); await shot(page, `${EV}/385-salary-w${w}.png`); }
    await setViewport(page, 1440);
  });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG });
  console.log('WAVE2_DONE');
} finally {
  await browser.close();
}
