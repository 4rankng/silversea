import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salaryClient, salaryPeriodConfigClient, type WorkDayUpdate } from '../api/salaryClient';
import { qk } from '../api/keys';

const salaryPeriodOverviewKey = (period: string, driverId: number | null) =>
  ['salary-period-overview', period, driverId ?? 'all'] as const;
const salaryPeriodGovernanceKey = (period: string) =>
  ['salary-period-governance', period] as const;
const salaryConfirmationGovernanceKey = (driverId: number, year: number, month: number) =>
  ['salary-confirmation-governance', driverId, year, month] as const;

export function useSalaryList(year: number, month: number) {
  return useQuery({
    queryKey: qk.salary.list(year, month),
    queryFn: () => salaryClient.getAll(year, month),
    enabled: year >= 2020 && month >= 1 && month <= 12,
  });
}

export function useDriverSalary(driverId: number | null, year: number, month: number) {
  return useQuery({
    queryKey: qk.salary.driverSalary(driverId, year, month),
    queryFn: () => salaryClient.getSalary(driverId!, year, month),
    enabled: !!driverId && year >= 2020 && month >= 1 && month <= 12,
  });
}

export function useDriverWorkDays(driverId: number | null, year: number, month: number) {
  return useQuery({
    queryKey: qk.salary.driverWorkdays(driverId, year, month),
    queryFn: () => salaryClient.getWorkDays(driverId!, year, month),
    enabled: !!driverId && year >= 2020 && month >= 1 && month <= 12,
  });
}

export function useUpdateWorkDays(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: WorkDayUpdate[]) =>
      salaryClient.updateWorkDays(driverId, year, month, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdays(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useSalaryPeriodDefault() {
  return useQuery({
    queryKey: qk.salary.periodDefault,
    queryFn: () => salaryPeriodConfigClient.getDefault(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateSalaryPeriodDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ startDay, endDay }: { startDay: number; endDay: number }) =>
      salaryPeriodConfigClient.updateDefault(startDay, endDay),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.periodDefault });
      queryClient.invalidateQueries({ queryKey: qk.salary.periodResolveAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdaysAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.listAll });
    },
  });
}

export function useDeleteSalaryPeriodDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => salaryPeriodConfigClient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.periodDefault });
      queryClient.invalidateQueries({ queryKey: qk.salary.periodResolveAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdaysAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
      queryClient.invalidateQueries({ queryKey: qk.salary.listAll });
    },
  });
}

export function useResolveSalaryPeriod(year: number, month: number) {
  return useQuery({
    queryKey: qk.salary.periodResolve(year, month),
    queryFn: () => salaryPeriodConfigClient.resolve(year, month),
    enabled: year >= 2020 && month >= 1 && month <= 12,
  });
}

export function useConfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => salaryClient.confirmSalary(driverId, year, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdays(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
    },
  });
}

export function useUnconfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => salaryClient.unconfirmSalary(driverId, year, month, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdays(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
    },
  });
}

export function useSalaryConfirmationGovernanceActions(driverId: number | null, year: number, month: number) {
  return useQuery({
    queryKey: salaryConfirmationGovernanceKey(driverId ?? 0, year, month),
    queryFn: () => salaryClient.listDriverGovernanceActions(driverId!, year, month),
    enabled: !!driverId && year >= 2020 && month >= 1 && month <= 12,
  });
}

export function useCheckConfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkConfirmSalary(driverId, year, month, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useApproveConfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approveConfirmSalary(driverId, year, month, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useCheckUnconfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkUnconfirmSalary(driverId, year, month, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useApproveUnconfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approveUnconfirmSalary(driverId, year, month, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryConfirmationGovernanceKey(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverWorkdays(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useSalaryPeriodOverview(period: string, driverId: number | null) {
  return useQuery({
    queryKey: salaryPeriodOverviewKey(period, driverId),
    queryFn: () => salaryClient.getPeriodOverview(period, driverId),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
  });
}

export function useSalaryPeriodGovernanceActions(period: string) {
  return useQuery({
    queryKey: salaryPeriodGovernanceKey(period),
    queryFn: () => salaryClient.listPeriodGovernanceActions(period),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
  });
}

export function useCloseSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note?: string | null) => salaryClient.closePeriod(period, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function useCheckCloseSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkClosePeriod(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useApproveCloseSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approveClosePeriod(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function useReopenSalaryPeriod(period: string, driverId: number | null, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { expectedVersion: number; reason: string }) =>
      salaryClient.reopenPeriod(period, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function useCheckReopenSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkReopenPeriod(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useApproveReopenSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approveReopenPeriod(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function useIssueSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { expectedVersion: number; note?: string | null }) =>
      salaryClient.issuePayslips(period, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function useCheckIssueSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkIssuePayslips(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
    },
  });
}

export function useApproveIssueSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approveIssuePayslips(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
      queryClient.invalidateQueries({ queryKey: qk.driver.payslips });
    },
  });
}

export function usePostSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { expectedVersion: number; note?: string | null }) =>
      salaryClient.postOfficial(period, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
    },
  });
}

export function useCheckPostSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkPostOfficial(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
    },
  });
}

export function useApprovePostSalaryPeriod(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedVersion }: { actionId: number; expectedVersion: number }) =>
      salaryClient.approvePostOfficial(period, actionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: salaryPeriodGovernanceKey(period) });
    },
  });
}

export function useRequestPostCloseAdjustment(period: string, driverId: number | null, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      driverId: number;
      targetPeriod: string;
      amount: number;
      reason: string;
      expectedVersion: number;
    }) => salaryClient.requestPostCloseAdjustment(period, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useCheckPostCloseAdjustment(period: string, driverId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: number; expectedVersion: number }) =>
      salaryClient.checkPostCloseAdjustment(period, input.actionId, input.expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
    },
  });
}

export function useApprovePostCloseAdjustment(period: string, driverId: number | null, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: number; expectedVersion: number }) =>
      salaryClient.approvePostCloseAdjustment(period, input.actionId, input.expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, driverId) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
    },
  });
}
