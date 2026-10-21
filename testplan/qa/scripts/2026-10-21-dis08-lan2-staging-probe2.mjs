// DIS-08 lan-2 verify-first probe v2 — STAGING read-only at 390/768/1440.
// Sample computed font-weight of container + port lines on both dispatch
// tables per width. Also opens the container-detail drawer (read-only view).
// Usage: node testplan/qa/scripts/2026-10-21-dis08-lan2-staging-probe2.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve('qa/2026-10-21-dis08-lan2');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const token = await login(process.env.QA_USER || 'dungnv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    // ── master plan ──
    await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(2200);
    const master = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('.master-plan-grid__location-block'));
      const weights = { port: [], summary: [] };
      for (const b of blocks) {
        const lines = Array.from(b.children);
        lines.forEach((el, i) => {
          const w = Number(getComputedStyle(el).fontWeight);
          (i === 0 ? weights.port : weights.summary).push({ t: (el.textContent || '').trim().slice(0, 24), w });
        });
      }
      return {
        blocks: blocks.length,
        portWeights: [...new Set(weights.port.map((x) => x.w))],
        summaryWeights: [...new Set(weights.summary.map((x) => x.w))],
        summarySample: weights.summary.slice(0, 3),
      };
    });
    log('master', { width, ...master });

    // ── detailed plan ──
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(2200);
    const detail = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.detailed-plan-grid tbody tr')).slice(0, 5);
      const cont = [];
      const ports = [];
      for (const row of rows) {
        const cs = row.querySelector('.detailed-plan-grid__cell--container .detailed-plan-grid__line--strong')
          ?? row.querySelector('[data-label="Container"] .detailed-plan-grid__line--strong');
        if (cs) cont.push({ t: cs.textContent.trim().slice(0, 20), w: Number(getComputedStyle(cs).fontWeight) });
        const pc = row.querySelector('.detailed-plan-grid__cell--ports .detailed-plan-grid__line');
        if (pc) ports.push({ t: pc.textContent.trim().slice(0, 24), w: Number(getComputedStyle(pc).fontWeight) });
      }
      return {
        rows: rows.length,
        contWeights: [...new Set(cont.map((x) => x.w))],
        portWeights: [...new Set(ports.map((x) => x.w))],
        contSample: cont.slice(0, 2),
      };
    });
    log('detail', { width, ...detail });
  }

  // ── drawer at 1440 (read-only open) ──
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2000);
  const drawerOpened = await page.evaluate(() => {
    const btn = document.querySelector('.master-plan-grid__container-detail-trigger');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (drawerOpened) {
    await sleep(1600);
    const drawer = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.dispatch-container-detail__table tbody tr')).slice(0, 4);
      return rows.map((r) => {
        const th = r.querySelector('th[scope="row"]');
        const strong = th ? th.querySelector('strong') : null;
        return {
          cont: strong ? strong.textContent.trim().slice(0, 20) : null,
          strongWeight: strong ? Number(getComputedStyle(strong).fontWeight) : null,
          thWeight: th ? Number(getComputedStyle(th).fontWeight) : null,
        };
      });
    });
    log('drawer', { rows: drawer.length, sample: drawer.slice(0, 3) });
    await page.screenshot({ path: path.join(OUT, 'staging-dispatch-drawer.png') });
  } else {
    log('drawer', { opened: false });
  }
} catch (err) {
  log('probe-error', { message: String(err).slice(0, 400) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'staging-probe2.json'), JSON.stringify(LOG, null, 2));
  await browser.close();
}
