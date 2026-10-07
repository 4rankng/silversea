// Card 071026205310 r2 — REAL-input preset-pill path: real taps on Hôm nay +
// 08:00 pills + real Enter. The lead's staging FAIL used all-real input; my
// previous rung set the pills synthetically. This rung closes that gap.
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
const detailRes = await fetch(`http://localhost:3002/api/shipments/cus-workspace/${SHIP}`, { headers: { Authorization: `Bearer ${token}` } });
const detail = await detailRes.json();
const detailData = detail.data ?? detail;
const portMap = new Map((((detailData.selectors ?? {}).ports) ?? []).map((p) => [p.label, p.id]));
const C1 = (detailData.containers ?? []).find((c) => c.num === 'CSQU3333330' || c.containerNumber === 'CSQU3333330');
if (!C1) throw new Error('CSQU3333330 missing');
step('start', { container: C1.id, baseLift: C1.liftSiteId ?? C1.lift });

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
  if (!rows) throw new Error('filtered list empty');
  await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
  let ledger = false;
  for (let i = 0; i < 12 && !ledger; i++) { await sleep(2000); ledger = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
  if (!ledger) throw new Error('ledger did not render');
  step('drawer', { ok: true });

  const num = 'CSQU3333330';
  const triggerText = () => page.evaluate((n) => {
    const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(`Cảng nâng của container ${n}`));
    const el = label ? document.getElementById(label.getAttribute('for')) : null;
    return el?.textContent?.trim() ?? null;
  }, num);

  // pick a port different from current — REAL taps
  const before = await triggerText();
  await page.evaluate((n) => {
    const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(`Cảng nâng của container ${n}`));
    document.getElementById(label.getAttribute('for'))?.click();
  }, num);
  await sleep(1200);
  const located = await page.evaluate((cur) => {
    function f(t) { return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => !/^[+＋]/.test(o.textContent.trim()) && f(o.textContent.trim()) !== f(cur));
    if (!opt) return { ok: false };
    const r = opt.getBoundingClientRect();
    return { ok: true, text: opt.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, before);
  if (!located.ok) throw new Error('no option found');
  await page.mouse.move(located.x, located.y); await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  const saveState = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Lưu');
    return b ? { disabled: b.disabled } : null;
  });
  step('port-picked', { before, picked: located.text, portId: portMap.get(located.text), save: saveState });
  if (saveState?.disabled) throw new Error('pick did not dirty the drawer');

  // open the appointment popover — REAL tap on the trigger
  const trig = await page.evaluate((n) => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Giờ hẹn đóng hoặc trả') && (b.getAttribute('aria-label') ?? '').includes(n));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') };
  }, num);
  if (!trig) throw new Error('appointment trigger not found');
  await page.mouse.move(trig.x, trig.y); await page.mouse.down(); await page.mouse.up();
  await sleep(1500);
  step('popover', { open: await page.evaluate(() => Boolean(document.querySelector('.cus-appointment-popover'))) });

  // REAL tap 'Hôm nay'
  const realTap = async (label) => {
    const t = await page.evaluate((l) => {
      const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
      const btn = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === l && !b.disabled);
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, label);
    if (!t) { step('real-tap-miss', { label }); return false; }
    await page.mouse.move(t.x, t.y); await page.mouse.down(); await page.mouse.up();
    await sleep(700);
    step('real-tap', { label, at: t });
    return true;
  };
  await realTap('Hôm nay');
  await realTap('08:00');
  const postMark = posts.length;
  // REAL Enter — focus is on the last real-tapped pill
  await page.keyboard.press('Enter');
  let closed = null;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    if (!(await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))))) { closed = (i + 1) * 500; break; }
  }
  const toast = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
  const pathPosts = posts.slice(postMark);
  step('pill-commit', { drawerClosedAfterMs: closed, toast, posts: pathPosts });
  if (!pathPosts.length) throw new Error('no container POST from the pill+Enter sequence');
  const expectedId = portMap.get(located.text);
  const p = pathPosts[0].body ?? {};
  step('payload-verdict', { liftSiteId: p.liftSiteId ?? null, expected: expectedId, match: p.liftSiteId === expectedId });
  if (p.liftSiteId !== expectedId) {
    await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-pill-path-FAIL.png` });
    throw new Error(`PILL PATH lost the port: liftSiteId=${JSON.stringify(p.liftSiteId)} expected ${expectedId}`);
  }
  await sleep(1500);
  // reopen — persistence
  await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
  for (let i = 0; i < 12; i++) { await sleep(2000); if (await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger')))) break; }
  const after = await triggerText();
  step('reopen', { triggerText: after, expected: located.text, match: flat(after) === flat(located.text) });
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-pill-path-reopened.png` });
  if (flat(after) !== flat(located.text)) throw new Error(`PILL PATH persistence failed: trigger='${after}'`);
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e), postsSoFar: posts });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
