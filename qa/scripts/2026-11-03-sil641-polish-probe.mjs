// SIL-641 POLISH — measured evidence for the uiux verdict: contrast pairs of
// the new chip boundary/icon (1.4.11) and the chip's keyboard focus ring.
import puppeteer from 'puppeteer';

const FRONT = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
}).then((r) => r.json());

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), login.token);
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-shipping-line"]'), { timeout: 30000 });

const data = await page.evaluate(() => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
  };
  const plus = document.querySelector('[data-field-id="shipment-customer"] .csc-append-button');
  const cs = getComputedStyle(plus);
  const icon = plus.querySelector('svg');
  const input = document.querySelector('[data-field-id="shipment-booking-ref"] input');
  const section = plus.closest('.csc-section');
  return {
    chip: {
      border: cs.borderColor, background: cs.backgroundColor, radius: cs.borderRadius,
      width: plus.getBoundingClientRect().width.toFixed(1), height: plus.getBoundingClientRect().height.toFixed(1),
    },
    iconColor: getComputedStyle(icon).color,
    inputBorder: getComputedStyle(input).borderTopColor,
    sectionBg: getComputedStyle(section).backgroundColor,
    ratios: {
      iconVsChipBg: ratio(getComputedStyle(icon).color, cs.backgroundColor),
      borderVsChipBg: ratio(cs.borderColor, cs.backgroundColor),
      borderVsSectionBg: ratio(cs.borderColor, getComputedStyle(section).backgroundColor),
      inputBorderVsChipBg: ratio(getComputedStyle(input).borderTopColor, cs.backgroundColor),
    },
  };
});
console.log(JSON.stringify(data, null, 2));

// Keyboard focus ring: Tab to the '+' chip and read its outline.
await page.evaluate(() => document.querySelector('[data-field-id="shipment-customer"] .csc-append-button').focus());
await page.keyboard.press('Tab'); // ensure a real tab pass; then focus it directly
await page.evaluate(() => document.querySelector('[data-field-id="shipment-customer"] .csc-append-button').focus());
const focus = await page.evaluate(() => {
  const el = document.querySelector('[data-field-id="shipment-customer"] .csc-append-button');
  el.focus();
  const cs = getComputedStyle(el);
  return { outline: cs.outline, outlineOffset: cs.outlineOffset, focused: document.activeElement === el };
});
console.log('FOCUS', JSON.stringify(focus));
await browser.close();
