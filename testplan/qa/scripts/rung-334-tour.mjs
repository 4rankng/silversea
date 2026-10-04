// Rung 334: footer-seam tour — mount each surface, probe the seam live, capture 4 widths.
// mutates: none (forms/dialogs opened, closed or abandoned; penalties empty-state via search filter)
import { launch, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });

// login runs pre-auth (its own document)
await page.goto(`${base}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await probeSurface('login-footer', '.login-footer, [class*=login-footer]');

const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function probeSurface(tag, sel, { open = null, url = null } = {}) {
  try {
    if (url) {
      await page.goto(`${base}${url}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 3200));
    }
    if (open) {
      const clicked = await page.evaluate((txt) => {
        const b = [...document.querySelectorAll('button, a')].find((x) => new RegExp(txt, 'i').test((x.getAttribute('aria-label') || x.innerText || '').trim()));
        if (!b) return false;
        b.click();
        return true;
      }, open);
      await new Promise((r) => setTimeout(r, 1300));
      if (!clicked) { console.log('SURFACE', tag, 'SKIP — trigger not found:', open); return; }
    }
    const m = await page.evaluate((s) => {
      const els = [...document.querySelectorAll(s.split(', '))];
      const el = els.find((x) => x.getBoundingClientRect().height > 0);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const prev = el.previousElementSibling?.getBoundingClientRect();
      return {
        marginTop: cs.marginTop, paddingTop: cs.paddingTop,
        borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        seamPx: prev ? Math.round(r.top - prev.bottom) : null,
        text: (el.innerText || '').replace(/\n/g, ' | ').slice(0, 60),
      };
    }, sel);
    console.log('SURFACE', tag, m ? JSON.stringify(m) : 'SKIP — selector not rendered');
    if (m) {
      for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
        await setViewport(page, w, h);
        await shot(page, `${E}/seam-${tag}-${w}.png`, { full: false });
      }
    }
  } catch (err) {
    console.log('SURFACE', tag, 'ERROR —', String(err).slice(0, 100));
  }
}

await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
await probeSurface('sidebar-footer', '.sidebar-footer, [class*=sidebar-footer]');
await probeSurface('tc-action-bar', '.tc-action-bar, [class*=tc-action-bar]', { url: '/trips/new' });
await probeSurface('fadv-form-actions', '.fadv-form-panel__actions, [class*=fadv-form-panel__actions]', { url: '/advances', open: 'Tạo|Thêm|Đề nghị' });
await probeSurface('cfg-form-actions', '.cfg-page .cfg-form-actions, .cfg-form-actions', { url: '/config/management-fees', open: 'Tạo|Thêm' });
await probeSurface('penalty-empty-actions', '.penalty-empty-actions, [class*=penalty-empty-actions]', { url: '/penalties' });
await probeSurface('billing-builder-footer', '.billing-builder__footer, [class*=billing-builder__footer]', { url: '/accounting/chot-debit' });
await probeSurface('fset-form-actions', '.fset-form-actions, [class*=fset-form-actions]', { url: '/my-settlements/new' });
await probeSurface('fset-card-footer', '.fset-card__footer, [class*=fset-card__footer]', { url: '/my-settlements' });
await probeSurface('settlement-expense-actions', '.settlement-expense-actions, [class*=settlement-expense-actions]', { url: '/admin/advance-settlements' });
await probeSurface('ttp-dialog-actions', '.ttp-dialog-actions, [class*=ttp-dialog-actions]', { url: '/fleet/vehicles', open: 'Lốp|Tire' });
await probeSurface('tc-rail-actions', '.tc-rail-actions, [class*=tc-rail-actions]', { url: '/trips', open: 'Sửa|Chỉnh' });
await probeSurface('ci-editor-footer', '.ci-editor__footer, [class*=ci-editor__footer]', { url: '/shipments-detail', open: 'Thêm container' });

console.log('TOUR done');
await browser.close();
