// Follow-up probe: exact wrap detection (text-range rects per th) on
// /shipments/new, plus /trips/new carrier-branch state dump (why does the
// OWN branch with the quick-add not render?) and the dispatch detail-plan
// surface discovery for FB-066.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status}`);
  return body.token;
}
async function openAuthed(browser, identifier, url, viewport) {
  const token = await login(identifier);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 45000 });
  return page;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  // Exact wrap: number of distinct line boxes per th label.
  for (const width of [1440, 1366, 1280]) {
    const page = await openAuthed(browser, 'admin', '/shipments/new', { width, height: 900 });
    await sleep(1200);
    const headers = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('.csc-container-table thead th')];
      return ths.map((th) => {
        const range = document.createRange();
        range.selectNodeContents(th);
        const rects = [...range.getClientRects()].filter((r) => r.height > 1);
        // Merge rects on the same line (y-overlap) → true line count.
        const lines = [];
        for (const r of rects) {
          const hit = lines.find((l) => Math.abs(l.top - r.top) < r.height * 0.6);
          if (hit) hit.width += r.width; else lines.push({ top: r.top, width: r.width });
        }
        return { label: th.textContent.trim(), lineCount: lines.length };
      });
    });
    const wrapped = headers.filter((h) => h.lineCount > 1);
    log('fb063-exact-wrap', { width, headers, wrappedLabels: wrapped.map((w) => w.label) });
    await page.close();
  }

  // /trips/new state dump — why is the OWN branch absent?
  {
    const page = await openAuthed(browser, 'giaonhan', '/trips/new', { width: 1440, height: 900 });
    await sleep(2000);
    const dump = await page.evaluate(() => {
      const text = document.body.innerText;
      const radios = [...document.querySelectorAll('input[type=radio], [role=radio], .tc-carrier *, label')].slice(0, 40).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), txt: (el.textContent || '').trim().slice(0, 40) })).filter((x) => x.txt);
      return {
        url: location.href,
        hasTruckField: !!document.querySelector('#truckId, [data-label="Xe đầu kéo"], select[name*=truck]'),
        hasCarrierHeading: text.includes('Xe ngoài') || text.includes('Nhà xe') || text.includes('Đơn vị vận chuyển'),
        headingSample: text.split('\n').filter(Boolean).slice(0, 40),
        radioish: radios.slice(0, 12),
      };
    });
    log('fb066-trips-new-dump', dump);
    await page.screenshot({ path: path.join(OUT, 'fb066-before-trips-new-state.png'), fullPage: true });
    await page.close();
  }

  // Dispatch detail plan: find the detailed-plan surface route.
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 900 });
    await sleep(1500);
    const links = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 40) })).filter((l) => l.href));
    log('fb066-dispatch-links', { links: links.slice(0, 30) });
    await page.close();
  }
  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'repro-before-probe.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
