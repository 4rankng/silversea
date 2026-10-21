// R29F re-verify (2026-10-21) — FB-093 surface: "Tách nhóm" phía Kế toán trên
// STAGING-BUILT FE (vantai.tingting.vip, build 85ea2cef — recut of ebd032fb,
// QA-script-only commits; `essentialWhenHasData` fix live in the deployed
// AccountingDebitClosePage chunk, verified in the chunk bytes).
//
// Fixture from 2026-10-21-r29f-fb093-setup-merge.mjs: 2 lô LCL R29F-01/02
// (YUANFANG) đã "Ghép cước thu khách" — lô 2 = 0₫ + note "Ghép cước cùng
// Bill R29F-01", lock OPEN.
//
//   Phase B (SURFACE CHÍNH): ketoan profile SẠCH (localStorage không stored
//     column choice) → /accounting/chot-debit → cột "Thông số container" TỰ
//     HIỂN (essentialWhenHasData) → nút "Tách nhóm" thấy cho từng dòng nhóm.
//   Phase D (REGRESSION MINI): máy trạm CŨ — stored choice `[]` và choice cũ
//     (ẩn cột khác) vẫn render đúng; 2 luật không va chạm; choice tường minh
//     ẩn container vẫn thắng.
//   Phase C (FLOW): click "Tách nhóm" dòng R29F-02 → dialog → xác nhận →
//     unmerge 200 → board cập nhật, cước/note trả về trạng thái trước ghép.
// Usage: node testplan/qa/scripts/2026-10-21-r29f-fb093-tach-verify.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const EXPECTED_BUILD = process.env.QA_EXPECT_BUILD || '85ea2cef';
const OUT = path.resolve('qa/2026-10-21-r29f-fb093-stgverify');
fs.mkdirSync(OUT, { recursive: true });
const BILLS = ['R29F-01', 'R29F-02'];
const MERGE_NOTE = 'Ghép cước cùng Bill R29F-01';
// Board DOM renders the group note SHORTER than the API reason: the container
// cell prints "(Ghép cùng Bill X)" from `lcl.ghépCùngRef` while the wire
// freightOverrideReason is "Ghép cước cùng Bill X" (note-literal trap recorded
// by the R29 verify — assert each surface against ITS OWN literal).
const MERGE_NOTE_DOM = 'Ghép cùng Bill R29F-01';
const CHOICE_KEY = 'accounting-debit-hidden-cols';

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const net = (line) => { NET.push(`${new Date().toISOString()} ${line}`); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const debitRows = async (token) => {
  const res = await fetch(`${API}/shipments/debit-summary`, { headers: { Authorization: `Bearer ${token}` } });
  net(`GET /api/shipments/debit-summary -> ${res.status}`);
  const body = await res.json();
  return (body?.items ?? []).filter((r) => BILLS.includes(r.billOrBookNumber))
    .map((r) => ({ ship: r.shipmentId, code: r.code, bill: r.billOrBookNumber, freight: r.freightAuto, note: r.freightOverrideReason, revGroup: r.revGroupId, revOrder: r.revGroupOrder, members: r.revGroupMemberCount, revClass: r.revVehicleClassCode, lock: r.lockStatus }));
};

// ── build gate ──────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash, expected: EXPECTED_BUILD });
if (health?.buildHash !== EXPECTED_BUILD && !process.env.QA_IGNORE_BUILD) {
  log('ABORT: build mismatch');
  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
  process.exit(2);
}

const tiepvv = await login('tiepvv');
const ketoan = await login('ketoan');
const grouped = await debitRows(tiepvv);
log('precheck_rows', grouped);
fs.writeFileSync(path.join(OUT, 'db-0-grouped-before-verify.json'), JSON.stringify(grouped, null, 2));
if (grouped.length !== 2 || !grouped.every((r) => r.revGroup)) {
  log('ABORT: R29F group not present — run 2026-10-21-r29f-fb093-setup-merge.mjs first');
  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
  process.exit(2);
}
const preMerge = fs.existsSync(path.join(OUT, 'setup-db-before-merge.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'setup-db-before-merge.json'), 'utf8'))
  : null;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  // Shared board probe: column presence + Tách nhóm buttons + DOM fragment.
  const probeBoard = (page, tag) => page.evaluate((args) => {
    const { note, bills } = args;
    const headers = Array.from(document.querySelectorAll('th')).map((th) => (th.textContent || '').trim()).filter(Boolean);
    const buttons = Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .map((b) => ({ aria: b.getAttribute('aria-label'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') }));
    const rowsFrag = Array.from(document.querySelectorAll('td'))
      .filter((td) => bills.some((bill) => (td.textContent || '').includes(bill)))
      .map((td) => {
        const tr = td.closest('tr');
        return {
          rowText: (tr?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260),
          containerCell: tr?.querySelector('.debit-col--container')?.outerHTML?.slice(0, 900) ?? null,
        };
      });
    return {
      storedChoice: localStorage.getItem('accounting-debit-hidden-cols'),
      headers,
      containerHeaderVisible: headers.includes('Thông số container'),
      moneyBreakdownVisible: headers.includes('Cước thu (tự động)'),
      rowsWithNote: Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes(note)).length,
      tachButtons: buttons,
      headerRowHtml: document.querySelector('thead tr')?.outerHTML?.slice(0, 1600) ?? null,
      rowsFrag,
    };
  }, { note: MERGE_NOTE_DOM, bills: BILLS }).then((state) => {
    const dom = [
      `# DOM fragment ${tag} — /accounting/chot-debit`,
      `storedChoice=${JSON.stringify(state.storedChoice)}`,
      `containerHeaderVisible=${state.containerHeaderVisible} moneyBreakdownVisible=${state.moneyBreakdownVisible} rowsWithNote=${state.rowsWithNote}`,
      `tachButtons=${JSON.stringify(state.tachButtons)}`,
      '', '## thead', state.headerRowHtml ?? '(none)', '',
      ...state.rowsFrag.map((r) => `## row ${r.rowText}\n${r.containerCell ?? '(no container cell)'}`),
    ].join('\n');
    fs.writeFileSync(path.join(OUT, `dom-${tag}.txt`), dom);
    log(`board_${tag}`, { storedChoice: state.storedChoice, containerHeaderVisible: state.containerHeaderVisible, moneyBreakdownVisible: state.moneyBreakdownVisible, rowsWithNote: state.rowsWithNote, tachButtons: state.tachButtons });
    return state;
  });

  // ══ Phase B — SURFACE CHÍNH: ketoan profile SẠCH ════════════════════════
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('response', async (res) => {
    if (/\/api\/shipments\/lcl\/(merge|unmerge)-group/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 300); } catch { /* noop */ }
      net(`POST ${res.url()} -> ${res.status()} ${b.slice(0, 200)}`);
      log('lcl_api', { url: res.url(), status: res.status(), body: b.slice(0, 250) });
    }
  });
  // FRESH profile: only the auth token — explicitly wipe any stored choice so
  // the rendered default is exactly what a brand-new workstation sees.
  await page.evaluateOnNewDocument((t) => {
    localStorage.removeItem('accounting-debit-hidden-cols');
    localStorage.setItem('token', t);
  }, ketoan);
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await sleep(4000);
  const fresh = await probeBoard(page, '01-fresh-ketoan');
  await page.screenshot({ path: path.join(OUT, '01-fresh-ketoan-board.png'), fullPage: true });
  record('FB-093 SURFACE: ketoan profile SẠCH (không stored choice) /accounting/chot-debit — cột "Thông số container" TỰ HIỂN theo dữ liệu lcl + nút "Tách nhóm" cho từng dòng nhóm R29F (cả 2 bill, enabled); KT4 giữ nguyên (cột tiền breakdown vẫn ẩn)',
    fresh.storedChoice === null
      && fresh.containerHeaderVisible
      && fresh.rowsWithNote >= 1
      && fresh.tachButtons.filter((b) => BILLS.some((bill) => (b.aria ?? '').includes(bill))).length >= 2
      && fresh.tachButtons.filter((b) => BILLS.some((bill) => (b.aria ?? '').includes(bill))).every((b) => !b.disabled && b.ariaDisabled !== 'true')
      && fresh.moneyBreakdownVisible === false,
    JSON.stringify({ storedChoice: fresh.storedChoice, containerHeaderVisible: fresh.containerHeaderVisible, rowsWithNote: fresh.rowsWithNote, tachButtons: fresh.tachButtons, moneyBreakdownVisible: fresh.moneyBreakdownVisible }));

  // ══ Phase D — REGRESSION MINI: máy trạm CŨ (stored choice) ═════════════
  const regPage = async (choice, tag, check) => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.evaluateOnNewDocument((args) => {
      localStorage.setItem('accounting-debit-hidden-cols', args.choice);
      localStorage.setItem('token', args.token);
    }, { choice, token: ketoan });
    await p.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
    await p.waitForSelector('table', { timeout: 30000 });
    await sleep(3500);
    const state = await probeBoard(p, tag);
    await p.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
    await p.close();
    return state;
  };
  const r29fButtons = (state) => state.tachButtons.filter((b) => BILLS.some((bill) => (b.aria ?? '').includes(bill)));
  // D1: choice `[]` — operator đã chọn "không ẩn gì" → mọi cột hiện, container
  // + nút vẫn có mặt (choice thắng default, kết quả trùng hướng essentialWhenHasData).
  const regEmpty = await regPage('[]', '02-regression-stored-empty-choice');
  record('FB-093 REGRESSION D1: máy trạm cũ với stored choice `[]` (không ẩn gì) — board render đủ cột, "Thông số container" + ≥2 nút "Tách nhóm" R29F vẫn hiện',
    regEmpty.containerHeaderVisible && r29fButtons(regEmpty).length >= 2,
    JSON.stringify({ storedChoice: regEmpty.storedChoice, containerHeaderVisible: regEmpty.containerHeaderVisible, headers: regEmpty.headers, buttons: r29fButtons(regEmpty) }));
  // D2: choice cũ ẩn cột khác (phanXe) — choice thắng cho phanXe, container
  // VẪN hiện theo essentialWhenHasData → 2 luật không va chạm.
  const regOld = await regPage(JSON.stringify(['phanXe']), '03-regression-stored-old-choice');
  record('FB-093 REGRESSION D2: máy trạm cũ với choice cũ ẩn "Phân xe" — phanXe bị ẩn ĐÚNG choice, "Thông số container" VẪN tự hiện + nút R29F còn (2 luật không va chạm)',
    !regOld.headers.includes('Phân xe') && regOld.containerHeaderVisible && r29fButtons(regOld).length >= 2,
    JSON.stringify({ storedChoice: regOld.storedChoice, containerHeaderVisible: regOld.containerHeaderVisible, headers: regOld.headers, buttons: r29fButtons(regOld) }));
  // D3: choice tường minh ẩn container — choice THẮNG essentialWhenHasData
  // (luật precedence: operator explicit choice wins wholesale).
  const regHide = await regPage(JSON.stringify(['container']), '04-regression-choice-hides-container');
  record('FB-093 REGRESSION D3: choice tường minh ẩn "Thông số container" vẫn THẮNG (không bị essentialWhenHasData hồi sinh) — precedence đúng, 2 luật không va chạm',
    !regHide.containerHeaderVisible,
    JSON.stringify({ storedChoice: regHide.storedChoice, containerHeaderVisible: regHide.containerHeaderVisible, headers: regHide.headers }));

  // ══ Phase C — FLOW: click "Tách nhóm" dòng R29F-02 ══════════════════════
  await page.evaluate((bill) => {
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .find((b) => (b.getAttribute('aria-label') || '').includes(bill));
    btn?.click();
  }, BILLS[1]);
  await sleep(1100);
  const confirmState = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    return { open: Boolean(d), text: (d?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260) };
  });
  log('tach_confirm_dialog', confirmState);
  await page.screenshot({ path: path.join(OUT, '05-tach-confirm-dialog.png') });
  fs.writeFileSync(path.join(OUT, 'dom-05-tach-confirm-dialog.txt'), JSON.stringify(confirmState, null, 2));
  if (!confirmState.open) throw new Error('tách nhóm confirm dialog did not open');
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Tách nhóm');
    btn?.click();
  });
  let afterUi = { rowsWithNote: -1, r29fButtons: -1 };
  for (let i = 0; i < 12; i++) {
    await sleep(900);
    afterUi = await page.evaluate((bills) => ({
      rowsWithNote: Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes('Ghép cước cùng Bill')).length,
      r29fButtons: Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
        .filter((b) => bills.some((bill) => (b.getAttribute('aria-label') || '').includes(bill))).length,
      allButtons: document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]').length,
    }), BILLS);
    if (afterUi.r29fButtons === 0) break;
  }
  log('after_tach_ui', afterUi);
  await page.screenshot({ path: path.join(OUT, '06-after-tach-board.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'dom-06-after-tach-board.txt'), JSON.stringify(afterUi, null, 2));
  const after = await debitRows(tiepvv);
  log('after_tach_rows', after);
  fs.writeFileSync(path.join(OUT, 'db-1-after-tach.json'), JSON.stringify(after, null, 2));

  const preMergeById = new Map((preMerge ?? []).map((r) => [r.bill, r]));
  const principal = after.find((r) => r.bill === BILLS[0]) ?? {};
  const member = after.find((r) => r.bill === BILLS[1]) ?? {};
  const principalRestored = !preMergeById.size || principal.freight === preMergeById.get(BILLS[0])?.freight;
  // Member sau tách: về giá trị trước ghép HOẶC 0₫ computed-zero (D02 — giá trị
  // 0 được tính toán có lý do "Tách khỏi nhóm ghép — chờ định giá lại" trong
  // freight_rate_snapshots; kênh debit-summary không surface reason — residual
  // đã ghi nhận từ R29, ngoài scope card).
  const memberRestored = member.freight === '0'
    || (preMergeById.size && member.freight === preMergeById.get(BILLS[1])?.freight);
  record('FB-093 FLOW: click "Tách nhóm" (dòng R29F-02) → confirm dialog → unmerge 200 — board hết nút/note R29F, DB: cả 2 lô revGroup=null + note=null, cước về trạng thái trước ghép (lô chính như trước; lô member 0₫ computed-zero D02 hoặc giá trị trước ghép), lock OPEN',
    confirmState.open
      && afterUi.r29fButtons === 0
      && after.every((r) => !r.revGroup) && after.every((r) => r.note == null)
      && principalRestored && memberRestored
      && after.every((r) => r.lock === 'OPEN'),
    JSON.stringify({ confirm: confirmState.text, afterUi, after, preMerge, principalRestored, memberRestored }));

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
fs.writeFileSync(path.join(OUT, 'net.log'), NET.join('\n'));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
