import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salaryClient, salaryPeriodConfigClient, type WorkDayUpdate, type WorkDayRecord } from '../api/salaryClient';
import { qk } from '../api/keys';

const salaryPeriodOverviewKey = (period: string, driverId: number | null) =>
  ['salary-period-overview', period, driverId ?? 'all'] as const;

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
  const workdaysKey = qk.salary.driverWorkdays(driverId, year, month);
  return useMutation({
    mutationFn: (items: WorkDayUpdate[]) =>
      salaryClient.updateWorkDays(driverId, year, month, items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: workdaysKey });
      type WorkdaysResponse = { period: { start: string; end: string; label: string }; workDays: WorkDayRecord[] };
      const previous = queryClient.getQueryData<WorkdaysResponse>(workdaysKey);
      queryClient.setQueryData<WorkdaysResponse>(workdaysKey, (old) => {
        if (!old) return old;
        const updated = [...old.workDays];
        for (const item of items) {
          const idx = updated.findIndex((w) => w.date === item.date);
          if (item.status === null) {
            if (idx >= 0) updated.splice(idx, 1);
          } else if (idx >= 0) {
            updated[idx] = { ...updated[idx], status: item.status, note: item.note ?? updated[idx].note };
          } else {
            updated.push({ id: 0, driverId, date: item.date, status: item.status, tripId: null, note: item.note ?? null });
          }
        }
        return { ...old, workDays: updated };
      });
      return { previous };
    },
    onError: (_err, _items, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workdaysKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workdaysKey });
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
export function useCloseSalaryPeriod(period: string, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note?: string | null) => salaryClient.closePeriod(period, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salaryPeriodOverviewKey(period, null) });
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
