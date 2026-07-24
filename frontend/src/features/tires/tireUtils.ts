import type { Supplier, Tire, TirePosition } from '@tingting/shared';

/** Editable tire fields. `cost` is a number on the wire (numeric(15,0)). */
export type TirePatch = Partial<{
  serial: string;
  truckId: number | null;
  trailerId: number | null;
  position: string | null;
  size: string | null;
  installedAt: string | null;
  removedAt: string | null;
  supplierId: number | null;
  cost: number;
  purchasedAt: string | null;
  status: Tire['status'];
}>;

export type TireEditDraft = {
  serial: string;
  position: string;
  size: string;
  installedAt: string;
  supplierText: string;
  purchasedAt: string;
};

/**
 * Whole days from `fromISO` (parsed as local midnight) to `toISO` (or now when
 * `toISO` is null/omitted). Returns null when `fromISO` is missing/invalid, and
 * is clamped to ≥ 0. Shared by tire age + days-in-service so both stay on the
 * same local-midnight day math (no UTC drift).
 */
export function daysBetween(fromISO: string | null, toISO?: string | null): number | null {
  if (!fromISO) return null;
  const start = new Date(`${fromISO}T00:00:00`).getTime();
  const end = toISO ? new Date(`${toISO}T00:00:00`).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** Days since the tire was purchased (purchasedAt → today). Null when unknown. */
export function tireAgeDays(purchasedAt: string | null): number | null {
  return daysBetween(purchasedAt, null);
}

/** Today's date as local 'YYYY-MM-DD' (no UTC drift). Mirrors the backend todayISO(). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function cleanText(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

export function normalizeSearchText(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

export function textMatches(haystack: string, query: string): boolean {
  return normalizeSearchText(haystack).includes(normalizeSearchText(query));
}

export function displayTirePosition(tire: Tire): string {
  return tire.position || '—';
}

export function positionPayloadFromLabel(label: string): { position: string | null } {
  const cleaned = cleanText(label);
  return {
    position: cleaned || null,
  };
}

export function buildPositionLabels(tires: Tire[], tirePositions: TirePosition[]): string[] {
  const labels = [
    ...[...tirePositions]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
      .map((position) => position.name),
    ...tires.map((tire) => tire.position || '').filter(Boolean),
  ];
  return Array.from(new Set(labels.map(cleanText).filter(Boolean)));
}

export function buildUsedPositionLabels(tires: Tire[]): string[] {
  return Array.from(new Set(tires.map((tire) => cleanText(tire.position || '')).filter(Boolean)));
}

export function normalizedCatalogLabel(label: string): string {
  return normalizeSearchText(label);
}

export function supplierName(suppliers: Supplier[], supplierId: number | null): string {
  if (!supplierId) return '—';
  return suppliers.find((supplier) => supplier.id === supplierId)?.name ?? '—';
}

export function supplierTextFromId(suppliers: Supplier[], supplierId: number | null): string {
  if (!supplierId) return '';
  return suppliers.find((supplier) => supplier.id === supplierId)?.name ?? '';
}

export function supplierIdFromText(suppliers: Supplier[], label: string): number | null {
  const cleaned = cleanText(label);
  if (!cleaned) return null;
  const match = suppliers.find((supplier) => cleanText(supplier.name).toLocaleLowerCase('vi') === cleaned.toLocaleLowerCase('vi'));
  return match?.id ?? null;
}

export function draftFromTire(tire: Tire, suppliers: Supplier[]): TireEditDraft {
  return {
    serial: tire.serial,
    position: tire.position ?? '',
    size: tire.size ?? '',
    installedAt: tire.installedAt ?? '',
    supplierText: supplierTextFromId(suppliers, tire.supplierId),
    purchasedAt: tire.purchasedAt ?? '',
  };
}

export function patchFromDraft(draft: TireEditDraft, suppliers: Supplier[]): TirePatch {
  return {
    serial: draft.serial.trim(),
    ...positionPayloadFromLabel(draft.position),
    size: draft.size.trim() || null,
    installedAt: draft.installedAt || null,
    supplierId: supplierIdFromText(suppliers, draft.supplierText),
    purchasedAt: draft.purchasedAt || null,
  };
}
