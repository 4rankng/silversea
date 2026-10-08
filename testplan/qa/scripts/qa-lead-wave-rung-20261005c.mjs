// Focused re-run: 372 popover+grouping, 378 structure, 379 dialog.
// MUTATION SURFACE: none — view popover, row-select checkbox, view dialog; Esc closes.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_lead-qa-wave-372-374-377-375-378-379-382';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
const session = await loginApi('admin', 'Abc123');
const token = session.token ?? session.accessToken ?? session?.data?.token;
const { browser, page } = await launch({ width: 1440, height: 1000 });

try {
  // ===== 372: popover behavior + trusted grouping =====
  await auth(page, token, '/accounting/phoi-phieu');
  await sleep(1200);
  const trig = await page.evaluate(() => {
    const t = (el) => (el?.textContent || '').trim();
    const b = [...document.querySelectorAll('thead button, thead [role="button"], thead [aria-haspopup]')]
      .find((x) => /Khách hàng/.test(t(x)));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!trig) throw new Error('372: trigger not found');
  await tapAt(page, trig.x, trig.y, { label: '372 trigger' });
  await sleep(800);
  const pop = await page.evaluate(() => {
    const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const portals = [...document.body.children].filter((c) => c !== document.querySelector('#root') && c.offsetParent !== null || getComputedStyle(c).position === 'fixed');
    const dlg = document.querySelector('[role="dialog"]');
    const node = dlg || portals[portals.length - 1];
    if (!node) return { open: false, portals: portals.length };
    const inp = node.querySelector('input');
    return {
      open: true, isDialog: !!dlg,
      text: t(node).slice(0, 140),
      hasInput: !!inp,
      inputFocused: document.activeElement === inp,
      buttons: [...node.querySelectorAll('button')].map(t),
    };
  });
  log('372-popover2', pop);
  if (pop.open && pop.hasInput) {
    const before = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
    await page.keyboard.type('LONG MINH', { delay: 30 });
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr')];
      const t = (r) => (r.textContent || '').replace(/\s+/g, ' ');
      return { rowCount: rows.length, allMatch: rows.slice(0, 10).every((r) => /LONG MINH/i.test(t(r))), sample: rows[0] ? t(rows[0]).slice(0, 90) : null };
    });
    log('372-applied', { before, ...after });
    await shot(page, `${EV}/372-filtered-LONGMINH-w1440.png`, { full: false });
    await page.keyboard.press('Escape');
    await sleep(500);
    // re-open shows kept value + filter dot; then clear via Bỏ lọc
    const kept = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('thead button, thead [aria-haspopup]')].find((x) => /Khách hàng/.test(t(x)));
      return { label: t(b), pressed: b?.getAttribute('aria-pressed'), dot: !!b?.querySelector('[class*="dot"], [data-active]') };
    });
    log('372-kept-value', kept);
    await tapAt(page, trig.x, trig.y, { label: '372 re-open' });
    await sleep(600);
    await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const dlg = document.querySelector('[role="dialog"]');
      const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /Bỏ lọc/.test(t(x))) : null;
      if (b) { b.style.outline = 'none'; }
    });
    const clearBtn = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const dlg = document.querySelector('[role="dialog"]');
      const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /Bỏ lọc/.test(t(x))) : null;
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (clearBtn) {
      await tapAt(page, clearBtn.x, clearBtn.y, { label: '372 Bỏ lọc' });
      await sleep(800);
      const cleared = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
      log('372-cleared', { rowCount: cleared });
    }
  }

  // ===== 372 grouping: trusted extractor from the Thông tin xe cells =====
  const grouping = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const plates = rows.map((r) => {
      const cell = r.querySelector('[data-label*="Thông tin xe"], [data-label*="xe"]');
      const m = (cell?.textContent || r.textContent).match(/[0-9]{2}[A-Z]-[0-9]{3}[.\-][0-9]{2}|[0-9]{2}[A-Z]{2}-[0-9]{4,5}/);
      return m ? m[0] : null;
    }).filter(Boolean);
    let ok = true; let firstBreak = null;
    const seen = new Map();
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i];
      if (seen.has(p)) { ok = false; firstBreak = { plate: p, firstAt: seen.get(p), againAt: i }; break; }
      seen.set(p, i);
    }
    return { sampled: plates.length, groupOk: ok, firstBreak };
  });
  log('372-grouping2', grouping);

  // ===== 378: header structure, case-insensitive =====
  await auth(page, token, '/accounting/chot-debit');
  await sleep(1500);
  const head = await page.evaluate(() => {
    const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const headRows = [...document.querySelectorAll('table thead tr, thead tr')].map((tr) => [...tr.children].map(t));
    const body = document.body.textContent;
    return {
      headRows: headRows.slice(0, 3),
      ciPhaiThu: /phải thu/i.test(body),
      ciPhaiTra: /phải trả/i.test(body),
      ciKhach: /chọn khách hàng/i.test(body),
      ciNhaXe: /chọn nhà xe/i.test(body),
      hasLoiNhuan: /Lợi nhuận/.test(body),
      rowCount: document.querySelectorAll('table tbody tr').length,
    };
  });
  log('378-head', head);
  await shot(page, `${EV}/378-chotdebit-headers-w1440.png`, { full: false });

  // ===== 379: checkbox-targeted selection → dialog =====
  const cb = await page.evaluate(() => {
    const row = [...document.querySelectorAll('table tbody tr')][0];
    if (!row) return null;
    const box = row.querySelector('input[type="checkbox"], [role="checkbox"]');
    if (box) {
      const r = box.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, kind: 'checkbox' };
    }
    const r = row.getBoundingClientRect();
    return { x: r.x + 14, y: r.y + r.height / 2, kind: 'row-left-edge' };
  });
  if (!cb) throw new Error('379: no rows');
  await tapAt(page, cb.x, cb.y, { label: '379 select row 1' });
  await sleep(700);
  const tb = await page.evaluate(() => {
    const t = (el) => (el?.textContent || '').trim();
    const b = [...document.querySelectorAll('button')].find((x) => /Chọn Debit/.test(t(x)));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { label: t(b), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  log('379-toolbar2', tb?.label ?? null);
  if (tb && /\([1-9]/.test(tb.label)) {
    await tapAt(page, tb.x, tb.y, { label: '379 open dialog' });
    await sleep(900);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"], .modal, [class*="Dialog"]')].filter((p) => p.offsetParent !== null)[0];
      if (!d) return null;
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const body = t(d);
      return {
        head: body.slice(0, 200),
        vatOptions: (body.match(/\b(0|5|8|10)%/g) || []).slice(0, 6),
        hasLanThang: /Lần/.test(body) && /Tháng/.test(body),
        hasChot: /Chốt đợt/.test(body),
        hasHuy: /Hủy/.test(body),
      };
    });
    log('379-dialog2', dlg);
    await shot(page, `${EV}/379-debit-dialog2-w1440.png`, { full: false });
    await page.keyboard.press('Escape');
    await sleep(600);
  } else {
    // ALL-select path as fallback: "Chọn tất cả N lô đủ điều kiện"
    const all = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('button, label')].find((x) => /Chọn tất cả/.test(t(x)));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { label: t(b), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    log('379-all-fallback', all?.label ?? null);
    if (all) {
      await tapAt(page, all.x, all.y, { label: '379 select ALL' });
      await sleep(700);
      const tb2 = await page.evaluate(() => {
        const t = (el) => (el?.textContent || '').trim();
        const b = [...document.querySelectorAll('button')].find((x) => /Chọn Debit/.test(t(x)));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { label: t(b), x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      log('379-toolbar-after-all', tb2?.label ?? null);
      if (tb2 && /\([1-9]/.test(tb2.label)) {
        await tapAt(page, tb2.x, tb2.y, { label: '379 open dialog (ALL path)' });
        await sleep(900);
        const dlg = await page.evaluate(() => {
          const d = [...document.querySelectorAll('[role="dialog"], .modal, [class*="Dialog"]')].filter((p) => p.offsetParent !== null)[0];
          if (!d) return null;
          const body = (d.textContent || '').replace(/\s+/g, ' ').trim();
          return { head: body.slice(0, 200), vatOptions: (body.match(/\b(0|5|8|10)%/g) || []).slice(0, 6), hasLanThang: /Lần/.test(body) && /Tháng/.test(body), hasChot: /Chốt đợt/.test(body), hasHuy: /Hủy/.test(body) };
        });
        log('379-dialog3', dlg);
        await shot(page, `${EV}/379-debit-dialog3-w1440.png`, { full: false });
        await page.keyboard.press('Escape');
        await sleep(500);
      }
    }
  }
  logEvidence(EV, 'driver-log-rerun.json', { build: process.env.QA_BUILD, entries: LOG });
  console.log('RERUN_DONE');
} finally {
  await browser.close();
}
