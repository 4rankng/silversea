// Card 377 — UI rung: the hoàn ứng report's spec-vocabulary headers
// ("Nhân viên ĐNTT", "Ghi chú") and report structure, on the local stack whose
// tree contains the landed fix 6332f272. Read-only.
import { loginApi, launch, shot, setViewport, logEvidence, sleep } from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card377-hoan-ung-report';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = async () => {
  const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  return (await r.json()).token;
};

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  let ok = false, h1 = '';
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    const token = await login();
    await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
    await page.goto('http://localhost:7175/accounting/hoan-ung', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3500);
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    ok = !/đăng nhập|hết hạn/i.test(h1) && h1.length > 0;
    log('attempt', { attempt, h1 });
  }
  if (!ok) throw new Error('page never reached: ' + h1);

  const contract = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    return {
      h1: text(document.querySelector('h1')),
      headers: [...document.querySelectorAll('table thead th')].map(text).slice(0, 16),
      headerSets: [...document.querySelectorAll('table')].map((t) => [...t.querySelectorAll('thead th')].map(text)),
      rowCount: document.querySelectorAll('tbody tr').length,
      sampleRow: text(document.querySelector('tbody tr'))?.slice(0, 200) ?? '',
      emptyOrFilter: text(document.querySelector('[role="alert"], [class*="empty" i]'))?.slice(0, 140) ?? '',
      hasDuyetControls: [...document.querySelectorAll('button')].some((b) => /Duyệt|Chọn trang này|Chọn tất cả/.test(b.textContent || '')),
    };
  });
  log('contract', contract);

  for (const width of [1280, 1440, 1920, 2560]) {
    await setViewport(page, width, 1000);
    await shot(page, `${EV}/377-hoan-ung-${width}-full.png`, { full: true });
    log('shot', { width });
  }
  logEvidence(EV, 'driver-377.json', { contract, log: LOG });
  console.log(`DONE headers=${JSON.stringify(contract.headerSets[0] ?? contract.headers)}`);
} finally {
  await browser.close();
}
