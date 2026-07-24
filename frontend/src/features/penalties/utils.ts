import type { PenaltyRow } from '../../hooks/usePenalties';

export type Severity = 'light' | 'med' | 'heavy' | 'critical';

export function getSeverity(amount: number): Severity {
  if (amount < 300000) return 'light';
  if (amount < 800000) return 'med';
  if (amount < 1500000) return 'heavy';
  return 'critical';
}

export function getSeverityLabel(s: Severity): string {
  return { light: 'Nhẹ', med: 'Trung bình', heavy: 'Nặng', critical: 'Đặc biệt' }[s];
}

export function getViolationGrade(violationCount: number): string {
  if (violationCount === 0) return 'A+';
  if (violationCount <= 2) return 'A';
  if (violationCount <= 5) return 'B';
  return 'C';
}

export function getGradeClass(grade: string): string {
  if (grade === 'A+') return 'a-plus';
  if (grade === 'A') return 'a';
  if (grade === 'B') return 'b';
  return 'c';
}

export function formatPillLabel(filter: 'all' | 'pending' | 'deducted'): string {
  if (filter === 'all') return 'Tất cả';
  if (filter === 'pending') return 'Hiệu lực';
  return 'Đã hủy';
}

export function formatTenure(createdAt: string): string {
  const start = new Date(createdAt);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  const years = Math.floor(months / 12);
  months = months % 12;
  if (years > 0 && months > 0) return `${years} năm ${months} tháng`;
  if (years > 0) return `${years} năm`;
  return `${months} tháng`;
}

export function computeStreak(driverId: number, penalties: PenaltyRow[], createdAt: string): number {
  const driverPenalties = penalties
    .filter(p => p.driverId === driverId && p.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (driverPenalties.length === 0) {
    const hire = new Date(createdAt);
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - hire.getTime()) / 86400000));
  }
  const lastViolation = new Date(driverPenalties[0].date);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - lastViolation.getTime()) / 86400000));
}
