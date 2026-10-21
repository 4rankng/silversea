// DIS-08 lan-2 local driver — BEFORE/AFTER computed-weight sweep of every
// container identity line on both dispatch tables at 390/768/1440.
// Read-only UI: views + computed styles + screenshots only.
// Usage: node testplan/qa/scripts/2026-10-21-dis08-lan2-local-driver.mjs [before|after]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.argv[2] === 'after' ? 'after' : 'before';
const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
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

const token = await login(process.env.QA_USER || 'dieuvan');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
let exitCode = 0;
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const record = (id, pass, detail) => { log('RESULT', { phase: PHASE, id, pass, detail }); if (!pass) exitCode = 1; };

  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 });

    // ── /dispatch master plan ──
    await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(2400);
    const master = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.master-plan-grid tbody tr'));
      const cargoCont = [];
      const cargoMuted = [];
      const portName = [];
      const portSummary = [];
      for (const row of rows.slice(0, 8)) {
        const cargoCell = row.querySelector('td[data-label="Tổng quan hàng hóa"], td[data-label="Hàng"]');
        if (cargoCell) for (const el of cargoCell.querySelectorAll('.master-plan-grid__line')) {
          const entry = { t: (el.textContent || '').trim().slice(0, 20), w: Number(getComputedStyle(el).fontWeight) };
          if (el.classList.contains('master-plan-grid__line--muted')) cargoMuted.push(entry);
          else if (/^\d+\s*[x×*]/i.test(entry.t) || /cont/i.test(entry.t)) cargoCont.push(entry);
        }
        for (const block of row.querySelectorAll('.master-plan-grid__location-block')) {
          const lines = Array.from(block.children);
          if (lines[0]) portName.push({ t: (lines[0].textContent || '').trim().slice(0, 20), w: Number(getComputedStyle(lines[0]).fontWeight) });
          for (const el of lines.slice(1)) portSummary.push({ t: (el.textContent || '').trim().slice(0, 20), w: Number(getComputedStyle(el).fontWeight) });
        }
      }
      return { rows: rows.length, cargoCont, cargoMuted, portName, portSummary };
    });
    log('master-sample', { width, phase: PHASE, rows: master.rows, cargoCont: master.cargoCont.slice(0, 4), portSummary: master.portSummary.slice(0, 3), portName: master.portName.slice(0, 2), cargoMuted: master.cargoMuted.slice(0, 2) });
    if (master.cargoCont.length > 0) {
      const allBold = master.cargoCont.every((x) => x.w >= 600);
      record(`DIS08-L2-01@${width}`, allBold, JSON.stringify(master.cargoCont.slice(0, 5)));
    } else {
      record(`DIS08-L2-01@${width}`, false, 'no container count lines found in cargo column');
    }
    if (master.portSummary.length > 0) {
      record(`DIS08-L2-02a@${width}`, master.portSummary.every((x) => x.w >= 600), JSON.stringify(master.portSummary.slice(0, 4)));
    }
    if (master.portName.length > 0) {
      record(`DIS08-L2-02b@${width}`, master.portName.every((x) => x.w <= 400), JSON.stringify(master.portName.slice(0, 4)));
    }
    await page.screenshot({ path: path.join(OUT, `local-dispatch-${PHASE}-${width}.png`) });

    // ── /dispatch-detail ──
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(2400);
    const detail = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.detailed-plan-grid tbody tr')).slice(0, 8);
      const cont = [];
      const ports = [];
      for (const row of rows) {
        const cs = row.querySelector('.detailed-plan-grid__cell--container .detailed-plan-grid__line--strong, [data-label="Container"] .detailed-plan-grid__line--strong');
        if (cs) cont.push({ t: cs.textContent.trim().slice(0, 18), w: Number(getComputedStyle(cs).fontWeight) });
        const pc = row.querySelector('.detailed-plan-grid__cell--ports .detailed-plan-grid__line, [data-label="Nâng hàng"] .detailed-plan-grid__line');
        if (pc) ports.push({ t: pc.textContent.trim().slice(0, 18), w: Number(getComputedStyle(pc).fontWeight) });
      }
      return { rows: rows.length, cont, ports };
    });
    log('detail-sample', { width, phase: PHASE, rows: detail.rows, cont: detail.cont.slice(0, 4), ports: detail.ports.slice(0, 3) });
    if (detail.cont.length > 0) {
      record(`DIS08-L2-03a@${width}`, detail.cont.every((x) => x.w >= 600), JSON.stringify(detail.cont.slice(0, 5)));
    } else {
      record(`DIS08-L2-03a@${width}`, false, 'no container serial lines found');
    }
    if (detail.ports.length > 0) {
      record(`DIS08-L2-03b@${width}`, detail.ports.every((x) => x.w <= 400), JSON.stringify(detail.ports.slice(0, 4)));
    }
    await page.screenshot({ path: path.join(OUT, `local-dispatch-detail-${PHASE}-${width}.png`) });
  }

  // Read-only persisted-state identity (§9.3): the API rows behind the screens
  // are unchanged by a styling pass — capture cont serials as data identity.
  const apiRows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=5`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((b) => (b.items ?? []).map((i) => ({ cont: i.container?.containerNumber ?? null, status: i.taskStatus })))
    .catch((e) => [{ error: String(e).slice(0, 120) }]);
  log('api-identity', { phase: PHASE, rows: apiRows });
} catch (err) {
  log('driver-error', { message: String(err).slice(0, 400) });
  exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, `local-driver-${PHASE}.log.json`), JSON.stringify(LOG, null, 2));
  console.log(`exit=${exitCode}`);
  await browser.close();
  process.exit(exitCode);
}
