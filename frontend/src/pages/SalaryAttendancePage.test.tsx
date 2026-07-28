import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const salaryQueriesMock = vi.hoisted(() => ({
  useSalaryList: vi.fn(),
  useDriverSalary: vi.fn(),
  useDriverWorkDays: vi.fn(),
  useUpdateWorkDays: vi.fn(),
  useConfirmSalary: vi.fn(),
  useUnconfirmSalary: vi.fn(),
  useSalaryConfirmationGovernanceActions: vi.fn(),
  useCheckConfirmSalary: vi.fn(),
  useApproveConfirmSalary: vi.fn(),
  useCheckUnconfirmSalary: vi.fn(),
  useApproveUnconfirmSalary: vi.fn(),
  useSalaryPeriodGovernanceActions: vi.fn(),
  useSalaryPeriodOverview: vi.fn(),
  useCheckCloseSalaryPeriod: vi.fn(),
  useApproveCloseSalaryPeriod: vi.fn(),
  useCloseSalaryPeriod: vi.fn(),
  useCheckReopenSalaryPeriod: vi.fn(),
  useApproveReopenSalaryPeriod: vi.fn(),
  useReopenSalaryPeriod: vi.fn(),
  useIssueSalaryPeriod: vi.fn(),
  useCheckIssueSalaryPeriod: vi.fn(),
  useApproveIssueSalaryPeriod: vi.fn(),
  usePostSalaryPeriod: vi.fn(),
  useCheckPostSalaryPeriod: vi.fn(),
  useApprovePostSalaryPeriod: vi.fn(),
  useRequestPostCloseAdjustment: vi.fn(),
  useCheckPostCloseAdjustment: vi.fn(),
  useApprovePostCloseAdjustment: vi.fn(),
}));

vi.mock('../hooks/useSalaryQueries', () => salaryQueriesMock);
vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));
vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: () => undefined,
}));
vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({
    month: 7,
    year: 2026,
    goPrev: vi.fn(),
    goNext: vi.fn(),
  }),
}));
vi.mock('../hooks/useCatalogQueries', () => ({
  useSalaryPeriod: () => ({ data: { start: '2026-07-01', end: '2026-07-31' } }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 99, role: 'MANAGER' },
  }),
}));
vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

import SalaryAttendancePage from './SalaryAttendancePage';

function mutationStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  };
}

