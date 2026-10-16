// Cascade liveness proof for the MOBFOOT-1016 pagination clearance rule.
// Headless Chrome resolves env(safe-area-inset-bottom)=0, so a dead override
// and a live one both compute 12px in the app. This check substitutes a
// literal 34px for env() in the REAL stylesheets and reads the computed
// padding-bottom of the terminal nav at a 390px phone viewport.
//   variant "as-is"     -> expect 46px (12 + 34): the rule is live
//   variant "reordered" -> override moved ABOVE the base rule: expect 12px
//                          (the dead-rule defect the review caught)
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const pageCss = read('frontend/src/pages/ShipmentsPage.css');
const pagCss = read('frontend/src/design-system/Pagination.css');
const respCss = read('frontend/src/styles/responsive.css');

const subst = (css) => css.replace(/env\(safe-area-inset-bottom,\s*0px\)/g, '34px');

const run = async (label, css) => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844 });
  await p.setContent('<!doctype html><html><body></body></html>');
  await p.evaluate((sheet) => {
    const style = document.createElement('style');
    style.textContent = sheet;
    document.head.append(style);
    document.body.innerHTML = [
      '<div class="app"><div class="app-main"><main class="app-body">',
      '<div class="shipments-page"><section class="cus-workspace">',
      '<div class="cus-dashboard-viewport"><nav class="ds-pagination"><span>x</span></nav></div>',
      '</section></div></main></div></div>',
    ].join('');
  }, subst(css));
  const result = await p.evaluate(() => ({
    navPaddingBottom: getComputedStyle(document.querySelector('.ds-pagination')).paddingBottom,
    appBodyPaddingBottom: getComputedStyle(document.querySelector('.app-body')).paddingBottom,
  }));
  console.log(label, JSON.stringify(result));
  await browser.close();
  return result;
};

// As-is: the ≤640 override sits after the base rule — live.
const asis = await run('as-is    ', `${respCss}\n${pagCss}\n${pageCss}`);

// Reordered: lift the trailing-band media block ABOVE the base pagination
// rule (the original dead placement).
const blockMatch = pageCss.match(/@media \(max-width: 640px\) \{\s*\.app-main[^}]*\{[^}]*\}\s*\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*\}\s*\}/);
if (!blockMatch) throw new Error('trailing-band block not found for reorder control');
const block = blockMatch[0];
const without = pageCss.replace(block, '');
const baseIdx = without.indexOf('.cus-dashboard-viewport > .ds-pagination {');
const reordered = without.slice(0, baseIdx) + block + '\n' + without.slice(baseIdx);
const control = await run('reordered', `${respCss}\n${pagCss}\n${reordered}`);

const pass = asis.navPaddingBottom === '46px' && control.navPaddingBottom === '12px'
  && asis.appBodyPaddingBottom === '0px' && control.appBodyPaddingBottom === '0px';
console.log(pass ? 'PROOF PASS: override live as-is, dead when reordered' : 'PROOF FAIL');
process.exit(pass ? 0 : 1);
