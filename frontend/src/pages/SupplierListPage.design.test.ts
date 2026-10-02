import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SupplierListPage dispatch worksheet styling', () => {
  it('uses the compact operational-table typography and an in-flow worksheet footer', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');

    expect(page).toContain("import '../styles/operational-table-typography.css'");
    // record-table base adoption: shared skin + card collapse ride these classes.
    expect(page).toContain('className="record-table ops-table suppliers-page__grid"');
    expect(page).toContain('className="desktop-only table-wrap suppliers-page__workspace"');
    // Workboard standard: the thead skin is owned by the shared record-table
    // base — the page must not re-declare it (conformance invariant).
    expect(css).not.toContain('.suppliers-page__grid th {');
    // Card 20260921_22 sweep: the worksheet footer stays in flow — a sticky
    // bottom pin floated it mid-list over the rows (dispatch ruled first).
    expect(css).toMatch(/__workspace > \.ds-pagination\s*\{[^}]*position:\s*static/);
    expect(css).toContain('font-size: var(--ops-table-primary-size)');
    expect(css).toContain('.suppliers-page__workspace > .ds-pagination {');
  });

  it('keeps supplier values visible by wrapping instead of ellipsizing cells', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');
    const recordTableCss = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

    // Wrapping is owned by the shared record-table base; the page only
    // un-clips the linked-supplier spans it stacks.
    expect(recordTableCss).toMatch(/\.record-table tbody td\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/__cell--linked > span[\s\S]*?white-space:\s*normal !important;/);
  });

  it('builds the edit modal on the untitled-ui kit with sectioned fields', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');

    expect(page).toContain('maxWidth={960}');
    // Untitled-UI react-aria inputs (label + icon live on the component), not
    // the raw .field/.input skin.
    expect(page).toContain("import { Input } from '../components/untitled-ui/base/input/input';");
    expect(page).toContain("import { TextArea } from '../components/untitled-ui/base/textarea/textarea';");
    expect(page).not.toContain('pairedFieldGridStyle');
    expect(page).not.toContain("from '../utils/formStyles'");
    // Sectioned form: the shared EntityFormSection primitive (icon chip +
    // uppercase label + hairline divider, 2-col field grid) groups the
    // profile, payment-term, and note fields; the footer carries the shared
    // required-field hint.
    expect(page).toContain("import { EntityFormSection, UnitInput, RequiredHint } from '../components/shared/EntityFormParts';");
    expect((page.match(/<EntityFormSection icon=\{[A-Za-z2]+\} label=/g) ?? []).length).toBe(3);
    expect(page).toContain('Thông tin nhà cung cấp');
    expect(page).toContain('Điều khoản thanh toán');
    expect(page).toContain('Ghi chú');
    expect(page).toContain('<RequiredHint />');
    // The required name gates the submit; the section primitive owns the
    // responsive 2-col field grid.
    expect(page).toContain('isRequired');
    expect(page).toContain('placeholder="Ví dụ: 0312…"');
    expect(page).toContain('placeholder="Ví dụ: 15"');
    expect(page).toContain('placeholder="Ví dụ: 30"');
    // Footer keeps the shared button contract.
    expect(page).toContain('btn btn--secondary btn--sm');
    expect(page).toContain('btn btn--primary btn--sm');
  });
});
