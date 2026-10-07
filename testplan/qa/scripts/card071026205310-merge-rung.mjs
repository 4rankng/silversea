// Card 071026205310 REWORK rung — merged auto-save. Both popover commit paths
// must sweep the row's dirty port into the SAME POST, and the port must survive
// reopen (server truth, read from the trigger — no hardcoded fixture values).
// Path 1: preset (Hôm nay) + typed 08:00 + Enter. Path 2: real mouse tap on
// XÁC NHẬN at its natural rect center. POST bodies captured from the network.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026205310';
const BASE = 'http://localhost:7175';
const SHIP = 53072;
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token) });
const detailRes = await fetch(`http://localhost:3002/api/shipments/cus-workspace/${SHIP}`, { headers: { Authorization: `Bearer ${token}` } });
const detail = await detailRes.json();
const detailData = detail.data ?? detail;
const portMap = new Map((((detailData.selectors ?? {}).ports) ?? []).map((p) => [p.label, p.id]));
const containers = (detailData.containers ?? []).map((c) => ({ id: c.id, num: c.containerNumber, lift: c.liftSiteId }));
step('detail-api', { containers, portCount: portMap.size });
const C1 = containers.find((c) => c.num === 'CSQU3333330');
const C2 = containers.find((c) => c.num === 'MSCU5678907');
if (!C1 || !C2) throw new Error('expected containers CSQU3333330 + MSCU5678907 missing: ' + JSON.stringify(containers));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const posts = [];
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
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments?searchSuffix=QA-329-PROBE-20944`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('list', { rows });
  if (!rows) throw new Error('filtered list empty');
  const openDrawer = async () => {
    await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
    let ledger = false;
    for (let i = 0; i < 12 && !ledger; i++) { await sleep(2000); ledger = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
    if (!ledger) throw new Error('container ledger did not render');
    return true;
  };
  await openDrawer();
  step('drawer-open-1', { ok: true });

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
    if (!opened.ok) throw new Error('lift trigger not found for ' + num);
    await sleep(1200);
    const located = await page.evaluate((cur) => {
      const opt = [...document.querySelectorAll('[role="option"]')]
        .find((o) => !/^[+＋]/.test(o.textContent.trim()) && flat_local(o.textContent.trim()) !== flat_local(cur));
      function flat_local(t) { return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
      if (!opt) return { ok: false, options: [...document.querySelectorAll('[role="option"]')].slice(0, 8).map((o) => o.textContent.trim()) };
      const r = opt.getBoundingClientRect();
      return { ok: true, text: opt.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, before);
    if (!located.ok) throw new Error('no different option: ' + JSON.stringify(located));
    await page.mouse.move(located.x, located.y);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(800);
    const saveBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Lưu');
      return b ? { disabled: b.disabled } : null;
    });
    step('port-picked', { container: num, before, picked: located.text, save: saveBtn });
    if (saveBtn?.disabled) throw new Error('pick did not dirty the drawer: ' + JSON.stringify({ before, picked: located.text }));
    return { before, picked: located.text, portId: portMap.get(located.text) };
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
    step('popover-open', { container: num, clicked, dlg });
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
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(hh, '08');
      const mm = dlg.querySelector('input[data-seg="mm"]');
      if (mm) set(mm, '00');
      return { ok: true };
    });
    if (!seg.ok) throw new Error('segment fill failed: ' + JSON.stringify(seg));
    await sleep(400);
  };

  // ══ PATH 1: preset + typed 08:00 + Enter, container C1 ══
  const pick1 = await pickDifferentPort(C1.num);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-merge-path1-dirty.png` });
  await openAppointmentPopover(C1.num);
  await fillTodayAndTime();
  const postMark = posts.length;
  await page.keyboard.press('Enter');
  let closed1 = null;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const open = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger')));
    if (!open) { closed1 = (i + 1) * 500; break; }
  }
  const toast1 = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
  const path1Posts = posts.slice(postMark);
  step('path1-commit', { picked: pick1, drawerClosedAfterMs: closed1, toast: toast1, posts: path1Posts });
  if (!path1Posts.length) throw new Error('PATH 1: no container POST fired from the Enter commit');
  const p1 = path1Posts[0].body ?? {};
  if (p1.liftSiteId !== pick1.portId) throw new Error(`PATH 1 payload lost the port: liftSiteId=${JSON.stringify(p1.liftSiteId)} expected ${pick1.portId} (body ${JSON.stringify(p1)})`);
  if (closed1 == null) throw new Error('PATH 1: drawer stayed open after a full merged save (exit should fire when clean)');

  // Reopen — the port must be SERVER truth now.
  await sleep(1500);
  await openDrawer();
  const after1 = await triggerText(C1.num);
  step('path1-reopen', { triggerText: after1, expected: pick1.picked });
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-merge-path1-reopened.png` });
  if (flat(after1) !== flat(pick1.picked)) throw new Error(`PATH 1 persistence FAILED: trigger='${after1}' expected='${pick1.picked}'`);

  // ══ PATH 2: real mouse tap on XÁC NHẬN, container C2 ══
  const pick2 = await pickDifferentPort(C2.num);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-merge-path2-dirty.png` });
  await openAppointmentPopover(C2.num);
  await fillTodayAndTime();
  const postMark2 = posts.length;
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
  let closed2 = null;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const open = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger')));
    if (!open) { closed2 = (i + 1) * 500; break; }
  }
  const toast2 = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
  const path2Posts = posts.slice(postMark2);
  step('path2-commit', { picked: pick2, tappedAt: tapped, drawerClosedAfterMs: closed2, toast: toast2, posts: path2Posts });
  if (!path2Posts.length) throw new Error('PATH 2: no container POST fired from the XÁC NHẬN tap');
  const p2 = path2Posts[0].body ?? {};
  if (p2.liftSiteId !== pick2.portId) throw new Error(`PATH 2 payload lost the port: liftSiteId=${JSON.stringify(p2.liftSiteId)} expected ${pick2.portId} (body ${JSON.stringify(p2)})`);

  await sleep(1500);
  await openDrawer();
  const after2 = await triggerText(C2.num);
  step('path2-reopen', { triggerText: after2, expected: pick2.picked });
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-merge-path2-reopened.png` });
  if (flat(after2) !== flat(pick2.picked)) throw new Error(`PATH 2 persistence FAILED: trigger='${after2}' expected='${pick2.picked}'`);

  step('ALL-PATHS-GREEN', { posts: posts.map((p) => p.body) });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e), postsSoFar: posts });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
