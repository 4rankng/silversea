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
