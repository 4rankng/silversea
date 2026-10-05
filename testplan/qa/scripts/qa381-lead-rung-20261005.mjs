// Card 381 lead QA — fund source label "Quỹ tiền mặt" (spec 5.10), staging rung.
// Read-only: staging login, label/DOM contract assertions, full-page captures at
// 1280/1440/1920/2560, fund-source selector observed and operated via native
// select only when present. No data mutation.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, STAGING, API,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_lead-qa-wave-381-fund-labels';
const LOG = [];

function log(step, obj) {
  const entry = { at: new Date().toISOString(), step, ...obj };
  LOG.push(entry);
  console.log(JSON.stringify(entry));
}

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
const buildOk = health.buildHash === process.env.QA_BUILD;
log('health', { buildHash: health.buildHash, expected: process.env.QA_BUILD, ok: buildOk });
if (!buildOk) throw new Error(`stale build: ${health.buildHash} != ${process.env.QA_BUILD}`);

const session = await loginApi('admin', 'Abc123');
const token = session.token ?? session.accessToken ?? session?.data?.token;
if (!token) throw new Error(`no token in login response: ${Object.keys(session)}`);
log('login', { ok: true });

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  await auth(page, token, '/finance/treasury');
  log('nav', { url: page.url() });

  const contract = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const body = text(document.body);
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      aria: s.getAttribute('aria-label'),
      options: [...s.options].map((o) => o.text.trim()),
      value: s.value,
    }));
    const legacyHits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent;
      if (/Quỹ\s*TM/.test(t)) legacyHits.push(t.trim().slice(0, 80));
    }
    const fundHeadings = [...document.querySelectorAll('h1,h2,h3,th,[data-label]')]
      .map((el) => text(el)).filter((t) => /Quỹ|Tiền mặt|Công ty|Ngân hàng/i.test(t)).slice(0, 20);
    return {
      title: document.title,
      h1: text(document.querySelector('h1')),
      pageHasCashFund: /Quỹ tiền mặt/.test(body),
      pageHasCompanyFund: /Quỹ công ty/.test(body),
      legacyHits,
      selects,
      fundHeadings,
      rowCount: document.querySelectorAll('tbody tr').length,
      firstRows: [...document.querySelectorAll('tbody tr')].slice(0, 3).map((tr) => text(tr).slice(0, 120)),
    };
  });
  log('contract', contract);

  // Width matrix — with-data state (staging has 1 account per source).
  for (const w of [1280, 1440, 1920, 2560]) {
    await setViewport(page, w);
    await shot(page, `${EV}/ui-treasury-w${w}.png`);
  }
  log('width-matrix', { done: [1280, 1440, 1920, 2560] });

  // Fund-source selector: operate ONLY a native <select> (page.select is the
  // trusted path for OS-level dropdowns). react-aria controls are observed, not forced.
  const nativeSource = contract.selects.find((s) => s.options.some((o) => /Quỹ/i.test(o)));
  if (nativeSource && nativeSource.options.length > 1) {
    const other = nativeSource.options.find((o) => o !== nativeSource.value
      && (nativeSource.options.includes('Quỹ tiền mặt') ? o.includes('Công ty') : o.includes('tiền mặt')));
    if (other) {
      await page.select(`select[aria-label="${nativeSource.aria}"]`, other).catch(async () => {
        // fall back to value-less match by visible text via keyboard-free select API
        const idx = nativeSource.options.indexOf(other);
        await page.evaluate((i, aria) => {
          const s = document.querySelector(`select[aria-label="${aria}"]`);
          s.selectedIndex = i;
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }, idx, nativeSource.aria);
      });
      await sleep(1500);
      const after = await page.evaluate(() => ({
        rows: document.querySelectorAll('tbody tr').length,
        first: (document.querySelector('tbody tr')?.textContent || '').replace(/\s+/g, ' ').slice(0, 120),
        legacy: /Quỹ\s*TM/.test(document.body.textContent),
      }));
      log('source-switch', { to: other, ...after });
      await setViewport(page, 1440);
      await shot(page, `${EV}/ui-treasury-source-${other.includes('Công ty') ? 'company' : 'cash'}-w1440.png`);
    }
  } else {
    log('source-switch', { skipped: 'no native multi-option source selector found', selects: contract.selects });
  }

  // Fund-book API identity for both sources (data-currency proof).
  for (const src of ['COMPANY', 'TM']) {
    const r = await fetch(`${API}/expense-accounting/fund-book?source=${src}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    const b = r.data ?? r;
    log('fund-book-api', {
      source: src,
      http: r.status ?? 'n/a',
      accounts: Array.isArray(b.accounts) ? b.accounts.length : null,
      firstAccount: b.accounts?.[0]?.name ?? b.accounts?.[0]?.accountName ?? null,
    });
  }

  const verdict = {
    labelCashFund: contract.pageHasCashFund,
    labelCompanyFund: contract.pageHasCompanyFund,
    legacyQuyTMOnPage: contract.legacyHits.length > 0,
    legacyHits: contract.legacyHits,
  };
  log('verdict', verdict);
  logEvidence(EV, 'driver-log.json', { build: health.buildHash, entries: LOG });
  if (verdict.legacyQuyTMOnPage) throw new Error('FAIL: legacy "Quỹ TM" label still on page');
  if (!verdict.labelCashFund) throw new Error('FAIL: "Quỹ tiền mặt" label not found');
  console.log('QA381_LEAD_RUNG PASS');
} finally {
  await browser.close();
}
