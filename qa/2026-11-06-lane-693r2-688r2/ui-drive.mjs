// SIL-693 r2 + SIL-688 r2 — UI DRIVEN evidence driver (rung 3, local worktree
// stack: FE :7185 → BE :3003, shared dev DB :5441).
// Flows:
//   1. /shipments-debit (admin): select unpriced locked lot 779059
//      (SHP-2611-00307) → Xuất Debit Note → toast MUST carry the BE remedy
//      verbatim (before the fix it collapsed into the generic retry line).
//   2. Same board: select 779038 (SHP-2611-00299, already inside note 15) →
//      Xuất Debit Note → toast MUST name the overlap (pre-check 409), not the
//      idempotency actor-collision mask.
//   3. /shipments/779058 (LCL, plan fulfillment present, no live trip): Xóa lô
//      MUST be armed (before the fix: permanently disabled), confirm modal
//      reason required, delete succeeds, toast 'Đã xóa lô hàng.'
// Run: node qa/2026-11-06-lane-693r2-688r2/ui-drive.mjs  (exit 0 = all PASS)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3003/api';
const OUT = path.resolve('qa/2026-11-06-lane-693r2-688r2');
const LOG = path.join(OUT, 'ui-driver.log');

fs.mkdirSync(OUT, { recursive: true });
const say = (...lines) => {
  for (const line of lines) { console.log(line); fs.appendFileSync(LOG, line + '\n'); }
};
fs.writeFileSync(LOG, `# SIL-693r2/688r2 UI drive — ${new Date().toISOString()} — FE ${FE} BE ${API}\n`);

const shot = async (page, name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  say(`SHOT ${name}`);
};

const fail = (msg) => { say(`FAIL ${msg}`); process.exitCode = 1; throw new Error(msg); };

const login = async (identifier) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const j = await r.json();
  if (!r.ok || !j.token) fail(`login ${identifier}: ${r.status}`);
  return j.token;
};

const bodyHas = (page, text, label) => page.waitForFunction(
  (t) => document.body?.innerText?.includes(t), { timeout: 20000 }, text,
).catch(async (err) => {
  const dump = await page.evaluate(() => ({
    url: location.href,
    text: document.body?.innerText?.slice(0, 600) ?? '',
  }));
  say(`WAIT-FAIL [${label ?? text}] ${JSON.stringify(dump)}`);
  throw err;
});

