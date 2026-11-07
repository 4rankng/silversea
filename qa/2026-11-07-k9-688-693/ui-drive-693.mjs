// SIL-693 r3 — rung-3 UI DRIVEN v3 (final): the UI's real export flow —
// 📦 Gộp hàng reveals the CHỌN ticks (SIL-538), customer axis + lock criterion
// ride URL params, [Xuất Debit Note] needs them all. Every text entry uses
// page.type (trusted keystrokes — synthetic events never reach React state).
//   guard leg   : 779059 (LOCKED, freightAuto null, SKIP NO_ROUTE) → remedy toast.
//   unlock leg  : 779234 (LOCKED, unclaimed) → MỞ KHÓA → KHÓA LÔ HÀNG lại.
//   pricing leg : 779237 (COMPLETED trip, OPEN) → giá tay 3.800.000 + Lưu cước
//                 thu → audit TRIP/manual/completedTrip → KHÓA → Xuất → FREIGHT.
// Stack: FE :7190 (this worktree) → BE :3003 (this worktree) → DB ss-prod-db:5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:7190';
const API = 'http://localhost:3003/api';
const DIR = 'qa/2026-11-07-k9-688-693';
const LOG = `${DIR}/ui-driver-693.log`;
mkdirSync(DIR, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== SIL-693 r3 UI drive v3 ${new Date().toISOString()} ===\n`);
const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-tAc', sql], { encoding: 'utf8' }).trim();

const login = async (identifier) => {
  const res = await fetch(`${BASE === '' ? 'http://x' : API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  const { token } = await res.json();
  log(`login ${identifier}: ${token ? 'OK' : 'FAIL'}`);
  return token;
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
let failures = 0;
const check = (name, ok, detail) => {
  failures += ok ? 0 : 1;
  log(`ASSERT ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const billOf = (id) => psql(`SELECT coalesce(nullif(booking_ref,''), nullif(bl_number,''), shipment_code) FROM shipments WHERE id=${id};`).trim();

async function openDebit(token, lock, customer = 1) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments-debit?customer=${customer}&lock=${lock}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(700);
  return page;
}

const waitRow = (page, bill) => page.waitForFunction((b) => {
  const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(b));
  return row ? 'row' : null;
}, { timeout: 25000, polling: 300 }, bill).then(() => 'row').catch(() => null);

/** Merge mode ON (📦 Gộp hàng) — the CHỌN ticks only exist inside it. */
const enterMergeMode = async (page) => {
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Gộp hàng'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await sleep(500);
  return clicked;
};

const tickLot = async (page, bill) => page.evaluate((b) => {
  const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(b));
  if (!row) return false;
  const box = row.querySelector('input[type="checkbox"]');
  if (box && !box.checked) box.click();
  return box != null;
}, bill);

const menuOpenDetails = async (page, bill) => {
  await page.evaluate((b) => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === `Hành động lô ${b}`);
    if (!btn) return false;
    btn.click();
    return true;
  }, bill);
  await sleep(350);
  return page.evaluate((b) => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? '').includes(`Mở chi tiết lô ${b}`));
    if (el) { el.click(); return true; }
    return false;
  }, bill);
};

const admin = await login('admin');
const accountant = await login('hoapt');

const guardLot = { id: 779059 };
const unlockLot = { id: 779234 };
const chainLot = { id: 779237 };
const guardBill = billOf(guardLot.id);
const unlockBill = billOf(unlockLot.id);
const chainBill = billOf(chainLot.id);
log(`lots — guard ${guardLot.id}=${guardBill} · unlock ${unlockLot.id}=${unlockBill} · chain ${chainLot.id}=${chainBill}`);

// Precondition: chain lot starts OPEN for the pricing leg.
const chainLockBefore = psql(`SELECT count(*) FROM shipment_cost_locks WHERE shipment_id=${chainLot.id} AND unlocked_at IS NULL;`);
if (chainLockBefore.trim() !== '0') {
  const res = await fetch(`${API}/shipments/${chainLot.id}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ reason: 'SIL-693 r3 UI drive v3: mở khóa trước chuỗi định giá UI' }),
  });
  log(`pre-unlock ${chainLot.id}: ${res.status}`);
}

