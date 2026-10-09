// Lead QA rung — card 091026164540 on staging (build be052c7a). Vehicle picker
// must NOT list the dead tractor 60C-567.89 (status != ACTIVE) while active
// tractors remain selectable. dungnv, 1440.
import { launch, step, BASE } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-harness.mjs';
const dir = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-09_card164540-picker';
const log = `${dir}/driver-164540.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEAD = '60C-567';
const EXPECT = 'be052c7a';

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
step(log, { step: 'build-currency', buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { console.log('BUILD-CURRENCY FAIL'); process.exit(2); }

const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
if (!token) { step(log, { step: 'login-FAIL' }); process.exit(2); }

// wire-side control: what does the trucks endpoint return for the dead plate?
const H = { Authorization: `Bearer ${token}` };
const trucks = await fetch(`${BASE}/api/dispatch/trucks?limit=200`, { headers: H }).then((r) => r.json()).catch(() => null);
const wire = Array.isArray(trucks?.items) ? trucks.items.filter((t) => (t.plate || t.code || '').includes(DEAD)).map((t) => ({ plate: t.plate || t.code, status: t.status })) : trucks ? 'shape?' : 'fetch-fail';
const active = Array.isArray(trucks?.items) ? trucks.items.filter((t) => t.status === 'ACTIVE').slice(0, 3).map((t) => t.plate || t.code) : [];
step(log, { step: 'wire-control', deadOnWire: wire, activeSample: active });

const { browser, page } = await launch({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
try {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  await page.screenshot({ path: `${dir}/dispatch-detail-1440.png` });
  // find an editor entry: a cell/button that opens the plan editor with the vehicle picker
  const entry = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button,[role="button"],td')].filter((n) => /đầu kéo|phương tiện|xe đầu|chọn xe/i.test(n.textContent || n.getAttribute('aria-label') || ''));
    return { count: btns.length, labels: btns.slice(0, 5).map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40)) };
  });
  step(log, { step: 'entry-scan', ...entry });
  console.log(JSON.stringify(entry));
  await browser.close();
  process.exit(0);
} catch (err) {
  step(log, { step: 'driver-error', error: String(err && err.message || err).slice(0, 200) });
  await browser.close();
  process.exit(1);
}
