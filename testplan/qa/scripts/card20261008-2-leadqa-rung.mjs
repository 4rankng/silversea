// Card 20261008_2 — lead staging QA. Ops wallet Lịch sử chi phí: every status
// tab ('Tất cả' / 'Cần bổ sung' / 'Đã ghi nhận' / 'Đã hủy') carries its
// FULL-SET count from the new statusCounts census (native + legacy trip
// rows), never the loaded page; empty buckets print a visible 0.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-2-leadqa';
const EXPECT = '47250a4f';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const api = await fetch(`${API}/ops/wallet/expenses?limit=3`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const truth = { total: api.total, statusCounts: api.statusCounts, rowsLoaded: (api.items ?? []).length };
log('api-truth', truth);
if (!api.statusCounts) { log('FAIL-no-statusCounts-in-envelope', { keys: Object.keys(api).slice(0, 10) }); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const scan = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button,a,[role="tab"]')].filter((e) => e.offsetParent !== null);
    const tabish = cands.filter((x) => /^(Tất cả|Cần bổ sung|Đã ghi nhận|Đã hủy)/.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
    return {
      tabs: tabish.map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()),
      historyVisible: /Lịch sử chi phí/.test((document.body.textContent || '')),
    };
  });
  log('tabs-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-tabs.png` });

  const tabCount = (label) => {
    const t = scan.tabs.find((x) => x.startsWith(label));
    const m = t ? t.match(/(\d+)\s*$/) : null;
    return m ? Number(m[1]) : null;
  };
  const sc = truth.statusCounts;
  const checks = [
    { tab: 'Tất cả', want: sc.all ?? truth.total, got: tabCount('Tất cả') },
    { tab: 'Cần bổ sung', want: sc.DRAFT ?? 0, got: tabCount('Cần bổ sung') },
    { tab: 'Đã ghi nhận', want: sc.RECORDED ?? 0, got: tabCount('Đã ghi nhận') },
    { tab: 'Đã hủy', want: sc.VOIDED ?? 0, got: tabCount('Đã hủy') },
  ];
  log('count-checks', { checks, rowsOnPage: truth.rowsLoaded, note: 'counts are full-set; the page loads 3-row pages' });
  const bad = checks.filter((c) => c.got === null || c.want !== c.got);
  const zeroVisible = checks.filter((c) => c.want === 0 && c.got === 0);
  if (bad.length === 0 && scan.historyVisible) log('PASS-full-set-tabs', { checks, visibleZeros: zeroVisible.length });
  else { log('FAIL', { bad, scan }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
