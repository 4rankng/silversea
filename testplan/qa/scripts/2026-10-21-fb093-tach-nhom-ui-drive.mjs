// Card 211026024348 (FB-093 follow-up) — UI evidence for the settlement
// "Tách nhóm" affordance: (a) 2 lô cùng KH ghép cước thu khách, (b) tách
// nhóm, (c) tiền về lại từng lô đúng trạng thái trước ghép + note ghép dọn.
//
// Dev-port contract (frontend/src/tests/dev-port-contract.test.ts): every
// endpoint comes from env (QA_BASE/QA_API), never a hardcoded port.
//
// Phases (QA_PHASE):
//   pre   — screenshots + assertions of the pre-merge face (no Tách nhóm yet)
//   merge — do the Ghép cước thu khách merge, stop on the merged face
//   tach  — click Tách nhóm on the merged member, prove money back
//   all   — pre + merge + tach (one sitting)
//
// Usage:
//   QA_BASE=http://localhost:7188 QA_PHASE=all \
//     node testplan/qa/scripts/2026-10-21-fb093-tach-nhom-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE ?? 'http://localhost:7188';
const API = process.env.QA_API ?? `${BASE}/api`;
const USER = process.env.QA_USER ?? 'thanhdc';
const PASS = process.env.QA_PASS ?? 'Abc123';
const OUT = process.env.QA_OUT ?? 'qa/2026-10-21-fb093-tach-nhom';
const TAG = process.env.QA_TAG ?? 'local';
const PHASE = process.env.QA_PHASE ?? 'all';
const CUSTOMER_ID = process.env.QA_CUSTOMER_ID ?? '47065';
const LOT_A = process.env.QA_LOT_A ?? 'UI-LCL-B77AP2-3';
const LOT_B = process.env.QA_LOT_B ?? 'UI-LCL-B77AP2-5';
const MONEY_A = process.env.QA_MONEY_A ?? '3.050.000';
const MONEY_B = process.env.QA_MONEY_B ?? '1.800.000';

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => {
  const v = ok ? 'PASS' : 'FAIL';
  results.push(v);
  console.log(`[${v}] ${name} — ${String(detail).slice(0, 500)}`);
};
const shot = (name) => page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), fullPage: false });
const domDump = (name, text) => fs.writeFileSync(path.join(OUT, `${TAG}-${name}.txt`), `${new Date().toISOString()}\n${text}\n`);

const token = await (async () => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USER, password: PASS }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`login failed: ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d.token;
})();
console.log(`login ${USER} @ ${BASE} ok`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.setViewport({ width: 1540, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

const rowText = (lot) => page.evaluate((l) => {
  const tr = [...document.querySelectorAll('tr')].find((x) => (x.textContent || '').includes(l));
  return tr ? (tr.textContent || '').replace(/\s+/g, ' ').trim() : null;
}, lot);

async function openBoard() {
  const query = CUSTOMER_ID ? `?customer=${CUSTOMER_ID}` : '';
  await page.goto(`${BASE}/shipments-debit${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction((a) => (document.body.textContent || '').includes(a), { timeout: 30000 }, LOT_A);
  await sleep(2500);
}

function tickLot(lot) {
  return page.evaluate((l) => {
    const tr = [...document.querySelectorAll('tr')].find((x) => (x.textContent || '').includes(l));
    const cb = tr?.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    if (!cb.checked) cb.click();
    return cb.checked;
  }, lot);
}

