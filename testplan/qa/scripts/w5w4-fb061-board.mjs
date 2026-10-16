// FB-061 (card 141026012010) — Kiểm soát phơi phiếu board must not render the
// QA fixture class in its vehicle columns (or anywhere else). Read-only drive
// as ADMIN. DB census + sanctioned dry-run purge run separately (bash).
import { writeFileSync } from 'node:fs';
import { assertBuild, login, launch, makeLogger, installIdempotency, sleep } from './w5w4-lib.mjs';

const log = makeLogger('2026-10-16_w5w4_fb061');
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

// The card's signatures + the registry families the purge covers.
const SIGNATURES = /(99T-99999|51K-PROBE|Test Driver|KHO-SEAM|STG VERIFY|BL-QAKE|E2E-[0-9A-Z]|QA0915)/;

await assertBuild(log);
const token = await login('admin');
log('login admin OK');

const browser = await launch();
try {
  const page = await browser.newPage();
  installIdempotency(page);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto('https://vantai.tingting.vip/accounting/phoi-phieu', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('table', { timeout: 20000 });
  // Rows load async after the table shell.
  await page.waitForFunction(() => {
    const t = document.querySelector('table');
    return t && (t.querySelectorAll('tbody tr').length > 0 || document.body.innerText.includes('Chưa có'));
  }, { timeout: 30000, polling: 250 });
  await sleep(1200);

  const board = await page.evaluate(() => {
    const vehicleTh = document.querySelector('th.ppc-col--xe');
    const rows = [...document.querySelectorAll('table tbody tr')];
    return {
      title: document.querySelector('h1, [class*="page-header"], header')?.textContent.trim() || '',
      vehicleHeader: vehicleTh ? vehicleTh.textContent.trim() : null,
      rowCount: rows.length,
      text: document.querySelector('main, body').innerText,
    };
  });
  log(`FB-061: page header="${board.title.slice(0, 60)}"`);
  log(`FB-061: vehicle column header="${board.vehicleHeader}"`);
  log(`FB-061: board rows=${board.rowCount}`);
  expect(board.title.includes('Kiểm soát phơi phiếu') || board.text.includes('Kiểm soát phơi phiếu'), 'the Kiểm soát phơi phiếu board is on screen');
  expect(!!board.vehicleHeader, 'vehicle column (ppc-col--xe) renders');

  const hits = board.text.match(new RegExp(SIGNATURES.source, 'g')) || [];
  log(`FB-061: signature scan over full board text → ${hits.length === 0 ? '0 hits' : `HITS ${JSON.stringify(hits)}`}`);
  // Evidence regardless of verdict: save the board text + the context around
  // every hit (which row/cell renders the fixture).
  writeFileSync('qa/2026-10-16_w5w4_fb061_board-text.txt', board.text);
  log('FB-061: board text saved to qa/2026-10-16_w5w4_fb061_board-text.txt (evidence)');
  const contexts = await page.evaluate((src) => {
    const re = new RegExp(src, 'g');
    const rows = [...document.querySelectorAll('table tbody tr')];
    const out = [];
    rows.forEach((tr, i) => {
      const t = tr.innerText.replace(/\s+/g, ' ');
      re.lastIndex = 0;
      if (re.test(t)) out.push({ row: i + 1, cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()) });
    });
    return out;
  }, SIGNATURES.source);
  for (const c of contexts) log(`FB-061: hit in row ${c.row}: ${JSON.stringify(c.cells).slice(0, 400)}`);
  expect(hits.length === 0, `no QA fixture signature visible on the board (found: ${hits.join(', ')})`);
  await log.shot(page, 'ui-01-board-clean-of-qa-signatures');

  await browser.close();
  log('FB-061 BOARD SCAN PASS (0 QA signatures rendered)');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try { await log.shot((await browser.pages()).slice(-1)[0], 'FAIL-last-state'); } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
