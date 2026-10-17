// QA wave 17/10 — FB-093 (merge rev), FB-095/105447 (Hủy ghép + money
// promotion), on /shipments-debit as CUS (thanhdc).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/revmerge';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 420)}`); };
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return (await r.json()).token;
};
const ctok = await login('thanhdc');
const ktok = await login('hoapt');
const board = async (q) => {
  const r = await fetch(`${API}/accounting/debit-board?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${ktok}` } });
  const d = await r.json();
  return (d.items ?? []).filter((x) => String(x.billOrBooking || '').includes(q));
};
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ctok);
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => /tìm|search/i.test(x.placeholder || '') || /tìm/i.test(x.getAttribute('aria-label') || ''));
    if (i) i.focus();
  });
  await page.keyboard.type('KBQA-REV', { delay: 40 });
  await sleep(3000);
  // tick A + B only
  const ticks = await page.evaluate(() => {
    const out = { a: null, b: null, c: null };
    for (const tr of document.querySelectorAll('tr')) {
      const t = tr.textContent || '';
      const cb = tr.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (!cb) continue;
      if (/KBQA-REV-A/.test(t)) { if (!cb.checked) cb.click(); out.a = true; }
      else if (/KBQA-REV-B/.test(t)) { if (!cb.checked) cb.click(); out.b = true; }
      else if (/KBQA-REV-C/.test(t)) out.c = !!cb.checked;
    }
    return out;
  });
  await sleep(1200);
  // AC FB-093 GAP2: merge button must be blocked/must error with mixed customers — but A+B same customer so first do the GOOD merge;
  // the cross-customer case is checked after, with A unmerged and C.
  const mergeBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /ghép cước thu khách/i.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled };
  });
  if (!mergeBtn || mergeBtn.disabled) { record('open-merge-dialog', false, `btn=${JSON.stringify(mergeBtn)}`); }
  else {
    await page.mouse.click(mergeBtn.x, mergeBtn.y);
    await sleep(1800);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      return d ? { labels: [...d.querySelectorAll('label')].map((l) => (l.textContent || '').trim()).slice(0, 8), text: (d.textContent || '').slice(0, 200) } : null;
    });
    await page.screenshot({ path: `${SHOTS}/01-merge-dialog.png` });
    record('fb093-merge-dialog-opens', !!dlg, JSON.stringify(dlg));
    // pick class 3.5T in the dialog + confirm
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const lbl = [...d.querySelectorAll('label')].find((l) => /loại xe/i.test(l.textContent || ''));
      if (lbl) {
        let el = lbl.parentElement; let g = 0;
        while (el && g++ < 6) {
          const t = el.querySelector('input[role="combobox"], button');
          if (t) { t.focus(); t.click(); return; }
          el = el.parentElement;
        }
      }
    });
    await sleep(800);
    const dbg1 = await page.evaluate(() => ({
      options: [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || '').trim()).slice(0, 8),
      inputs: [...([...document.querySelectorAll('[role="dialog"]')][0]?.querySelectorAll('input') ?? [])].map((i) => ({ v: i.value, ph: i.placeholder, role: i.getAttribute('role') })),
    }));
    console.log('after class trigger:', JSON.stringify(dbg1));
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /3.5 tấn/.test(x.textContent || ''));
      if (o) { o.scrollIntoView({ block: 'nearest' }); o.click(); }
    });
    await sleep(900);
    const dbg2 = await page.evaluate(() => ({
      inputs: [...([...document.querySelectorAll('[role="dialog"]')][0]?.querySelectorAll('input') ?? [])].map((i) => ({ v: i.value, ph: i.placeholder })),
      btns: [...([...document.querySelectorAll('[role="dialog"]')][0]?.querySelectorAll('button') ?? [])].map((b) => ({ t: (b.textContent || '').trim(), d: b.disabled })),
    }));
    console.log('after class pick:', JSON.stringify(dbg2));
    // BKS ảo if present
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const lbl = [...d.querySelectorAll('label')].find((l) => /ảo|báo khách/i.test(l.textContent || ''));
      if (lbl) {
        let el = lbl.parentElement; let g = 0;
        while (el && g++ < 6) {
          const t = el.querySelector('input[role="combobox"], input:not([type=checkbox])');
          if (t) { t.focus(); return; }
          el = el.parentElement;
        }
      }
    });
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.evaluate(() => {
      window.__mergeHits = [];
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      d?.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        window.__mergeHits.push({ t: (b?.textContent || '').trim().slice(0, 24), trusted: e.isTrusted });
      }, true);
    });
    const confirm = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const btn = [...d.querySelectorAll('button')].find((b) => /ghép cước thu khách$/i.test((b.textContent || '').trim()) && !b.disabled && d.contains(b));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    console.log('confirm btn:', JSON.stringify(confirm));
    if (confirm) { await page.mouse.click(confirm.x, confirm.y); }
    await sleep(4500);
    const after = await page.evaluate(() => ({
      dlg: !!document.querySelector('[role="dialog"]'),
      hits: window.__mergeHits,
      dlgTail: (document.querySelector('[role="dialog"]')?.textContent || '').slice(-200),
      toast: (document.querySelector('.toast-container, [aria-live]')?.textContent || '').slice(0, 140),
    }));
    console.log('after confirm:', JSON.stringify(after));
    await page.screenshot({ path: `${SHOTS}/02-after-merge.png` });
    const [a] = await board('KBQA-REV-A');
    const [b] = await board('KBQA-REV-B');
    record('fb093-merged-money', !!a && a.thu?.cuocThu === 1800000 && !!b && (b.thu?.cuocThu === 0 || b.thu?.cuocThu == null) && (b.lcl?.ghépCùngRef || '').includes('KBQA-REV-A'),
      `A.thu=${JSON.stringify(a?.thu)} B.thu=${JSON.stringify(b?.thu)} B.note=${JSON.stringify(b?.lcl)}`);
  }
  // cross-customer validation: tick C together with A → merge must be blocked with a clear error and no API call
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => /tìm|search/i.test(x.placeholder || '') || /tìm/i.test(x.getAttribute('aria-label') || ''));
    if (i) { i.focus(); }
  });
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('KBQA-REV', { delay: 40 });
  await sleep(2500);
  await page.evaluate(() => {
    for (const tr of document.querySelectorAll('tr')) {
      const t = tr.textContent || '';
      const cb = tr.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (!cb) continue;
      if (/KBQA-REV-B/.test(t) && cb.checked) cb.click();
    }
  });
  await sleep(600);
  await page.evaluate(() => {
    for (const tr of document.querySelectorAll('tr')) {
      const t = tr.textContent || '';
      const cb = tr.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (!cb) continue;
      if (/KBQA-REV-C/.test(t) && !cb.checked) cb.click();
    }
  });
  await sleep(1000);
  const mixMerge = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /ghép cước thu khách/i.test(x.textContent || ''));
    if (!b) return { state: 'no-btn' };
    b.click();
    return { state: 'clicked', disabled: b.disabled };
  });
  await sleep(1500);
  const mixState = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /khách hàng|ghép/i.test(x.textContent || ''));
    const body = (document.body.textContent || '');
    const err = body.match(/cùng một khách hàng[^\\n]{0,80}|khác khách hàng[^\\n]{0,80}|chỉ ghép[^\\n]{0,80}/i);
    return { dlg: !!d, err: err ? err[0] : null };
  });
  await page.screenshot({ path: `${SHOTS}/03-cross-customer-blocked.png` });
  record('fb093-cross-customer-blocked', mixMerge.state !== 'no-btn' && !!mixState.err, JSON.stringify({ mixMerge, mixState }) + ` · ${SHOTS}/03-cross-customer-blocked.png`);
  // close whatever opened
  await page.keyboard.press('Escape');
  await sleep(600);
  // Hủy ghép on A (principal) → promotion to B (FB-095 + card 105447)
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => /tìm|search/i.test(x.placeholder || '') || /tìm/i.test(x.getAttribute('aria-label') || ''));
    if (i) { i.focus(); }
  });
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('KBQA-REV-A', { delay: 40 });
  await sleep(2500);
  const expanded = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-REV-A/.test(r.textContent || ''));
    if (!tr) return false;
    const plus = tr.querySelector('.shipment-debit-row__expand-button, button[aria-expanded]');
    if (plus) { plus.click(); return true; }
    return false;
  });
  await sleep(1200);
  const strip = await page.evaluate(() => {
    const t = document.body.textContent || '';
    const m = t.match(/Thu khách:[^\\n]{0,120}/);
    return m ? m[0] : null;
  });
  await page.screenshot({ path: `${SHOTS}/04-expanded-strip.png` });
  record('c105447-group-block-visible', !!strip && /Ghép/.test(strip), `expanded=${expanded} strip=${JSON.stringify(strip)} · ${SHOTS}/04-expanded-strip.png`);
  // click Hủy ghép in the THU KHÁCH dimension
  const huy = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /hủy ghép/i.test(b.textContent || '') && !b.disabled);
    if (!btns.length) return null;
    const r = btns[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, n: btns.length };
  });
  if (huy) {
    await page.mouse.click(huy.x, huy.y);
    await sleep(1200);
    await page.screenshot({ path: `${SHOTS}/05-unmerge-confirm.png` });
    const conf = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /hủy ghép/i.test(x.textContent || ''));
      if (!d) return null;
      const btn = [...d.querySelectorAll('button')].find((b) => /hủy ghép$/i.test((b.textContent || '').trim()) || /xác nhận/i.test((b.textContent || '').trim()));
      if (!btn) return { text: (d.textContent || '').slice(0, 180), btn: null };
      const r = btn.getBoundingClientRect();
      return { text: (d.textContent || '').slice(0, 180), pt: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
    });
    record('c105447-unmerge-confirm-dialog', !!conf, JSON.stringify(conf));
    if (conf?.pt) { await page.mouse.click(conf.pt.x, conf.pt.y); }
    await sleep(4000);
    await page.screenshot({ path: `${SHOTS}/06-after-unmerge.png` });
    const [a2] = await board('KBQA-REV-A');
    const [b2] = await board('KBQA-REV-B');
    const survivorKeeps = b2 && b2.thu?.cuocThu === 1800000;
    const dissolved = !a2?.lcl?.ghépCùngRef && !b2?.lcl?.ghépCùngRef;
    record('fb095-money-promotes-to-survivor', survivorKeeps && dissolved,
      `A.thu=${JSON.stringify(a2?.thu?.cuocThu)} A.note=${JSON.stringify(a2?.lcl?.ghépCùngRef)} B.thu=${JSON.stringify(b2?.thu?.cuocThu)} B.note=${JSON.stringify(b2?.lcl?.ghépCùngRef)} · ${SHOTS}/06-after-unmerge.png`);
  } else {
    record('c105447-unmerge-confirm-dialog', false, 'no Hủy ghép button found');
  }
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