try {
  if (PHASE === 'repro') {
    // Card repro on the deployed build (read-only): a merged rev group shows
    // its "Ghép cước cùng Bill" note but NO "Tách nhóm" affordance anywhere.
    await page.goto(`${BASE}/shipments-debit${CUSTOMER_ID ? `?customer=${CUSTOMER_ID}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
    const bodyText = await page.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
    const mergedNote = /Ghép cước cùng Bill|Ghép xe cùng Bill/.test(bodyText);
    const tachButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
      .filter((x) => /Tách nhóm|Hủy ghép/.test(x)));
    record('repro-merged-note-on-board', mergedNote, bodyText.slice(bodyText.indexOf('Ghép cước cùng Bill') - 120, bodyText.indexOf('Ghép cước cùng Bill') + 80));
    record('repro-no-tach-nhom-affordance', tachButtons.length === 0, JSON.stringify(tachButtons));
    await shot('ui-00-repro');
    domDump('dom-00-repro', `merged-note-present=${mergedNote}\nTách nhóm/Hủy ghép buttons: ${JSON.stringify(tachButtons)}`);
    throw new Error('phase=repro stop');
  }

  await openBoard();

  if (PHASE !== 'tach') {
    // ── (a-1) pre-merge face ──────────────────────────────────────────────
    const preA = await rowText(LOT_A);
    const preB = await rowText(LOT_B);
    record('pre-merge-rows-visible', !!preA && !!preB, `A=${preA?.slice(0, 160)} | B=${preB?.slice(0, 160)}`);
    record('pre-merge-own-money', !!preA && preA.includes(MONEY_A) && !!preB && preB.includes(MONEY_B),
      `A has ${MONEY_A}=${!!preA && preA.includes(MONEY_A)} · B has ${MONEY_B}=${!!preB && preB.includes(MONEY_B)}`);
    record('pre-merge-no-merge-note', !!preB && !/Ghép cước cùng Bill/.test(preB), preB?.slice(0, 160));
    const preButtons = await page.evaluate((lots) => [...document.querySelectorAll('button')]
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
      .filter((x) => /Tách nhóm/.test(x) && lots.some((l) => x.includes(l))), [LOT_A, LOT_B]);
    record('pre-merge-no-tach-nhom', preButtons.length === 0, JSON.stringify(preButtons));
    await shot('ui-01-pre-merge');
    domDump('dom-01-pre-merge', `A row: ${preA}\nB row: ${preB}\nTách nhóm buttons: ${JSON.stringify(preButtons)}`);

    if (PHASE === 'pre') throw new Error('phase=pre stop');
  }

  if (PHASE !== 'tach') {
    // ── (a-2) merge the two lots ──────────────────────────────────────────
    record('tick-lots', (await tickLot(LOT_A)) && (await tickLot(LOT_B)), 'checkboxes A+B');
    await sleep(1000);
    const mergeClicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /ghép cước thu khách/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    record('merge-dialog-opens', mergeClicked && !!(await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => null)), 'dialog');
    await sleep(1500);
    await shot('ui-02-merge-dialog');
    // pick the 3.5T class in the shared dialog (proven selector pattern)
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const lbl = [...(d?.querySelectorAll('label') ?? [])].find((l) => /loại xe/i.test(l.textContent || ''));
      let el = lbl?.parentElement;
      let g = 0;
      while (el && g++ < 6) {
        const t = el.querySelector('input[role="combobox"], button');
        if (t) { t.focus(); t.click(); return true; }
        el = el.parentElement;
      }
      return false;
    });
    await sleep(900);
    const optionPicked = await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /3\.5 tấn|3\.5T/i.test(x.textContent || ''));
      if (o) { o.scrollIntoView({ block: 'nearest' }); o.click(); return (o.textContent || '').trim(); }
      return null;
    });
    record('merge-class-picked', !!optionPicked, String(optionPicked));
    await sleep(800);
    const confirmMerge = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const btn = [...(d?.querySelectorAll('button') ?? [])].find((b) => /ghép cước thu khách$/i.test((b.textContent || '').trim()) && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    });
    record('merge-submitted', confirmMerge, 'submit clicked');
    await sleep(4500);

    const mergedB = await rowText(LOT_B);
    const mergedA = await rowText(LOT_A);
    record('merged-member-zero-note', !!mergedB && /Ghép cước cùng Bill/.test(mergedB), `B=${mergedB?.slice(0, 200)}`);
    const tachButtons = await page.evaluate((lots) => [...document.querySelectorAll('button')]
      .filter((b) => /Tách nhóm/.test((b.getAttribute('aria-label') || b.textContent || ''))
        && b.tagName.toLowerCase() === 'button'
        && lots.some((l) => (b.getAttribute('aria-label') || '').includes(l)))
      .map((b) => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim(), ariaDisabled: b.getAttribute('aria-disabled') })), [LOT_A, LOT_B]);
    record('merged-tach-nhom-present', tachButtons.length === 2, JSON.stringify(tachButtons));
    await shot('ui-03-merged');
    domDump('dom-03-merged', `A row: ${mergedA}\nB row: ${mergedB}\nTách nhóm buttons: ${JSON.stringify(tachButtons, null, 1)}`);

    if (PHASE === 'merge') throw new Error('phase=merge stop');
  }

  // ── (b) Tách nhóm on the member ─────────────────────────────────────────
  const tachClicked = await page.evaluate((lot) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('Tách nhóm') && (x.getAttribute('aria-label') || '').includes(lot));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    b.click();
    return { label: b.getAttribute('aria-label'), x: r.x, y: r.y };
  }, LOT_B);
  record('tach-nhom-clicked', !!tachClicked, JSON.stringify(tachClicked));
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => null);
  await sleep(1200);
  await shot('ui-04-tach-confirm');
  const confirmText = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent || '').replace(/\s+/g, ' ').trim());
  domDump('dom-04-tach-confirm', confirmText);
  const confirmTach = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const btn = [...(d?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === 'Tách nhóm' && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  record('tach-confirmed', confirmTach, 'confirm clicked');
  await sleep(5000);

  // ── (c) money back per lot + note shed ──────────────────────────────────
  const afterA = await rowText(LOT_A);
  const afterB = await rowText(LOT_B);
  record('tach-money-back', !!afterA && afterA.includes(MONEY_A) && !!afterB && afterB.includes(MONEY_B),
    `A ${MONEY_A}=${!!afterA && afterA.includes(MONEY_A)} · B ${MONEY_B}=${!!afterB && afterB.includes(MONEY_B)}`);
  record('tach-note-shed', !!afterB && !/Ghép cước cùng Bill/.test(afterB), `B=${afterB?.slice(0, 200)}`);
  const afterButtons = await page.evaluate((lots) => [...document.querySelectorAll('button')]
    .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
    .filter((x) => /Tách nhóm/.test(x) && lots.some((l) => x.includes(l))), [LOT_A, LOT_B]);
  record('tach-buttons-gone', afterButtons.length === 0, JSON.stringify(afterButtons));
  await shot('ui-05-after-tach');
  domDump('dom-05-after-tach', `A row: ${afterA}\nB row: ${afterB}\nTách nhóm buttons: ${JSON.stringify(afterButtons)}`);
} catch (err) {
  if (!/phase=(pre|merge|repro) stop/.test(String(err))) {
    record('driver-exception', false, String(err));
    await shot('ui-99-exception').catch(() => {});
  } else {
    console.log(String(err));
  }
} finally {
  await browser.close();
  const fails = results.filter((r) => r === 'FAIL').length;
  console.log(`\n== ${TAG}/${PHASE}: ${results.length - fails}/${results.length} PASS · exit ${fails > 0 ? 1 : 0}`);
  process.exit(fails > 0 ? 1 : 0);
}
