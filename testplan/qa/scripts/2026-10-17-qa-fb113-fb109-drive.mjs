// FB-113 field order + FB-109/110 declaration persist/auto-copy + 000406 flip.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb113';
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
  await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-15&transportDateTo=2026-10-25`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'KBQA-DET');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => (document.body.textContent || '').includes('KBQU0005559'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);

  // open the documents inline editor on the DET-3 row (retry loop)
  let editorText = null;
  for (let attempt = 0; attempt < 3 && !editorText; attempt++) {
    if (attempt > 0) {
      // fresh state: reload + re-search (a second press would toggle-close)
      await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-15&transportDateTo=2026-10-25`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(4500);
      await page.evaluate(() => {
        const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(i, 'KBQA-DET');
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => (document.body.textContent || '').includes('KBQU0005559'), { timeout: 15000 }).catch(() => {});
      await sleep(1500);
    }
    const pt = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('tr')].filter((rw) => /KBQU0005559/.test(rw.textContent || ''));
      const tr = trs[0];
      if (!tr) return null;
      const b = [...tr.querySelectorAll('button')].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || ''));
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
        const trs = [...document.querySelectorAll('tr')].filter((rw) => /KBQU0005559/.test(rw.textContent || ''));
        const b = [...(trs[0]?.querySelectorAll('button') ?? [])].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || ''));
        b?.click();
      });
    } else if (pt) {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
    }
    await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0, { timeout: 5000 }).catch(() => {});
    editorText = await page.evaluate(() => {
      const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
      return ed ? (ed.textContent || '').slice(0, 100) : null;
    });
    if (!editorText) await sleep(1200);
  }
  console.log('editor:', JSON.stringify(editorText));
  const btnDump = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /lưu/i.test(b.textContent || '') || /lưu/i.test(b.getAttribute('aria-label') || '')).map((b) => ({ t: (b.textContent || '').trim().slice(0, 24), aria: b.getAttribute('aria-label'), dis: b.disabled, cls: (b.className || '').slice(0, 40) })));
  console.log('save buttons:', JSON.stringify(btnDump, null, 1));
  if (!editorText) {
    const dbg = await page.evaluate(() => ({
      url: location.href,
      rows: [...document.querySelectorAll('tbody tr')].map((r2) => (r2.textContent || '').slice(0, 70)).slice(0, 6),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => (a.textContent || '').slice(0, 140)),
      searchVal: document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]')?.value,
    }));
    console.log('DEBUG state:', JSON.stringify(dbg, null, 1));
  }

  // field order
  const labels = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    return ed ? [...ed.querySelectorAll('label')].map((l) => (l.textContent || '').trim()).filter(Boolean) : [];
  });
  await page.screenshot({ path: `${SHOTS}/01-doc-editor.png` });
  const wantOrder = ['Số Bill', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu'];
  const idx = wantOrder.map((w) => labels.findIndex((l) => l.startsWith(w)));
  const orderOk = idx.every((i2) => i2 >= 0) && idx.every((v, k) => k === 0 || v > idx[k - 1]);
  record('fb113-document-field-order', orderOk, `labels=${JSON.stringify(labels)} · ${SHOTS}/01-doc-editor.png`);

  // fill tờ khai on the first container + save
  const decl = 'TK-KBQA-DET3-001';
  let filled = false;
  if (editorText) {
    // real keyboard input — the editor's dirty flag follows native key events
    filled = await page.evaluate(() => {
      const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
      if (!ed) return false;
      const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
      if (!lbl) return false;
      let el = lbl.parentElement; let g = 0;
      while (el && g++ < 6) {
        const input = el.querySelector('input');
        if (input) {
          input.scrollIntoView({ block: 'center' });
          input.focus();
          return true;
        }
        el = el.parentElement;
      }
      return false;
    });
    if (filled) {
      await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await sleep(150);
      await page.keyboard.type(decl, { delay: 30 });
      await sleep(800);
      const readback = await page.evaluate(() => {
        const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
        const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
        let el = lbl?.parentElement; let g = 0;
        while (el && g++ < 6) {
          const input = el.querySelector('input');
          if (input) return { value: input.value, active: document.activeElement === input };
          el = el.parentElement;
        }
        return { value: null };
      });
      console.log('input readback:', JSON.stringify(readback));
    }
  }
  let saveState = null;
  if (editorText) {
    saveState = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^lưu( thây đổi)?$/i.test((b.textContent || '').trim()) && (b.getAttribute('aria-label') || '').startsWith('Lưu'));
      if (!btn) return { found: false };
      btn.focus();
      return { found: true, disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true' };
    });
    if (saveState.found && !saveState.disabled) {
      await page.keyboard.press('Enter');
    }
  }
  await sleep(4000);
  console.log('WIRE after save:', JSON.stringify(wire));
  const editorErr = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    return ed ? { open: true, text: (ed.textContent || '').slice(0, 200) } : { open: false };
  });
  console.log('editor after save:', JSON.stringify(editorErr));
  // verify via API: both containers carry the declaration (persist + auto-copy)
  const persist = await page.evaluate(async () => {
    const detail = await (await fetch('/api/shipments/cus-workspace/876', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).json();
    return (detail.containers ?? []).map((c) => ({ n: c.containerNumber, decl: c.declarationNumber }));
  });
  const declCount = (persist ?? []).filter((c) => c.decl === decl).length;
  record('fb110-declaration-persists', filled === true && saveState?.found && !saveState.disabled && declCount >= 1, `filled=${filled} save=${JSON.stringify(saveState)} containers=${JSON.stringify(persist)}`);
  record('fb109-auto-copy-to-empty-containers', declCount >= 2, `containers with the declaration: ${declCount}/${(persist ?? []).length} (empty siblings auto-filled, per-container divergence preserved separately)`);

  // completeness flip
  await sleep(1200);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'KBQA-DET');
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
  await page.screenshot({ path: `${SHOTS}/02-det3-complete.png` });
  record('c000406-cont-declaration-clears-missing', status === 'Đầy đủ', `status=${JSON.stringify(status)} · ${SHOTS}/02-det3-complete.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
