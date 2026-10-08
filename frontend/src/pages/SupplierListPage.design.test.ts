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
    // The modal is a shared component (the dispatch suppliers view imports it),
    // so it lives in features/suppliers/SupplierFormModal — the same
    // LOC-ceiling-driven extraction that moved the type picker out of the page.
    const modal = readFileSync(resolve(process.cwd(), 'src/features/suppliers/SupplierFormModal.tsx'), 'utf8');
    const picker = readFileSync(resolve(process.cwd(), 'src/features/suppliers/SupplierTypePicker.tsx'), 'utf8');

    expect(modal).toContain('maxWidth={960}');
    // Untitled-UI react-aria inputs (label + icon live on the component), not
    // the raw .field/.input skin.
    expect(modal).toContain("import { Input } from '../../components/untitled-ui/base/input/input';");
    expect(modal).toContain("import { TextArea } from '../../components/untitled-ui/base/textarea/textarea';");
    expect(modal).not.toContain('pairedFieldGridStyle');
    expect(modal).not.toContain("from '../../utils/formStyles'");
    // Sectioned form: the shared EntityFormSection primitive (icon chip +
    // uppercase label + hairline divider, 2-col field grid) groups the
    // profile, payment-term, and note fields; the footer carries the shared
    // required-field hint. The type section lives in its own component, and
    // the modal itself is off the page for the same reason
    // (scripts/check-structure.mjs).
    expect(modal).toContain("import { EntityFormSection, UnitInput, RequiredHint } from '../../components/shared/EntityFormParts';");
    expect((modal.match(/<EntityFormSection icon=\{[A-Za-z2]+\} label=/g) ?? []).length).toBe(3);
    expect(modal).toContain('Thông tin nhà cung cấp');
    expect(modal).toContain('Điều khoản thanh toán');
    expect(modal).toContain('Ghi chú');
    expect(modal).toContain('<SupplierTypePicker types={types} onChange={setTypes} />');
    expect(picker).toContain('<EntityFormSection icon={Truck} label="Phân loại — quyết định nhà xe">');
    expect(modal).toContain('<RequiredHint />');
    // The required name gates the submit; the section primitive owns the
    // responsive 2-col field grid.
    expect(modal).toContain('isRequired');
    expect(modal).toContain('placeholder="Ví dụ: 0312…"');
    expect(modal).toContain('placeholder="Ví dụ: 15"');
    expect(modal).toContain('placeholder="Ví dụ: 30"');
    // Footer keeps the shared button contract.
    expect(modal).toContain('btn btn--secondary btn--sm');
    expect(modal).toContain('btn btn--primary btn--sm');
  });
});
