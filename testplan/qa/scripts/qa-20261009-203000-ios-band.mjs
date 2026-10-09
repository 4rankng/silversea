// Lead QA rung — card 20261009_3 (iOS bottom dead band) on staging.
// Expects the 5245061d landing live in the deployed build (build-currency gate
// first): band = shell-only max(16px, env) at ≤640; page-root padding-bottom 0.
// AC2 re-verify: editor opens as a docked bottom sheet at 390. AC3: at 1440
// the editor stays cell-anchored (no sheet/scrim).
import { launch, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('2026-10-09_card20261009_3-ios-band');
const log = `${dir}/driver-iosband.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });

async function openPage(page, path) {
  const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
  if (!token) throw new Error('login failed');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
}

// Real CDP wheel to the true bottom of the shell scroller.
async function wheelToBottom(page) {
  for (let i = 0; i < 40; i++) {
    const atBottom = await page.evaluate(() => {
      const sc = document.querySelector('.app-body') ?? document.scrollingElement;
      return sc && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    });
    if (atBottom) return i;
    await page.mouse.move(200, 400);
    await page.mouse.wheel({ deltaY: 900 });
    await sleep(160);
  }
  return -1;
}

// The ledger page is date-scoped; its default window holds no rows on
// staging. Fill each .date-seg-group's first input and let auto-advance chain
// DD→MM→YYYY (Từ 01/09/2026 → Đến 20/10/2026), then commit on genuine exit.
async function setLedgerWindow(page) {
  const groups = await page.$$('.shipments-detail-page .date-seg-group');
  if (groups.length < 2) throw new Error(`expected 2 date groups, got ${groups.length}`);
  const typeInto = async (group, digits) => {
    const first = await group.$('input');
    await first.click();
    await page.keyboard.type(digits, { delay: 70 });
    await sleep(350);
  };
  await typeInto(groups[0], '01092026');
  await typeInto(groups[1], '20102026');
  await page.mouse.click(200, 120); // outside the fields: genuine exit commits
  await sleep(2500);
  const vals = await page.evaluate(() => [...document.querySelectorAll('.shipments-detail-page .date-seg-group input')].map((i) => i.value).join('/'));
  step(log, { step: 'ledger-window', segments: vals });
}

async function measure(page, pageRootSelector) {
  return page.evaluate((sel) => {
    const sc = document.querySelector('.app-body') ?? document.scrollingElement;
    const root = document.querySelector(sel);
    const scRect = sc.getBoundingClientRect();
    const rootRect = root ? root.getBoundingClientRect() : null;
    const cs = root ? getComputedStyle(root) : null;
    return {
      scrollBottom: Math.round(scRect.bottom),
      rootBottom: rootRect ? Math.round(rootRect.bottom) : null,
      trailingGap: rootRect ? Math.round(scRect.bottom - rootRect.bottom) : null,
      pagePaddingBottom: cs ? cs.paddingBottom : null,
      shellPaddingBottom: getComputedStyle(sc).paddingBottom,
      scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight,
    };
  }, pageRootSelector);
}

const results = {};
const { browser, page } = await launch({ width: 390, height: 844 });
try {
  await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
  const health = await page.evaluate(() => document.body.innerText);
  const buildHash = health.match(/"buildHash":"([^"]+)"/)?.[1] ?? 'unknown';
  step(log, { step: 'build-currency', buildHash });
  if (!buildHash.startsWith('bc305aec')) throw new Error(`build-currency FAIL: expected bc305aec*, got ${buildHash}`);

  // 390 /shipments
  await openPage(page, '/shipments');
  const wheel1 = await wheelToBottom(page);
  await sleep(700);
  results.m390List = await measure(page, '.shipments-page');
  step(log, { step: 'band-390-list', wheels: wheel1, ...results.m390List });
  await shot(page, 'iosband-390-list');

  // 390 /shipments-detail — the ledger page IS this literal route (its root
  // class .shipments-detail-page is the card's second band surface).
  const first = '/shipments-detail';
  await page.goto(`${BASE}${first}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  await setLedgerWindow(page);
  await wheelToBottom(page);
  await sleep(700);
  results.m390Detail = await measure(page, '.shipments-detail-page');
  step(log, { step: 'band-390-detail', ...results.m390Detail });
  await shot(page, 'iosband-390-detail');
  results.detailPath = first;

  // AC2: at 390 the edit cell opens a docked bottom sheet (open + close via scrim = non-mutating)
  const cell = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Chỉnh sửa ô khách hàng và lộ trình')));
  const cellEl = cell.asElement();
  if (cellEl) {
    await cellEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await cellEl.click();
    await sleep(1300);
    results.sheet = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false };
      const cs = getComputedStyle(dlg);
      return { open: true, position: cs.position, bottomCoord: Math.round(dlg.getBoundingClientRect().bottom), vh: window.innerHeight, radius: cs.borderRadius, hasBackdrop: !!document.querySelector('[class*="backdrop"], .modal-backdrop') };
    });
    step(log, { step: 'ac2-sheet-390', ...results.sheet });
    await shot(page, 'iosband-390-sheet');
    await page.mouse.click(195, 40); // scrim (top zone outside a bottom sheet) to close
    await sleep(900);
  } else step(log, { step: 'ac2-skip', note: 'edit cell not found on this fixture' });

  await browser.close();

  // 430 spot check (fresh browser — clean env per lane)
  const b2 = await launch({ width: 430, height: 932 });
  const p2 = b2.page ?? (await b2.browser.pages())[0];
  await openPage(p2, '/shipments');
  await wheelToBottom(p2);
  await sleep(700);
  results.m430List = await measure(p2, '.shipments-page');
  step(log, { step: 'band-430-list', ...results.m430List });
  await shot(p2, 'iosband-430-list');
  await b2.browser.close();

  // 1440 desktop anchor (AC3)
  const b3 = await launch({ width: 1440, height: 900 });
  const p3 = b3.page ?? (await b3.browser.pages())[0];
  await openPage(p3, results.detailPath);
  await setLedgerWindow(p3);
  const cell3 = await p3.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Chỉnh sửa ô khách hàng và lộ trình')));
  const c3 = cell3.asElement();
  if (c3) {
    await c3.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await c3.click();
    await sleep(1200);
    results.desktopAnchor = await p3.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false };
      const cs = getComputedStyle(dlg);
      return { open: true, position: cs.position, radius: cs.borderRadius };
    });
    step(log, { step: 'ac3-desktop-1440', ...results.desktopAnchor });
    await shot(p3, 'iosband-1440-anchor');
  } else step(log, { step: 'ac3-skip', note: 'edit cell not found' });
  await b3.browser.close();

  // Verdict
  const band = (m) => m && m.trailingGap !== null && m.trailingGap >= 13 && m.trailingGap <= 20 && m.pagePaddingBottom === '0px' && m.shellPaddingBottom === '16px';
  const ac1 = band(results.m390List) && band(results.m390Detail) && band(results.m430List);
  // A skipped re-verify is NOT a pass — it must fail the verdict honestly.
  const ac2 = Boolean(results.sheet && results.sheet.open && results.sheet.position === 'fixed' && results.sheet.bottomCoord >= results.sheet.vh - 2);
  const ac3 = Boolean(results.desktopAnchor && results.desktopAnchor.open && results.desktopAnchor.position !== 'fixed');
  step(log, { step: 'DONE', verdict: ac1 && ac2 && ac3 ? 'PASS' : 'FAIL', ac1, ac2, ac3 });
  console.log(ac1 && ac2 && ac3 ? `PASS — band 390/430=16px shell-only, sheet docked, desktop anchored (${JSON.stringify({ ac1, ac2, ac3 })})` : `FAIL — ${JSON.stringify({ ac1, ac2, ac3, m: results.m390List })}`);
  process.exit(ac1 && ac2 && ac3 ? 0 : 1);
} catch (err) {
  step(log, { step: 'error', error: String(err && err.message || err).slice(0, 200) });
  await shot(page, 'iosband-error').catch(() => {});
  console.log('ERROR:', String(err && err.message || err).slice(0, 200));
  process.exit(2);
} finally {
  try { await browser.close(); } catch {}
}
