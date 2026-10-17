// QA wave 17/10 — LCL grouping cluster: FB-092 (selection bar + dialog),
// 232309 (carrier source per class), 232319 (Lô 1 auto price), FB-091
// (master-plan columns). Fixtures: KBQA-GRP-A/B (lots 861/862, route 19).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/lclgroup';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 420)}`); };
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  if (!r.ok) throw new Error(`login ${id} ${r.status}`);
  return (await r.json()).token;
};
const dtok = await login('dungnv');
const wire = [];
const apiGet = async (path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${dtok}` } })).json();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dtok);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await page.evaluate(() => document.querySelector('input[aria-label="Tìm nhanh"]')?.focus());
  await page.keyboard.type('KBQA-GRP', { delay: 40 });
  await sleep(2500);

  // tick both LCL rows
  const ticks = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')].filter((r) => /KBQA-GRP/.test(r.textContent || ''));
    const out = [];
    for (const row of rows) {
      const cb = row.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (cb && !cb.checked) { cb.click(); out.push(true); } else out.push(!!cb?.checked);
    }
    return { rows: rows.length, ticks: out };
  });
  await sleep(1500);
  const bar = await page.evaluate(() => {
    const t = document.body.textContent || '';
    const m = t.match(/Đang chọn[^\n]{0,80}/);
    return m ? m[0] : null;
  });
  await page.screenshot({ path: `${SHOTS}/01-selection-bar.png` });
  record('fb092-selection-bar', ticks.rows >= 2 && !!bar && /Đang chọn 2 lô/.test(bar), `rows=${ticks.rows} ticks=${JSON.stringify(ticks.ticks)} bar=${JSON.stringify(bar)} · ${SHOTS}/01-selection-bar.png`);

  // open the group-assign dialog
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /gán xe nhóm/i.test(b.textContent || '') && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(1800);
  const dlg = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /gán xe|nhóm/i.test(x.textContent || ''));
    if (!d) return null;
    return {
      title: (d.querySelector('h1,h2,h3')?.textContent || '').trim(),
      labels: [...d.querySelectorAll('label')].map((l) => (l.textContent || '').trim()).slice(0, 10),
      buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 14),
    };
  });
  await page.screenshot({ path: `${SHOTS}/02-dialog-open.png` });
  record('fb092-dialog-fields', !!dlg && dlg.labels.length >= 3, JSON.stringify(dlg) + ` · ${SHOTS}/02-dialog-open.png`);

  // truck class: pick 2.5T in the class select, then read the NHÀ XE list
  const pickTrigger = async (labelText) => {
    const ok = await page.evaluate((lt) => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      if (!d) return false;
      const lbl = [...d.querySelectorAll('label')].find((l) => (l.textContent || '').includes(lt));
      if (!lbl) return false;
      let el = lbl.parentElement; let g = 0;
      while (el && g++ < 6) {
        const t = el.querySelector('input[role="combobox"], button');
        if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); t.click(); return true; }
        el = el.parentElement;
      }
      return false;
    }, labelText);
    await sleep(900);
    return ok;
  };
  const clickOption = async (want) => {
    const ok = await page.evaluate((w) => {
      const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
      const o = [...document.querySelectorAll('[role="option"]')].find((el) => norm(el.textContent).includes(norm(w)));
      if (!o) return false;
      o.scrollIntoView({ block: 'nearest' });
      o.click();
      return true;
    }, want);
    await sleep(600);
    return ok;
  };
  let pickedClass = await pickTrigger('Loại xe tính cước trả ĐV');
  pickedClass = pickedClass && await clickOption('2.5 tấn');
  await sleep(1400);
  // open NHÀ XE and dump options (truck class → external carriers only)
  const trig2 = await pickTrigger('Nhà xe');
  await sleep(400);
  const carrierOpts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || '').trim()));
  await page.screenshot({ path: `${SHOTS}/03-truckclass-carriers.png` });
  record('c232309-truckclass-external-only', pickedClass === true && trig2 === true && carrierOpts.some((t) => /BIỂN XANH/.test(t)) && !carrierOpts.some((t) => /nội bộ/i.test(t)),
    `class2.5T picked=${pickedClass} options=${JSON.stringify(carrierOpts).slice(0, 260)} · ${SHOTS}/03-truckclass-carriers.png`);
  // close the listbox, switch to CONT class, re-open carrier list
  await page.keyboard.press('Escape');
  await sleep(500);
  let pickedCont = await pickTrigger('Loại xe tính cước trả ĐV');
  pickedCont = pickedCont && await clickOption('Container 20');
  await sleep(1400);
  const trig3 = await pickTrigger('Nhà xe');
  await sleep(400);
  const carrierOptsCont = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || '').trim()));
  await page.screenshot({ path: `${SHOTS}/04-contclass-carriers.png` });
  record('c232309-contclass-internal-or-external', pickedCont === true && trig3 === true && carrierOptsCont.some((t) => /nội bộ/i.test(t)) && carrierOptsCont.some((t) => /BIỂN XANH/.test(t)),
    `cont picked=${pickedCont} options=${JSON.stringify(carrierOptsCont).slice(0, 260)} · ${SHOTS}/04-contclass-carriers.png`);
  await page.keyboard.press('Escape');
  await sleep(400);

  // final assign: 2.5T + BIỂN XANH + first carrier BKS; expect Lô 1 = 4.500.000
  await pickTrigger('Loại xe tính cước trả ĐV');
  await clickOption('2.5 tấn');
  await sleep(1000);
  await pickTrigger('Nhà xe');
  await clickOption('BIỂN XANH');
  await sleep(1800);
  // BKS thực: open and take the first option; the FE sourcing guard must
  // reject an internal plate on the EXTERNAL_ONLY truck class (FB-090).
  const trigBks = await pickTrigger('BKS thực');
  await sleep(500);
  console.log('bks trigger opened:', trigBks);
  const bksPicked = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')][0];
    if (!o) return null;
    const t = (o.textContent || '').trim();
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return t;
  });
  await sleep(900);
  // try to assign with whatever was picked; read the dialog error afterwards
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    const btn = [...d.querySelectorAll('button')].find((b) => /gán nhóm xe/i.test((b.textContent || '').trim()));
    if (btn && !btn.disabled) { const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    return null;
  }).then(async (pt) => { if (pt) await page.mouse.click(pt.x, pt.y); });
  await sleep(2500);
  const guardError = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    return d ? (d.textContent || '').match(/(Hàng lẻ xe tải[^]*?chọn BKS nhà xe|Nhà xe đã chọn[^]*?|Chọn[^]*?)/)?.[1]?.slice(0, 160) ?? null : null;
  });
  record('fb090-internal-plate-blocked-on-truck-class', !!guardError && /là xe nội bộ/.test(guardError), `picked=${JSON.stringify(bksPicked)} guard=${JSON.stringify(guardError)}`);
  // pick a NON-internal plate: reopen and choose an option ≠ the internal one
  const trigBks2 = await pickTrigger('BKS thực');
  await sleep(600);
  const bksPicked2 = await page.evaluate((firstPick) => {
    const opts = [...document.querySelectorAll('[role="option"]')].map((o) => ({ t: (o.textContent || '').trim(), el: o }));
    const candidate = opts.find((o) => o.t && o.t !== firstPick) ?? opts[0];
    if (!candidate) return null;
    candidate.el.scrollIntoView({ block: 'nearest' });
    candidate.el.click();
    return candidate.t;
  }, bksPicked);
  await sleep(900);
  console.log('bks second pick:', JSON.stringify(bksPicked2));
  const bksVirtual = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    const inputs = [...d.querySelectorAll('input')].map((i) => ({ v: i.value, ph: i.placeholder }));
    return inputs;
  });
  await page.screenshot({ path: `${SHOTS}/05-filled-dialog.png` });
  record('fb092-bks-virtual-autocopy', !!bksPicked && JSON.stringify(bksVirtual).includes((bksPicked || '').split(' ')[0]), `bks=${JSON.stringify(bksPicked)} inputs=${JSON.stringify(bksVirtual).slice(0, 320)} · ${SHOTS}/05-filled-dialog.png`);

  // assign
  await page.evaluate(() => {
    window.__btnHits = [];
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    if (!d) return;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      window.__btnHits.push({ text: (b?.textContent || '').trim().slice(0, 20), trusted: e.isTrusted });
    }, true);
  });
  const btnBox = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    if (!d) return null;
    const btn = [...d.querySelectorAll('button')].find((b) => /gán nhóm xe/i.test((b.textContent || '').trim()));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: btn.disabled, text: (btn.textContent || '').trim() };
  });
  console.log('assign btn:', JSON.stringify(btnBox));
  let assigned = 'no-btn';
  if (btnBox && !btnBox.disabled) {
    await page.mouse.click(btnBox.x, btnBox.y);
    assigned = 'mouse-clicked';
  } else if (btnBox) assigned = 'btn-disabled';
  await sleep(5000);
  const afterDlg = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    return {
      dlgStill: !!d,
      dlgText: d ? (d.textContent || '').slice(-320) : null,
      btnHits: window.__btnHits,
      toast: (document.querySelector('.toast-container, [aria-live]')?.textContent || '').slice(0, 140),
    };
  });
  console.log('assigned:', assigned, JSON.stringify(afterDlg));
  await page.screenshot({ path: `${SHOTS}/06-after-assign.png` });
  // read money: cước trả ĐV per lot from the debit-close API surface
  const moneys = {};
  for (const [ref, sid] of [['A', 861], ['B', 862]]) {
    const row = await apiGet(`/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=${encodeURIComponent('KBQA-GRP-' + ref)}`);
    const items = row.items ?? [];
    moneys[ref] = items.map((r) => ({ est: r.estimates?.tra ?? r.estimates?.cuocTraDv ?? null, all: r.estimates })) [0] ?? null;
  }
  console.log('moneys:', JSON.stringify(moneys).slice(0, 400));
  const lots = await apiGet(`/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=KBQA-GRP`);
  const summaries = (lots.items ?? []).map((r) => ({ f: r.fulfillmentId, plate: r.dispatch?.assignedPlate, carrier: r.dispatch?.carrierName, est: r.estimates }));
  console.log('rows after assign:', JSON.stringify(summaries).slice(0, 600));
  console.log('WIRE:', JSON.stringify(wire));
  record('c232319-group-assigned', assigned === 'clicked' && (summaries.length >= 2) && summaries.some((s) => /BIỂN XANH/.test(s.carrier || '')), JSON.stringify(summaries).slice(0, 400) + ` · ${SHOTS}/06-after-assign.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
