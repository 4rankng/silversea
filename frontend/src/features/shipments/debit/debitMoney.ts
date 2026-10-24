import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import { formatMoney } from '../../../lib/format';

/**
 * Money-state helpers for the redesigned Chi phí - Quyết toán L1 board
 * (owner spec v2 (c), 23/10; pending amended to BLANK 24/10). The wire's
 * null never means 0 — it means the figure is not determined yet ("chưa
 * xác định — chờ đối soát"). The board renders exactly:
 *
 *   known  → the formatted number (tabular, right-aligned)
 *   zero   → '0' — phát sinh nhưng tổng bằng 0
 *   pending→ an EMPTY cell — the 'Chờ số liệu' pill repeated ~5×/row over
 *            170 lots and buried the real figures (owner 24/10)
 *
 * The banned strings: 'Chưa xác định' in a money cell (audit #3), and any
 * fabricated 0.
 */

export type MoneyState =
  | { kind: 'known'; value: number }
  | { kind: 'zero' }
  | { kind: 'pending' };

/** Wire money arrives as decimal strings (or legacy numbers); null/''/NaN = pending. */
export function moneyState(value: string | number | null | undefined): MoneyState {
  if (value == null || value === '') return { kind: 'pending' };
  const num = Number(value);
  if (!Number.isFinite(num)) return { kind: 'pending' };
  if (num === 0) return { kind: 'zero' };
  return { kind: 'known', value: num };
}

/** Sum the KNOWN values only; zero counts as known 0, pending is skipped. */
export function sumMoneyStates(states: MoneyState[]): number | null {
  let sum = 0;
  let any = false;
  for (const state of states) {
    if (state.kind === 'known') { sum += state.value; any = true; }
    else if (state.kind === 'zero') { any = true; }
  }
  return any ? sum : null;
}

export const PENDING_TOOLTIP = 'Chưa chốt — đang chờ số liệu đối soát';
export const ZERO_TOOLTIP = 'Phát sinh nhưng tổng bằng 0';
export const EMPTY_SUM_TOOLTIP = 'Chưa có số liệu nào đã chốt trong danh sách này';

/** Vietnamese Title Case for names: 'NGUYỄN VĂN A' → 'Nguyễn Văn A'. */
export function titleCaseName(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLocaleLowerCase('vi-VN')
    .replace(/(^|[\s-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toLocaleUpperCase('vi-VN'));
}

/** The row's single display key (AGENTS §2): Số Bill/Booking → Số tờ khai → '—'. */
export function lotLabelOf(row: ShipmentDebitLotRow): string {
  return row.billOrBookNumber || row.customsNumber || '—';
}

/** One document identity per entry — the checklist behind the CHỨNG TỪ badge. */
export interface LotDocument {
  ok: boolean;
  label: string;
  value: string | null;
}

/** The L1 wire carries exactly two document identities: Bill/Booking and the
 *  tờ khai numbers (comma-joined when several). 'Chưa đính kèm' rows are the
 *  ✗ entries — no file list is fabricated (the wire has none). */
export function lotDocuments(row: ShipmentDebitLotRow): LotDocument[] {
  const docs: LotDocument[] = [];
  docs.push(row.billOrBookNumber
    ? { ok: true, label: 'Bill/Booking', value: row.billOrBookNumber }
    : { ok: false, label: 'Bill/Booking', value: null });
  const declarations = (row.customsNumber ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (declarations.length === 0) docs.push({ ok: false, label: 'Tờ khai HQ', value: null });
  else for (const declaration of declarations) docs.push({ ok: true, label: 'Tờ khai HQ', value: declaration });
  return docs;
}

export function formatKnownMoney(value: number): string {
  return formatMoney(value);
}
