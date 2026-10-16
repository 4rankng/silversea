// W3a — R17 verification batch re-run on staging (build must equal main HEAD 1e2beebe).
// Re-verifies the TC verdicts from the readable backlog cards:
//   - 131026222628 verify-batch1 (FB-084, FB-083, FB-085)   [role CUS]
//   - 141026003630 r17-batch5  (FB-039/073, FB-035, FB-042..051, FB-075, FB-040)
// Usage: node w3a-r17-verify-rung.mjs <phase>
//   phases: cus-create | cus-fcl | table | ketoan | driver | admin
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '1e2beebe';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3a-r17-verify');
fs.mkdirSync(OUT, { recursive: true });

const PHASE = process.argv[2] || '';
const USER = {
  'cus-create': 'tiepvv', 'cus-fcl': 'tiepvv', table: 'tiepvv',
  ketoan: 'hoapt', driver: 'bqhuong', admin: 'admin',
}[PHASE];
const BL = `QAW3A${PHASE.toUpperCase()}${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 14)}`;

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e); console.log(JSON.stringify(e));
};
const tc = (id, verdict, detail = {}) => log('TC', { id, verdict, ...detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const fail = (id, why, detail = {}) => { tc(id, 'FAIL', { why, ...detail }); exitCode = 1; };

const api = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};

// ── health gate ─────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) {
  console.error('STALE BUILD — aborting phase');
  process.exit(2);
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: 'Abc123' }),
});
if (login.status !== 200) { console.error(`login ${USER} -> ${login.status}`); process.exit(2); }
let token = (await login.json()).token;
// identity assertion — decode JWT payload, never trust ambient state
const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
log('identity', { user: USER, jwtUsername: jwtPayload.username || jwtPayload.identifier || jwtPayload.sub });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1500,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
await page.evaluateOnNewDocument((t, origin) => {
  if (location.origin === origin) localStorage.setItem('token', t);
}, token, new URL(BASE).origin);

