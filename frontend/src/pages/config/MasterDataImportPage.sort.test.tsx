import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importClientMock } = vi.hoisted(() => ({
  importClientMock: { analyzeMasterData: vi.fn(), applyMasterData: vi.fn(), rejectMasterData: vi.fn() },
}));

vi.mock('../../api/masterDataImportClient', () => importClientMock);

import MasterDataImportPage from './MasterDataImportPage';

const batch = {
  id: 1,
  sourceFileName: 'master.xlsx',
  sourceFileHash: 'h',
  parserVersion: 'v1',
  status: 'ANALYZED',
  summary: { ACCEPTED: 3, BLOCKED: 1, TEMPLATE: 0, EXAMPLE: 0 },
  warningCodes: [],
  version: 1,
  analyzedAt: '2026-08-23T00:00:00.000Z',
  appliedAt: null,
  rows: [
    { id: 1, sheetName: 'Khách hàng', rowNumber: 9, entityType: 'CUSTOMER', classification: 'ACCEPTED', reasonCode: null, redactedReason: null, appliedEntityType: null, appliedEntityId: null },
    { id: 2, sheetName: 'Khách hàng', rowNumber: 2, entityType: 'CUSTOMER', classification: 'BLOCKED', reasonCode: 'X', redactedReason: 'Thiếu tên', appliedEntityType: null, appliedEntityId: null },
    { id: 3, sheetName: 'Khách hàng', rowNumber: 5, entityType: 'CUSTOMER', classification: 'ACCEPTED', reasonCode: null, redactedReason: null, appliedEntityType: null, appliedEntityId: null },
  ],
};

function rowNumberColumn(): string[] {
  return screen.getAllByRole('row').slice(1).map((row) =>
    (row.querySelector('td')?.textContent ?? '').trim());
}

async function renderWithAnalyzedBatch() {
  render(
    <MemoryRouter>
      <MasterDataImportPage />
    </MemoryRouter>,
  );
  const input = document.getElementById('master-data-file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'master.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] } });
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra dữ liệu/ }));
  expect(await screen.findByText(/Khách hàng · 3 dòng/)).toBeTruthy();
}

describe('MasterDataImportPage preview sort headers', () => {
  beforeEach(() => {
    importClientMock.analyzeMasterData.mockReset();
    importClientMock.analyzeMasterData.mockResolvedValue({ batch, replayed: false });
  });

  it('keeps the sheet order first, then sorts Dòng asc → desc', async () => {
    await renderWithAnalyzedBatch();
    expect(rowNumberColumn()).toEqual(['9', '2', '5']);

    fireEvent.click(screen.getByRole('button', { name: 'Dòng' }));
    expect(rowNumberColumn()).toEqual(['2', '5', '9']);

    fireEvent.click(screen.getByRole('button', { name: 'Dòng' }));
    expect(rowNumberColumn()).toEqual(['9', '5', '2']);
  });

  it('sorts Kết quả labels and keeps Lý do as a sortable column', async () => {
    await renderWithAnalyzedBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Kết quả' }));
    const classifications = screen.getAllByRole('row').slice(1).map((row) =>
      row.querySelectorAll('td')[2]?.textContent ?? '');
    // Vietnamese collation: "Cần sửa" (C) sorts before "Hợp lệ" (H).
    expect(classifications).toEqual(['Cần sửa', 'Hợp lệ', 'Hợp lệ']);

    expect(screen.getByRole('button', { name: 'Lý do' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nhóm dữ liệu' })).toBeTruthy();
  });
});