try {
  // ── 1. Guard leg: remedy toast on the unpriced locked lot ─────────────────
  const p1 = await openDebit(admin, 'LOCKED');
  const rowSeen = await waitRow(p1, guardBill);
  check(`bảng Quyết toán (?lock=LOCKED) hiện lô ${guardBill}`, rowSeen === 'row');
  if (rowSeen) {
    await enterMergeMode(p1);
    await tickLot(p1, guardBill);
    await sleep(300);
    await p1.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Xuất Debit Note'));
      btn.click();
    });
    const toast = await page_waitRemedy(p1);
    check('Xuất Debit Note trên lô chưa định giá → toast remedy NGUYÊN VĂN', toast != null, (toast ?? '(no toast)').slice(0, 170));
    await p1.screenshot({ path: `${DIR}/693-01-guard-remedy-toast-1440.png` });
    log(`shot ${DIR}/693-01-guard-remedy-toast-1440.png`);
  }
  await p1.close();

  // ── 2. Unlock leg via UI ──────────────────────────────────────────────────
  const p2 = await openDebit(admin, 'LOCKED');
  await waitRow(p2, unlockBill);
  await menuOpenDetails(p2, unlockBill);
  const unlockSeen = await p2.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
    return b ? 'seen' : null;
  }, { timeout: 15000, polling: 300 }).then(() => 'seen').catch(() => null);
  check(`MỞ KHÓA hiển thị trên panel quyết toán của lô ${unlockBill}`, unlockSeen === 'seen');
  if (unlockSeen) {
    await p2.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
      b.click();
    });
    await sleep(700);
    const typed = await p2.evaluate(() => {
      const t = [...document.querySelectorAll('textarea')][0];
      return t != null;
    });
    if (typed) {
      await p2.click('textarea');
      await p2.type('textarea', 'SIL-693 r3 QA: mở khóa định giá bù remedy Debit Note');
      await sleep(300);
      await p2.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === 'Mở khóa' && !x.disabled);
        if (b) b.click();
      });
      await sleep(1500);
    }
    const activeAfterUnlock = psql(`SELECT count(*) FROM shipment_cost_locks WHERE shipment_id=${unlockLot.id} AND unlocked_at IS NULL;`);
    check('MỞ KHÓA qua UI (kế toán quyền mở, lý do bắt buộc) → DB hết active lock', activeAfterUnlock.trim() === '0', `active=${activeAfterUnlock}`);
    await p2.screenshot({ path: `${DIR}/693-02-unlocked-1440.png` });
    // Restore: KHÓA LÔ HÀNG lại qua cùng UI.
    await sleep(800);
    const relockSeen = await p2.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
      return b && !b.disabled ? 'seen' : null;
    }, { timeout: 15000, polling: 300 }).then(() => 'seen').catch(() => null);
    if (relockSeen) {
      await p2.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
        b.click();
      });
      await sleep(1500);
    }
    const activeAfterRelock = psql(`SELECT count(*) FROM shipment_cost_locks WHERE shipment_id=${unlockLot.id} AND unlocked_at IS NULL;`);
    check('KHÓA LÔ HÀNG lại qua UI → active lock 1', activeAfterRelock.trim() === '1', `active=${activeAfterRelock}`);
  }
  await p2.close();

  // ── 3. Pricing leg: REAL typed manual price on the COMPLETED-trip lot ─────
  const p3 = await openDebit(accountant, 'OPEN');
  const row3 = await waitRow(p3, chainBill);
  await menuOpenDetails(p3, chainBill);
  const inputSeen = await p3.waitForFunction(() => {
    const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '') === 'Bỏ trống = tự tra bảng giá');
    return i && !i.disabled ? 'seen' : null;
  }, { timeout: 20000, polling: 300 }).then(() => 'seen').catch(() => null);
  check(`ô Giá cước thu khách armed trên lô COMPLETED ${chainBill}`, row3 === 'row' && inputSeen === 'seen');
  if (inputSeen) {
    const clicked = await p3.evaluate(() => {
      const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '') === 'Bỏ trống = tự tra bảng giá');
      i.scrollIntoView({ block: 'center' });
      i.click();
      return true;
    });
    await p3.type('input[placeholder="Bỏ trống = tự tra bảng giá"]', '3800000');
    await sleep(400);
    const saveState = await p3.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Lưu cước thu'));
      return { found: b != null, disabled: b?.disabled ?? null };
    });
    check('Lưu cước thu enabled sau khi nhập giá (React state dirty)', clicked === true && saveState.found && saveState.disabled === false, JSON.stringify(saveState));
    await p3.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Lưu cước thu'));
      b.click();
    });
    await sleep(2000);
    const audit = psql(`SELECT payload::text FROM audit_logs WHERE entity_id=${chainLot.id} AND payload::text LIKE '%rev-class%' ORDER BY id DESC LIMIT 1;`);
    check('audit mới: TRIP + freightManual 3800000 + completedTrip (remedy thật trên UI)',
      /"channel": "TRIP"/.test(audit) && /"freightManual": "3800000"/.test(audit) && /"completedTrip": true/.test(audit),
      audit.slice(0, 200));
    await p3.screenshot({ path: `${DIR}/693-03-manual-price-saved-1440.png` });
  }
  await p3.close();

  // ── 4. Re-lock + export the priced lot → FREIGHT in DB ────────────────────
  const p4 = await openDebit(admin, 'LOCKED');
  const row4 = await waitRow(p4, chainBill);
  await menuOpenDetails(p4, chainBill);
  const lockSeen = await p4.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
    return b && !b.disabled ? 'seen' : null;
  }, { timeout: 15000, polling: 300 }).then(() => 'seen').catch(() => null);
  if (lockSeen) {
    await p4.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
      b.click();
    });
    await sleep(1500);
  }
  const freightAuto = psql(`SELECT cost_snapshot->>'freightAuto' FROM shipment_cost_locks WHERE shipment_id=${chainLot.id} AND unlocked_at IS NULL ORDER BY id DESC LIMIT 1;`);
  check('KHÓA LÔ HÀNG lại → freeze mang freightAuto 3800000', freightAuto.trim() === '3800000', `freightAuto=${freightAuto}`);
  await p4.screenshot({ path: `${DIR}/693-04-relocked-1440.png` });

  await enterMergeMode(p4);
  await tickLot(p4, chainBill);
  await sleep(300);
  await p4.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Xuất Debit Note'));
    btn.click();
  });
  await sleep(3000);
  const stillRemedy = await p4.evaluate(() => /chưa được định giá/.test(document.body.innerText));
  check('Xuất Debit Note sau định giá → KHÔNG còn toast remedy', row4 === 'row' && stillRemedy === false);
  await p4.screenshot({ path: `${DIR}/693-05-export-priced-ok-1440.png` });
  await p4.close();

  const noteLine = psql(`SELECT bdl.line_type || '|' || bdl.base_amount FROM billing_document_lines bdl JOIN debit_note_lots dnl ON dnl.document_id = bdl.document_id WHERE dnl.shipment_id = ${chainLot.id} AND dnl.released_at IS NULL ORDER BY bdl.id DESC LIMIT 3;`);
  check('DB: note mới mang dòng FREIGHT 3.800.000', /FREIGHT\|3800000/.test(noteLine), noteLine.replace(/\n/g, ' ; '));
} catch (err) {
  failures += 1;
  log(`DRIVE ERROR: ${err.message}`);
} finally {
  await browser.close();
}

log(`== SIL-693 UI drive v3: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ==`);
process.exitCode = failures === 0 ? 0 : 1;

async function page_waitRemedy(page) {
  try {
    await page.waitForFunction(() => /chưa được định giá/.test(document.body.innerText), { timeout: 15000, polling: 300 });
    return await page.evaluate(() => (document.body.innerText.match(/[^\n]*chưa được định giá[^\n]*/) ?? [''])[0]);
  } catch {
    return null;
  }
}
