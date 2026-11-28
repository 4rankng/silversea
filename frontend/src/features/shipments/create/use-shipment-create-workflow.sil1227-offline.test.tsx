// SIL-1227 (K1.11/K2.161) — bấm "Lưu nháp" khi mất mạng used to print the
// browser's engine English ('NetworkError when attempting to fetch resource.')
// verbatim in the error banner and the toast. The save catch routes through
// the site's single mapping (actionErrorMessage, the SIL-1035 law) with the
// shared offline SAVE sentence (SIL-1105's copy: name what did NOT happen and
// when to retry), so both engine texts read the same Vietnamese sentence and
// the draft form state is never touched — a retry re-sends the same content.
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/shared/Toast';

const {
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
} = vi.hoisted(() => ({
  quickCreateShipment: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
  saveShipmentContainers: vi.fn(),
  submitShipmentForDispatch: vi.fn(),
  createShipmentDeclaration: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', () => ({
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
}));

import {
  EMPTY_SHIPMENT_CREATE_FORM,
  getShipmentCreateReadiness,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';

const SAVE_SENTENCE = 'Mất kết nối, chưa lưu được. Giữ nguyên nội dung và thử lại khi có mạng.';

const draftForm: ShipmentCreateFormState = {
  ...EMPTY_SHIPMENT_CREATE_FORM,
  isAdHoc: true,
  rawCustomerName: 'Khách chạy ngoài',
  rawRouteName: 'Tuyến riêng',
  cargoMode: 'LCL',
  blNumber: 'BL-OFFLINE-1',
  tradeDirection: 'IMPORT',
  packageType: 'Pallet',
  packageCount: '5',
  cargoWeightKg: '300',
  expectedDeliveryDate: '2026-11-28',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/shipments/new']}>
    <ToastProvider>{children}</ToastProvider>
  </MemoryRouter>
);

function renderDraftWorkflow() {
  return renderHook(
    ({ current }: { current: ShipmentCreateFormState }) => useShipmentCreateWorkflow({
      form: current,
      containers: [],
      sites: [],
      readiness: getShipmentCreateReadiness(current, []),
      onValidationIssues: () => {},
    }),
    { wrapper, initialProps: { current: draftForm } },
  );
}

describe('useShipmentCreateWorkflow — SIL-1227 offline Lưu nháp mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateShipment.mockResolvedValue({ version: 4 });
  });

  it.each([
    ['Firefox NetworkError', new TypeError('NetworkError when attempting to fetch resource.')],
    ['Chrome Failed to fetch', new TypeError('Failed to fetch')],
    ['Safari Load failed', new TypeError('Load failed')],
  ])('%s maps to the offline save sentence, never engine English', async (_name, error) => {
    quickCreateShipment.mockRejectedValueOnce(error);
    const { result } = renderDraftWorkflow();

    await act(async () => { await result.current.save('DRAFT'); });

    expect(result.current.submitError).toBe(SAVE_SENTENCE);
    expect(result.current.submitError).not.toContain('NetworkError');
    expect(result.current.submitError).not.toContain('Failed to fetch');
    // Nothing saved — the request never reached the server.
    expect(updateShipment).not.toHaveBeenCalled();
    expect(saveShipmentContainers).not.toHaveBeenCalled();
  });

  it('a real server refusal keeps its verbatim reason (only the network layer is normalized)', async () => {
    quickCreateShipment.mockRejectedValueOnce(new Error('Lỗi máy chủ thử lại'));
    const { result } = renderDraftWorkflow();

    await act(async () => { await result.current.save('DRAFT'); });

    expect(result.current.submitError).toBe('Lỗi máy chủ thử lại');
  });
});
