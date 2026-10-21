// DIS-08 lan-2 verify-first probe — STAGING (read-only): login, open both
// dispatch tables, sample computed font-weight of every container/port line.
// No mutation: GET pages + computed styles + screenshots only.
// Usage: node testplan/qa/scripts/2026-10-21-dis08-lan2-staging-probe.mjs
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

const SERIAL_RE = /\b[A-Z]{4}\d{7}\b/;

const token = await login(process.env.QA_USER || 'dungnv');
log('login-ok', { api: API, base: BASE });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ── Phase A: /dispatch (Kế hoạch Tổng quát — master plan) ──
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  const masterReady = await page.$('table');
  log('master-plan-loaded', { hasTable: !!masterReady, path: new URL(page.url()).pathname });

  const masterPortLines = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.master-plan-grid__location-block'));
    return blocks.slice(0, 14).map((block) => ({
      blockClass: block.className,
      lines: Array.from(block.children).map((el) => ({
        text: (el.textContent || '').trim().slice(0, 40),
        cls: el.className,
        weight: Number(getComputedStyle(el).fontWeight),
      })),
    }));
  });
  log('master-port-blocks', { count: masterPortLines.length, sample: masterPortLines.slice(0, 5) });

  // Any container SERIAL rendered anywhere in the master grid? Capture its styling.
  const masterSerials = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const out = [];
    for (const el of document.querySelectorAll('.master-plan-grid *')) {
      const t = (el.textContent || '').trim();
      if (!t || el.children.length > 0) continue;
      const m = t.match(re);
      if (m) {
        out.push({ text: t.slice(0, 40), cls: el.className?.toString?.().slice(0, 80) ?? '', weight: Number(getComputedStyle(el).fontWeight), tag: el.tagName });
        if (out.length >= 12) break;
      }
    }
    return out;
  }, SERIAL_RE.source);
  log('master-serial-elements', { count: masterSerials.length, sample: masterSerials.slice(0, 6) });

  await page.screenshot({ path: path.join(OUT, 'staging-dispatch-before.png') });

  // ── Phase B: /dispatch-detail (Kế hoạch Chi tiết — detailed plan) ──
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  log('detail-loaded', { path: new URL(page.url()).pathname });

  const detailSample = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).slice(0, 6);
    return rows.map((row) => {
      const contStrong = row.querySelector('.detailed-plan-grid__cell--container .detailed-plan-grid__line--strong');
      const portsCell = row.querySelector('.detailed-plan-grid__cell--ports');
      const portLine = portsCell ? portsCell.querySelector('.detailed-plan-grid__line') : null;
      return {
        contText: contStrong ? contStrong.textContent.trim().slice(0, 24) : null,
        contWeight: contStrong ? Number(getComputedStyle(contStrong).fontWeight) : null,
        contClass: contStrong ? contStrong.className : null,
        portText: portLine ? portLine.textContent.trim().slice(0, 30) : null,
        portWeight: portLine ? Number(getComputedStyle(portLine).fontWeight) : null,
      };
    });
  });
  log('detail-container-lines', { rows: detailSample.length, sample: detailSample.slice(0, 4) });

  // Serial scan on detail page too (catches serials rendered outside --strong)
  const detailSerials = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const out = [];
    for (const el of document.querySelectorAll('.detailed-plan-grid *')) {
      const t = (el.textContent || '').trim();
      if (!t || el.children.length > 0) continue;
      if (re.test(t)) {
        out.push({ text: t.slice(0, 40), cls: el.className?.toString?.().slice(0, 80) ?? '', weight: Number(getComputedStyle(el).fontWeight), tag: el.tagName });
        if (out.length >= 12) break;
      }
    }
    return out;
  }, SERIAL_RE.source);
  log('detail-serial-elements', { count: detailSerials.length, sample: detailSerials.slice(0, 8) });

  await page.screenshot({ path: path.join(OUT, 'staging-dispatch-detail-before.png') });
} catch (err) {
  log('probe-error', { message: String(err).slice(0, 400) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'staging-probe.json'), JSON.stringify(LOG, null, 2));
  await browser.close();
}
