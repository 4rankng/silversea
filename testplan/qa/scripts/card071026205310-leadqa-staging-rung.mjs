// Card 071026205310 REWORK — lead staging QA on cut 3375229c. Both appointment
// popover commit paths (preset+Enter, XÁC NHẬN tap) must sweep the row's dirty
// port into the SAME POST; the port must survive reopen (server truth).
// Staging has no two-container editable lot — both paths run sequentially on
// the single fixture container (path 2 re-picks a different port).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb205310-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '3375229c' });
if (!String(health.buildHash || '').startsWith('3375229c')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const posts = [];
let shipDetail = null;
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && /\/containers\/\d+/.test(url)) {
      let body = null;
      try { body = JSON.parse(req.postData() ?? 'null'); } catch { /* raw */ }
      posts.push({ url: url.replace(BASE, ''), body });
    }
    void req.continue();
  });
  page.on('response', async (res) => {
    const m = res.url().match(/\/api\/shipments\/cus-workspace\/(\d+)$/);
    if (res.request().method() === 'GET' && m) {
      try { shipDetail = { id: Number(m[1]), data: await res.json() }; } catch { /* ignore */ }
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments?searchSuffix=MSKU1234565`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('list', { rows });
  if (!rows) throw new Error('filtered list empty');

  await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
  let ledger = false;
  for (let i = 0; i < 12 && !ledger; i++) { await sleep(2000); ledger = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
  if (!ledger) throw new Error('container ledger did not render');
  for (let i = 0; i < 10 && !shipDetail; i++) { await sleep(1000); }
  if (!shipDetail) throw new Error('drawer detail GET not captured');
  const d = shipDetail.data?.data ?? shipDetail.data ?? {};
  const containers = (d.containers ?? []).map((c) => ({ id: c.id, num: c.containerNumber, lift: c.liftSiteId }));
  const portMap = new Map((((d.selectors ?? {}).ports) ?? []).map((p) => [p.label, p.id]));
  const C1 = containers[0];
  log('drawer-detail', { shipId: shipDetail.id, containers, portCount: portMap.size });
  if (!C1) throw new Error('opened lot has no containers');

  const SHIPID = shipDetail.id;

  const triggerText = (num) => page.evaluate((n) => {
    const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(`Cảng nâng của container ${n}`));
    const el = label ? document.getElementById(label.getAttribute('for')) : null;
    return el?.textContent?.trim() ?? null;
  }, num);

  const pickDifferentPort = async (num) => {
    const before = await triggerText(num);
    const opened = await page.evaluate((n) => {
      const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(`Cảng nâng của container ${n}`));
      const btn = label ? document.getElementById(label.getAttribute('for')) : null;
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    }, num);
    if (!opened.ok) throw new Error('lift trigger re-opened listbox for ' + num);
    await sleep(1200);
    // Clipped-listbox guard: hit-test + scroll + retry until the TRIGGER
    // reflects the pick (a tap that doesn't commit is a miss, not a pass).
    let result = null;
    for (let attempt = 0; attempt < 4 && !result; attempt++) {
      const cand = await page.evaluate(({ cur, attempt }) => {
        const f = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const opts = [...document.querySelectorAll('[role="option"]')]
          .filter((o) => !/^[+＋]/.test(o.textContent.trim()) && f(o.textContent.trim()) !== f(cur));
        const opt = opts[attempt % Math.max(1, opts.length)];
        if (!opt) return { ok: false, n: 0 };
        opt.scrollIntoView({ block: 'nearest' });
        const r = opt.getBoundingClientRect();
        const hit = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
        const clean = hit && (hit === opt || opt.contains(hit));
        return { ok: true, clean, text: opt.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), opts: opts.length };
      }, { cur: before, attempt });
      if (!cand.ok) throw new Error('no different option rendered: ' + JSON.stringify(cand));
      if (!cand.clean) { await sleep(400); continue; }
      await page.mouse.move(cand.x, cand.y);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(1000);
      const after = await triggerText(num);
      if (flat(after) === flat(cand.text)) {
        result = { before, picked: cand.text, portId: portMap.get(cand.text), triggerNow: after };
      } else {
        log('pick-miss', { attempt, tapped: cand.text, triggerNow: after });
        // reopen the listbox for the next attempt
        await page.evaluate((n) => {
          const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(`Cảng nâng của container ${n}`));
          const btn = label ? document.getElementById(label.getAttribute('for')) : null;
          if (btn) btn.click();
        }, num);
        await sleep(1000);
      }
    }
    if (!result) throw new Error('pick never committed to the trigger after retries');
    log('port-picked', { container: num, before, picked: result.picked, triggerNow: result.triggerNow });
    return result;
  };

  const openAppointmentPopover = async (num) => {
    const clicked = await page.evaluate((n) => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Giờ hẹn đóng hoặc trả') && (b.getAttribute('aria-label') ?? '').includes(n));
      if (!btn) return null;
      btn.click();
      return btn.getAttribute('aria-label');
    }, num);
    await sleep(1500);
    const dlg = await page.evaluate(() => Boolean(document.querySelector('.cus-appointment-popover')));
    log('popover-open', { container: num, clicked, dlg });
    if (!clicked || !dlg) throw new Error('appointment popover did not open for ' + num);
  };

  const fillTodayAndTime = async () => {
    const r = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
      if (!dlg) return { ok: false, why: 'no popover' };
      const today = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hôm nay');
      if (!today) return { ok: false, why: 'no Hôm nay preset', btns: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()) };
      today.click();
      return { ok: true };
    });
    if (!r.ok) throw new Error('preset failed: ' + JSON.stringify(r));
    await sleep(600);
    const seg = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
      const hh = dlg?.querySelector('input[data-seg="hh"]');
      if (!hh) return { ok: false, why: 'no hh segment' };
      const set = (el, v) => {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(hh, '08');
      const mm = dlg.querySelector('input[data-seg="mm"]');
      if (mm) set(mm, '00');
      hh.focus();
      return { ok: true, focused: document.activeElement === hh };
    });
    if (!seg.ok) throw new Error('segment fill failed: ' + JSON.stringify(seg));
    await sleep(400);
  };

  const waitDrawerClosed = async () => {
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      const open = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger')));
      if (!open) return (i + 1) * 500;
    }
    return null;
  };

  const reopenDrawer = async () => {
    await sleep(1500);
    await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
    for (let i = 0; i < 12; i++) { await sleep(2000); if (await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger')))) return true; }
    throw new Error('drawer did not reopen');
  };

  // ══ PATH 1: preset + typed 08:00 + Enter ══
  const pick1 = await pickDifferentPort(C1.num);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-path1-dirty.png` });
  await openAppointmentPopover(C1.num);
  await fillTodayAndTime();
  const mark1 = posts.length;
  await page.keyboard.press('Enter');
  const closed1 = await waitDrawerClosed();
  const toast1 = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
  const p1posts = posts.slice(mark1);
  log('path1-commit', { picked: pick1.picked, triggerNow: pick1.triggerNow, drawerClosedAfterMs: closed1, toast: toast1, posts: p1posts });
  if (!p1posts.length) {
    const diag = await page.evaluate(() => ({
      active: document.activeElement?.tagName + '.' + String(document.activeElement?.className).slice(0, 30),
      popoverStill: Boolean(document.querySelector('.cus-appointment-popover')),
      popBtns: [...(document.querySelector('.cus-appointment-popover')?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
      hhVal: document.querySelector('.cus-appointment-popover input[data-seg="hh"]')?.value ?? null,
    }));
    throw new Error('PATH 1: no container POST fired from Enter commit — diag ' + JSON.stringify(diag));
  }
  const p1 = p1posts[0].body ?? {};
  if (p1.liftSiteId !== pick1.portId) throw new Error(`PATH 1 payload lost the port: liftSiteId=${JSON.stringify(p1.liftSiteId)} expected ${pick1.portId}`);
  if (closed1 == null) throw new Error('PATH 1: drawer stayed open after merged save');
  await reopenDrawer();
  const after1 = await triggerText(C1.num);
  log('path1-reopen', { triggerText: after1, expected: pick1.picked });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-path1-reopened.png` });
  if (flat(after1) !== flat(pick1.picked)) throw new Error(`PATH 1 persistence FAILED: trigger='${after1}' expected='${pick1.picked}'`);

  // ══ PATH 2: real mouse tap on XÁC NHẬN (same container, different port) ══
  const pick2 = await pickDifferentPort(C1.num);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-path2-dirty.png` });
  await openAppointmentPopover(C1.num);
  await fillTodayAndTime();
  const mark2 = posts.length;
  const tapped = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
    const btn = [...dlg.querySelectorAll('button')].find((b) => /^xác nhận$/i.test(b.textContent.trim()));
    if (!btn) return { ok: false, btns: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    const r = btn.getBoundingClientRect();
    return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!tapped.ok) throw new Error('XÁC NHẬN not found: ' + JSON.stringify(tapped));
  await page.mouse.move(tapped.x, tapped.y);
  await page.mouse.down();
  await page.mouse.up();
  const closed2 = await waitDrawerClosed();
  const toast2 = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
  const p2posts = posts.slice(mark2);
  log('path2-commit', { picked: pick2.picked, tappedAt: tapped, drawerClosedAfterMs: closed2, toast: toast2, posts: p2posts });
  if (!p2posts.length) throw new Error('PATH 2: no container POST fired from XÁC NHẬN tap');
  const p2 = p2posts[0].body ?? {};
  if (p2.liftSiteId !== pick2.portId) throw new Error(`PATH 2 payload lost the port: liftSiteId=${JSON.stringify(p2.liftSiteId)} expected ${pick2.portId}`);

  // ══ SERVER TRUTH ══
  const verify = await fetch(`${API}/shipments/cus-workspace/${SHIPID}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const vd = verify.data ?? verify;
  const vcs = (vd.containers ?? []).map((c) => ({ id: c.id, lift: c.liftSiteId }));
  log('server-truth', { shipId: SHIPID, containers: vcs, expectLift: [pick1.portId, pick2.portId] });
  if (vcs[0]?.lift !== pick2.portId) throw new Error(`server truth: liftSiteId=${vcs[0]?.lift} expected ${pick2.portId} (path 2 last write)`);
  log('PASS', { bothPathsCarryPort: true, persisted: vcs[0]?.lift });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
