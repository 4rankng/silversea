/**
 * SIL-161 page tests for /demo/master-data: three tabs with their tables,
 * fleet search + add-row into fixture state, partner table searches, and the
 * editable Rate Engine matrices (click → edit → commit updates state).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import DemoMasterDataPage from './DemoMasterDataPage';
import { demoFreightRates } from '../data/master-data';

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoMasterDataPage />
    </MemoryRouter>,
  );
}

/** The testid sits on the control itself (InputBase/NativeSelect) or on its wrapper (TextField). */
function controlOf(testId: string): HTMLInputElement | HTMLSelectElement {
  const element = screen.getByTestId(testId);
  if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
    return element as HTMLInputElement | HTMLSelectElement;
  }
  const inner = element.querySelector('input, select');
  if (!inner) throw new Error(`no input/select found for ${testId}`);
  return inner as HTMLInputElement | HTMLSelectElement;
}

function typeInto(testId: string, value: string) {
  fireEvent.change(controlOf(testId), { target: { value } });
}

describe('/demo/master-data — tabs (SIL-161)', () => {
  it('opens on Đội xe nội bộ and switches to Đối tác and Rate Engine', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Quản lý Đội Xe & Danh Mục' })).toBeInTheDocument();
    expect(screen.getByTestId('fleet-table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Đối tác' }));
    expect(await screen.findByTestId('partners-table-customers')).toBeInTheDocument();
    expect(screen.getByTestId('partners-table-factories')).toBeInTheDocument();
    expect(screen.getByTestId('partners-table-vendors')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));
    expect(await screen.findByTestId('rate-matrix-ports')).toBeInTheDocument();
    expect(screen.getByTestId('rate-matrix-freight')).toBeInTheDocument();
  });
});

describe('/demo/master-data — đội xe nội bộ', () => {
  it('renders the fleet grid with pairing chips per truck', () => {
    renderPage();
    const row = screen.getByTestId('fleet-row-51C-138.65');
    // Driver identity appears in the column and again in the pairing chip.
    expect(within(row).getAllByText('Nguyễn Văn Tâm').length).toBeGreaterThanOrEqual(1);
    expect(within(row).getByText('034201001234')).toBeInTheDocument();
    expect(within(row).getByText('Hạng E')).toBeInTheDocument();
    const chips = screen.getByTestId('fleet-pair-51C-138.65');
    expect(chips).toHaveTextContent('51C-138.65');
    expect(chips).toHaveTextContent('51R-072.44');
    expect(chips).toHaveTextContent('Nguyễn Văn Tâm');
  });

  it('filters trucks by plate / driver / phone, diacritic-insensitively', () => {
    renderPage();
    typeInto('fleet-search', '469');
    expect(screen.getByTestId('fleet-row-72L-846.30')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-row-51C-138.65')).not.toBeInTheDocument();

    typeInto('fleet-search', 'tam');
    expect(screen.getByTestId('fleet-row-51C-138.65')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-row-72L-846.30')).not.toBeInTheDocument();

    typeInto('fleet-search', 'zzz');
    expect(screen.getByTestId('fleet-empty')).toBeInTheDocument();
  });

  it('adds a truck row into fixture state, blocking duplicate plates', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('fleet-add-toggle'));

    typeInto('fleet-add-plate', '51C-999.99');
    typeInto('fleet-add-model', 'Isuzu Giga');
    typeInto('fleet-add-trailer', '51R-999.99');
    // UuiSelectField exposes a hidden native select — the file-proven idiom.
    fireEvent.change(screen.getByDisplayValue('— Chọn tài xế —'), { target: { value: 'DRV-01' } });
    fireEvent.click(screen.getByTestId('fleet-add-submit'));

    expect(screen.getByTestId('fleet-row-51C-999.99')).toBeInTheDocument();
    expect(within(screen.getByTestId('fleet-pair-51C-999.99')).getByText('Nguyễn Văn Tâm')).toBeInTheDocument();

    // Duplicate plate is rejected with an inline error.
    fireEvent.click(screen.getByTestId('fleet-add-toggle'));
    typeInto('fleet-add-plate', '51C-999.99');
    typeInto('fleet-add-trailer', '51R-888.88');
    fireEvent.change(screen.getByDisplayValue('— Chọn tài xế —'), { target: { value: 'DRV-02' } });
    fireEvent.click(screen.getByTestId('fleet-add-submit'));
    expect(screen.getByTestId('fleet-add-error')).toHaveTextContent('đã tồn tại');
    expect(screen.getAllByTestId('fleet-row-51C-999.99')).toHaveLength(1);
  });
});

