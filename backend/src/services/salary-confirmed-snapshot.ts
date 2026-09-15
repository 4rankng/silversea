/** Persisted payroll facts. Never reconstruct an old confirmed amount from today's driver rate. */
interface WorkDayFact { id: number; date: string; status: string; tripId: number | null; note: string | null }
export function attendanceFingerprint(days: WorkDayFact[]): string {
  return JSON.stringify(days.map(({ id, date, status, tripId, note }) => ({ id, date, status, tripId, note }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id));
}

const numericFields = [
  'standardWorkDays', 'tripDays', 'standbyDays', 'personalLeaveDays', 'weeklyOffDays', 'paidDays',
  'baseSalary', 'socialInsurance', 'dailyRate', 'totalTripSalary', 'adjustment', 'supplementPay',
  'leaveDeduction', 'totalPenalties', 'netSalary',
] as const;

export function restoreSalarySnapshot<T>(
  snapshot: Record<string, unknown> | null | undefined,
  driverId: number, year: number, month: number,
): T | null {
  if (!snapshot || snapshot.snapshotVersion !== 1 || snapshot.driverId !== driverId
    || snapshot.year !== year || snapshot.month !== month
    || typeof snapshot.periodStart !== 'string' || typeof snapshot.periodEnd !== 'string'
    || !Array.isArray(snapshot.workDays)
    || numericFields.some((field) => typeof snapshot[field] !== 'number' || !Number.isFinite(snapshot[field]))) return null;
  const workDays = snapshot.workDays as Array<Record<string, unknown>>;
  if (workDays.some((day) => typeof day.id !== 'number' || typeof day.date !== 'string' || typeof day.status !== 'string'
    || typeof day.createdAt !== 'string' || typeof day.updatedAt !== 'string')) return null;
  return {
    ...snapshot,
    workDays: workDays.map((day) => ({ ...day, createdAt: new Date(String(day.createdAt)), updatedAt: new Date(String(day.updatedAt)) })),
  } as T;
}
