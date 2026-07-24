import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salaryClient, salaryPeriodConfigClient, type WorkDayUpdate } from '../api/salaryClient';
import { qk } from '../api/keys';

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
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

export function useUnconfirmSalary(driverId: number, year: number, month: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => salaryClient.unconfirmSalary(driverId, year, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      queryClient.invalidateQueries({ queryKey: qk.salary.list(year, month) });
    },
  });
}

