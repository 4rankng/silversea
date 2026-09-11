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

describe('Debit note template save/delete UX', () => {
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

  it('invalidates the saved template detail and shows the direct save toast', async () => {
    mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false });
    mocks.saveDebitNoteTemplate.mockResolvedValue({
      id: 901,
      name: 'Mẫu mới',
      documentType: 'DEBIT_NOTE',
      titleText: 'GIẤY BÁO NỢ',
      columns: [],
      groupingMode: 'ROUTE',
      orientation: 'landscape',
      isDefault: false,
      createdBy: 7,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    });

    render(<DebitNoteTemplateEditorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));

    await waitFor(() => {
      expect(mocks.saveDebitNoteTemplate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalogs.debitNoteTemplates });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalogs.debitNoteTemplate(901) });
    expect(mocks.toast).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã lưu mẫu giấy báo nợ.',
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/config/debit-note-templates');
  });

  it('shows the direct delete toast and refetches the template list', async () => {
    mocks.useQuery.mockReturnValue({
      data: [sampleTemplate],
      isLoading: false,
      refetch: mocks.refetch,
    });
    mocks.deleteDebitNoteTemplate.mockResolvedValue({ ok: true });

    render(<DebitNoteTemplatesConfigPage />);

    fireEvent.click(screen.getByRole('button', { name: `Xoá ${sampleTemplate.name}` }));

    await waitFor(() => {
      expect(mocks.deleteDebitNoteTemplate).toHaveBeenCalledWith(sampleTemplate.id);
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      kind: 'success',
      message: `Đã xoá mẫu "${sampleTemplate.name}".`,
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
