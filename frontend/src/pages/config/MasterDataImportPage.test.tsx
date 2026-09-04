import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), apply: vi.fn(), reject: vi.fn() }));
vi.mock('../../api/masterDataImportClient', () => ({
  analyzeMasterData: mocks.analyze,
  applyMasterData: mocks.apply,
  rejectMasterData: mocks.reject,
}));

import MasterDataImportPage from './MasterDataImportPage';

const baseBatch = {
  id: 1, sourceFileName: 'master.xlsx', sourceFileHash: 'hash', parserVersion: '1',
  status: 'ANALYZED' as const, summary: { ACCEPTED: 2, BLOCKED: 0, TEMPLATE: 1, EXAMPLE: 0 },
  warningCodes: [], version: 1, analyzedAt: '2026-08-01T00:00:00.000Z', appliedAt: null,
  rows: [
    { id: 1, sheetName: 'NHÀ MÁY', rowNumber: 3, entityType: 'operational_site', classification: 'ACCEPTED' as const, reasonCode: null, redactedReason: null, appliedEntityType: null, appliedEntityId: null },
    { id: 2, sheetName: 'CẢNG', rowNumber: 4, entityType: 'port', classification: 'TEMPLATE' as const, reasonCode: null, redactedReason: 'Dòng mẫu', appliedEntityType: null, appliedEntityId: null },
  ],
};

function renderPage() {
  return render(<MemoryRouter><MasterDataImportPage /></MemoryRouter>);
}

async function uploadAndAnalyze() {
  const dataForm = new File(['data-form'], 'Data form.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const userRole = new File(['user-role'], 'User & Role.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  fireEvent.change(screen.getByLabelText('Data form.xlsx (khách hàng, nhà máy, tuyến, cảng, xe)'), { target: { files: [dataForm] } });
  fireEvent.change(screen.getByLabelText('User & Role.xlsx (nhân sự, tài xế)'), { target: { files: [userRole] } });
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra dữ liệu/ }));
  await waitFor(() => expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ dataForm, userRole })));
}

describe('MasterDataImportPage', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.analyze.mockResolvedValue({ batch: baseBatch, replayed: false });
    mocks.apply.mockResolvedValue({ batch: { ...baseBatch, status: 'APPLIED', version: 2 }, appliedCounts: { port: 1 }, replayed: false });
  });

  it('shows a redacted dry-run and applies a fully valid batch', async () => {
    renderPage();
    await uploadAndAnalyze();
    expect(await screen.findByText('NHÀ MÁY · 1 dòng')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Áp dụng dữ liệu hợp lệ/ }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(baseBatch));
    expect(await screen.findByText(/Đã cập nhật danh mục thành công/)).toBeTruthy();
  });

  it('downloads only the redacted row report', async () => {
    const createObjectUrl = vi.fn(() => 'blob:master-report');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderPage();
    await uploadAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: /Tải báo cáo lỗi đã ẩn dữ liệu nhạy cảm/ }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:master-report');
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('prevents apply when any row is blocked and directs Admin to upload a corrected file', async () => {
    const blockedBatch = {
      ...baseBatch,
      summary: { ...baseBatch.summary, BLOCKED: 1 },
      rows: [...baseBatch.rows, { id: 3, sheetName: 'THÔNG TIN NCC', rowNumber: 2, entityType: 'organization', classification: 'BLOCKED' as const, reasonCode: 'AMBIGUOUS_ORGANIZATION_ROLE', redactedReason: 'Vai trò tổ chức chưa được xác nhận', appliedEntityType: null, appliedEntityId: null }],
    };
    mocks.analyze.mockResolvedValue({ batch: blockedBatch, replayed: false });
    renderPage();
    await uploadAndAnalyze();
    expect(await screen.findByText(/Có 1 dòng cần sửa/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Áp dụng dữ liệu hợp lệ/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('requires and sends an explicit reason when Admin rejects a batch', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.reject.mockResolvedValue({ batch: { ...baseBatch, status: 'REJECTED', version: 2 }, replayed: false });
    renderPage();
    await uploadAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: /Từ chối đợt nhập/ }));
    expect(await screen.findByText(/Vui lòng nhập lý do/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lý do từ chối'), { target: { value: 'Dữ liệu nhà xe chưa được xác nhận' } });
    fireEvent.click(screen.getByRole('button', { name: /Từ chối đợt nhập/ }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith(baseBatch, 'Dữ liệu nhà xe chưa được xác nhận'));
    expect(await screen.findByText(/Đợt nhập đã bị từ chối/)).toBeTruthy();
  });
});
