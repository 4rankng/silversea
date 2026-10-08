// Lead QA wave 2026-10-05 evening — cards 372, 374, 377 (code) + 375, 378, 379, 382 (audits).
// MUTATION SURFACE: none. Opens/closes view popovers and dialogs only (Esc / Hủy);
// never taps Duyệt / Chốt đợt / Lọc data-changing confirmations beyond view filters.
// Every section logs independently; one section failing does not kill the rest.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_lead-qa-wave-372-374-377-375-378-379-382';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });

const session = await loginApi('admin', 'Abc123');
const token = session.token ?? session.accessToken ?? session?.data?.token;

const { browser, page } = await launch({ width: 1440, height: 1000 });
const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');

async function section(name, fn) {
  try { await fn(); log(`section:${name}`, { ok: true }); }
  catch (err) { log(`section:${name}`, { ok: false, error: String(err).slice(0, 300) }); }
}

try {
  // ---------- 372 + 374: /accounting/phoi-phieu ----------
  await section('372-374-phoiphieu', async () => {
    await auth(page, token, '/accounting/phoi-phieu');
    log('nav-phoiphieu', { url: page.url() });
    const base = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const triggers = [...document.querySelectorAll('thead button, thead [role="button"], thead [aria-haspopup]')].map((b) => ({
        text: t(b).slice(0, 60), aria: b.getAttribute('aria-label'), haspopup: b.getAttribute('aria-haspopup'),
      }));
      const rows = [...document.querySelectorAll('.record-table tbody tr, table tbody tr')];
      return {
        h1: t(document.querySelector('h1')),
        triggerCount: triggers.length,
        triggers: triggers.slice(0, 12),
        rowCount: rows.length,
        hasStatusPhoi: /Phơi:/.test(document.body.textContent),
        hasNhanPhoi: /Nhận phơi:/.test(document.body.textContent),
        hasDriverNote: /Ghi chú lái xe/.test(document.body.textContent),
      };
    });
    log('372-base', base);

    // width matrix for the touched screen (viewport captures: large unpaged table)
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      await shot(page, `${EV}/372-phoiphieu-w${w}.png`, { full: false });
    }
    await setViewport(page, 1440);

    // open the Khách hàng mini-filter (real tap at hit-tested coords)
    const trig = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const cands = [...document.querySelectorAll('thead button, thead [role="button"], thead [aria-haspopup]')]
        .filter((b) => /Khách hàng/.test(t(b)));
      if (!cands.length) return null;
      const r = cands[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!trig) throw new Error('372: no Khách hàng mini-filter trigger found');
    await tapAt(page, trig.x, trig.y, { label: '372 mini-filter trigger' });
    await sleep(700);
    const popover = await page.evaluate(() => {
      const pps = [...document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper], .popover, [class*="mini-filter"]')]
        .filter((p) => p.offsetParent !== null);
      const p = pps[pps.length - 1];
      if (!p) return null;
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      return {
        text: t(p).slice(0, 120),
        hasSearch: !!p.querySelector('input'),
        buttons: [...p.querySelectorAll('button')].map(t).slice(0, 6),
      };
    });
    log('372-popover', popover);
    if (popover?.hasSearch) {
      // type a filter value via keyboard events into the focused input (CDP trusted)
      await page.keyboard.type('QA292', { delay: 40 });
      await sleep(400);
      const applyBtn = await page.evaluate(() => {
        const t = (el) => (el?.textContent || '').trim();
        const pps = [...document.querySelectorAll('[role="dialog"], [class*="mini-filter"]')].filter((p) => p.offsetParent !== null);
        const p = pps[pps.length - 1];
        if (!p) return null;
        const b = [...p.querySelectorAll('button')].find((x) => /^Lọc$/.test(t(x)));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (applyBtn) {
        await tapAt(page, applyBtn.x, applyBtn.y, { label: '372 Lọc apply' });
        await sleep(900);
      }
    }
    const filtered = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const rows = [...document.querySelectorAll('table tbody tr')];
      return {
        rowCount: rows.length,
        sample: rows.slice(0, 2).map((r) => t(r).slice(0, 100)),
        dotActive: !!document.querySelector('[class*="filter-dot"], [data-active="true"]'),
      };
    });
    log('372-filtered', filtered);
    await shot(page, `${EV}/372-phoiphieu-filtered-w1440.png`, { full: false });
    // grouping invariant: duplicate truck plates render consecutively in the visible window
    const grouping = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr')];
      const plates = rows.map((r) => (r.textContent.match(/[0-9]{2}[A-Z]{1,2}-[0-9]{4,5}[.\-]?[0-9]*/) || [])[0]).filter(Boolean);
      let ok = true; let firstBreak = null;
      for (let i = 1; i < plates.length; i++) {
        if (plates[i] === plates[i - 1]) continue;
        const later = plates.indexOf(plates[i - 1], i);
        if (later !== -1) { ok = false; firstBreak = { plate: plates[i - 1], at: i }; break; }
      }
      return { platesSampled: plates.length, groupOk: ok, firstBreak };
    });
    log('372-grouping', grouping);
  });

  // ---------- 374: Báo cáo tháng block on the same page ----------
  await section('374-reports', async () => {
    const rep = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const btns = [...document.querySelectorAll('button')].filter((b) => /Hiện dòng đã ẩn/.test(t(b)));
      return {
        hasPhaiThu: /Phải thu\s*\/?\s*KH|PHẢI THU/.test(document.body.textContent),
        hasPhaiTra: /Phải trả\s*\/?\s*NXC|PHẢI TRẢ/.test(document.body.textContent),
        toggles: btns.map((b) => ({ label: t(b), disabled: b.disabled, pressed: b.getAttribute('aria-pressed') })),
      };
    });
    log('374-base', rep);
    await shot(page, `${EV}/374-reports-default-w1440.png`, { full: false });
    const tg = rep.toggles.find((x) => !x.disabled);
    if (tg) {
      const pos = await page.evaluate(() => {
        const t = (el) => (el?.textContent || '').trim();
        const b = [...document.querySelectorAll('button')].find((x) => /Hiện dòng đã ẩn/.test(t(x)) && !x.disabled);
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const totalsBefore = await page.evaluate(() => (document.querySelector('[class*="report"], [class*="summary"]')?.textContent || '').match(/[\d.]{5,}/g)?.slice(0, 6));
      await tapAt(page, pos.x, pos.y, { label: '374 show-hidden toggle' });
      await sleep(800);
      const after = await page.evaluate(() => {
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        const btns = [...document.querySelectorAll('button')].filter((b) => /Ẩn dòng|Hiện dòng đã ẩn/.test(t(b)));
        return { toggles: btns.map((b) => t(b)), totals: (document.querySelector('[class*="report"], [class*="summary"]')?.textContent || '').match(/[\d.]{5,}/g)?.slice(0, 6) };
      });
      log('374-toggled', { before: rep.toggles, totalsBefore, after });
      await shot(page, `${EV}/374-reports-toggled-w1440.png`, { full: false });
      const sameTotals = JSON.stringify(totalsBefore) === JSON.stringify(after.totals);
      log('374-totals-unchanged', { sameTotals });
    } else {
      log('374-toggled', { skipped: 'all toggles disabled (N=0) — by-design state, recorded' });
    }
  });

  // ---------- 377: /accounting/hoan-ung ----------
  await section('377-hoanung', async () => {
    await auth(page, token, '/accounting/hoan-ung');
    const rep = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const headers = [...document.querySelectorAll('table thead th')].map(t);
      return {
        headers,
        rowCount: document.querySelectorAll('table tbody tr').length,
        hasNhanVienDNTT: headers.some((h) => /Nhân viên ĐNTT/.test(h)),
        hasGhiChu: headers.some((h) => /Ghi chú/.test(h)),
        staleChiTieu: headers.some((h) => /^Chiều$/.test(h)),
      };
    });
    log('377-contract', rep);
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      await shot(page, `${EV}/377-hoanung-w${w}.png`, { full: false });
    }
    await setViewport(page, 1440);
  });

  // ---------- 375: /accounting/deposit-tracker ----------
  await section('375-deposit', async () => {
    await auth(page, token, '/accounting/deposit-tracker');
    const rep = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(document.body);
      return {
        warningBand: /kiểm tra check cược|Chưa hoàn cược số tiền/.test(body),
        bandText: (body.match(/kiểm tra check cược[^|]{0,80}/) || [''])[0],
        rowCount: document.querySelectorAll('table tbody tr').length,
        hasStatusFilter: /Chưa hoàn cược|Đã hoàn cược/.test(body),
      };
    });
    log('375-contract', rep);
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      await shot(page, `${EV}/375-deposit-w${w}.png`, { full: false });
    }
    await setViewport(page, 1440);
  });

  // ---------- 378 + 379: /accounting/chot-debit ----------
  await section('378-379-chotdebit', async () => {
    await auth(page, token, '/accounting/chot-debit');
    const rep = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(document.body);
      const row1 = document.querySelectorAll('table tbody tr')[0];
      return {
        hasGroupPhaiThu: /PHẢI THU/.test(body),
        hasGroupPhaiTra: /PHẢI TRẢ/.test(body),
        hasLoiNhuan: /Lợi nhuận/.test(body),
        hasCustomerFilter: /Chọn khách hàng/.test(body),
        hasCarrierFilter: /Chọn nhà xe/.test(body),
        rowCount: document.querySelectorAll('table tbody tr').length,
        firstRow: row1 ? t(row1).slice(0, 140) : null,
      };
    });
    log('378-contract', rep);
    await shot(page, `${EV}/378-chotdebit-w1440.png`, { full: false });

    // 379: select one row (single tap) → toolbar → open dialog → read → Esc close
    const rowPos = await page.evaluate(() => {
      const r = document.querySelectorAll('table tbody tr')[0];
      if (!r) return null;
      const b = r.getBoundingClientRect();
      return { x: b.x + Math.min(120, b.width / 2), y: b.y + b.height / 2 };
    });
    if (!rowPos) throw new Error('378/379: no rows');
    await tapAt(page, rowPos.x, rowPos.y, { label: '378 row select (fixture row 1)' });
    await sleep(600);
    const toolbar = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('button')].find((x) => /Chọn Debit/.test(t(x)));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { label: t(b), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    log('379-toolbar', toolbar?.label ?? null);
    if (toolbar) {
      await tapAt(page, toolbar.x, toolbar.y, { label: '379 open Debit dialog' });
      await sleep(900);
      const dlg = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"], [class*="modal"]')].filter((p) => p.offsetParent !== null)[0];
        if (!d) return null;
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        return {
          text: t(d).slice(0, 260),
          vatRadios: [...d.querySelectorAll('button, label, input[type="radio"]')].map(t).filter((x) => /^0%?$|^[5８]%$|^8%?$|^10%?$|^[0581]0?%$/.test(x)).slice(0, 8),
          hasLan: /Lần/.test(t(d)),
          hasThang: /Tháng/.test(d.textContent),
          hasChot: /Chốt đợt/.test(t(d)),
          hasHuy: /Hủy/.test(t(d)),
        };
      });
      log('379-dialog', dlg);
      await shot(page, `${EV}/379-debit-dialog-w1440.png`, { full: false });
      await page.keyboard.press('Escape');
      await sleep(600);
      const closed = await page.evaluate(() => ![...document.querySelectorAll('[role="dialog"]')].some((p) => p.offsetParent !== null));
      log('379-dialog-closed', { closed });
    }
    for (const w of [1280, 1920, 2560]) {
      await setViewport(page, w);
      await shot(page, `${EV}/378-chotdebit-w${w}.png`, { full: false });
    }
    await setViewport(page, 1440);
  });

  // ---------- 382: /salary ----------
  await section('382-salary', async () => {
    await auth(page, token, '/salary');
    const rep = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(document.body);
      return {
        h1: t(document.querySelector('h1')),
        hasDriverPart: /lái xe|Lái xe|tripDays|standbyDays|Kỳ lương/.test(body),
        hasOfficePart: /văn phòng|Văn phòng/.test(body),
        hasChamCong: /chấm công|Chấm công/.test(body),
      };
    });
    log('382-contract', rep);
    for (const w of [1280, 1440, 1920, 2560]) {
      await setViewport(page, w);
      await shot(page, `${EV}/382-salary-w${w}.png`, { full: false });
    }
    await setViewport(page, 1440);
  });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG });
  console.log('WAVE_RUNG_DONE');
} finally {
  await browser.close();
}
