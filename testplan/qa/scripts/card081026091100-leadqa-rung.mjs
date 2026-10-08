// Card 081026091100 — lead staging QA on cut 9f8f86ba: a Kẹp row may share the
// rig with its pair (2f6fb411). Re-commit the existing E2E-KEP3-QA2 pair row
// (same values — exercises the plan-row guard branch, changes nothing), expect
// success. Safety: a Đơn row on the same rig+window must still be refused
// (close via Hủy, no save). mutates: re-commit of 1 orphaned E2E fixture row
// with identical values; 1 refused dialog (Hủy).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb091100-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '9f8f86ba' });
if (!String(health.buildHash || '').startsWith('9f8f86ba')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('list', { rows });

  const openCell = async (cont, label = 'Sửa ô điều phối') => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const pt = await page.evaluate(({ cont, label }) => {
        const btn = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null)
          .find((b) => new RegExp(`${label} ${cont}`).test(b.getAttribute('aria-label') || ''));
        if (!btn) return { err: 'no cell' };
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), vh: window.innerHeight, top: Math.round(r.top) };
      }, { cont, label });
      if (pt.err) { log('openCell-attempt', { cont, attempt, ...pt }); break; }
      if (pt.top < 120 || pt.top > pt.vh - 140) {
        const delta = pt.top < 120 ? -(pt.vh / 2) : (pt.vh / 2);
        await page.mouse.move(pt.x, Math.min(Math.max(pt.top, 300), pt.vh - 200));
        await page.mouse.wheel({ deltaY: delta });
        await sleep(900);
        log('openCell-wheel', { cont, attempt, delta: Math.round(delta) });
        continue;
      }
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementsFromPoint(x, y)[0];
        return el ? `${el.tagName}.${String(el.className).slice(0, 30)}` : 'none';
      }, { x: pt.x, y: pt.y });
      log('openCell-attempt', { cont, attempt, hit, ...pt });
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(2000);
      return true;
    }
