import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../../api/keys';
import type { DebitNoteTemplate } from '@tingting/shared';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  invalidateQueries: vi.fn(),
  refetch: vi.fn(),
  useQuery: vi.fn(),
  saveDebitNoteTemplate: vi.fn(),
  updateDebitNoteTemplate: vi.fn(),
  deleteDebitNoteTemplate: vi.fn(),
  params: {} as Record<string, string>,
  search: '',
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => mocks.useQuery(options),
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
    }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => mocks.params,
    useSearchParams: () => [new URLSearchParams(mocks.search)],
  };
});

vi.mock('../../components/shared/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('../../components/UI', () => ({
  PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
  useConfirm: () => ({ confirm: mocks.confirm, dialog: null }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({
  useBackShortcut: () => undefined,
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../components/AssetIcon', () => ({
  AssetIcon: () => <div data-testid="asset-icon" />,
}));

vi.mock('./debit-note-template-preview', () => ({
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
  TemplatePreview: () => <div data-testid="template-preview" />,
}));

vi.mock('./debit-note-template-columns', () => ({
  ColumnPropertyPanel: () => <div data-testid="column-property-panel" />,
  ColumnTable: () => <div data-testid="column-table" />,
}));

vi.mock('../../api/configClient', () => ({
  configClient: {
    getDebitNoteTemplate: vi.fn(),
    getDebitNoteTemplates: vi.fn(),
    saveDebitNoteTemplate: (...args: unknown[]) => mocks.saveDebitNoteTemplate(...args),
    updateDebitNoteTemplate: (...args: unknown[]) => mocks.updateDebitNoteTemplate(...args),
    deleteDebitNoteTemplate: (...args: unknown[]) => mocks.deleteDebitNoteTemplate(...args),
  },
}));

import DebitNoteTemplateEditorPage from './DebitNoteTemplateEditorPage';
import DebitNoteTemplatesConfigPage from './DebitNoteTemplatesConfigPage';

const sampleTemplate: DebitNoteTemplate = {
  id: 41,
  name: 'Mẫu công nợ A',
  documentType: 'DEBIT_NOTE',
  titleText: 'GIẤY BÁO NỢ',
  issuerName: null,
  issuerTaxCode: null,
  issuerAddress: null,
  issuerRepresentative: null,
  accentColor: '#1F4E79',
  showContainerColumn: true,
  showUnitColumn: true,
  groupingMode: 'ROUTE',
  columns: [],
  amountInWords: false,
  orientation: 'landscape',
  termsText: null,
  signatureLeftLabel: null,
  signatureLeftName: null,
  signatureRightLabel: null,
  signatureRightName: null,
  isDefault: false,
  createdBy: 7,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  deletedAt: null,
};

describe('Debit note template governance UX', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
    mocks.refetch.mockReset().mockResolvedValue(undefined);
    mocks.useQuery.mockReset();
    mocks.saveDebitNoteTemplate.mockReset();
    mocks.updateDebitNoteTemplate.mockReset();
    mocks.deleteDebitNoteTemplate.mockReset();
    mocks.params = {};
    mocks.search = '';
  });

  it('shows a pending-review save message without invalidating a fake template detail id', async () => {
    mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false });
    mocks.saveDebitNoteTemplate.mockResolvedValue({
      id: 901,
      status: 'PENDING_CHECK',
      actionKind: 'PRICE_CONFIG_CHANGE',
      version: 1,
    });

    render(<DebitNoteTemplateEditorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));

    await waitFor(() => {
      expect(mocks.saveDebitNoteTemplate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalogs.debitNoteTemplates });
    expect(mocks.toast).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã gửi yêu cầu tạo mẫu giấy báo nợ để kiểm tra và phê duyệt. Mẫu chưa được áp dụng.',
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/config/debit-note-templates');
  });

  it('shows a pending-review delete message instead of claiming the template was deleted', async () => {
    mocks.useQuery.mockReturnValue({
      data: [sampleTemplate],
      isLoading: false,
      refetch: mocks.refetch,
    });
    mocks.deleteDebitNoteTemplate.mockResolvedValue({
      id: 902,
      status: 'PENDING_CHECK',
      actionKind: 'PRICE_CONFIG_CHANGE',
      version: 1,
    });

    render(<DebitNoteTemplatesConfigPage />);

    fireEvent.click(screen.getByRole('button', { name: `Xoá ${sampleTemplate.name}` }));

    await waitFor(() => {
      expect(mocks.deleteDebitNoteTemplate).toHaveBeenCalledWith(sampleTemplate.id);
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      kind: 'success',
      message: `Đã gửi yêu cầu xoá mẫu "${sampleTemplate.name}" để kiểm tra và phê duyệt. Mẫu hiện chưa bị xoá.`,
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
