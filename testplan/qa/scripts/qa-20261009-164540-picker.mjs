// Lead QA rung b — card 091026164540, staging be052c7a. Open the real dispatch
// editor, type the dead plate '60C-567' into the plate picker, assert it is NOT
// offered while other ACTIVE plates still are. dungnv, 1440.
import { launch, step, BASE } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-harness.mjs';
const dir = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-09_card164540-picker';
const log = `${dir}/driver-164540b.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
const { browser, page } = await launch({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
try {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const editBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối')));
  const btn = editBtn.asElement();
  if (!btn) throw new Error('no editor button');
  await btn.click();
  await sleep(2500);
  await page.screenshot({ path: `${dir}/editor-open-1440.png` });
  const plateInput = await page.evaluateHandle(() => [...document.querySelectorAll('input[placeholder]')].find((i) => /biển số/i.test(i.placeholder)));
  const inp = plateInput.asElement();
  if (!inp) throw new Error('no plate input');
  const readOptions = () => page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"], li[role="presentation"], [class*="option"]')].map((n) => (n.textContent || '').trim()).filter(Boolean);
    const empty = /không tìm thấy|no results/i.test(document.body.innerText);
    return { opts: opts.slice(0, 12), empty };
  });
  // search the dead plate
  await inp.click({ clickCount: 3 });
  await page.keyboard.type('60C-567', { delay: 40 });
  await sleep(1800);
  const dead = await readOptions();
  step(log, { step: 'search-dead', q: '60C-567', ...dead });
  await page.screenshot({ path: `${dir}/picker-dead-1440.png` });
  // clear + search the broad prefix as control
  await inp.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('60C', { delay: 40 });
  await sleep(1800);
  const ctrl = await readOptions();
  step(log, { step: 'search-control', q: '60C', ...ctrl });
  await page.screenshot({ path: `${dir}/picker-control-1440.png` });
  const deadListed = dead.opts.some((o) => o.includes('60C-567.89'));
  const activeAvailable = ctrl.opts.length > 0 && ctrl.opts.some((o) => /60C-\d/.test(o));
  const pass = !deadListed && activeAvailable;
  step(log, { step: 'DONE', verdict: pass ? 'PASS-dead-absent-active-present' : 'FAIL', deadListed, activeAvailable });
  console.log(pass ? 'PASS — dead tractor absent, active tractors listed' : `FAIL deadListed=${deadListed}`);
  process.exit(pass ? 0 : 1);
} catch (err) {
  step(log, { step: 'driver-error', error: String(err && err.message || err).slice(0, 200) });
  console.log('ERROR'); process.exit(1);
} finally { await browser.close(); }