async function main() {
  const token = await login('admin');
  say('LOGIN admin ok');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ── Flow 1+2: settlement board toasts ─────────────────────────────────
  // Rows display Số Bill/Booking (display law) — tick by booking label, not
  // shipment code. 779059 → QA693R2-UNPRICED, 779038 → QA-MC-B.
  await page.goto(`${FE}/shipments-debit?customer=1`, { waitUntil: 'domcontentloaded' });
  await bodyHas(page, 'QA693R2-UNPRICED', 'row-779059');
  await bodyHas(page, 'QA-MC-B', 'row-779038');
  await shot(page, '01-debit-board-loaded-1440.png');

  // merge mode reveals the per-row ticks
  const mergeBtn = await page.waitForSelector('button[aria-pressed="false"]::-p-text(Gộp hàng)', { timeout: 10000 })
    .catch(() => null);
  if (!mergeBtn) fail('Gộp hàng toggle not found');
  await mergeBtn.click();
  await bodyHas(page, 'Thoát gộp hàng');
  say('MERGE MODE on');

  const tick = async (label) => {
    const result = await page.evaluate((needle) => {
      const row = [...document.querySelectorAll('.shipment-debit-row')]
        .find((r) => r.textContent?.includes(needle));
      if (!row) return 'no-row';
      const cb = row.querySelector('input[type="checkbox"]');
      if (!cb) return 'no-checkbox';
      cb.click();
      return row.hasAttribute('data-selected') ? 'clicked-selected' : 'clicked';
    }, label);
    if (result === 'no-row') fail(`tick: row for ${label} not found`);
    if (result === 'no-checkbox') fail(`tick: checkbox missing for ${label} (merge mode off?)`);
    say(`TICK ${label} → ${result}`);
  };
  const exportBtn = async () => {
    const btn = await page.waitForSelector('button::-p-text(Xuất Debit Note)', { timeout: 10000 })
      .catch(() => null);
    if (!btn) fail('Xuất Debit Note button not found');
    const disabled = await page.evaluate((el) => el.disabled || el.getAttribute('aria-disabled') === 'true', btn);
    if (disabled) fail('Xuất Debit Note button not armed after tick');
    return btn;
  };
  const waitToast = async (needle, label) => {
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('.toast__message')].some((el) => el.textContent?.includes(n)),
      { timeout: 15000 }, needle,
    ).catch(() => fail(`toast missing needle "${needle}" (${label})`));
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('.toast__message')].map((el) => el.textContent).join(' | '));
    say(`TOAST[${label}] ${text}`);
    return text;
  };

  // Flow 1 — unpriced remedy, verbatim
  await tick('QA693R2-UNPRICED');
  await (await exportBtn()).click();
  const remedy = await waitToast('chưa được định giá', 'remedy');
  if (!remedy.includes('SHP-2611-00307') || !remedy.includes('Quyết toán')) {
    fail(`remedy toast incomplete: ${remedy}`);
  }
  if (remedy.includes('Không xuất được Debit Note. Vui lòng thử lại.')) {
    fail(`generic toast swallowed the remedy: ${remedy}`);
  }
  await shot(page, '02-unpriced-remedy-toast-1440.png');

  // Flow 2 — already-in-note overlap (pre-check 409, friendly naming)
  await tick('QA-MC-B');
  await (await exportBtn()).click();
  const overlap = await waitToast('nằm trong Debit Note', 'overlap');
  if (overlap.includes('thuộc về người thực hiện khác')) fail(`actor-collision surfaced: ${overlap}`);
  await shot(page, '03-overlap-in-note-toast-1440.png');

  // 390 spot-check: the same board face on phone (toast law, no clipping)
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, '04-debit-board-390.png');
  await page.setViewport({ width: 1440, height: 900 });

  // ── Flow 3: LCL delete armed + real delete ────────────────────────────
  await page.goto(`${FE}/shipments/779058`, { waitUntil: 'domcontentloaded' });
  // The view form keeps identities in input values (not innerText) — wait on
  // the control itself; armed = aria-label exactly 'Xóa lô'.
  const del = await page.waitForSelector('button[aria-label="Xóa lô"]', { timeout: 20000 })
    .catch(async () => {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent?.trim())
          .filter((t) => t && t.includes('Xóa')));
      say(`DELETE-LABELS ${JSON.stringify(labels)}`);
      return null;
    });
  if (!del) fail('armed Xóa lô button (aria-label="Xóa lô") not found on /shipments/779058');
  const delState = await page.evaluate((el) => ({ disabled: el.disabled, aria: el.getAttribute('aria-label') }), del);
  say(`DELETE ARMED ${JSON.stringify(delState)}`);
  if (delState.disabled) fail('Xóa lô disabled for LCL lot with plan fulfillment only');
  await shot(page, '05-lcl-delete-armed-1440.png');

  await del.click();
  await page.waitForSelector('#shipment-delete-lot-reason', { timeout: 10000 }).catch(() => fail('confirm modal reason textarea not found'));
  const confirmBtnSel = 'div[class*="modal"] button::-p-text(Xóa lô hàng)';
  const confirm = await page.waitForSelector(confirmBtnSel, { timeout: 10000 }).catch(() => null);
  if (!confirm) fail('confirm button Xóa lô hàng not found');
  const confirmDisabled = await page.evaluate((el) => el.disabled, confirm);
  if (!confirmDisabled) fail('confirm button armed WITHOUT a reason — reason must be mandatory');
  say('CONFIRM gated on reason: true');
  await page.type('#shipment-delete-lot-reason', 'QA lane SIL-693r2/688r2 — xóa lô test');
  await new Promise((r) => setTimeout(r, 200));
  const confirm2 = await page.waitForSelector(confirmBtnSel, { timeout: 10000 });
  if (await page.evaluate((el) => el.disabled, confirm2)) fail('confirm still disabled after reason typed');
  await confirm2.click();
  await waitToast('Đã xóa lô hàng.', 'deleted');
  await shot(page, '06-lcl-deleted-toast-1440.png');

  await browser.close();
  say('DRIVE DONE');
}

main().catch((err) => { say(`DRIVE ERROR ${err.message}`); process.exit(process.exitCode || 1); });