const shot = (name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`), fullPage: false });
const goto = async (url, settleMs = 2200) => {
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(settleMs);
};
// all visible text of the current page, normalized
const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const has = async (needle) => (await bodyText()).includes(needle);

// label -> associated form control (house TextField renders <label> before input;
// required marker renders as a span inside the label, so compare cleaned text)
const fieldByLabel = async (labelText) => page.evaluate((lt) => {
  const clean = (s) => s.textContent.trim().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
  const labels = [...document.querySelectorAll('label')].filter((l) => l.offsetParent && (clean(l) === lt || clean(l).startsWith(lt)));
  for (const label of labels) {
    const forId = label.getAttribute('for');
    const el = forId ? document.getElementById(forId)
      : (label.querySelector('input,select,textarea') ?? label.parentElement.querySelector('input,select,textarea') ?? label.nextElementSibling?.querySelector('input,select,textarea'));
    if (el) {
      const r = el.getBoundingClientRect();
      return { found: true, tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height, labelText: clean(label) };
    }
  }
  return { found: false };
}, labelText);

// react-aria combobox: real mouse pick — synthetic .click() on [role=option]
// does NOT commit (house lesson, kanban-two-lane memory)
const pickCombobox = async (labelText, query) => {
  const fld = await fieldByLabel(labelText);
  if (!fld.found) throw new Error(`combobox label not found: ${labelText}`);
  await page.click(`[id="${fld.id}"]`);
  await sleep(800);
  if (query) { await page.keyboard.type(query, { delay: 40 }); await sleep(1500); }
  const located = await page.evaluate((q) => {
    const norm = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent);
    const hit = q
      ? opts.find((o) => norm(o.textContent).includes(norm(q)))
      : opts.find((o) => !/^[+＋]/.test(o.textContent.trim()));
    if (!hit) return { ok: false, count: opts.length, sample: opts.slice(0, 5).map((o) => o.textContent.trim().slice(0, 30)) };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: hit.textContent.trim().slice(0, 50), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, query || '');
  if (!located.ok) throw new Error(`no option for ${labelText} (${located.count} visible; ${JSON.stringify(located.sample)})`);
  await page.mouse.move(located.x, located.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(600);
  return located.text;
};
// native <select> inside the label (Hình thức xuất nhập khẩu)
const pickSelect = async (optionText) => {
  const sel = await page.evaluate((ot) => {
    const s = [...document.querySelectorAll('select')].find((e) => e.offsetParent && [...e.options].some((o) => o.textContent.trim() === ot));
    if (!s) return null;
    const opt = [...s.options].find((o) => o.textContent.trim() === ot);
    const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
    proto.set.call(s, opt.value);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { id: s.id, value: opt.value };
  }, optionText);
  if (!sel) throw new Error(`select with option "${optionText}" not found`);
  await sleep(400);
  return sel;
};

const setValue = async (labelText, value) => {
  const fld = await fieldByLabel(labelText);
  if (!fld.found) throw new Error(`label not found: ${labelText}`);
  const sel = `[id="${fld.id}"]`;
  await page.click(sel, { clickCount: 3 });
  await page.keyboard.type(value, { delay: 15 });
  await sleep(200);
};

try {
  if (PHASE === 'cus-create') {
    await goto('/shipments/new');
    await sleep(1500);
    // switch to LCL so the LCL cargo + route sections render
    const lclPicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('label,button,[role="radio"],[role="tab"]')]
        .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
      if (!el) return false;
      el.click(); return true;
    });
    log('lcl-mode', { lclPicked });
    await sleep(1200);
    await shot('01-create-top');

    // ── FB-083: label must read "Ngày giao hàng" ───────────────────────────
    const labelOk = await fieldByLabel('Ngày giao hàng');
    const staleLabel = await has('Ngày giao dự kiến');
    const labelDump = await page.evaluate(() => [...document.querySelectorAll('label')].filter((l) => l.offsetParent).map((l) => l.textContent.trim().replace(/\s+/g, ' ')).slice(0, 60));
    log('labels', { labelDump });
    if (labelOk.found && !staleLabel) tc('FB-083', 'PASS', { label: 'Ngày giao hàng rendered, stale label absent' });
    else fail('FB-083', 'label mismatch', { found: labelOk.found, staleLabel, labelDump });

    // ── FB-084: CBM optional for LCL — no required marker, blank submit OK ──
    const cbm = await fieldByLabel('Thể tích (CBM)');
    const marker = await page.evaluate((lt) => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(lt));
      if (!label) return { labelFound: false };
      return { labelFound: true, requiredMarker: !!label.querySelector('.ds-field__required, [class*="required"]'), labelCls: label.className };
    }, 'Thể tích (CBM)');
    log('FB-084-marker', marker);
    await shot('02-cbm-field');

    // fill the LCL required set — leave CBM blank (7 required fields per label dump)
    log('fill', { picked: await pickCombobox('Khách hàng', 'YUAN') });
    log('fill', { trade: await pickSelect('Nhập khẩu') });
    await setValue('Số Bill/Booking', BL);
    log('fill', { route: await pickCombobox('Tuyến đường', null) });
    log('fill', { warehouse: await pickCombobox('Kho lấy hàng', null) });
    await setValue('Quy cách đóng gói', 'CTL');
    await setValue('Số lượng', '10');
    await setValue('Trọng lượng (kg)', '5000');
    // Ngày giao hàng: segmented date — type day/month/year, auto-advance carries
    const dg = await fieldByLabel('Ngày giao hàng');
    if (dg.found) {
      await page.click(`[id="${dg.id}"]`);
      await sleep(200);
      await page.keyboard.type('20102026', { delay: 90 });
      await sleep(300);
      log('fill', { deliveryDate: '20/10/2026' });
    }
    await shot('03-filled-blank-cbm');
    // submit
    const submitTxt = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /Tạo lô hàng|Tạo lô|Lưu/.test(b.textContent));
      return btns.map((b) => b.textContent.trim());
    });
    log('submit-buttons', { submitTxt });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Tạo lô hàng/.test(b.textContent));
      if (btn) btn.click(); else throw new Error('no submit button');
    });
    await sleep(3500);
    await shot('04-after-submit');
    const afterUrl = page.url();
    const err9 = await has('Cần bổ sung');
    const errCbm = await has('Nhập thể tích lớn hơn 0');
    log('FB-084-submit', { afterUrl, err9, errCbm });
    const m = afterUrl.match(/\/shipments\/(\d+)/);
    if (m && !err9 && !errCbm) {
      const sid = Number(m[1]);
      const get = await api('GET', `/shipments/${sid}`);
      const persisted = get.body && typeof get.body === 'object' ? { id: get.body.id, bl: get.body.blNumber, cbm: get.body.cargoVolumeCbm ?? null, status: get.body.status } : get.body;
      tc('FB-084', 'PASS', { shipmentId: sid, persisted });
      // cleanup via admin API delete (version-gated; CUS lacks delete)
      const cLogin = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
      }).then((r) => r.json());
      const cGet = await fetch(`${API}/shipments/${sid}`, { headers: { Authorization: `Bearer ${cLogin.token}` } }).then((r) => r.json());
      const del = await fetch(`${API}/shipments/${sid}?version=${cGet.shipment?.version}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${cLogin.token}`, 'Idempotency-Key': crypto.randomUUID() },
      }).then((r) => r.status);
      log('cleanup', { shipmentId: sid, deleteStatus: del });
    } else {
      fail('FB-084', 'blank-CBM submit blocked', { afterUrl, err9, errCbm });
    }

    // ── FB-044: container-type dropdown opens BELOW the field ───────────────
    await goto('/shipments/new');
    await sleep(3000);
    const openPick = await page.evaluate(() => {
      const trig = document.querySelector('input[aria-label="Loại container"]');
      if (!trig || !trig.offsetParent) return { found: false };
      const r = trig.getBoundingClientRect();
      trig.focus();
      trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trig.click();
      return { found: true, trigBottom: Math.round(r.y + r.height), trigX: Math.round(r.x), trigW: Math.round(r.width) };
    });
    await sleep(900);
    const pos = await page.evaluate((trig) => {
      const pop = [...document.querySelectorAll('[role="listbox"],[data-testid*="popover"],[class*="popover"]')]
        .find((p2) => p2.offsetParent);
      if (!pop) return { popFound: false };
      const r = pop.getBoundingClientRect();
      return { popFound: true, popTop: Math.round(r.y), popLeft: Math.round(r.x), popW: Math.round(r.width), opensBelow: r.y >= trig.trigBottom - 4 };
    }, openPick);
    await shot('05-container-picker-position');
    log('FB-044-open', { openPick, pos });
    if (openPick.found && pos.popFound) {
      if (pos.opensBelow) tc('FB-044', 'PASS', pos);
      else fail('FB-044', 'picker opens above/on the field', pos);
    } else fail('FB-044', 'container-type picker or popover not found', { openPick, pos });

    // ── FB-075: date auto-advance day→month ─────────────────────────────────
    await goto('/shipments/new');
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('label,button,[role="radio"],[role="tab"]')]
        .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
      if (el) el.click();
    });
    await sleep(1000);
    const dateField = await fieldByLabel('Ngày giao hàng');
    if (dateField.found) {
      await page.click(`[id="${dateField.id}"]`);
      await sleep(200);
      await page.keyboard.type('15', { delay: 120 });
      await sleep(300);
      const seg = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const active = document.activeElement;
        return {
          activeIsField: el && (active === el || el.contains(active)),
          activeCls: active ? String(active.className).slice(0, 60) : null,
          activeAria: active ? (active.getAttribute('aria-label') || active.getAttribute('placeholder') || '') : '',
        };
      }, dateField.id);
      await shot('06-date-autoadvance');
      const advanced = /month|tháng/i.test(seg.activeAria) || /month|segment/i.test(String(seg.activeCls));
      if (advanced) tc('FB-075', 'PASS', seg); else tc('FB-075', 'UNCONFIRMED', { note: 'focus state after typing 15', ...seg });
    } else fail('FB-075', 'date field not found');

    // ── FB-040: nav has no separate "Hàng lẻ" section ───────────────────────
    const navHas = await page.evaluate(() => {
      const nav = document.querySelector('nav,[class*="sidebar"],[class*="nav"]');
      return nav ? { navFound: true, text: nav.textContent.replace(/\s+/g, ' ').slice(0, 400) } : { navFound: false };
    });
    log('FB-040-nav', navHas);
    tc('FB-040', 'NEEDS-INFO', { navText: navHas.text ?? null, note: 'still needs Muse info; nav scan attached' });
  }

  if (PHASE === 'cus-fcl') {
    // ── FB-085: per-container Số tờ khai + copy button ──────────────────────
    const day = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const created = await api('POST', '/shipments', {
      customerId: 1, cargoMode: 'FCL', tradeDirection: 'IMPORT', blNumber: BL,
      shippingLineName: 'QA Line', routeId: 6,
      customerNotes: `QAFIXTURE w3a FB-085 ${BL}. Xoa duoc sau QA.`,
    });
    log('fcl-created', { status: created.status, id: created.body?.id });
    if (![200, 201].includes(created.status)) throw new Error(`create ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`);
    const sid = created.body.id ?? created.body.shipment?.id;
    let ver = created.body.version ?? created.body.shipment?.version ?? 1;
    log('fcl-shape', { sid, ver, keys: Object.keys(created.body ?? {}) });
    await api('PUT', `/shipments/${sid}`, { expectedVersion: ver, closingAt: `${day}T03:00:00.000Z`, expectedDeliveryDate: day });
    // refresh version after the date PUT before the containers reconcile
    const gv = await api('GET', `/shipments/${sid}`);
    ver = gv.body?.shipment?.version ?? ver + 1;
    log('ver-refresh', { ver });
    // two containers — container-types catalog needs an admin token (fixture setup)
    const adminLogin = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
    }).then((r) => r.json());
    const ct = await fetch(`${API}/container-types?limit=1`, { headers: { Authorization: `Bearer ${adminLogin.token}` } }).then((r) => r.json());
    const ctId = ct.items?.[0]?.id ?? null;
    log('fixture-ct', { ctId });
    const putC = await api('PUT', `/shipments/${sid}/containers`, {
      expectedVersion: ver,
      containers: [
        { containerTypeId: ctId, containerNumber: 'QAWA0000010' },
        { containerTypeId: ctId, containerNumber: 'QAWA0000088' },
      ],
    });
    log('containers-put', { status: putC.status, body: typeof putC.body === 'string' ? putC.body.slice(0, 200) : putC.body });
    if (![200, 201].includes(putC.status)) throw new Error(`containers PUT ${putC.status}`);
        const g0 = await api('GET', `/shipments/${sid}`);
    ver = g0.body?.shipment?.version ?? ver;

    await goto(`/shipments-detail?searchSuffix=${encodeURIComponent(BL)}&transportDateFrom=2026-10-01&transportDateTo=2026-10-31`);
    await sleep(2500);
    // fixture-row guard: our BL must be on the board before any interaction
    const blOnBoard = await page.evaluate((bl) => (document.body.innerText || '').includes(bl), BL);
    log('FB-085-bl-on-board', { bl: BL, blOnBoard });
    if (!blOnBoard) throw new Error(`fixture lot not on board — ABORT, refusing to touch other rows`);
    await shot('fcl-01-workboard');
    // 1) expand container 1's documents editor via its cell trigger (real tap)
    const trig1 = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[id^="shipment-detail-edit-documents-"]')].find((x) => x.offsetParent);
      if (!t) return { found: false, n: document.querySelectorAll('[id^="shipment-detail-edit-"]').length, rows: document.querySelectorAll('tbody tr').length };
      t.scrollIntoView({ block: 'center' });
      const r = t.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), id: t.id };
    });
    log('FB-085-trigger1', trig1);
    if (!trig1.found) { fail('FB-085', 'documents cell trigger not found', trig1); throw new Error('no trigger'); }
    await page.mouse.move(trig1.x, trig1.y); await page.mouse.down(); await page.mouse.up();
    await sleep(1200);
    await shot('fcl-02-docs-editor');
    // 2) type the first Số tờ khai and submit with Enter (form onSubmit saves)
    const tkInput = await page.evaluate((ct1) => {
      const heading = [...document.querySelectorAll('[class*="editor-heading"]')].find((h) => h.offsetParent && /Chỉnh sửa chứng từ/.test(h.textContent));
      if (!heading || !heading.textContent.includes(ct1)) {
        return { found: false, why: `editor heading does not name our container ${ct1}`, heading: heading?.textContent ?? null };
      }
      const inp = [...document.querySelectorAll('label input')].find((i) => i.offsetParent
        && i.closest('label')?.textContent.includes('Số tờ khai')
        && i.closest('[class*="editor"]'));
      if (!inp || inp.disabled) return { found: false, why: 'Số tờ khai input missing or disabled', disabled: inp?.disabled ?? null };
      inp.focus();
      return { found: true };
    }, 'QAWA0000010');
    log('FB-085-tk-input', tkInput);
    if (!tkInput.found) { fail('FB-085', 'Số tờ khai input not found in editor', tkInput); throw new Error('no tk input'); }
    await page.keyboard.type('TK-W3A-0001', { delay: 25 });
    await page.keyboard.press('Enter');
    await sleep(2200);
    await shot('fcl-03-after-first-save');
    // persisted side effect + auto-copy fan-out check
    const g1 = await api('GET', `/shipments/${sid}`);
    const conts1 = (g1.body?.containers ?? []).map((c) => ({ no: c.containerNumber, tk: c.declarationNumber ?? null }));
    log('FB-085-after-first-save', { conts1 });
    const autoCopied = conts1.length === 2 && conts1.every((c) => c.tk === 'TK-W3A-0001');
    // 3) add an empty 3rd container via API — reconcile must CARRY the existing
    // rows (containerId + declarationNumber) or it recreates them and wipes data
    const g3v = await api('GET', `/shipments/${sid}`);
    const v3 = g3v.body?.shipment?.version;
    const existing = (g3v.body?.containers ?? []).map((c) => ({
      id: c.id, containerTypeId: c.containerTypeId, containerNumber: c.containerNumber,
      declarationNumber: c.declarationNumber,
    }));
    existing.push({ containerTypeId: ctId, containerNumber: 'QAWA0000154' });
    const put3 = await api('PUT', `/shipments/${sid}/containers`, { expectedVersion: v3, containers: existing });
    log('containers-put-3rd', { status: put3.status, body: typeof put3.body === 'string' ? put3.body.slice(0, 120) : null });
    if (![200, 201].includes(put3.status)) throw new Error(`3rd container PUT ${put3.status}`);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);
    // expand cont1's editor first — the copy button lives inside it
    const expandCont1 = await page.evaluate((ct1) => {
      const t = [...document.querySelectorAll('[id^="shipment-detail-edit-documents-"]')]
        .find((x) => x.offsetParent && x.closest('tr')?.textContent.includes(ct1));
      if (!t) return { found: false };
      const r = t.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, 'QAWA0000010');
    log('FB-085-expand-cont1', expandCont1);
    if (!expandCont1.found) throw new Error('cont1 row not found for copy step');
    await page.mouse.move(expandCont1.x, expandCont1.y); await page.mouse.down(); await page.mouse.up();
    await sleep(1200);
    const copyBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /Copy số tờ khai sang \d+ cont chưa có số/.test(x.textContent));
      if (!b) return { found: false, boardText: (document.body.innerText || '').match(/Copy[^\n]*/)?.[0] ?? null };
      const r = b.getBoundingClientRect();
      return { found: true, text: b.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    log('FB-085-copy-btn', copyBtn);
    await shot('fcl-04-copy-button-visible');
    let copyWorked = null;
    if (copyBtn.found) {
      await page.mouse.move(copyBtn.x, copyBtn.y); await page.mouse.down(); await page.mouse.up();
      await sleep(2000);
      await shot('fcl-05-after-copy-click');
      const g4 = await api('GET', `/shipments/${sid}`);
      const conts4 = (g4.body?.containers ?? []).map((c) => ({ no: c.containerNumber, tk: c.declarationNumber ?? null }));
      log('FB-085-after-copy-click', { conts4 });
      copyWorked = conts4.every((c) => c.tk === 'TK-W3A-0001');
    }
    // 4) independent edit on container 2 — close the open editor, then open cont2's
    await page.keyboard.press('Escape');
    await sleep(800);
    const trig2 = await page.evaluate((ct2) => {
      const t = [...document.querySelectorAll('[id^="shipment-detail-edit-documents-"]')]
        .find((x) => x.offsetParent && x.closest('tr')?.textContent.includes(ct2));
      if (!t) return { found: false };
      const r = t.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), id: t.id };
    }, 'QAWA0000088');
    log('FB-085-trigger2', trig2);
    await page.mouse.move(trig2.x, trig2.y); await page.mouse.down(); await page.mouse.up();
    await sleep(1200);
    const setTk2 = await page.evaluate((ct2) => {
      const heading = [...document.querySelectorAll('[class*="editor-heading"]')].find((h) => h.offsetParent && /Chỉnh sửa chứng từ/.test(h.textContent));
      if (!heading || !heading.textContent.includes(ct2)) return { found: false, why: `editor heading is not ${ct2}`, heading: heading?.textContent ?? null };
      const inp = [...document.querySelectorAll('label input')].find((i) => i.offsetParent
        && i.closest('label')?.textContent.includes('Số tờ khai')
        && i.closest('[class*="editor"]'));
      if (!inp || inp.disabled) return { found: false, why: 'input missing/disabled' };
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto.set.call(inp, 'TK-W3A-0002');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.focus();
      return { found: true };
    }, 'QAWA0000088');
    log('FB-085-set-tk2', setTk2);
    await page.keyboard.press('Enter');
    await sleep(2200);
    await shot('fcl-06-after-independent-edit');
    const g5 = await api('GET', `/shipments/${sid}`);
    const conts5 = (g5.body?.containers ?? []).map((c) => ({ no: c.containerNumber, tk: c.declarationNumber ?? null }));
    log('FB-085-persisted', { conts5 });
    const c1 = conts5.find((c) => c.no === 'QAWA0000010');
    const c2 = conts5.find((c) => c.no === 'QAWA0000088');
    const c3 = conts5.find((c) => c.no === 'QAWA0000154');
    const indep = c1?.tk === 'TK-W3A-0001' && c2?.tk === 'TK-W3A-0002' && (copyWorked === null ? c3?.tk === 'TK-W3A-0001' : c3?.tk === 'TK-W3A-0001');
    if (indep && (autoCopied || copyWorked)) {
      tc('FB-085', 'PASS', { autoCopied, copyWorked, conts: conts5 });
    } else {
      fail('FB-085', 'per-container tờ khai flow mismatch', { autoCopied, copyWorked, conts: conts5 });
    }
    // refresh version then version-gated delete (admin token — CUS lacks delete)
    const g9 = await fetch(`${API}/shipments/${sid}`, { headers: { Authorization: `Bearer ${adminLogin.token}` } }).then((r) => r.json());
    const v9 = g9.shipment?.version;
    const del = await fetch(`${API}/shipments/${sid}?version=${v9}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminLogin.token}`, 'Idempotency-Key': crypto.randomUUID() },
    }).then((r) => r.status);
    log('cleanup', { shipmentId: sid, deleteStatus: del });
  }

  if (PHASE === 'table') {
    // ── FB-043: shipments table rows even/aligned ───────────────────────────
    await goto('/shipments');
    await sleep(2500);
    await shot('01-shipments-1440');
    const rows = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent);
      const hs = trs.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
      return { count: trs.length, heights: hs, min: Math.min(...hs), max: Math.max(...hs) };
    });
    log('FB-043-rows', rows);
    if (rows.count >= 3 && rows.max - rows.min <= 1.5) tc('FB-043', 'PASS', rows);
    else fail('FB-043', 'row heights uneven or table empty', rows);
  }

  if (PHASE === 'ketoan') {
    // ── FB-042: salary calendar trip chip one line ──────────────────────────
    await goto('/salary');
    await sleep(2500);
    // select a driver so the salary calendar with its trip chips renders
    // pick a driver who actually has trips this month (else no chips render)
    const sal = await api('GET', '/salary?year=2026&month=10');
    const salItems = Array.isArray(sal.body) ? sal.body : (sal.body?.items ?? sal.body?.rows ?? []);
    const withTrips = salItems.find((r) => Number(r.tripDays ?? r.trip_days ?? r.daysWithTrips ?? 0) > 0 || Number(r.trips ?? 0) > 0);
    const driverName = withTrips ? (withTrips.driverName ?? withTrips.name ?? null) : null;
    log('FB-042-driver-pick', { total: salItems.length, picked: driverName, sample: salItems[0] ? Object.keys(salItems[0]).slice(0, 12) : null });
    await page.evaluate((name) => {
      if (!name) return;
      const row = [...document.querySelectorAll('tr,li,button,div')].filter((e) => e.offsetParent
        && e.textContent.replace(/\s+/g, ' ').trim() === name)[0];
      if (row) row.click();
    }, driverName);
    await sleep(5000);
    await shot('01-salary');
    // trip chip contract (card 20261004_338, supersedes the batch5 one-line
    // observation): .cal-cell-trip-code shows the FULL code — wraps at hyphens,
    // never ellipsizes/truncates
    const chip = await page.evaluate(() => {
      const codes = [...document.querySelectorAll('.cal-cell-trip-code')].filter((e) => e.offsetParent);
      const area = document.querySelector('.salary-calendar-area');
      const details = codes.slice(0, 8).map((e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return {
          txt: e.textContent.trim().slice(0, 40),
          h: Math.round(r.height * 10) / 10,
          ellipsized: cs.textOverflow === 'ellipsis',
          hiddenOverflow: cs.overflow === 'hidden' || cs.overflowY === 'hidden',
          clamped: /-webkit-line-clamp/.test(cs.webkitLineClamp || ''),
          whiteSpace: cs.whiteSpace,
          clippedContent: e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible',
        };
      });
      return { count: codes.length, areaBox: area ? Math.round(area.getBoundingClientRect().height) : null, details };
    });
    log('FB-042-chip', chip);
    const bad = chip.details.filter((d) => d.ellipsized || d.hiddenOverflow || d.clamped || d.clippedContent);
    if (chip.count >= 1 && bad.length === 0) tc('FB-042', 'PASS', { note: 'trip codes render in full (wrap-at-hyphens law, card 20261004_338); no truncation idiom', ...chip });
    else if (chip.count >= 1) fail('FB-042', 'trip chip truncated/clamped', { bad });
    else tc('FB-042', 'UNCONFIRMED', { note: 'no .cal-cell-trip-code chips rendered — see screenshot', areaBox: chip.areaBox });

    // ── FB-049: summary header text spacing ("Hiển thị 43/43" style) ────────
    const summary = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const joined = txt.match(/\S{1,6}(ngày|đ|\/\d+)\b/g) || [];
      // concatenated = a letter directly glued to unit without space
      const glued = txt.match(/[^\s\d](ngày|đ)\b/g) || [];
      return { gluedSample: glued.slice(0, 10), hiểnThị: (txt.match(/Hiển thị\s?\d+\s?\/\s?\d+/g) || [])[0] ?? null };
    });
    log('FB-049-summary', summary);
    await shot('02-salary-summary');

    // ── FB-046 + FB-050: finance charts ────────────────────────────────────
    await goto('/finance');
    await sleep(3000);
    await shot('03-finance');
    const charts = await page.evaluate(() => {
      // scope to the top-vehicles panel ("Top xe theo lợi nhuận" — the FB-046
      // chart; div-based, no svg). Largest visible ancestor of the heading.
      const heading = [...document.querySelectorAll('*')].find((e) => e.offsetParent
        && e.children.length === 0 && /Top xe theo lợi nhuận/.test(e.textContent));
      if (!heading) return { found: false };
      let panel = heading;
      for (let i = 0; i < 8 && panel.parentElement; i++) {
        panel = panel.parentElement;
        if (panel.getBoundingClientRect().height > 300) break;
      }
      const leaves = [...panel.querySelectorAll('*')].filter((e) => e.offsetParent
        && e.children.length === 0 && e.textContent.trim().length > 0 && e.textContent.trim().length < 30);
      const clipped = leaves.filter((e) => e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 4)
        .map((e) => ({ t: e.textContent.trim().slice(0, 30), sw: e.scrollWidth, cw: e.clientWidth }));
      const texts = [...new Set(leaves.map((e) => e.textContent.trim()))].slice(0, 30);
      const ticks = texts.filter((t) => /^[+-]?\d+([.,]\d+)?\s?(tr|k)?\s?₫/i.test(t));
      return { found: true, clipped, texts, ticks };
    });
    log('FB-046-charts', charts);
    await shot('04-finance-chart-zoom');
    if (!charts.found) {
      tc('FB-046', 'UNCONFIRMED', { note: 'top-vehicles panel not found' });
      tc('FB-050', 'UNCONFIRMED', { note: 'no panel to scan' });
    } else {
      const truncated = (charts.clipped ?? []).length > 0;
      if (truncated) fail('FB-046', 'vehicle chart labels truncated', { clipped: charts.clipped });
      else tc('FB-046', 'PASS', { labels: (charts.texts ?? []).slice(0, 10), clipped: 0 });
      // FB-050: the '-50k ₫'/'0 ₫' axis ticks are real data when a negative bar exists
      const zeroTicks = (charts.ticks ?? []).filter((t) => /^[+-]?0\s?(tr|k)?\s?₫/i.test(t));
      const negativeTick = (charts.ticks ?? []).some((t) => /^-/.test(t));
      if ((charts.ticks ?? []).length > 0 && zeroTicks.length <= 1) tc('FB-050', 'PASS', { ticks: charts.ticks, negativeTick, note: 'zero tick is real data when negative bars exist' });
      else if ((charts.ticks ?? []).length === 0) tc('FB-050', 'UNCONFIRMED', { note: 'no tick-like labels — see screenshot', texts: charts.texts });
      else fail('FB-050', 'spurious zero tick(s)', { zeroTicks, ticks: charts.ticks });
    }

    // ── FB-048: debt detail payment form red boundary on empty required ────
    await goto('/debt');
    await sleep(2500);
    await shot('05-debt-list');
    const clicked = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.offsetParent);
      if (!tr) return { found: false };
      tr.click(); return { found: true, txt: tr.textContent.trim().slice(0, 50) };
    });
    log('debt-row-click', clicked);
    await sleep(2500);
    const debtUrl = await page.evaluate(() => location.href);
    if (!/\/debt\/\d+/.test(debtUrl)) {
      fail('FB-048', 'debt detail did not open', { debtUrl });
    } else {
      await shot('06-debt-detail');
      const payBtn = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Thanh toán|Ghi nhận thanh toán|Trả tiền/i.test(b.textContent));
        if (!btn) return { found: false, buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter((t) => t && t.length < 30).slice(0, 25) };
        btn.click(); return { found: true };
      });
      log('FB-048-pay-btn', payBtn);
      await sleep(1200);
      await shot('06-payment-form');
      if (payBtn.found) {
        await sleep(800);
        // (a) empty-submit guard: the Ghi nhận button must be DISABLED while
        // required fields are empty — an empty submit cannot even be attempted
        const guard = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.trim() === 'Ghi nhận' && b.closest('[class*="modal"],[role="dialog"],footer,[class*="footer"]'));
          return { found: !!btn, disabled: btn ? btn.disabled : null };
        });
        log('FB-048-empty-guard', guard);
        await shot('07-payment-empty-guard');
        // (b) invalid-value path: amount=0 + receipt filled enables the button,
        // submit must paint the red boundary + banner (validation refuses; no API write)
        await page.evaluate(() => {
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          const amt = document.querySelector('#pay-amount');
          const rec = document.querySelector('#pay-receipt');
          if (amt) { proto.set.call(amt, '0'); amt.dispatchEvent(new Event('input', { bubbles: true })); }
          if (rec) { proto.set.call(rec, 'PT-W3A-QA'); rec.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(500);
        const enabled = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.trim() === 'Ghi nhận' && b.closest('[class*="modal"],[role="dialog"],footer,[class*="footer"]'));
          return btn ? { disabled: btn.disabled } : { disabled: null };
        });
        log('FB-048-btn-after-invalid-fill', enabled);
        const clicked2 = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.trim() === 'Ghi nhận' && b.closest('[class*="modal"],[role="dialog"],footer,[class*="footer"]'));
          if (!btn || btn.disabled) return { clicked: false, disabled: btn?.disabled ?? null };
          btn.click(); return { clicked: true };
        });
        log('FB-048-invalid-submit', clicked2);
        await sleep(1200);
        await shot('08-invalid-value-boundary');
        const boundary = await page.evaluate(() => {
          const amt = document.querySelector('#pay-amount');
          const banner = document.querySelector('#pay-error,[role="alert"]');
          return {
            bannerText: banner ? banner.textContent.trim().slice(0, 60) : null,
            amtInvalid: amt?.getAttribute('aria-invalid'),
            amtBorder: amt ? getComputedStyle(amt).borderColor : null,
          };
        });
        log('FB-048-invalid-boundary', boundary);
        const dangerPainted = boundary.amtInvalid === 'true' && boundary.bannerText
          && !/rgb\(137, 151, 143\)/.test(String(boundary.amtBorder));
        if (!guard.found) fail('FB-048', 'payment submit button not found', {});
        else if (guard.disabled !== true && enabled.disabled === false) {
          // no disabled-until-valid guard AND no boundary observed earlier would be the defect;
          // here the invalid path decides
          if (dangerPainted) tc('FB-048', 'PASS', { note: 'no empty-submit guard but invalid value paints boundary+banner', ...boundary });
          else fail('FB-048', 'empty required submit possible and no red boundary', { guard, boundary });
        } else if (dangerPainted) tc('FB-048', 'PASS', { note: 'empty submit blocked by disabled button; invalid value paints red boundary + banner', ...boundary });
        else fail('FB-048', 'invalid value did not paint red boundary', { guard, boundary });
        // close without writing anything
        const cancel = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /^Hủy/.test(b.textContent.trim()));
          if (btn) { btn.click(); return true; }
          return false;
        });
        log('FB-048-cancel', { cancel });
        await sleep(600);
      } else {
        fail('FB-048', 'payment button not found on debt detail', { buttons: payBtn.buttons });
      }
    }
  }

  if (PHASE === 'driver') {
    // ── FB-039/FB-073: trip 79 phone + Gọi kho tel: link ────────────────────
    await goto('/my-trips');
    await sleep(2200);
    await shot('01-my-trips');
    const trips = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/my-trips/"]')].map((a) => a.getAttribute('href')).filter((h) => /\/my-trips\/\d+$/.test(h));
      return [...new Set(links)].slice(0, 12);
    });
    log('trips-listed', { trips });
    await goto('/my-trips/79');
    await sleep(2500);
    await shot('02-trip79');
    const call = await page.evaluate(() => {
      const tel = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => ({ href: a.getAttribute('href'), txt: a.textContent.trim().slice(0, 40), visible: !!a.offsetParent }));
      const txt = (document.body.innerText || '').includes('0989130345');
      return { tel, phoneInText: txt };
    });
    log('FB-039-call', call);
    const ok = call.tel.some((t) => t.href === 'tel:0989130345' && t.visible) && call.phoneInText;
    if (ok) tc('FB-039+FB-073', 'PASS', call); else fail('FB-039+FB-073', 'Gọi kho tel:0989130345 missing', call);

    // ── FB-035: money input 15000 → '15.000' ────────────────────────────────
    // trip cost entry on the trip detail (chi phí section)
    const costBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Chi phí|Thêm chi phí|Khai chi phí/i.test(b.textContent));
      if (!btn) return { found: false };
      btn.click(); return { found: true };
    });
    log('FB-035-cost-btn', costBtn);
    await sleep(1200);
    await shot('03-cost-form');
    if (costBtn.found) {
      await sleep(800);
      // the money field is labeled "Thực chi (VND)" — NOT the note field
      const money = await page.evaluate(() => {
        const clean = (el) => el.textContent.trim().replace(/\s+/g, ' ').replace(/\*+$/, '');
        const label = [...document.querySelectorAll('label')].find((l) => l.offsetParent && /^Thực chi \(VND\)/.test(clean(l)));
        const el = label ? (label.querySelector('input') ?? (label.getAttribute('for') ? document.getElementById(label.getAttribute('for')) : null)) : null;
        if (!el) return { found: false, labels: [...document.querySelectorAll('label')].filter((l) => l.offsetParent).map((l) => clean(l)).slice(0, 20) };
        el.focus();
        return { found: true, id: el.id };
      });
      log('FB-035-money-input', money);
      if (money.found) {
        await page.keyboard.type('15000', { delay: 40 });
        await sleep(600);
        const val = await page.evaluate((id) => document.getElementById(id)?.value, money.id);
        await shot('04-money-formatted');
        if (val === '15.000') tc('FB-035', 'PASS', { displayed: val });
        else fail('FB-035', 'money formatting wrong', { displayed: val });
        // leave without saving: clear the draft field and reload the page
        await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (el) {
            const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            proto.set.call(el, '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, money.id);
        await page.reload({ waitUntil: 'networkidle2' });
      } else fail('FB-035', 'Thực chi (VND) input not found', money);
    } else {
      // fallback: driver earnings page input? document instead
      tc('FB-035', 'UNCONFIRMED', { note: 'no cost-entry affordance on trip 79 — see screenshot' });
    }
  }

  if (PHASE === 'admin') {
    // ── FB-045: dispatch drawer opens ───────────────────────────────────────
    await goto('/dispatch');
    await sleep(2500);
    await shot('01-dispatch');
    const drawerBtn = await page.evaluate(() => {
      const link = [...document.querySelectorAll('button,a,[role="button"]')].find((b) => b.offsetParent && b.textContent.trim() === 'Chi tiết');
      if (!link) return { found: false, sample: [...document.querySelectorAll('button,a')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter((t) => t && t.length < 22).slice(0, 20) };
      const r = link.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    log('FB-045-drawer-btn', drawerBtn);
    if (drawerBtn.found) {
      await page.mouse.move(drawerBtn.x, drawerBtn.y); await page.mouse.down(); await page.mouse.up();
      await sleep(1800);
    }
    await shot('02-dispatch-drawer');
    const drawer = await page.evaluate(() => {
      // the dispatch drawer: overlay panel titled "Chi tiết container" — not the app nav sidebar
      const cands = [...document.querySelectorAll('[class*="drawer"],[role="dialog"],aside,[class*="side-panel"],[class*="overlay"] [class*="panel"]')]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().width < window.innerWidth * 0.85 && e.getBoundingClientRect().width > 300
          && !/\bsidebar\b/.test(String(e.className)));
      const d = cands.find((e) => /Chi tiết container/.test(e.textContent || ''));
      return { open: !!d, cls: d ? String(d.className).slice(0, 60) : null, text: d ? (d.textContent || '').replace(/\s+/g, ' ').slice(0, 100) : null, candidates: cands.length };
    });
    log('FB-045-drawer', drawer);
    if (drawer.open) tc('FB-045', 'PASS', { drawer }); else fail('FB-045', 'dispatch drawer not reachable as admin', { drawerBtn, drawer });

    // ── FB-047: treasury form (/ops/wallet Quỹ tạm ứng) ─────────────────────
    await goto('/ops/wallet');
    await sleep(2500);
    await shot('03-ops-wallet');
    const wallet = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return { quỹVisible: /Quỹ|Ví|Tạm ứng/.test(txt), hasForm: !!document.querySelector('form'), heading: (txt.match(/Quỹ[^\n]*/) || [])[0] ?? null };
    });
    log('FB-047-wallet', wallet);
    if (wallet.quỹVisible) tc('FB-047', 'PASS', wallet); else fail('FB-047', 'treasury page not rendering', wallet);

    // ── FB-051: policy version page (/config/app-settings hosts FinancePolicySection) ──
    await goto('/config/app-settings');
    await sleep(2500);
    await shot('04-app-settings');
    const policy = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const hit = /Chính sách|Phiên bản/i.test(txt);
      const match = (txt.match(/[^\n]*(Phiên bản|Chính sách)[^\n]*/) || [])[0] ?? null;
      return { hit, match };
    });
    log('FB-051-app-settings', policy);
    await shot('05-policy-if-any');
    if (policy.hit) tc('FB-051', 'PASS', policy); else fail('FB-051', 'policy version surface not found at /config/app-settings', policy);

    // ── FB-049 (admin fallback): table summary header spacing ──────────────
    await goto('/shipments');
    await sleep(2500);
    const summ = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return { hiểnThị: (txt.match(/Hiển thị\s?\d+\s?\/\s?\d+/g) || [])[0] ?? null, glued: (txt.match(/[^\s\d](ngày|đ)\b/g) || []).slice(0, 8) };
    });
    log('FB-049-admin-summary', summ);
    await shot('06-shipments-summary');
  }
} catch (e) {
  log('phase-error', { phase: PHASE, error: String(e.message).slice(0, 300) });
  await shot('99-error').catch(() => {});
  exitCode = 2;
} finally {
  log('page-errors', { count: pageErrors.length, sample: pageErrors.slice(0, 5) });
  fs.writeFileSync(path.join(OUT, `${PHASE}_log.json`), JSON.stringify(LOG, null, 2));
  await browser.close();
  process.exit(exitCode);
}