describe('/demo/master-data — đối tác', () => {
  it('searches all three partner catalogs', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Đối tác' }));

    const customers = screen.getByTestId('partners-table-customers');
    typeInto('partners-search-customers', 'samsung');
    expect(within(customers).getByText('Samsung Electronics HCM CE')).toBeInTheDocument();
    expect(within(customers).queryByText('Intel Việt Nam')).not.toBeInTheDocument();

    const factories = screen.getByTestId('partners-table-factories');
    typeInto('partners-search-factories', 'VSIP');
    expect(within(factories).getByText('KCN VSIP II')).toBeInTheDocument();

    const vendors = screen.getByTestId('partners-table-vendors');
    typeInto('partners-search-vendors', 'HTD');
    expect(within(vendors).getByText('HTD Vận Tải')).toBeInTheDocument();
    expect(within(vendors).queryByText('Giao Nhận Nam Hải')).not.toBeInTheDocument();
  });
});

describe('/demo/master-data — rate engine', () => {
  it('renders the 8-column port matrix with seeded Cát Lái fees', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));

    const matrix = screen.getByTestId('rate-matrix-ports');
    expect(within(matrix).getByText('20′ · Xuất')).toBeInTheDocument();
    expect(within(matrix).getByText('40′ · Nhập')).toBeInTheDocument();
    expect(screen.getByTestId('rate-cell-CL-20-export-lift')).toHaveTextContent('1.250.000');
    expect(screen.getByTestId('rate-cell-CM-40-import-drop')).toHaveTextContent('1.880.000');
  });

  it('edits a port fee cell and keeps the change in state', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));

    fireEvent.click(screen.getByTestId('rate-cell-VICT-20-export-lift'));
    const input = screen.getByTestId('rate-cell-VICT-20-export-lift');
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, { target: { value: '1.350.000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('rate-cell-VICT-20-export-lift')).toHaveTextContent('1.350.000');
    expect(screen.getByTestId('rate-save-live')).toHaveTextContent('Đã lưu');
    // Sibling cells untouched.
    expect(screen.getByTestId('rate-cell-VICT-20-export-drop')).toHaveTextContent('1.150.000');
  });

  it('rejects an empty edit by reverting the cell', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));

    fireEvent.click(screen.getByTestId('rate-cell-LB-40-export-lift'));
    const input = screen.getByTestId('rate-cell-LB-40-export-lift');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('rate-cell-LB-40-export-lift')).toHaveTextContent('2.150.000');
  });

  it('highlights row + column crosshair on hover', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));
    const matrix = screen.getByTestId('rate-matrix-ports');
    const tdOf = (testId: string) => screen.getByTestId(testId).closest('td');

    fireEvent.mouseEnter(screen.getByTestId('rate-cell-CL-40-export-drop'));

    // Same row band…
    expect(tdOf('rate-cell-CL-20-export-lift')?.className).toContain('bg-brand-50');
    // …same column band…
    expect(tdOf('rate-cell-CM-40-export-drop')?.className).toContain('bg-brand-50');
    // …and nothing outside the crosshair.
    expect(tdOf('rate-cell-VICT-20-export-lift')?.className).not.toContain('bg-brand');

    fireEvent.mouseLeave(matrix);
    expect(tdOf('rate-cell-CL-20-export-lift')?.className).not.toContain('bg-brand-50');
  });

  it('edits a freight rate cell for a customer × route row', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Rate Engine' }));

    const first = demoFreightRates[0];
    if (!first) throw new Error('freight fixture missing');
    const testId = `freight-cell-${first.id}-40`;
    fireEvent.click(screen.getByTestId(testId));
    fireEvent.change(screen.getByTestId(testId), { target: { value: '5000000' } });
    fireEvent.keyDown(screen.getByTestId(testId), { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId(testId)).toHaveTextContent('5.000.000'));
    expect(screen.getByTestId('freight-save-live')).toHaveTextContent('Samsung');
  });
});
