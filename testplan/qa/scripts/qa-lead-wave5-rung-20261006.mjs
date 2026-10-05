// Lead QA wave 5 — 373r2 reject (network capture), 387 issue-dialog trailer, 388 card-mode law, 389 reassign field.
// MUTATION SURFACE: exactly one — the 373r2 reject on lead fixture cost id=29 (source row 40);
// all dialogs otherwise open read-only and close via Hủy/Esc.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-06_lead-qa-wave5-373r2-387-388-389';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });
const admin = await loginApi('admin', 'Abc123');
const tok = admin.token ?? admin.accessToken ?? admin?.data?.token;
const dungnv = await loginApi('dungnv', 'Abc123');
const dungnvTok = dungnv.token ?? dungnv.accessToken ?? dungnv?.data?.token;

const { browser, page } = await launch({ width: 1440, height: 1100 });
const REQ = [];
page.on('response', (res) => {
  const u = res.url().replace(STAGING, '');
  if (/rows\/\d+/.test(u)) REQ.push({ url: u, method: res.request().method(), status: res.status() });
});
async function section(name, fn) {
  try { await fn(); log(`section:${name}`, { ok: true }); }
  catch (err) { log(`section:${name}`, { ok: false, error: String(err).slice(0, 260) }); }
}

try {
  // ===== 373r2: reject fixture cost 29 — THE mutation =====
  await section('373r2-reject', async () => {
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
    await tapAt(page, open.x, open.y, { label: '373r2 open dialog' });
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
    await tapAt(page, rej.x, rej.y, { label: '373r2 Từ chối — MUTATES lead fixture cost id=29' });
    await sleep(800);
    await page.keyboard.type('Lead QA wave5: reject verify 373r2', { delay: 20 });
    await sleep(300);
    const submit = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal')].filter((p) => p.offsetParent !== null);
      const last = dlgs[dlgs.length - 1];
      const t = (el) => (el?.textContent || '').trim();
      const b = [...last.querySelectorAll('button')].find((x) => /^Từ chối$/.test(t(x)));
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await tapAt(page, submit.x, submit.y, { label: '373r2 submit' });
    await sleep(2200);
    const after = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]') || document.querySelector('.modal.modal--operational');
      const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      return { dialogNow: root ? t(root).slice(0, 200) : '(closed)' };
    });
    log('373r2-after', { ...after, network: REQ.slice(-3) });
    await shot(page, `${EV}/373r2-after-reject.png`);
  });

  // ===== 388: expense register card-mode numeric law =====
  await section('388-card-law', async () => {
    await auth(page, tok, '/expenses');
    await sleep(2500);
    for (const w of [1280, 1440]) {
      await setViewport(page, w);
      const c = await page.evaluate(() => {
        const out = [];
        for (const td of document.querySelectorAll('table tbody td')) {
          const txt = (td.textContent || '').trim();
          if (!/^\d{1,3}(\.\d{3})+\s?₫$/.test(txt)) continue;
          const range = document.createRange();
          range.selectNodeContents(td);
          const lines = [...range.getClientRects()].filter((r) => r.width > 2).length;
          if (lines > 1) out.push({ text: txt.slice(0, 20), lines });
        }
        return { broken: out.length, samples: out.slice(0, 3) };
      });
      log(`388-wrap@${w}`, c);
      await shot(page, `${EV}/388-expenses-w${w}.png`);
    }
    await setViewport(page, 1440);
  });

  // ===== 387 + 389: dispatch dialogs (dungnv, read-only) =====
  await section('387-389-dispatch-dialogs', async () => {
    await auth(page, dungnvTok, '/dispatch-detail');
    await sleep(2500);
    // 389: reassign dialog — find a Phân xe lại control and open it
    const reassign = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('button')].find((x) => /Phân xe lại/.test(t(x)));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (reassign) {
      await tapAt(page, reassign.x, reassign.y, { label: '389 open reassign dialog' });
      await sleep(1500);
      const dlg = await page.evaluate(() => {
        const root = [...document.querySelectorAll('[role="dialog"], .modal')].filter((p) => p.offsetParent !== null)[0];
        if (!root) return null;
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        return {
          head: t(root).slice(0, 160),
          hasTrailerField: /Rơ-moóc|rơ moóc/i.test(t(root)),
          buttons: [...root.querySelectorAll('button')].map(t).filter(Boolean).slice(0, 6),
        };
      });
      log('389-reassign-dialog', dlg);
      await shot(page, `${EV}/389-reassign-w1440.png`);
      const cancel = await page.evaluate(() => {
        const roots = [...document.querySelectorAll('[role="dialog"], .modal')].filter((p) => p.offsetParent !== null);
        const t = (el) => (el?.textContent || '').trim();
        const b = roots.length ? [...roots[roots.length - 1].querySelectorAll('button')].find((x) => /^Hủy|Huỷ$/.test(t(x))) : null;
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (cancel) { await tapAt(page, cancel.x, cancel.y, { label: '389 cancel' }); await sleep(700); }
    }
    // 387: issue dialog — Gán xe / Phát lệnh path
    const issue = await page.evaluate(() => {
      const t = (el) => (el?.textContent || '').trim();
      const b = [...document.querySelectorAll('button')].find((x) => /Gán xe/.test(t(x)));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (issue) {
      await tapAt(page, issue.x, issue.y, { label: '387 open issue dialog' });
      await sleep(1600);
      const dlg = await page.evaluate(() => {
        const root = [...document.querySelectorAll('[role="dialog"], .modal')].filter((p) => p.offsetParent !== null)[0];
        if (!root) return null;
        const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
        const body = t(root);
        return {
          head: body.slice(0, 140),
          hasTrailerField: /Rơ-moóc/i.test(body),
          warningMention: /khác với rơ-moóc đang ghép|ghi đè/i.test(body),
        };
      });
      log('387-issue-dialog', dlg);
      await shot(page, `${EV}/387-issue-dialog-w1440.png`);
      await page.keyboard.press('Escape');
      await sleep(600);
    }
  });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG, network: REQ });
  console.log('WAVE5_DONE');
} finally {
  await browser.close();
}
