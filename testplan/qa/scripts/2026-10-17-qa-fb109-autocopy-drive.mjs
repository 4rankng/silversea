// FB-109 auto-copy + 000406 bit — add a sibling, clear, re-enter the FIRST
// declaration, witness the copy fan-out, and the missing-fields count drop.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb109ac';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 440)}`); };
const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const { token } = await r.json();
const ws = async () => (await (await fetch(`${API}/shipments/cus-workspace/876`, { headers: { Authorization: `Bearer ${token}` } })).json());
const wire = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('response', async (res) => {
    const req = res.request();
    if (req.method() !== 'GET' && res.url().includes('/api/')) {
      let body = ''; try { body = (await res.text()).slice(0, 200); } catch {}
      wire.push({ m: req.method(), u: res.url().replace(BASE, ''), s: res.status() });
    }
  });
  // A. add a sibling container via the workspace endpoint (inherits)
  const before = await ws();
  const v = before.summary.version;
  const added = await fetch(`${API}/shipments/cus-workspace/876/containers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `qa-add-cont2-${Date.now()}` }, body: JSON.stringify({ expectedShipmentVersion: v, containerNumber: 'KBQU0007776', containerTypeId: 1 }) });
  console.log('add sibling:', added.status);
  const mid = await ws();
  record('setup-sibling-added', mid.containers.length === 2 && !(mid.containers[1].declarationNumber || '').trim(), JSON.stringify(mid.containers.map((c) => ({ n: c.containerNumber, d: c.declarationNumber }))));
  // B. open the editor, CLEAR the declaration, save (the clear must persist and NOT copy)
  await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-15&transportDateTo=2026-10-25&_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'KBQU0005559');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length === 0 && /KBQU0005559/.test(document.body.textContent || ''), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const openEditor = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
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
      const ok = await page.evaluate(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0);
      if (ok) return true;
      await sleep(900);
    }
    return false;
  };
  const fillDecl = async (value) => {
    await page.evaluate((v) => {
      const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
      if (!ed) return;
      const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
      let input = null;
      if (lbl.htmlFor) input = document.getElementById(lbl.htmlFor);
      if (!input) {
        const inputs = [...ed.querySelectorAll('input, textarea')];
        input = inputs.find((i) => (lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
      }
      const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await sleep(700);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^lưu( thây đổi)?$/i.test((b.textContent || '').trim()) && (b.getAttribute('aria-label') || '').startsWith('Lưu') && !b.disabled);
      btn?.focus();
    });
    await page.keyboard.press('Enter');
    await sleep(4000);
  };
  const isOpen = await openEditor();
  record('editor-open-clear-step', isOpen, 'open documents editor');
  await fillDecl('');
  const afterClear = await ws();
  record('fb110-clear-persists-no-copy', (afterClear.containers[0].declarationNumber ?? '') === '' && (afterClear.containers[1].declarationNumber ?? '') === '',
    JSON.stringify(afterClear.containers.map((c) => ({ n: c.containerNumber, d: c.declarationNumber }))) + ` wire=${JSON.stringify(wire.slice(-3))}`);
  // C. re-enter the first declaration → the fan-out copies to the empty sibling
  wire.length = 0;
  const open2 = await openEditor();
  await fillDecl('TK-KBQA-DET3-001');
  await sleep(1500);
  const after2 = await ws();
  const both = after2.containers.filter((c) => c.declarationNumber === 'TK-KBQA-DET3-001').length;
  await page.screenshot({ path: `${SHOTS}/01-autocopy-both.png` });
  record('fb109-auto-copy-fires', both === 2, `containers=${JSON.stringify(after2.containers.map((c) => ({ n: c.containerNumber, d: c.declarationNumber })))} wire=${JSON.stringify(wire)} · ${SHOTS}/01-autocopy-both.png`);
  // D. completeness: the missing-fields count must have dropped (declaration bit cleared)
  const miss = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((rw) => /KBQU0005559/.test(rw.textContent || ''));
    const m = (tr?.textContent || '').match(/(Thiếu \d+ thông tin|Đầy đủ)/);
    return m ? m[1] : (tr?.textContent || '').slice(0, 60);
  });
  await page.screenshot({ path: `${SHOTS}/02-status-after.png` });
  record('c000406-decl-bit-cleared', /Đầy đủ|Thiếu [0-4] thông tin/.test(miss) && !/Thiếu 5/.test(miss), `missing badge=${JSON.stringify(miss)} (was 'Thiếu 5 thông tin' before the declaration; the tờ khai bit no longer counts) · ${SHOTS}/02-status-after.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