const baseSalary = {
  driverId: 1,
  year: 2026,
  month: 7,
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  standardWorkDays: 26,
  tripDays: 10,
  standbyDays: 4,
  personalLeaveDays: 0,
  weeklyOffDays: 4,
  paidDays: 14,
  baseSalary: 12_000_000,
  socialInsurance: 0,
  dailyRate: 461_538,
  totalTripSalary: 3_200_000,
  supplementPay: 1_000_000,
  leaveDeduction: 0,
  adjustment: 0,
  totalPenalties: 0,
  netSalary: 13_200_000,
  postCloseAdjustment: 0,
  confirmationStatus: 'CONFIRMED' as const,
  confirmedBy: 8,
  confirmedAt: '2026-07-31T09:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SalaryAttendancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SalaryAttendancePage Q11 post-close surface', () => {
  beforeEach(() => {
    salaryQueriesMock.useSalaryList.mockReturnValue({
      data: {
        items: [{ id: 1, name: 'Nguyen Van A', status: 'ACTIVE', salary: { ...baseSalary } }],
      },
      isLoading: false,
    });
    salaryQueriesMock.useDriverSalary.mockReturnValue({ data: { ...baseSalary }, isLoading: false });
    salaryQueriesMock.useDriverWorkDays.mockReturnValue({ data: { workDays: [] }, isLoading: false });
    salaryQueriesMock.useUpdateWorkDays.mockReturnValue(mutationStub());
    salaryQueriesMock.useConfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useUnconfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useSalaryConfirmationGovernanceActions.mockReturnValue({ data: [], isLoading: false });
    salaryQueriesMock.useCheckConfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useApproveConfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useCheckUnconfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useApproveUnconfirmSalary.mockReturnValue(mutationStub());
    salaryQueriesMock.useSalaryPeriodGovernanceActions.mockReturnValue({ data: [], isLoading: false });
    salaryQueriesMock.useCheckCloseSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useApproveCloseSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useCloseSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useCheckReopenSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useApproveReopenSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useReopenSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useIssueSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useCheckIssueSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useApproveIssueSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.usePostSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useCheckPostSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useApprovePostSalaryPeriod.mockReturnValue(mutationStub());
    salaryQueriesMock.useRequestPostCloseAdjustment.mockReturnValue(mutationStub());
    salaryQueriesMock.useCheckPostCloseAdjustment.mockReturnValue(mutationStub());
    salaryQueriesMock.useApprovePostCloseAdjustment.mockReturnValue(mutationStub());
    salaryQueriesMock.useSalaryPeriodOverview.mockReturnValue({
      data: {
        lifecycle: {
          period: '2026-07',
          status: 'OPEN',
          closeId: null,
          version: null,
          ledgerEntryId: null,
          closedBy: null,
          closedAt: null,
          note: null,
          payslipIssuedBy: null,
          payslipIssuedAt: null,
          payslipIssuedNote: null,
          officialPostedBy: null,
          officialPostedAt: null,
          officialPostingNote: null,
          hasDriverPayout: false,
          canReopen: false,
          reopenBlockers: ['Kỳ lương chưa được chốt'],
        },
        adjustments: [],
      },
      isLoading: false,
    });
  });

  it('shows the close action while the company period is still open', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Nguyen Van A')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Gửi yêu cầu chốt kỳ' })).toBeTruthy();
  });

  it('shows a request-confirm button while the driver salary is still draft', async () => {
    salaryQueriesMock.useSalaryList.mockReturnValue({
      data: {
        items: [{ id: 1, name: 'Nguyen Van A', status: 'ACTIVE', salary: { ...baseSalary, confirmationStatus: 'DRAFT', confirmedBy: null, confirmedAt: null } }],
      },
      isLoading: false,
    });
    salaryQueriesMock.useDriverSalary.mockReturnValue({
      data: { ...baseSalary, confirmationStatus: 'DRAFT', confirmedBy: null, confirmedAt: null },
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xác nhận' })).toBeTruthy());
  });

  it('shows the pending salary-confirmation governance request and checker action instead of another request button', async () => {
    salaryQueriesMock.useSalaryList.mockReturnValue({
      data: {
        items: [{ id: 1, name: 'Nguyen Van A', status: 'ACTIVE', salary: { ...baseSalary, confirmationStatus: 'DRAFT', confirmedBy: null, confirmedAt: null } }],
      },
      isLoading: false,
    });
    salaryQueriesMock.useDriverSalary.mockReturnValue({
      data: { ...baseSalary, confirmationStatus: 'DRAFT', confirmedBy: null, confirmedAt: null },
      isLoading: false,
    });
    salaryQueriesMock.useSalaryConfirmationGovernanceActions.mockReturnValue({
      data: [{
        id: 51,
        subjectType: 'SALARY_CONFIRMATION',
        subjectId: null,
        subjectKey: '1:2026-07',
        actionKind: 'SALARY_CONFIRMATION',
        status: 'PENDING_CHECK',
        version: 2,
        reason: 'Đề nghị xác nhận bảng công và lương tháng 07',
        makerId: 18,
        makerRole: 'ACCOUNTANT',
        checkerId: null,
        checkerRole: null,
        approverId: null,
        approverRole: null,
        createdAt: '2026-07-31T10:00:00.000Z',
        checkedAt: null,
        approvedAt: null,
        beforeSnapshot: null,
        afterSnapshot: null,
        deltaSnapshot: null,
        allowedActions: ['CHECK'],
      }],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Yêu cầu xác nhận bảng công và lương')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Gửi yêu cầu xác nhận' })).toBeNull();
    expect(screen.getByText(/Đang có yêu cầu xác nhận bảng công và lương chờ xử lý bên dưới/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeTruthy();
  });

  it('shows the pending close governance request and manager check action instead of another close request', async () => {
    salaryQueriesMock.useSalaryPeriodGovernanceActions.mockReturnValue({
      data: [{
        id: 41,
        subjectType: 'SALARY_PERIOD',
        subjectId: 15,
        subjectKey: '2026-07',
        actionKind: 'SALARY_PERIOD_CLOSE',
        status: 'PENDING_CHECK',
        version: 2,
        reason: 'Đề nghị chốt kỳ lương tháng 07',
        makerId: 18,
        makerRole: 'ACCOUNTANT',
        checkerId: null,
        checkerRole: null,
        approverId: null,
        approverRole: null,
        createdAt: '2026-07-31T10:00:00.000Z',
        checkedAt: null,
        approvedAt: null,
        beforeSnapshot: null,
        afterSnapshot: null,
        deltaSnapshot: null,
        allowedActions: ['CHECK'],
      }],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Yêu cầu chốt kỳ')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Gửi yêu cầu chốt kỳ' })).toBeNull();
    expect(screen.getByText(/Đang có yêu cầu chốt kỳ chờ xử lý bên dưới/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeTruthy();
  });

  it('blocks reopen in the UI after payslips have been issued and shows the adjustment path', async () => {
    salaryQueriesMock.useSalaryPeriodOverview.mockReturnValue({
      data: {
        lifecycle: {
          period: '2026-07',
          status: 'CLOSED',
          closeId: 11,
          version: 4,
          ledgerEntryId: 101,
          closedBy: 5,
          closedAt: '2026-07-31T10:00:00.000Z',
          note: 'Đã chốt',
          payslipIssuedBy: 8,
          payslipIssuedAt: '2026-08-01T08:00:00.000Z',
          payslipIssuedNote: 'Phát hành tháng 07',
          officialPostedBy: null,
          officialPostedAt: null,
          officialPostingNote: null,
          hasDriverPayout: false,
          canReopen: false,
          reopenBlockers: ['Kỳ lương 2026-07 đã phát hành phiếu lương'],
        },
        adjustments: [],
      },
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Đã phát hành phiếu lương')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Mở lại kỳ lương' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tạo khoản điều chỉnh' })).toBeTruthy();
  });

  it('requires a reopen reason before sending the governed salary-reopen request and passes the typed reason through', async () => {
    const reopenMutate = vi.fn();
    salaryQueriesMock.useReopenSalaryPeriod.mockReturnValue({
      ...mutationStub(),
      mutate: reopenMutate,
    });
    salaryQueriesMock.useUnconfirmSalary.mockReturnValue({
      ...mutationStub(),
      mutate: reopenMutate,
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu mở lại' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu mở lại' }));
    expect(screen.getByText('Cần nhập lý do mở lại bảng công và lương trước khi gửi yêu cầu.')).toBeTruthy();
    expect(reopenMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Lý do mở lại bảng công và lương'), {
      target: { value: 'Điều chỉnh sau đối soát kỳ lương tháng 07' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu mở lại' }));

    expect(reopenMutate).toHaveBeenCalledTimes(1);
    expect(reopenMutate).toHaveBeenCalledWith(
      'Điều chỉnh sau đối soát kỳ lương tháng 07',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('renders an approved linked adjustment on the target period for the selected driver', async () => {
    salaryQueriesMock.useDriverSalary.mockReturnValue({
      data: { ...baseSalary, postCloseAdjustment: 450_000, netSalary: 13_650_000 },
      isLoading: false,
    });
    salaryQueriesMock.useSalaryPeriodOverview.mockReturnValue({
      data: {
        lifecycle: {
          period: '2026-08',
          status: 'OPEN',
          closeId: null,
          version: null,
          ledgerEntryId: null,
          closedBy: null,
          closedAt: null,
          note: null,
          payslipIssuedBy: null,
          payslipIssuedAt: null,
          payslipIssuedNote: null,
          officialPostedBy: null,
          officialPostedAt: null,
          officialPostingNote: null,
          hasDriverPayout: false,
          canReopen: false,
          reopenBlockers: ['Kỳ lương chưa được chốt'],
        },
        adjustments: [{
          actionId: 21,
          adjustmentId: 31,
          sourcePeriod: '2026-07',
          targetPeriod: '2026-08',
          driverId: 1,
          driverName: 'Nguyen Van A',
          amount: 450000,
          reason: 'Bổ sung chuyến hoàn tất sau khi đã phát hành phiếu lương kỳ 07',
          status: 'APPROVED' as const,
          makerId: 7,
          makerName: 'Kế toán',
          checkerId: 8,
          checkerName: 'Trưởng phòng',
          approverId: 99,
          approverName: 'Giám đốc',
          createdAt: '2026-08-02T09:00:00.000Z',
          approvedAt: '2026-08-02T11:00:00.000Z',
          relationship: 'TARGET' as const,
        }],
      },
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Nguyen Van A')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Từ kỳ 2026-07')).toBeTruthy());
    expect(screen.getByText(/Bổ sung chuyến hoàn tất/)).toBeTruthy();
  });
});
