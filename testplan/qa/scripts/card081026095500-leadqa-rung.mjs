// Card 081026095500 — lead staging QA on cut a1dc8b1f. /ops overview for the
// OPS role: 3 metric cards (kế hoạch chờ xử lý / xe đang chạy / số dư quỹ +
// yêu cầu chờ duyệt) fed from real endpoints, 3 quick links. Cross-checks each
// number against its API source, then real-taps one quick link.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026095500-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'a1dc8b1f' });
if (!String(health.buildHash || '').startsWith('a1dc8b1f')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }
const auth = { Authorization: `Bearer ${token}` };

// API truths (same sources the page uses)
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const orders = await fetch(`${API}/ops/orders?date=${today}`, { headers: auth }).then((r) => r.json()).catch(() => null);
const fleet = await fetch(`${API}/ops/fleet`, { headers: auth }).then((r) => r.json()).catch(() => null);
const wallet = await fetch(`${API}/ops/wallet/summary`, { headers: auth }).then((r) => r.json()).catch(() => null);
const adv = await fetch(`${API}/ops/wallet/advance-requests?limit=1`, { headers: auth }).then((r) => r.json()).catch(() => null);
const oLots = orders?.items ?? orders?.lots ?? [];
const trucks = fleet?.trucks ?? fleet?.items ?? [];
const truth = {
  pendingLots: (Array.isArray(oLots) ? oLots : []).filter((x) => x.status !== 'COMPLETED').length,
  runningTrucks: (Array.isArray(trucks) ? trucks : []).filter((x) => x.status === 'IN_TRANSIT').length,
  balance: wallet?.balance ?? null,
  draftRequests: adv?.statusCounts?.DRAFT ?? 0,
};
log('api-truth', { today, truth, ordersShape: orders ? Object.keys(orders).slice(0, 8) : null });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/ops`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const scan = await page.evaluate(() => {
    const text = (document.body.textContent || '').replace(/\s+/g, ' ');
    const links = [...document.querySelectorAll('a')].filter((e) => e.offsetParent !== null)
      .map((a) => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), href: a.getAttribute('href') }))
      .filter((l) => /ops\//.test(l.href || ''));
    const body = (document.querySelector('main') ?? document.body).textContent.replace(/\s+/g, ' ');
    return {
      hasPendingCard: /Kế hoạch làm hàng chờ xử lý/.test(body),
      hasTruckCard: /Xe đang chạy|đang vận chuyển/.test(body),
      hasWalletCard: /Số dư quỹ tạm ứng|tạm ứng/.test(body),
      hasPendingRequests: /chờ duyện|chờ duyệt|Chưa ghi sổ/i.test(body),
      errorBands: (body.match(/Không tải được[^.]*\./g) ?? []).slice(0, 3),
      links,
      snippet: body.slice(0, 400),
    };
  });
  log('ops-page-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-ops-overview.png` });

  // metric numbers vs API truth — DOM concatenates glued text ("xử lý3lô"),
  // so digit assertions use (?!\d), never \b (digit→letter has no boundary)
  const fmt = (n) => Number(n).toLocaleString('vi-VN');
  const checks = [
    { label: 'pendingLots', uiHas: new RegExp(`chờ xử lý\\s*${truth.pendingLots}(?!\\d)`).test(scan.snippet) },
    { label: 'runningTrucks', uiHas: new RegExp(`Xe đang chạy\\s*${truth.runningTrucks}(?!\\d)`).test(scan.snippet) },
    { label: 'balance', uiHas: truth.balance === null ? null : scan.snippet.includes(fmt(truth.balance)) },
    { label: 'draftRequests', uiHas: truth.draftRequests > 0 ? new RegExp(`${truth.draftRequests}(?!\\d) yêu cầu`).test(scan.snippet) : scan.snippet.includes('Chưa có yêu cầu chờ duyệt') },
  ];
  log('metric-checks', { truth, checks });

  // quick links: all three targets present?
  const linkTargets = ['/ops/orders', '/ops/fleet-tracking', '/ops/wallet'];
  const linksOk = linkTargets.every((t) => scan.links.some((l) => (l.href || '').endsWith(t)));
  log('quick-links', { linksOk, links: scan.links });

  // real-tap one quick link → lands on /ops/orders
  const tapPt = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].filter((e) => e.offsetParent !== null).find((x) => (x.getAttribute('href') || '').endsWith('/ops/orders'));
    if (!a) return { err: 'no link' };
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!tapPt.err) {
    await page.mouse.click(tapPt.x, tapPt.y);
    await sleep(3000);
    const landed = await page.evaluate(() => location.pathname);
    log('quick-link-tap', { landed, want: '/ops/orders' });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-ops-orders-landed.png` });
    if (landed !== '/ops/orders') exitCode = 1;
  } else { log('quick-link-tap-skipped', tapPt); exitCode = 1; }

  const pass = scan.hasPendingCard && scan.hasTruckCard && scan.hasWalletCard && linksOk && checks.every((c) => c.uiHas === true);
  if (pass && exitCode === 0) log('PASS-ops-overview', { truth });
  else { log('FAIL', { scan, checks, linksOk }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
