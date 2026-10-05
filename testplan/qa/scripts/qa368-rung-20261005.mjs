// Card 20261005_368 — staging rung: the normalized error must reach the UI
// bundle; a non-JSON 4xx/5xx body must never print `<html`/`<body`.
// Staging serves JSON error bodies (authMiddleware + errorHandler), so the
// non-JSON path is exercised by CONTROLLED response injection against the
// DEPLOYED bundle's blob endpoint (api.getBlob) — disclosed in the report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { launch, shot, setViewport, domText } from './lead-qa-lib.mjs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = process.argv[2] || 'testplan/qa/evidence/2026-10-05_368-loi-raw-body-khi-backend-tra-text-html';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = []; const note = (s) => { log.push(s); console.log(s); };

const HTML_BODY = '<!DOCTYPE html>\n<html lang="vi"><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>';

async function tok(user) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: user, password: 'Abc123' }) });
  return (await r.json()).token;
}
async function rolePage(browser, user) {
  const token = await tok(user);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t, origin) => {
    if (location.origin === origin) localStorage.setItem('token', t);
    window.__probe = { pointerdown: 0, click: 0, keydown: 0, any: 0, anyPointer: 0 };
    for (const ev of ['pointerdown', 'click', 'keydown']) document.addEventListener(ev, (e) => { window.__probe.any += 1; if (ev === 'pointerdown') window.__probe.anyPointer += 1; if (e.isTrusted) window.__probe[ev] += 1; }, { capture: true, passive: true });
  }, token, BASE);
  page.on('pageerror', (e) => note(`  [pageerror] ${e.message}`));
  return { ctx, page, token, user };
}
async function clickText(page, text) {
  const h = await page.evaluateHandle((t) => Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"]')).find((n) => (n.innerText || '').trim().includes(t) && n.offsetParent !== null) || null, text);
  const el = h.asElement(); if (!el) throw new Error(`no control "${text}"`);
  const b = await el.boundingBox();
  const cx = Math.round(b.x + b.width / 2), cy = Math.round(b.y + b.height / 2);
  const probe = () => page.evaluate(() => ({ ...window.__probe }));
  const before = await probe();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await settle(700);
  const after = await probe();
  if (after.pointerdown <= before.pointerdown) throw new Error(`no trusted pointerdown for "${text}"`);
}

async function main() {
  await fs.mkdir(EV, { recursive: true });
  const health = await (await fetch(`${API}/health`)).json();
  note(`HEALTH status=${health.status} buildHash=${health.buildHash}`);
  await fs.writeFile(path.join(EV, 'health.json'), JSON.stringify(health, null, 2));
  if (health.buildHash !== '19ed100f') { await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n')); process.exit(2); }

  const results = {};
  const { browser } = await launch({ width: 1440, height: 900, base: BASE });
  const adm = await rolePage(browser, 'admin');

  const arm = async (status) => {
    await adm.page.setRequestInterception(true);
    const handler = (req) => {
      if (req.url().includes('/fleet/productivity/monthly/export')) {
        req.respond({ status, contentType: 'text/html', body: HTML_BODY }).catch(() => {});
      } else req.continue().catch(() => {});
    };
    adm.page.on('request', handler);
    return async () => { adm.page.off('request', handler); await adm.page.setRequestInterception(false); };
  };

  // baseline: the export surface loads
  await adm.page.goto(`${BASE}/fleet/productivity`, { waitUntil: 'networkidle2', timeout: 60000 });
  await settle(2000);
  await clickText(adm.page, 'Từng xe trong 1 tháng');
  await settle(2000);
  await shot(adm.page, path.join(EV, '368_00_monthly_baseline.png'), { full: false });

  const runCase = async (status, label) => {
    const disarm = await arm(status);
    try {
      await clickText(adm.page, 'Xuất Excel');
      await settle(2500);
    } finally { await disarm(); }
    const alerts = await adm.page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.innerText.trim()).filter(Boolean));
    const bodyText = await domText(adm.page, 'body');
    const pageHtml = await adm.page.evaluate(() => document.body.innerHTML);
    const r = {
      injectedStatus: status,
      alerts,
      printsRawHtml: /<html|<body|<!DOCTYPE/i.test(bodyText),
      alertContainsRawHtml: alerts.some((a) => /<html|<body|DOCTYPE/i.test(a)),
      htmlFragmentInDom: /<\/?html|<\/?body/i.test(pageHtml),
    };
    await shot(adm.page, path.join(EV, label), { full: false });
    return r;
  };

  // 502 text/html (card headline case): export surface falls back for 5xx,
  // but must NEVER render the raw body.
  results.s502 = await runCase(502, '368_01_502_html.png');
  note(`  502 -> alerts=${JSON.stringify(results.s502.alerts)} printsRawHtml=${results.s502.printsRawHtml} alertHtml=${results.s502.alertContainsRawHtml}`);

  // 409 text/html (non-JSON 4xx): the 4xx branch leads with err.message, which
  // must be the normalized status-aware string, never the HTML page.
  results.s409 = await runCase(409, '368_02_409_html.png');
  note(`  409 -> alerts=${JSON.stringify(results.s409.alerts)} printsRawHtml=${results.s409.printsRawHtml} alertHtml=${results.s409.alertContainsRawHtml}`);

  // state matrix of the export screen (viewport at 4 widths)
  for (const w of [1280, 1440, 1920, 2560]) {
    await setViewport(adm.page, w, 900); await settle(700);
    await shot(adm.page, path.join(EV, `368_03_monthly_w${w}.png`), { full: false });
  }
  await setViewport(adm.page, 1440, 900);

  await adm.ctx.close();
  await browser.close();
  await fs.writeFile(path.join(EV, 'rung-results.json'), JSON.stringify({ build: health.buildHash, results }, null, 2));
  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  note('DONE');
}
main().catch(async (e) => { note(`FATAL ${e.stack || e.message}`); try { await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n')); } catch {} process.exit(1); });
