// Card 191026160000 (3a verify) — /advances tab "Yêu cầu tạm ứng" as ketoan:
// the PENDING row created by Ops (id 7575) must show PHÊ DUYỆT TẠM ỨNG; click it
// and verify the row becomes Đã ghi nhận (approve = giải ngân, KP-148).
import { login, launch, makeLogger, tokenPage, sleep } from './2026-10-19_chiphi2b-lib.mjs';

const log = makeLogger('2026-10-19_chiphi2-b_repro/advances-before');
const token = await login('ketoan');
log('login ketoan OK');
const browser = await launch();
try {
  const page = await tokenPage(browser, token, 'http://localhost:7178/advances?view=requests');
  await sleep(2500);
  await log.shot(page, '01-advances-requests.png');
  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('PHÊ DUYỆT TẠM ỨNG'));
    return {
      hasPendingPill: text.includes('Chờ duyệt'),
      hasApproveButton: Boolean(btn),
      hasQaRow: text.includes('QA card 191026160000'),
      activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null,
    };
  });
  log(`tab state: ${JSON.stringify(state)}`);
  if (state.hasQaRow && !state.hasApproveButton) {
    // Maybe the QA row is on another page — click the Chờ duyệt pill.
    const pill = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Chờ duyệt'));
      if (!hit) return null;
      hit.click();
      return hit.textContent.trim();
    });
    log(`clicked pill: ${JSON.stringify(pill)}`);
    await sleep(1500);
    await log.shot(page, '02-after-choduyet-pill.png');
  }
  const btnState = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('PHÊ DUYỆT TẠM ỨNG'));
    return btn ? { disabled: btn.disabled } : null;
  });
  log(`approve button: ${JSON.stringify(btnState)}`);
  if (btnState) {
    const respP = page.waitForResponse((r) => r.url().includes('/approve'), { timeout: 15000 }).catch(() => null);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('PHÊ DUYỆT TẠM ỨNG')).click();
    });
    const resp = await respP;
    await sleep(2000);
    await log.shot(page, '03-after-approve.png');
    if (resp) log(`approve API → ${resp.status()}`);
    const after = await page.evaluate(() => {
      const text = document.body.innerText;
      return { stillPending: text.includes('Chưa duyệt'), rowRecorded: text.includes('Đã ghi nhận') };
    });
    log(`after approve: ${JSON.stringify(after)}`);
  }
  log('VERIFY DONE');
} finally {
  await browser.close();
}
