// Lead QA wave 4 — 385r menu entry, 386r nowrap, 373r reject (network capture), 387 control.
// MUTATION SURFACE: exactly one — the 373 reject on lead fixture cost id=29 (declared below);
// everything else opens dialogs and closes them via Hủy/Esc without submitting.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-06_lead-qa-wave4-385r-386r-373r-387';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });
const admin = await loginApi('admin', 'Abc123');
const tok = admin.token ?? admin.accessToken ?? admin?.data?.token;
const hoapt = await loginApi('hoapt', 'Abc123');
const hoaptTok = hoapt.token ?? hoapt.accessToken ?? hoapt?.data?.token;
const dungnv = await loginApi('dungnv', 'Abc123');
const dungnvTok = dungnv.token ?? dungnv.accessToken ?? dungnv?.data?.token;

const { browser, page } = await launch({ width: 1440, height: 1100 });
// network capture for the reject call
const REQ = [];
page.on('response', async (res) => {
  const u = res.url();
  if (/phoi-phieu\/\d+\/rows\/\d+/.test(u) || /invoice-tracking/.test(u)) {
    REQ.push({ url: u.replace(STAGING, ''), method: res.request().method(), status: res.status() });
  }
});
async function section(name, fn) {
  try { await fn(); log(`section:${name}`, { ok: true }); }
  catch (err) { log(`section:${name}`, { ok: false, error: String(err).slice(0, 260) }); }
}

try {
  // ===== 385r: roster in the Khác menu (hoapt) =====
  await section('385r-menu', async () => {
    await auth(page, hoaptTok, '/accounting/phoi-phieu');
    await sleep(2000);
    const m = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a, button')].map((a) => (a.textContent || '').trim());
      return { hasRoster: links.includes('Danh sách nhân sự'), sample: links.filter((x) => /nhân sự|Khác|Lương/.test(x)).slice(0, 6) };
    });
    log('385r-menu', m);
    const pos = await page.evaluate(() => {
      const el = [...document.querySelectorAll('a, button')].find((x) => (x.textContent || '').trim() === 'Danh sách nhân sự');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (pos) {
      await tapAt(page, pos.x, pos.y, { label: '385r menu entry' });
      await sleep(2000);
      const landed = await page.evaluate(() => ({ url: location.pathname, h1: (document.querySelector('h1')?.textContent || '').trim() }));
      log('385r-landed', landed);
      await shot(page, `${EV}/385r-roster-via-menu-w1440.png`);
    }
    await shot(page, `${EV}/385r-menu-w1440.png`);
  });

  // ===== 386r: invoice-tracking money cells one line at 4 widths =====
  await section('386r-nowrap', async () => {
    await auth(page, tok, '/accounting/invoice-tracking');
    await sleep(2200);
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      const c = await page.evaluate(() => {
        const out = [];
        for (const td of document.querySelectorAll('table tbody td')) {
          const txt = (td.textContent || '').trim();
          if (!/^\d{1,3}(\.\d{3})+\s?₫$/.test(txt)) continue;
          const range = document.createRange();
          range.selectNodeContents(td);
          const lines = [...range.getClientRects()].filter((r) => r.width > 2).length;
          out.push({ text: txt, lines });
        }
        return out;
      });
      log(`386r-wrap@${w}`, { moneyCells: c.length, broken: c.filter((x) => x.lines > 1).length, detail: c.slice(0, 4) });
      await shot(page, `${EV}/386r-invoice-w${w}.png`);
    }
    await setViewport(page, 1440);
  });

  // ===== 373r: reject fixture cost 29 with network capture (THE mutation) =====
  await section('373r-reject', async () => {
    await auth(page, tok, '/accounting/phoi-phieu');
    await sleep(2500);
    await page.evaluate(() => {
      [...document.querySelectorAll('table tbody tr')].find((r) => /E2EROLE001/.test(r.textContent || ''))?.scrollIntoView({ block: 'center' });
    });
    await sleep(1200);
    const open = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const row = [...document.querySelectorAll('table tbody tr')].find((r) => /E2EROLE001/.test(r.textContent || ''));
      const b = [...row.querySelectorAll('button')].find((x) => /Xem chi tiết/.test(t(x)));
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await tapAt(page, open.x, open.y, { label: '373r open dialog' });
    await sleep(1600);
    const rej = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]') || document.querySelector('.modal.modal--operational');
      const t = (el) => (el?.textContent || '').trim();
      const b = [...root.querySelectorAll('button')].find((x) => /Từ chối/.test(t(x)) && !x.disabled);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rej) throw new Error('no enabled reject button');
    await tapAt(page, rej.x, rej.y, { label: '373r Từ chối — MUTATES lead fixture cost id=29' });
    await sleep(800);
    await page.keyboard.type('Lead QA rework verify: reason 373r', { delay: 20 });
    await sleep(300);
    const submit = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal')].filter((p) => p.offsetParent !== null);
      const last = dlgs[dlgs.length - 1];
      const t = (el) => (el?.textContent || '').trim();
      const b = [...last.querySelectorAll('button')].find((x) => /^Từ chối$/.test(t(x)));
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await tapAt(page, submit.x, submit.y, { label: '373r submit reason' });
    await sleep(2200);
    const after = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]') || document.querySelector('.modal.modal--operational');
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      return { dialogNow: root ? t(root).slice(0, 260) : '(closed)' };
    });
    log('373r-after', { ...after, network: REQ.slice(-4) });
    await shot(page, `${EV}/373r-after-reject.png`);
  });

  // ===== 387: trailer override control on issue dialog (dungnv, read-only) =====
  await section('387-trailer-control', async () => {
    await auth(page, dungnvTok, '/dispatch-detail');
    await sleep(2500);
    const probe = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const body = t(document.body);
      const trailerWords = /Rơ-moóc|rơ moóc|trailer/i.test(body);
      return { hasTrailerMention: trailerWords, controls: [...document.querySelectorAll('button')].map(t).filter((x) => /Phát lệnh|Phân xe|Gán|Tạo chuyến/.test(x)).slice(0, 6) };
    });
    log('387-probe', probe);
    await shot(page, `${EV}/387-dispatch-w1440.png`);
  });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG, network: REQ });
  console.log('WAVE4_DONE');
} finally {
  await browser.close();
}
