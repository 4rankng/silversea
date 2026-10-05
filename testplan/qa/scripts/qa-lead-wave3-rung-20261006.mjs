// Lead QA 06/10 morning — cards 372(rework), 383, 373, 370.
// MUTATION SURFACE: none. Opens dialogs/popovers read-only; Hủy/Esc closes everything.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-06_lead-qa-wave3-372-383-373-370';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });
const admin = await loginApi('admin', 'Abc123');
const tok = admin.token ?? admin.accessToken ?? admin?.data?.token;
const { browser, page } = await launch({ width: 1440, height: 1000 });
async function section(name, fn) {
  try { await fn(); log(`section:${name}`, { ok: true }); }
  catch (err) { log(`section:${name}`, { ok: false, error: String(err).slice(0, 300) }); }
}

try {
  // ===== 372 rework: grouping in default view =====
  await section('372-grouping', async () => {
    await auth(page, tok, '/accounting/phoi-phieu');
    await sleep(2000);
    const g = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr')];
      const plates = rows.map((r) => {
        const cell = r.querySelector('[data-label*="Thông tin xe"], [data-label*="xe"]');
        const m = (cell?.textContent || r.textContent).match(/[0-9]{2}[A-Z]-[0-9]{3}[.\-][0-9]{2}|[0-9]{2}[A-Z]{2}-[0-9]{4,5}/);
        return m ? m[0] : null;
      }).filter(Boolean);
      const lastSeen = new Map(); let ok = true; let firstBreak = null;
      for (let i = 0; i < plates.length; i++) {
        const p = plates[i];
        if (lastSeen.has(p) && lastSeen.get(p) !== i - 1) { ok = false; firstBreak = { plate: p, lastAt: lastSeen.get(p), againAt: i }; break; }
        lastSeen.set(p, i);
      }
      return { rowCount: rows.length, sampled: plates.length, groupOk: ok, firstBreak };
    });
    log('372-grouping-after-rework', g);
    await shot(page, `${EV}/372-grouped-default-w1440.png`);
    // mini-filter regression (was PASS scope)
    const trig = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('thead button, thead [aria-haspopup]')].find((x) => /Khách hàng/.test(t(x)));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (trig) {
      await tapAt(page, trig.x, trig.y, { label: '372 regression trigger' });
      await sleep(700);
      const before = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
      await page.keyboard.type('LONG MINH', { delay: 30 });
      await page.keyboard.press('Enter');
      await sleep(900);
      const mid = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
      await page.keyboard.press('Escape');
      await sleep(500);
      log('372-miniFilter-regression', { before, after: mid });
    }
  });

  // ===== 383: container type + direction on invoice-tracking =====
  await section('383-cont-specs', async () => {
    await auth(page, tok, '/accounting/invoice-tracking');
    await sleep(2000);
    const c = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      const cell = document.querySelector('[data-label*="Cont"], td[data-label*="Thông số"]');
      const rows = [...document.querySelectorAll('table tbody tr')];
      return {
        rowCount: rows.length,
        contCell: cell ? t(cell).slice(0, 120) : null,
        firstRow: rows[0] ? t(rows[0]).slice(0, 200) : null,
        headers: [...document.querySelectorAll('table thead th')].map(t).slice(0, 16),
      };
    });
    log('383-contract', c);
    await shot(page, `${EV}/383-cont-w1440.png`);
    for (const w of [1280, 1920, 2560]) { await setViewport(page, w); await shot(page, `${EV}/383-invoice-w${w}.png`); }
    await setViewport(page, 1440);
  });

  // ===== 373: reject control + payer column in phoi-phieu dialogs =====
  await section('373-reject-payer', async () => {
    await auth(page, tok, '/accounting/phoi-phieu');
    await sleep(2000);
    // find a row action opening the tiền đường/chi hộ dialog (read-only open)
    const btn = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const cands = [...document.querySelectorAll('table tbody button, table tbody a')]
        .filter((b) => /Tiền đường|Chi hộ|Chi tiết|Xem/.test(t(b)));
      if (!cands.length) return null;
      const r = cands[0].getBoundingClientRect();
      return { label: t(cands[0]), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    log('373-dialog-trigger', btn?.label ?? null);
    if (btn) {
      await tapAt(page, btn.x, btn.y, { label: '373 open detail dialog' });
      await sleep(1000);
      const d = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"], .modal, [class*="Dialog"]')].filter((p) => p.offsetParent !== null)[0];
        if (!dlg) return null;
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        const body = t(dlg);
        const rejectBtn = [...dlg.querySelectorAll('button')].find((b) => /Từ chối/.test(t(b)));
        return {
          head: body.slice(0, 150),
          hasPayerCol: /Người thanh toán/.test(body),
          hasReject: !!rejectBtn,
          rejectDisabled: rejectBtn ? rejectBtn.disabled : null,
          hasReasonPromptOnReject: rejectBtn ? rejectBtn.getAttribute('aria-label') || t(rejectBtn) : null,
        };
      });
      log('373-dialog', d);
      await shot(page, `${EV}/373-dialog-w1440.png`);
      if (d?.hasReject && !d.rejectDisabled) {
        // open the reason prompt, verify it, close via Hủy — NO submit
        const rp = await page.evaluate(() => {
          const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((p) => p.offsetParent !== null)[0];
          const b = [...dlg.querySelectorAll('button')].find((x) => /Từ chối/.test((x.textContent || '').trim()) && !x.disabled);
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await tapAt(page, rp.x, rp.y, { label: '373 reject (prompt only)' });
        await sleep(800);
        const prompt = await page.evaluate(() => {
          const dlg = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((p) => p.offsetParent !== null);
          const last = dlg[dlg.length - 1];
          if (!last) return null;
          const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
          return { text: t(last).slice(0, 160), hasTextarea: !!last.querySelector('textarea, input'), buttons: [...last.querySelectorAll('button')].map(t).slice(0, 5) };
        });
        log('373-reason-prompt', prompt);
        await shot(page, `${EV}/373-reason-prompt-w1440.png`);
        const cancel = await page.evaluate(() => {
          const dlgs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((p) => p.offsetParent !== null);
          const last = dlgs[dlgs.length - 1];
          const t = (el) => (el?.textContent || '').trim();
          const b = last ? [...last.querySelectorAll('button')].find((x) => /^Hủy|Huỷ$/.test(t(x))) : null;
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (cancel) await tapAt(page, cancel.x, cancel.y, { label: '373 cancel prompt' });
        await sleep(600);
      }
    }
  });

  // ===== 370: overview fund notice + alerts + due chart, 390 overflow =====
  await section('370-overview', async () => {
    await auth(page, tok, '/accounting?view=overview');
    await sleep(2000);
    const o = await page.evaluate(() => {
      const body = (document.body.textContent || '').replace(/\s+/g, ' ');
      return {
        hasFundNotice: /Quỹ (tiền mặt|công ty)?\s*(âm|negative)|quỹ âm/i.test(body) || /Cảnh báo quỹ/i.test(body),
        hasMoneyAlerts: /cảnh báo|Cảnh báo/i.test(body),
        hasDueChart: /Tuần \d{2}\/\d{2}/.test(body) || !!document.querySelector('svg'),
        overflow390: null,
      };
    });
    log('370-contract-1440', o);
    await shot(page, `${EV}/370-overview-w1440.png`);
    await setViewport(page, 390, 900);
    await sleep(1200);
    const of390 = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth }));
    log('370-overflow-390', of390);
    await shot(page, `${EV}/370-overview-w390.png`);
    await setViewport(page, 768, 1000);
    await shot(page, `${EV}/370-overview-w768.png`);
    await setViewport(page, 1440, 1000);
  });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG });
  console.log('WAVE3_DONE');
} finally {
  await browser.close();
}
