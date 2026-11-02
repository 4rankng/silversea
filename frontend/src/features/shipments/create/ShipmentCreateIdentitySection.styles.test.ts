import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'frontend');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const css = read('src/pages/clerk/ClerkShipmentCreatePage.css');

describe('SIL-641 (id 745) — Form tạo lô, section "Nhận diện lô": 2 input columns equal width (50/50)', () => {
  it('defines equal 50/50 column tracks at desktop (repeat(12, minmax(0, 1fr)) with span 6 for each column)', () => {
    // 12-column track with 6/12 split per column = exactly 50% left, 50% right.
    expect(css).toMatch(/\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\);/);

    const custMatch = css.match(/\.csc-identity-grid__customer\s*\{[^}]*grid-column:\s*span\s*(\d+);/);
    const tradeMatch = css.match(/\.csc-identity-grid__trade-direction\s*\{[^}]*grid-column:\s*span\s*(\d+);/);
    const bookingMatch = css.match(/\.csc-identity-grid__booking\s*\{[^}]*grid-column:\s*span\s*(\d+);/);
    const shippingMatch = css.match(/\.csc-identity-grid__shipping-line\s*\{[^}]*grid-column:\s*span\s*(\d+);/);

    expect(custMatch).not.toBeNull();
    expect(tradeMatch).not.toBeNull();
    expect(bookingMatch).not.toBeNull();
    expect(shippingMatch).not.toBeNull();

    const leftTrackSpan = Number(custMatch![1]);
    const rightTrackSpan = Number(tradeMatch![1]);
    const bookingSpan = Number(bookingMatch![1]);
    const shippingSpan = Number(shippingMatch![1]);

    // Compare the two column track spans directly: Left Column === Right Column
    expect(leftTrackSpan).toBe(rightTrackSpan);
    expect(bookingSpan).toBe(shippingSpan);
    expect(leftTrackSpan + rightTrackSpan).toBe(12);
  });

  it('keeps 2 equal columns (repeat(2, minmax(0, 1fr))) at tablet (<=820px, including 768px)', () => {
    // Media query for tablet <=820px defines 2 equal tracks: repeat(2, minmax(0, 1fr))
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);

    // Grid items default to auto span (1 column each), ensuring 50/50 equality
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid\s*>\s*\*\s*\{[^}]*grid-column:\s*auto;/);

    // SIL-641: customer column does NOT expand to 1 / -1 (which caused the uneven width bug)
    expect(css).not.toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid__customer[^{]*\{[^}]*grid-column:\s*1 \/ -1;/);

    // Only full-width elements like the options flags span across both columns (1 / -1)
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid__flags--solo\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  });

  it('maintains single-column stack at phone viewport (<=640px, including 390px)', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });
});
