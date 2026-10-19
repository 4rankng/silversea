// QA wave 17/10 — phase 2: Hủy ghép on the rev principal (105447 + FB-095
// money promotion), then the cross-customer merge block (FB-093 GAP2).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/revmerge2';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 400)}`); };
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
  const search = async (q) => {
    await page.evaluate(() => {
      const i = [...document.querySelectorAll('input')].find((x) => /tìm|search/i.test(x.placeholder || '') || /tìm/i.test(x.getAttribute('aria-label') || ''));
      if (i) { i.focus(); }
    });
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(q, { delay: 40 });
    await sleep(2800);
  };
  await search('KBQA-REV-A');
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-REV-A/.test(r.textContent || ''));
    const plus = tr?.querySelector('.shipment-debit-row__expand-button, button[aria-expanded]');
    plus?.click();
  });
  await sleep(1500);
  const huy = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /hủy ghép/i.test(b.textContent || '') && !b.disabled);
    if (!btns.length) return null;
    btns[0].click();
    return { n: btns.length, text: (btns[0].textContent || '').trim() };
  });
  console.log('huy click:', JSON.stringify(huy));
  if (!huy) { record('c105447-unmerge-button', false, 'no Hủy ghép button'); }
  else {
    await sleep(1800);
    const dlgDump = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.textContent || '').slice(0, 160)),
      bodyTail: (document.body.textContent || '').slice(-300),
    }));
    console.log('after huy:', JSON.stringify(dlgDump));
    const conf = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /hủy ghép/i.test(x.textContent || ''));
      if (!d) return null;
      const btn = [...d.querySelectorAll('button')].find((b) => /^hủy ghép$/i.test((b.textContent || '').trim()));
      const r = btn?.getBoundingClientRect();
      return { text: (d.textContent || '').slice(0, 200), pt: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null };
    });
    await page.screenshot({ path: `${SHOTS}/01-unmerge-confirm.png` });
    record('c105447-unmerge-confirm-dialog', !!conf && /Khoản cước 100% tự động chuyển sang lô kế tiếp/.test(conf.text || ''), JSON.stringify(conf));
    if (conf?.pt) { await page.mouse.click(conf.pt.x, conf.pt.y); }
    await sleep(5000);
    await page.screenshot({ path: `${SHOTS}/02-after-unmerge.png` });
    const [a2] = await board('KBQA-REV-A');
    const [b2] = await board('KBQA-REV-B');
    const okMoney = String(b2?.thu?.cuocThu) === '1800000';
    const dissolved = !a2?.lcl?.ghépCùngRef && !b2?.lcl?.ghépCùngRef;
    record('fb095-money-promotes-to-survivor', okMoney && dissolved,
      `A.thu=${JSON.stringify(a2?.thu?.cuocThu)} A.note=${JSON.stringify(a2?.lcl?.ghépCùngRef)} B.thu=${JSON.stringify(b2?.thu?.cuocThu)} B.note=${JSON.stringify(b2?.lcl?.ghépCùngRef)}`);
  }
  // cross-customer merge block: tick A (LONG MINH) + C (Vân Trung)
  await search('KBQA-REV');
  await page.evaluate(() => {
    for (const tr of document.querySelectorAll('tr')) {
      const t = tr.textContent || '';
      const cb = tr.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (!cb) continue;
      if (/KBQA-REV-A/.test(t) && !cb.checked) cb.click();
      if (/KBQA-REV-C/.test(t) && !cb.checked) cb.click();
      if (/KBQA-REV-B/.test(t) && cb.checked) cb.click();
    }
  });
  await sleep(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /ghép cước thu khách/i.test(x.textContent || ''));
    b?.click();
  });
  await sleep(1800);
  const mixState = await page.evaluate(() => {
    const body = (document.body.textContent || '');
    const m = body.match(/Chỉ ghép cước thu[^\n]{0,80}/);
    return { err: m ? m[0] : null, dlg: !!document.querySelector('[role="dialog"]') };
  });
  await page.screenshot({ path: `${SHOTS}/03-cross-customer-blocked.png` });
  record('fb093-cross-customer-blocked', !!mixState.err, JSON.stringify(mixState) + ` · ${SHOTS}/03-cross-customer-blocked.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
