// SIL-700 (id 820) — UI DRIVEN: /advances vai Kế toán sees "Xác nhận giải
// ngân tạm ứng" (NOT "PHÊ DUYỆT TẠM ỨNG") on the PENDING row, both desktop
// and mobile; clicking still runs the UNCHANGED approve flow (SIL-455: row
// flips to "Đã ghi nhận").
// Run: node qa/2026-11-06-lane-693r2-688r2/sil700-drive.mjs  (exit 0 = PASS)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3003/api';
const OUT = path.resolve('qa/2026-11-06-lane-693r2-688r2');
const LOG = path.join(OUT, 'sil700-driver.log');
fs.writeFileSync(LOG, `# SIL-700 UI drive — ${new Date().toISOString()} — FE ${FE} BE ${API}\n`);
const say = (...l) => { for (const x of l) { console.log(x); fs.appendFileSync(LOG, x + '\n'); } };
const fail = (m) => { say(`FAIL ${m}`); process.exitCode = 1; throw new Error(m); };

const login = async (identifier) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const j = await r.json();
  if (!r.ok || !j.token) fail(`login ${identifier}: ${r.status}`);
  return j.token;
};

async function main() {
  // 1. OPS creates a PENDING request (the ticket's repro step).
  const ops = await login('giaonhan');
  const cr = await fetch(`${API}/ops/wallet/advance-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ops}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-sil700-${Date.now()}` },
    body: JSON.stringify({ amount: 50000, reason: 'QA SIL-700 — tạm ứng test đổi nhãn' }),
  });
  const cj = await cr.json();
  const requestId = cj.id ?? cj.request?.id;
  say(`CREATE OPS request ${cr.status} id=${requestId} status=${cj.status ?? cj.request?.status}`);
  if (cr.status !== 201 || cj.status !== 'PENDING') fail(`create request did not land PENDING: ${cr.status} ${JSON.stringify(cj).slice(0, 200)}`);

  // 2. Kế toán opens /advances.
  const ketoan = await login('ketoan');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoan);
  await page.goto(`${FE}/advances`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body?.innerText?.includes('QA SIL-700'),
    { timeout: 20000 },
  ).catch(() => fail('PENDING row (QA SIL-700) not rendered on /advances'));

  const counts = await page.evaluate(() => ({
    newLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Xác nhận giải ngân tạm ứng').length,
    oldLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'PHÊ DUYỆT TẠM ỨNG').length,
  }));
  say(`LABELS desktop: new=${counts.newLabel} old=${counts.oldLabel}`);
  if (counts.oldLabel > 0) fail(`old label PHÊ DUYỆT TẠM ỨNG still rendered (${counts.oldLabel})`);
  if (counts.newLabel === 0) fail('new label Xác nhận giải ngân tạm ứng missing');
  await page.screenshot({ path: path.join(OUT, '07-sil700-advances-label-1440.png') });
  say('SHOT 07-sil700-advances-label-1440.png');

  // 3. Click — flow UNCHANGED: row flips to "Đã ghi nhận".
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Xác nhận giải ngân tạm ứng');
    b.click();
  });
  await page.waitForFunction(
    () => document.body?.innerText?.includes('Đã ghi nhận') && document.body?.innerText?.includes('QA SIL-700'),
    { timeout: 15000 },
  ).catch(() => fail('row did not flip to Đã ghi nhận after click'));
  const after = await page.evaluate(() => ({
    oldLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'PHÊ DUYỆT TẠM ỨNG').length,
    newLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Xác nhận giải ngân tạm ứng').filter((b) => !b.disabled).length,
  }));
  say(`AFTER CLICK: recorded row visible, remaining armed new-label buttons=${after.newLabel}, old=${after.oldLabel}`);
  await page.screenshot({ path: path.join(OUT, '08-sil700-after-click-1440.png') });
  say('SHOT 08-sil700-after-click-1440.png');

  // 4. Mobile spot-check (390): the same new label on the card face.
  const apiRows = await (await fetch(`${API}/advance-requests?status=PENDING`, { headers: { Authorization: `Bearer ${ketoan}` } })).json();
  if ((apiRows.items ?? []).length === 0) fail('no PENDING row left for the mobile check');
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Xác nhận giải ngân tạm ứng'),
    { timeout: 20000 },
  ).catch(() => fail('mobile face missing the new label'));
  const mob = await page.evaluate(() => ({
    newLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Xác nhận giải ngân tạm ứng').length,
    oldLabel: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'PHÊ DUYỆT TẠM ỨNG').length,
  }));
  say(`LABELS mobile(390): new=${mob.newLabel} old=${mob.oldLabel}`);
  if (mob.oldLabel > 0) fail('old label on mobile face');
  await page.screenshot({ path: path.join(OUT, '09-sil700-advances-mobile-390.png') });
  say('SHOT 09-sil700-advances-mobile-390.png');

  await browser.close();
  say('SIL700 DRIVE DONE');
}

main().catch((e) => { say(`DRIVE ERROR ${e.message}`); process.exit(process.exitCode || 1); });
