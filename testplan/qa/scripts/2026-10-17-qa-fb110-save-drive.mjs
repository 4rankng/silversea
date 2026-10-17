// FB-110/109/000406 — drive the documents inline editor save to completion.
// Field located via label[for] → #id (precise), filled with the native setter
// (the house pattern that provably fires React onChange on this app), read
// back, saved with focus+Enter, verified on the wire + workspace API.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb110save';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 440)}`); };
const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const { token } = await r.json();
const wire = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('response', async (res) => {
    const req = res.request();
    if (req.method() !== 'GET' && res.url().includes('/api/')) {
      let body = ''; try { body = (await res.text()).slice(0, 240); } catch {}
      wire.push({ m: req.method(), u: res.url().replace(BASE, ''), s: res.status(), body });
    }
  });
  await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-15&transportDateTo=2026-10-25`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'KBQU0005559');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => (document.body.textContent || '').includes('KBQU0005559'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);

  // open the documents inline editor (retry, trusted press)
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    const pt = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('tr')].find((rw) => /KBQU0005559/.test(rw.textContent || ''));
      const b = [...(tr?.querySelectorAll('button') ?? [])].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || ''));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const rect = b.getBoundingClientRect();
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === b || b.contains(hit) || hit.contains(b))) return { synthetic: true };
      return { x: cx, y: cy };
    });
    if (pt?.synthetic) {
      await page.evaluate(() => {
        const tr = [...document.querySelectorAll('tr')].find((rw) => /KBQU0005559/.test(rw.textContent || ''));
        [...(tr?.querySelectorAll('button') ?? [])].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || ''))?.click();
      });
    } else if (pt) {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
    }
    await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0, { timeout: 6000 }).catch(() => {});
    opened = await page.evaluate(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0);
    if (!opened) await sleep(900);
  }
  record('editor-open', opened, `expanded=${opened}`);

  // locate the tờ khai input precisely via label[for] → #id
  const target = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return null;
    const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
    if (!lbl) return { no: 'label' };
    if (lbl.htmlFor) {
      const byId = document.getElementById(lbl.htmlFor);
      if (byId) return { how: 'htmlFor', id: lbl.htmlFor, value: byId.value ?? null };
    }
    // first INPUT in document order AFTER this label (labels and inputs interleave
    // in this editor; the previous wrapper-walk grabbed the Số Bill input)
    const inputs = [...ed.querySelectorAll('input, textarea')];
    const pos = inputs.filter((i) => (lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
    const input = pos[0];
    if (!input) return { no: 'input-after-label' };
    return { how: 'doc-order', value: input.value ?? null };
  });
  console.log('target:', JSON.stringify(target));

  const decl = 'TK-KBQA-DET3-001';
  // fill via native setter on the located input (inside the editor)
  const filled = await page.evaluate((decl) => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return { ok: false, why: 'no-editor' };
    const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
    if (!lbl) return { ok: false, why: 'no-label' };
    let input = null;
    if (lbl.htmlFor) input = document.getElementById(lbl.htmlFor);
    if (!input) {
      const inputs = [...ed.querySelectorAll('input, textarea')];
      input = inputs.find((i) => (lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
    }
    if (!input) return { ok: false, why: 'no-input' };
    const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, decl);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: input.value };
  }, decl);
  await sleep(800);
  // readback + save-button state
  const state = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return { open: false };
    const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
    let input = null;
    if (lbl?.htmlFor) input = document.getElementById(lbl.htmlFor);
    if (!input) {
      const inputs = [...ed.querySelectorAll('input, textarea')];
      input = inputs.find((i) => (lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
    }
    const btn = [...document.querySelectorAll('button')].find((b) => /^lưu( thây đổi)?$/i.test((b.textContent || '').trim()) && (b.getAttribute('aria-label') || '').startsWith('Lưu'));
    return { open: true, inputValue: input ? input.value : null, saveDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled') === 'true') : null };
  });
  console.log('pre-save:', JSON.stringify(state));
  await page.screenshot({ path: `${SHOTS}/01-filled.png` });
  record('fb110-input-filled-dirty', filled.ok === true && state.inputValue === decl && state.saveDisabled === false,
    `fill=${JSON.stringify(filled)} state=${JSON.stringify(state)}`);

  if (state.open && state.saveDisabled === false) {
    // save via focus + Enter (trusted keyboard activation)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^lưu( thây đổi)?$/i.test((b.textContent || '').trim()) && (b.getAttribute('aria-label') || '').startsWith('Lưu'));
      btn?.focus();
    });
    await page.keyboard.press('Enter');
    await sleep(4500);
    console.log('WIRE:', JSON.stringify(wire));
    const after = await page.evaluate(() => {
      const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
      return { editorOpen: !!ed, text: ed ? (ed.textContent || '').slice(0, 160) : null, toast: (document.querySelector('.toast-container, [aria-live]')?.textContent || '').slice(0, 120) };
    });
    console.log('after save:', JSON.stringify(after));
    await page.screenshot({ path: `${SHOTS}/02-after-save.png` });
    const ws = await page.evaluate(async () => {
      const d = await (await fetch('/api/shipments/cus-workspace/876', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).json();
      return (d.containers ?? []).map((c) => ({ n: c.containerNumber, decl: c.declarationNumber }));
    });
    const declCount = (ws ?? []).filter((c) => c.decl === decl).length;
    record('fb110-save-persists', declCount >= 1, `wire=${JSON.stringify(wire)} after=${JSON.stringify(after)} containers=${JSON.stringify(ws)}`);
    record('fb109-auto-copy-siblings', declCount >= 2, `containers with the declaration: ${declCount}/${(ws ?? []).length}`);
    // completeness flip (000406)
    await sleep(1200);
    await page.evaluate(() => {
      const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'KBQU0005559');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => (document.body.textContent || '').includes('KBQU0005559'), { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const status = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('tr')].find((rw) => /KBQU0005559/.test(rw.textContent || ''));
      if (!tr) return 'row-missing';
      const t = tr.textContent || '';
      return t.includes('Đầy đủ') ? 'Đầy đủ' : t.includes('Chưa cập nhật') ? 'Chưa cập nhật' : t.slice(0, 80);
    });
    await page.screenshot({ path: `${SHOTS}/03-complete.png` });
    record('c000406-status-flips-complete', status === 'Đầy đủ', `status=${JSON.stringify(status)} · ${SHOTS}/03-complete.png`);
  }
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
