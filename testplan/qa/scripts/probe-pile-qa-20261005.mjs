// Batch QA rungs on the 05d0cf60 staging build:
// - 362: choosing Lấy Lẻ in the dispatch editor seeds NO ĐẢO VỎ tag.
// - 360: the CUS quick-edit weight input hydrates without PG's dead decimals.
// - 361: grid computed weights — container line bolder than the port lines.
// Fresh-page-per-surface protocol (input-death days); comboboxes drive via
// eval-focus + trusted ArrowDown (react-aria inputs take programmatic focus).
// Usage: BASE=https://vantai.tingting.vip node <script>
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = 'qa/2026-10-05_batch-qa';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'dungnv', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
console.log(`API login OK (${process.env.IDENTIFIER || 'dungnv'})`);
const browser = await puppeteer.launch({ headless: 'new' });
const results = { build: (await (await fetch(`${BASE}/api/health`)).json()).buildHash, rungs: {} };
console.log('buildHash:', results.build);

async function freshPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  return page;
}

// ── 362: Lấy Lẻ seeds nothing ──
{
  const page = await freshPage();
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(3500);
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].find((b) => !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 20000 });
  await settle(400);
  // Open the Phân loại combobox (react-aria input: eval-focus + ArrowDown).
  const focused = await page.evaluate(() => {
    const input = [...document.querySelectorAll('[role="dialog"] input')]
      .find((i) => (i.getAttribute('aria-label') || '').includes('Phân loại') || (i.closest('label')?.textContent?.trim() || '').startsWith('Phân loại'));
    if (!input) return { ok: false, inputs: [...document.querySelectorAll('[role="dialog"] input')].map((i) => i.getAttribute('aria-label') || i.closest('label')?.textContent?.trim().slice(0, 20)).slice(0, 8) };
    input.focus();
    return { ok: document.activeElement === input };
  });
  console.log('362 combobox focus:', JSON.stringify(focused));
  await page.keyboard.press('ArrowDown');
  await settle(600);
  const picked = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Lấy Lẻ'));
    if (!opt) return { ok: false, options: [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()) };
    opt.click();
    return { ok: true };
  });
  console.log('362 pick Lấy Lẻ:', JSON.stringify(picked));
  await settle(800);
  const notes = await page.evaluate(() => {
    // The tag editor renders the WHOLE pool as toggle buttons — the seed bug
    // lit ĐẢO VỎ up automatically. Assert the button's active state, not its
    // presence.
    const daoVo = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === 'ĐẢO VỎ');
    return {
      daoVoClass: daoVo?.className ?? null,
      daoVoActive: daoVo ? /active|selected|is-on|bg-brand|bg-primary/.test(daoVo.className) : null,
    };
  });
  await page.screenshot({ path: `${OUT}/362-lay-le-no-seed.png` });
  results.rungs['362'] = { focused, picked, notes, verdict: picked.ok && notes.daoVoActive === false ? 'NO SEED (ĐẢO VỎ not activated)' : 'CHECK' };
  console.log('362 verdict:', results.rungs['362'].verdict, '| daoVo:', JSON.stringify(notes));
  await page.close();
}

// ── 361: grid weight comparison ──
{
  const page = await freshPage();
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(4000);
  const weights = await page.evaluate(() => {
    const cont = document.querySelector('.detailed-plan-grid__cell--container .detailed-plan-grid__line--strong');
    const port = document.querySelector('.detailed-plan-grid__cell--ports .detailed-plan-grid__line');
    const w = (el) => el ? getComputedStyle(el).fontWeight : null;
    return { container: cont ? { text: cont.textContent?.trim().slice(0, 14), weight: w(cont) } : null, port: port ? { text: port.textContent?.trim().slice(0, 14), weight: w(port) } : null };
  });
  await page.screenshot({ path: `${OUT}/361-grid-weights-1440.png` });
  const bold = weights.container?.weight && weights.port?.weight && Number(weights.container.weight) > Number(weights.port.weight);
  results.rungs['361'] = { weights, verdict: bold ? 'CONTAINER BOLDER THAN PORTS' : 'CHECK' };
  console.log('361 verdict:', results.rungs['361'].verdict, JSON.stringify(weights));
  await page.close();
}

writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 2));
await browser.close();
