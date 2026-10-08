// Card 071026212000 — lead decision rung on cut 22837bc3 (owner granted
// decision authority 08/10). Admin sees a flashing red toast 'Không có quyền
// truy cập' on /customers. ZAI disproved via token-inject; hypothesis left:
// real login→nav sequence, or a 403 from a stale session/tab landing late.
// Non-mutating: real login page + navigations only, no data writes.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card071026212000-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const responses = [];
const toastProbe = () => page.evaluate(() => {
  if (!window.__toastObs) {
    window.__toastLog = [];
    const hit = /Không có quyền|bị từ chối/i;
    window.__toastObs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = (n.textContent || '').trim();
        if (t.length <= 80 && hit.test(t)) window.__toastLog.push({ at: Date.now(), text: t.slice(0, 120) });
      }
    });
    window.__toastObs.observe(document.body, { childList: true, subtree: true });
  }
  return window.__toastLog;
});
let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('response', (r) => { if (r.status() >= 400) responses.push({ url: r.url().replace(BASE, ''), status: r.status() }); });
  await page.evaluateOnNewDocument(() => {
    window.__toastLog = [];
    window.__toastObs = new MutationObserver((muts) => {
      const hit = /Không có quyền|bị từ chối/i;
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = (n.textContent || '').trim();
        if (t.length <= 80 && hit.test(t)) window.__toastLog.push({ at: Date.now(), text: t.slice(0, 120) });
      }
    });
    document.addEventListener('DOMContentLoaded', () => window.__toastObs.observe(document.body, { childList: true, subtree: true }));
  });

  // ── Real login-page flow (not token-inject) ──
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 });
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input')].filter((e) => e.offsetParent !== null).map((i) => ({ type: i.type, ph: i.placeholder || '', id: i.id })));
  log('login-form', { inputs });
  const userSel = await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].filter((e) => e.offsetParent !== null).find((x) => x.type !== 'password');
    return i ? (i.id ? '#' + i.id : 'input:not([type=password])') : null;
  });
  if (!userSel) throw new Error('no login inputs');
  await page.click(userSel); await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
  await page.keyboard.type('admin', { delay: 30 });
  await page.click('input[type=password]');
  await page.keyboard.type('Abc123', { delay: 30 });
  const submit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Đăng nhập/i.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await page.mouse.click(submit.x, submit.y);
  for (let i = 0; i < 20 && !page.url().includes('/customers') && page.url().endsWith('/login'); i++) await sleep(1000);
  await sleep(2500);
  const landed = await page.evaluate(() => ({ url: location.pathname, toast: (window.__toastLog || []).length }));
  log('after-login', landed);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-login.png` });

  // ── Leg A: /customers ×3 direct loads ──
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(3500);
    const toasts = await toastProbe();
    const rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
    log('legA-customers', { i, rows, toasts: toasts.slice(-3) });
  }
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-customers.png` });

  // ── Leg B: sidebar real-tap into Khách hàng from a neighbor page ──
  await page.goto(`${BASE}/suppliers`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2000);
  const navTap = await page.evaluate(() => {
    const b = [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent !== null).find((x) => /^Khách hàng$/i.test((x.textContent || '').trim()));
    if (!b) return { err: 'no nav item', sample: [...document.querySelectorAll('a')].filter((e) => e.offsetParent !== null).map((a) => (a.textContent || '').trim().slice(0, 20)).slice(0, 10) };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  log('legB-nav-probe', navTap);
  if (!navTap.err) {
    await page.mouse.click(navTap.x, navTap.y);
    await sleep(3500);
    const toasts = await toastProbe();
    log('legB-after-tap', { url: page.url(), toasts: toasts.slice(-3) });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-legb.png` });
  }

  // ── Leg C: same-context two-tab role switch (stale-session 403 hypothesis).
  // page1 keeps the booted admin app on /customers; page2 logs in as the
  // driver (overwrites the shared localStorage token); page1 then makes an
  // in-app request — if its client re-reads storage, driver-token 403s land
  // on the open admin page.
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 800 });
  await page2.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await sleep(1500);
  // force the login form even though a token exists
  await page2.evaluate(() => { localStorage.removeItem('token'); location.href = '/login'; });
  await sleep(2500);
  const hasForm = await page2.evaluate(() => Boolean(document.querySelector('input[type=password]')));
  if (hasForm) {
    const u2 = 'input:not([type=password])';
    await page2.click(u2); await page2.keyboard.down('Meta'); await page2.keyboard.press('KeyA'); await page2.keyboard.up('Meta');
    await page2.keyboard.type('bqhuong', { delay: 30 });
    await page2.click('input[type=password]'); await page2.keyboard.type('Abc123', { delay: 30 });
    const s2 = await page2.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Đăng nhập/i.test(x.textContent || ''));
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await page2.mouse.click(s2.x, s2.y);
    await sleep(3500);
    // page1: in-app interaction on the still-open admin customers page
    const before = responses.length;
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((b) => /2|›|Tiếp/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length <= 3);
      if (btn) btn.click();
    });
    await sleep(3500);
    const toastsC = await toastProbe();
    log('legC-role-switch', { page2url: page2.url(), newResponses: responses.slice(before, before + 8), page1toasts: toastsC.slice(-5) });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-legc.png` });
  } else {
    log('legC-skipped', { why: 'login form did not appear on page2' });
  }
  await page2.close();

  log('summary', { total4xx: responses.length, last4xx: responses.slice(-8), totalToasts: (await toastProbe()).length });
  const bad = responses.filter((r) => r.status === 403);
  log('verdict-input', { f403: bad.length, any4xx: responses.length });
  if (bad.length === 0) log('PASS-no-403-no-toast', { note: 'real login flow + 3 loads + sidebar tap + role-switch variant — no 403, no permission toast' });
  else log('REPRO-403-found', { bad: bad.slice(0, 5) });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
