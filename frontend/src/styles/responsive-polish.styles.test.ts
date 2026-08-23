import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const accountingInboxCss = readFileSync(
  resolve(process.cwd(), 'src/features/accounting/AccountingWorkInbox.css'),
  'utf8',
);
const catalogsCss = readFileSync(
  resolve(process.cwd(), 'src/features/dispatch/catalogs/catalogs.css'),
  'utf8',
);
const debtListCss = readFileSync(
  resolve(process.cwd(), 'src/pages/DebtListPage.css'),
  'utf8',
);
const payableListCss = readFileSync(
  resolve(process.cwd(), 'src/pages/PayableListPage.css'),
  'utf8',
);
const financeCss = readFileSync(resolve(process.cwd(), 'src/pages/FinancePage.css'), 'utf8');

/**
 * Whole-app overflow polish — the customer signed off on /shipments* and
 * /dispatch*, so every other screen must hand off to a labelled-card layout
 * before the desktop shell's 1112px operational canvas forces horizontal
 * scroll. These CSS-level contracts lock the 1500px threshold so future
 * regressions surface in CI.
 */

describe('operational-canvas (≤1500px) record-table hand-off', () => {
  it('removes the global 900px table rail for .record-table so the @container card layout can fire', () => {
    expect(responsiveCss).toMatch(
      /@media\s*\(max-width:\s*1500px\)\s*\{[\s\S]*?\.record-table,\s*\.record-table-wrap\s*>\s*table\s*\{[^}]*min-width:\s*0;[^}]*\}/,
    );
  });
});

describe('expense filter bar (≤640px)', () => {
  it('stacks every filter into a single column on phones so the Untitled-UI select label is not truncated', () => {
    expect(responsiveCss).toMatch(
      /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.expense-filters,\s*\.expense-filter-bar\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
  });
});

describe('accounting work-inbox (≤1500px) hand-off', () => {
  it('hides the thead and switches the inbox to a labelled-card layout before the 980px table rail forces overflow', () => {
    expect(accountingInboxCss).toMatch(
      /@media\s*\(max-width:\s*1500px\)\s*\{[\s\S]*?\.accounting-work-inbox__table-wrap\s*\{\s*overflow:\s*visible;[\s\S]*?\.accounting-work-inbox\s+thead\s*\{\s*display:\s*none;/,
    );
  });

  it('lets the inbox advisory <li> wrap instead of overflowing the right edge', () => {
    expect(accountingInboxCss).toMatch(
      /\.accounting-work-inbox__advisories li,\s*\.accounting-work-inbox__issues li\s*\{[^}]*overflow-wrap:\s*anywhere;/,
    );
  });
});

describe('dispatch catalogs (≤640px) — thead must be display:none, not clip-rect', () => {
  it('hides the thead so its child TR/TH do not occupy layout (clip-rect was leaking past the audit)', () => {
    expect(catalogsCss).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.dispatch-catalogs__table\s+thead\s*\{[^}]*display:\s*none;/,
    );
  });
});

describe('debt list — operational canvas hand-off to card list', () => {
  it('hides the desktop table and shows the mobile card list at ≤1500px', () => {
    expect(debtListCss).toMatch(
      /@media\s*\(max-width:\s*1500px\)\s*\{[\s\S]*?\.debt-list-page\s+\.desktop-only\s*\{\s*display:\s*none\s*!important;[\s\S]*?\.debt-list-page\s+\.mobile-only\s*\{\s*display:\s*block;/,
    );
  });
});

describe('payable list — operational canvas hand-off to card list', () => {
  it('hides the desktop table and shows the mobile card list at ≤1500px', () => {
    expect(payableListCss).toMatch(
      /@media\s*\(max-width:\s*1500px\)\s*\{[\s\S]*?\.payables-page\s+\.desktop-only\s*\{\s*display:\s*none\s*!important;[\s\S]*?\.payables-page\s+\.mobile-only\s*\{\s*display:\s*block;/,
    );
  });
});

describe('finance category-breakdown table — operational canvas hand-off', () => {
  it('hides the thead and switches the table to a labelled-card layout at ≤1500px', () => {
    expect(financeCss).toMatch(
      /@media\s*\(max-width:\s*1500px\)\s*\{[\s\S]*?\.finance-category-breakdown__scroll\s*>\s*table\s+thead\s*\{\s*display:\s*none;/,
    );
    expect(financeCss).toMatch(
      /\.finance-category-breakdown__scroll\s*>\s*table\s+td:not\(:first-child\)::before\s*\{[^}]*content:\s*attr\(data-label\);/,
    );
  });
});
