// Card 371 lead QA — accounting menu split into 4 spec-5.10 categories.
// Read-only: two real role logins (hoapt ACCOUNTANT, dungnv dispatcher),
// sidebar structure + clipping at 1440/768/390, old-route landings. No writes.
import {
  loginApi, launch, shot, setViewport, logEvidence, sleep, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_lead-qa-371-accounting-categories';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
if (health.buildHash !== process.env.QA_BUILD) throw new Error(`stale build ${health.buildHash}`);
log('health', { buildHash: health.buildHash });

const { browser, page } = await launch({ width: 1440, height: 1000 });
const EXPECTED = ['Phơi phiếu', 'Công nợ vận tải', 'Quỹ', 'Khác', 'Giá & cước', 'Báo cáo', 'Vận hành liên quan', 'Hệ thống'];

async function readMenu() {
  return page.evaluate(() => {
    const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const groups = [...document.querySelectorAll('nav [class*="section"], nav [class*="group"], nav li')];
    const labels = [...document.querySelectorAll('nav a, nav [role="link"]')].map((a) => t(a));
    const clipped = [...document.querySelectorAll('nav *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && (el.textContent || '').trim()).length;
    return { navText: t(document.querySelector('nav, aside, [class*="sidebar"]')).slice(0, 500), linkLabels: labels.slice(0, 60), clippedCount: clipped };
  });
}

async function gotoRoute(path) {
  await page.goto(`${STAGING}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  return page.evaluate(() => ({
    url: location.pathname,
    notFound: /Không tìm thấy trang|404/.test(document.body.textContent),
    h1: (document.querySelector('h1')?.textContent || '').trim(),
  }));
}

try {
  // ---- ACCOUNTANT role: hoapt ----
  const s1 = await loginApi('hoapt', 'Abc123');
  const t1 = s1.token ?? s1.accessToken ?? s1?.data?.token;
  if (!t1) throw new Error('hoapt login failed');
  await page.evaluateOnNewDocument((tok) => localStorage.setItem('token', tok), t1);
  await page.goto(`${STAGING}/accounting/phoi-phieu`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  for (const w of [1440, 768, 390]) {
    await setViewport(page, w, Math.max(900, w));
    const m = await readMenu();
    log(`sections@${w}`, { linkLabels: m.linkLabels, clipped: m.clippedCount });
    await shot(page, `${EV}/371-menu-hoapt-w${w}.png`, { full: false });
  }
  await setViewport(page, 1440, 1000);

  // old routes must land (spec: routes unchanged)
  const routes = ['/accounting/phoi-phieu', '/accounting/chot-debit', '/finance/treasury', '/accounting/hoan-ung', '/salary'];
  const landed = [];
  for (const r of routes) landed.push(await gotoRoute(r));
  log('routes-hoapt', landed);

  // ---- dispatcher role: dungnv — accounting categories must be absent ----
  const s2 = await loginApi('dungnv', 'Abc123');
  const t2 = s2.token ?? s2.accessToken ?? s2?.data?.token;
  if (!t2) throw new Error('dungnv login failed');
  await page.evaluateOnNewDocument((tok) => localStorage.setItem('token', tok), t2);
  await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const m2 = await readMenu();
  const accLabels = ['Phơi phiếu', 'Công nợ vận tải', 'Giá & cước'];
  const visible = accLabels.filter((l) => m2.linkLabels.some((x) => x.includes(l)));
  log('sections-dungnv', { linkLabels: m2.linkLabels.slice(0, 40), accountingLeak: visible });
  await shot(page, `${EV}/371-menu-dungnv-w1440.png`, { full: false });

  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG });
  console.log('QA371_LEAD_RUNG DONE');
} finally {
  await browser.close();
}