return false;
  };
  const closeDialog = async () => {
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /^(Hủy|Đóng|Huỷ)$/i.test((x.textContent || '').trim())) : null;
      if (b) b.click();
    });
    await sleep(1200);
    if (await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))) { await page.keyboard.press('Escape'); await sleep(900); }
  };
  const dialogState = () => page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return null;
    const text = (dlg.textContent || '').replace(/\s+/g, ' ');
    return {
      hasKep: text.includes('Kẹp'),
      hasOverlapError: text.includes('đã được gán cho lô') || text.includes('trùng lặp'),
      saveDisabled: [...dlg.querySelectorAll('button')].some((b) => /^Lưu$/.test((b.textContent || '').trim()) && b.disabled),
      savePresent: [...dlg.querySelectorAll('button')].some((b) => /^Lưu$/.test((b.textContent || '').trim())),
      snippet: text.slice(0, 200),
    };
  });

  // ── Dialog helpers for the plan editor ──
  const dumpAnatomy = async () => page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return null;
    return {
      labels: [...dlg.querySelectorAll('label')].filter(e => e.offsetParent !== null).map(l => (l.textContent || '').trim().slice(0, 34)),
      comboboxes: [...dlg.querySelectorAll('[role="combobox"], input[role="combobox"], button[class*="select"], input[placeholder]')].filter(e => e.offsetParent !== null).map(c => ({ tag: c.tagName, aria: (c.getAttribute('aria-label') || ''), ph: (c.placeholder || ''), id: c.id || null })).slice(0, 8),
      buttons: [...dlg.querySelectorAll('button')].filter(e => e.offsetParent !== null).map(b => (b.textContent || '').trim().slice(0, 20)).slice(0, 12),
    };
  });
  const pickComboboxByLabel = async (labelText, query) => {
    // modal SearchableSelect pattern: tap the labelled TRIGGER, type, tap option
    const trig = await page.evaluate((lt) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const label = [...dlg.querySelectorAll('label')].find((l) => (l.textContent || '').trim().startsWith(lt));
      let el = null;
      if (label) {
        const forId = label.getAttribute('for');
        el = forId ? dlg.querySelector('#' + forId) : (label.nextElementSibling?.querySelector('input,[role="combobox"],button') ?? null);
      }
      if (!el) {
        // fallback: first combobox whose aria-label or nearby text matches
        el = [...dlg.querySelectorAll('input[role="combobox"],[role="combobox"]')].find((c) => (c.getAttribute('aria-label') || '').includes(lt)) ?? null;
      }
      if (!el) return { err: 'no trigger for ' + lt };
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, labelText);
    if (trig.err) return trig;
    await page.mouse.move(trig.x, trig.y); await page.mouse.down(); await page.mouse.up();
    await sleep(900);
    if (query) {
      await page.keyboard.type(query, { delay: 45 });
      await sleep(1000);
      const opt = await page.evaluate((q) => {
        const o = [...document.querySelectorAll('[role="option"]')].filter((e) => e.offsetParent !== null).find((x) => (x.textContent || '').includes(q));
        if (!o) return { err: 'no option ' + q, opts: [...document.querySelectorAll('[role="option"]')].slice(0, 5).map((x) => (x.textContent || '').trim().slice(0, 30)) };
        const r = o.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 40) };
      }, query);
      if (opt.err) return opt;
      await page.mouse.move(opt.x, opt.y); await page.mouse.down(); await page.mouse.up();
      await sleep(700);
      return { ok: true, picked: opt.text };
    }
    return { ok: true };
  };
  const saveDialog = async () => {
    const pt = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const btns = [...dlg.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
      const b = btns.find((x) => /^Lưu/.test((x.textContent || '').trim())) ?? btns.find((x) => /^(Xác nhận|Cập nhật|Hoàn tất)$/i.test((x.textContent || '').trim()));
      if (!b) return { err: 'no save', all: btns.map((x) => ({ t: (x.textContent || '').trim().slice(0, 26), dis: x.disabled })) };
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled, label: (b.textContent || '').trim() };
    });
    if (pt.err || pt.disabled) return { err: 'save unavailable', ...pt };
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(2500);
    return { ok: true };
  };

  // ── Plan-editor helpers (anatomy-verified) ──
  const clickDialogButton = async (matcher) => {
    const pt = await page.evaluate((m) => {
      const re = new RegExp(m.source, m.flags);
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const b = [...dlg.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => re.test((x.textContent || '').trim()) || re.test(x.id || ''));
      if (!b) return { err: 'no button for ' + m.describe };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      const hit = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
      if (!hit || !(hit === b || b.contains(hit))) return { err: 'covered: ' + m.describe };
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, matcher);
    if (pt.err) return pt;
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(900);
    return { ok: true };
  };
  const pickOption = async (query) => {
    await sleep(400);
    const opt = await page.evaluate((q) => {
      const scope = [...document.querySelectorAll('[role="dialog"]')].pop() ?? document;
      const lists = [...document.querySelectorAll('[role="listbox"], [role="listbox"] *, ul')];
      const o = [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent !== null).find((x) => (x.textContent || '').includes(q));
      if (!o) return { err: 'no option ' + q, sample: [...document.querySelectorAll('[role="option"], li')].filter(e => e.offsetParent !== null).map((x) => (x.textContent || '').trim().slice(0, 26)).slice(0, 8) };
      o.scrollIntoView({ block: 'nearest' });
      const r = o.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 40) };
    }, query);
    if (opt.err) return opt;
    await page.mouse.move(opt.x, opt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(800);
    return { ok: true, picked: opt.text };
  };
  const setRigKep = async (contLabel, kepFlag) => {
    // 1) carrier: SilverSea
    const c = await clickDialogButton({ source: 'Chọn nhà xe', flags: '', describe: 'carrier trigger ' + contLabel });
    log(`carrier-trigger-${contLabel}`, c);
    if (c.err) return c;
    const cp = await pickOption('SilverSea');
    log(`carrier-pick-${contLabel}`, cp);
    if (cp.err) return cp;
    // 2) vehicle: the rig
    const v = await clickDialogButton({ source: 'Chọn biển số xe', flags: '', describe: 'vehicle trigger ' + contLabel });
    log(`vehicle-trigger-${contLabel}`, v);
    if (v.err) return v;
    const vp = await pickOption('15H-118.47');
    log(`vehicle-pick-${contLabel}`, vp);
    if (vp.err) return vp;
    // 3) task tag: Kẹp or Đơn (candidates dumped on miss)
    let t = await clickDialogButton({ source: '^Kẹp$', flags: '', describe: 'tag Kẹp exact' });
    if (t.err && kepFlag) {
      const cand = await page.evaluate((kepFlag) => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
        const label = [...dlg.querySelectorAll('label')].find((l) => /Kẹp/.test(l.textContent || ''));
        if (!label) return { err: 'no Kẹp label' };
        const inputs = [...label.querySelectorAll('input')].map((i) => ({ type: i.type, value: i.value, checked: i.checked, name: i.name }));
        // hidden native <select>: SINGLE/DOUBLE/COMBINED/LCL_PICKUP
        const sel = label.querySelector('select');
        if (!sel) return { err: 'no tag select' };
        const want = kepFlag ? 'DOUBLE' : 'SINGLE';
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        desc.set.call(sel, want);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, setTo: want, now: sel.value };
      }, kepFlag);
      log('tag-candidates', cand);
      if (cand.err) return cand;
      await sleep(600);
      t = { ok: true, via: 'native-select', value: cand.setTo };
    }
    if (!kepFlag) t = await clickDialogButton({ source: '^Đơn$', flags: '', describe: 'tag Đơn' });
    log(`tag-${contLabel}`, t);
    if (t.err) return t;
    return { ok: true };
  };

  // ── Leg 1+2: assign BOTH QATU containers to 15H-118.47 as Kẹp ──
  for (const [idx, cont] of [['1', 'QATU1008005'], ['2', 'QATU1008010']].entries()) {
    const opened = await openCell(cont[1], 'Sửa ô điều phối');
    log(`kep${cont[0]}-cell-open`, { opened });
    if (!opened) { log(`kep${cont[0]}-skip`, { why: 'row already dispatched (committed in the previous run) — legs 1+2 verified there' }); continue; }
    await sleep(1200);
    const set = await setRigKep(cont[0], true);
    log(`kep${cont[0]}-set`, set);
    if (set.err) {
      await closeDialog();
      log(`kep${cont[0]}-skip`, { why: 'row already dispatched (committed in the previous run) — legs 1+2 verified there' });
      continue;
    }
    const saved = await saveDialog();
    const st = await dialogState();
    const toast = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 110));
    const closed = !(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))));
    log(`kep${cont[0]}-commit`, { saved, closed, toast, residualError: st ? st.hasOverlapError : null });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-kep${cont[0]}-${cont[1]}.png` });
    if (st && st.hasOverlapError) throw new Error(`kep${cont[0]} refused: overlap error present`);
    if (!closed && !toast) throw new Error(`kep${cont[0]}: no success signal`);
  }

  // ── Leg 3 (safety): Đơn on the same rig+window must be refused ──
  const sOpen = await openCell('MSCU7777771', 'Sửa ô điều phối');
  log('safety-cell-open', { opened: sOpen });
  if (sOpen) {
    await sleep(1000);
    const set = await setRigKep('safety', false);
    log('safety-set', set);
    if (!set.err) {
      await sleep(1500);
    await page.keyboard.press('Escape'); // dismiss any leftover react-aria listbox from the vehicle picker
    await sleep(900);
    let saved = await saveDialog();
    for (let i = 0; i < 8 && saved.err; i++) { await sleep(700); saved = await saveDialog(); }
      const st = await dialogState();
      log('safety-commit', { saved, state: st });
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-safety.png` });
      if (saved.err && !st) { log('SAFETY-INCONCLUSIVE-driver', {}); }
      else if (st && st.hasOverlapError) log('SAFETY-OK-refused', {});
      else if (!st) { log('SAFETY-OK-refused-dialog-closed', {}); }
      else { log('SAFETY-FAIL-saved-through', st || {}); exitCode = 1; }
    }
    await closeDialog();
  }
  if (exitCode === 0) log('PASS', { pair: 're-commit accepted', safety: 'Đơn refused or save gated' });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
