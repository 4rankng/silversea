// Rung 332 spot checks: users mobile kebab, trip-list pagination, fleet-trip-chip font token (D13).
// mutates: none
import { launch, shot, setViewport } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 900 });
const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

// (1) users ≤640: kebab actions intact
await setViewport(page, 390, 844);
await page.goto(`${base}/users`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4500));
const users = await page.evaluate(() => ({
  rows: document.querySelectorAll('tbody tr, [class*=mcard]').length,
  kebabs: [...document.querySelectorAll('button')].filter((b) => /tuỳ chọn|tùy chọn|thao tác|menu/i.test(b.getAttribute('aria-label') || '')).length,
  deadActionRow: document.querySelectorAll('.users-mobile-card__actions, .users-mobile-card__action-btn').length,
}));
console.log('USERS_MOBILE', JSON.stringify(users));
await shot(page, `${E}/users-mobile-390.png`, { full: false });

// (2) trip list pagination intact + no '.table-foot' ghost
await setViewport(page, 1440, 900);
await page.goto(`${base}/trips`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4500));
const trips = await page.evaluate(() => ({
  rows: document.querySelectorAll('tbody tr').length,
  dsPagination: document.querySelectorAll('.ds-pagination, [class*=ds-pagination]').length,
  tableFoot: document.querySelectorAll('.table-foot').length,
}));
console.log('TRIP_LIST', JSON.stringify(trips));
await shot(page, `${E}/triplist-1440.png`, { full: false });

// (3) D13: fleet-trip-chip uses the data font token, not a monospace literal
const d13 = await page.evaluate(() => {
  const el = document.querySelector('.fleet-trip-chip, [class*=fleet-trip-chip]');
  return el ? { found: true, fontFamily: getComputedStyle(el).fontFamily.slice(0, 80) } : { found: false, note: 'chip not on /trips — probe CSS source instead' };
});
console.log('D13_CHIP', JSON.stringify(d13));
await browser.close();
