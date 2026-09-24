// Settlement workspace tables + the draft/delta helpers they render from.
// Split from ShipmentDebitWorkspace.tsx at the guard's new-file ceiling:
// the container keeps queries, mutations and the action rail; this module
// is the pure rendering and delta math.
//
// Fidelity pass (20260919_1-debit-cus-ui-fidelity): Bảng 2.2/2.3 follow the
// customer drawing's column contracts; Bảng 2.1 reads the shared debit-detail
// contract (card _7): contractFreightTotal is the wire's snapshot quantity,
// the row total here is derived from components — never a wire pass-through.
// Port-fee columns render the interim '—' in both tables (port-names ruling:
// no place-named identifiers, config-sourced heading pending its producer);
// Customer charges and actual OPS costs remain separate on their own wires.
import { AlertTriangle } from 'lucide-react';
import { defaultFeeRouting } from '@tingting/shared';
import type { ShipmentDebitDetail, ShipmentDebitEditsBody } from '../../../api/shipmentDebit';
import type { QuotationFeeRow } from '../../../api/quotationClient';
import { dedicatedColumns, matchDedicatedColumn, buildDebitNote } from './ShipmentDebitTables.routing';
import { buildDraft, num, type DraftState } from './ShipmentDebitTables.draft';
import { formatMoney } from '../../../lib/format';

export { DRAFT_EMPTY, buildDraft, deltaIsEmpty, buildDelta, type DraftState } from './ShipmentDebitTables.draft';

/** Luồng hải quan labels (card _5): Customs assigns the channel per tờ khai;
 *  every container row of the lot renders the same one. */
const CHANNEL_LABELS: Record<string, string> = { RED: 'Luồng đỏ', YELLOW: 'Luồng vàng', GREEN: 'Luồng xanh' };

const money = (value: number | null | undefined) => (value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value));



/** Canonical Ops-fee columns for Bảng 2.2 (Nâng/Hạ/CSHT), bucketed by
 * expense-type keyword. Unmapped non-OTHER items stay visible read-only in
 * the Phí khác cell — no data hides. */
export function canonicalFeeBucket(expenseType: string): 'lift' | 'lower' | 'csht' | null {
  const type = expenseType.toUpperCase();
  if (type.includes('LIFT')) return 'lift';
  if (type.includes('LOWER')) return 'lower';
  if (type.includes('REPAIR') || type.includes('CSHT')) return 'csht';
  return null;
}

/** The drawing's bracketed hold format for tiền treo cells: warn when above
 * zero; null = chưa xác định — never rendered as 0. */
const bracketMoney = (value: number | null | undefined): { text: string; warn: boolean } => {
  if (value == null || Number.isNaN(value)) return { text: 'Chưa xác định', warn: false };
  return { text: `[ ${formatMoney(value)} đ ]`, warn: value > 0 };
};









/** Bảng 2.1 — auto freight per container + the CUS-entered actual PS. */
export function FreightTable({ detail, draft, frozen, setFreight }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setFreight: (containerNumber: string, patch: Partial<{ psActual: string; note: string }>) => void;
}) {
  return (
    <table className="csc-debit-table csc-debit-table--freight">
      <caption>Bảng 2.1 — Cước vận tải</caption>
      <thead><tr>
        <th scope="col">Số Container</th>
        <th scope="col">Cước thu</th>
        <th scope="col">Phụ phí xăng dầu</th>
        {/* Port-fee column: config-sourced heading pending its producer —
            interim '—' per the port-names ruling, no place-named label. */}
        <th scope="col">—</th>
        <th scope="col">Phí Hải Quan</th>
        <th scope="col">Phát sinh</th>
        <th scope="col">Tổng</th>
        <th scope="col">Ghi chú</th>
      </tr></thead>
      <tbody>
        {detail.freightRows.map((row) => {
          const cells = row.containerNumber == null ? { psActual: '', note: '' } : (draft.freight[row.containerNumber] ?? { psActual: '', note: '' });
          const known = row.freightCharge != null || row.fuelSurcharge != null || row.customsCustomerCharge != null;
          const derivedTotal = (row.freightCharge ?? 0) + (row.fuelSurcharge ?? 0) + (row.customsCustomerCharge ?? 0) + num(cells.psActual || '0');
          return (
            <tr key={row.containerNumber ?? `trip-${row.tripId}`}>
              <td>{row.containerNumber}<small>{row.containerTypeLabel ?? ''}</small>{(row.liftSiteLabel || row.dropSiteLabel) && <small className="csc-debit-channel">Nâng: {row.liftSiteLabel ?? '—'} · Hạ: {row.dropSiteLabel ?? '—'}</small>}</td>
              <td>{row.freightCharge == null ? '(auto)' : formatMoney(row.freightCharge)}</td>
              <td>{row.fuelSurcharge == null ? '(auto)' : formatMoney(row.fuelSurcharge)}</td>
              <td>—</td>
              <td>{row.customsCustomerCharge == null ? '—' : formatMoney(row.customsCustomerCharge)}{detail.customsChannel && <small className="csc-debit-channel">{CHANNEL_LABELS[detail.customsChannel]}</small>}</td>
              <td>
                <input
                  className="csc-debit-input"
                  aria-label={`PS thực tế ${row.containerNumber}`}
                  placeholder="PS thực tế"
                  value={cells.psActual}
                  disabled={frozen}
                  onChange={(event) => { if (row.containerNumber != null) setFreight(row.containerNumber, { psActual: event.target.value }); }}
                />
              </td>
              <td>{known ? formatMoney(derivedTotal) : 'Chưa xác định'}</td>
              <td>
                <input
                  className="csc-debit-input"
                  aria-label={`Ghi chú PS ${row.containerNumber}`}
                  placeholder="Ghi chú phí PS"
                  value={cells.note}
                  disabled={frozen}
                  onChange={(event) => { if (row.containerNumber != null) setFreight(row.containerNumber, { note: event.target.value }); }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


/** Bảng 2.2 — chi hộ & tiền treo, the drawing's 8-column contract. The Ops
 * fee columns (Nâng/Hạ/CSHT) bucket expenses canonically and render
 * read-only; the Phí khác cell keeps unmapped non-OTHER lines visible
 * read-only beside the CUS-managed OTHER rows; hold amounts render in the
 * bracketed format, armed orange above zero. */
export function ChiHoTable({ detail, draft, frozen, feeCatalog = [], setFeeAmount, addFee, removeFee, setAddedFee }: {
  /** Card _64: the customer's active-frame Chi-phí-khác catalog — drives the
   *  dedicated routing columns (headers = the customer's own fee names). */
  feeCatalog?: QuotationFeeRow[];
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setFeeAmount: (feeId: number, value: string) => void;
  addFee: (tripId: number) => void;
  removeFee: (feeId: number) => void;
  setAddedFee: (key: string, patch: Partial<{ name: string; amount: string }>) => void;
}) {
  const columns = dedicatedColumns(feeCatalog);
  const roItem = (item: ShipmentDebitDetail['chiHoRows'][number]['items'][number]) => (
    <div className="csc-debit-item csc-debit-item--ro" key={item.id}>
      <span className="csc-debit-item__amount">{money(item.amount)}</span>
      {item.invoiceNumber && <small className="csc-debit-item__hd">HD: {item.invoiceNumber}</small>}
    </div>
  );
  return (
    <table className="csc-debit-table csc-debit-table--chiho">
      <caption>Bảng 2.2 — Phí Chi Hộ &amp; Tiền Treo</caption>
      <thead><tr>
        <th scope="col">Số Container</th>
        <th scope="col">Phí Nâng</th>
        <th scope="col">Phí Hạ</th>
        <th scope="col">Phí cơ sở hạ tầng</th>
        {columns.map((col) => <th key={col.key} scope="col">{col.label}</th>)}
        <th scope="col">Phí khác (không hđ)</th>
        <th scope="col">Cược Hãng Tàu (Tiền treo)</th>
        <th scope="col">Tạm thu sửa chữa</th>
        <th scope="col">Chứng từ Ops</th>
      </tr></thead>
      <tbody>
        {detail.chiHoRows.map((row, chiIdx) => {
          const liftItems = row.items.filter((item) => canonicalFeeBucket(item.expenseType) === 'lift');
          const lowerItems = row.items.filter((item) => canonicalFeeBucket(item.expenseType) === 'lower');
          const cshtItems = row.items.filter((item) => canonicalFeeBucket(item.expenseType) === 'csht');
          const otherItems = row.items.filter((item) => canonicalFeeBucket(item.expenseType) === null && item.expenseType.toUpperCase() !== 'OTHER');
          const detention = bracketMoney(row.carrierDetention);
          const repair = bracketMoney(row.repairAdvance);
          // Card _64 partition: each CUS fee lands in its dedicated routing
          // column by name match; the rest stay in Phí khác. Draft fees with
          // an empty name stay put (unclassifiable = other).
          const columnOf = (name: string) => matchDedicatedColumn(name, columns);
          const managedOf = (colKey: string) => row.otherFees.filter((fee) => columnOf(fee.name)?.key === colKey);
          const draftsOf = (colKey: string) => draft.addedFees.filter((fee) => fee.tripId === row.tripId && columnOf(fee.name)?.key === colKey);
          const otherManaged = row.otherFees.filter((fee) => columnOf(fee.name) == null);
          const otherDrafts = draft.addedFees.filter((fee) => fee.tripId === row.tripId && columnOf(fee.name) == null);
          return (
            <tr key={row.containerNumber ?? `row-${chiIdx}`}>
              <td>{row.containerNumber ?? '—'}<small>{row.containerTypeLabel ?? ''}</small></td>
              <td>{liftItems.length === 0 ? <span>—</span> : liftItems.map(roItem)}</td>
              <td>{lowerItems.length === 0 ? <span>—</span> : lowerItems.map(roItem)}</td>
              <td>{cshtItems.length === 0 ? <span>—</span> : cshtItems.map(roItem)}</td>
              {columns.map((col) => (
                <td key={col.key}>
                  {managedOf(col.key).map((fee) => (
                    <div className="csc-debit-otherfee" key={fee.id}>
                      <span className="csc-debit-item__name">{fee.name}</span>
                      <span className="csc-debit-otherfee__sell">Thu khách: {fee.thuKhach == null ? '—' : formatMoney(fee.thuKhach)}</span>
                      <div className="csc-debit-otherfee__control">
                        <input
                          className="csc-debit-input csc-debit-input--amount"
                          aria-label={`Số tiền chi hộ phí khác ${fee.name} ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`}
                          value={draft.feeAmounts[fee.id] ?? ''}
                          disabled={frozen || fee.readOnly === true}
                          onChange={(event) => setFeeAmount(fee.id, event.target.value)}
                        />
                        <button type="button" className="csc-debit-otherfee__remove" aria-label={`Xóa phí khác ${fee.name}`} disabled={frozen || fee.readOnly === true} onClick={() => removeFee(fee.id)}>×</button>
                      </div>
                      {fee.readOnly && <small className="csc-debit-otherfee__source">Điều chỉnh tại nguồn chi phí kế toán.</small>}
                    </div>
                  ))}
                  {draftsOf(col.key).map((fee) => (
                    <div className="csc-debit-otherfee" key={fee.key}>
                      <div className="csc-debit-otherfee__grid">
                        <label className="csc-debit-otherfee__field">
                          <span className="csc-debit-otherfee__label">Tên phí</span>
                          <input className="csc-debit-input" aria-label={`Tên phí mới ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`} value={fee.name} disabled={frozen}
                            onChange={(event) => setAddedFee(fee.key, { name: event.target.value })} />
                        </label>
                        <label className="csc-debit-otherfee__field">
                          <span className="csc-debit-otherfee__label">Số tiền</span>
                          <input className="csc-debit-input csc-debit-input--amount" aria-label={`Số tiền phí mới ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`} value={fee.amount} disabled={frozen}
                            onChange={(event) => setAddedFee(fee.key, { amount: event.target.value })} />
                        </label>
                      </div>
                    </div>
                  ))}
                </td>
              ))}
              <td>
                {otherItems.map(roItem)}
                {otherManaged.map((fee) => (
                    <div className="csc-debit-otherfee" key={fee.id}>
                      <span className="csc-debit-item__name">{fee.name}</span>
                      <span className="csc-debit-otherfee__sell">Thu khách: {fee.thuKhach == null ? '—' : formatMoney(fee.thuKhach)}</span>
                      <div className="csc-debit-otherfee__control">
                        <input
                          className="csc-debit-input csc-debit-input--amount"
                          aria-label={`Số tiền chi hộ phí khác ${fee.name} ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`}
                          value={draft.feeAmounts[fee.id] ?? ''}
                          disabled={frozen || fee.readOnly === true}
                          onChange={(event) => setFeeAmount(fee.id, event.target.value)}
                        />
                        <button type="button" className="csc-debit-otherfee__remove" aria-label={`Xóa phí khác ${fee.name}`} disabled={frozen || fee.readOnly === true} onClick={() => removeFee(fee.id)}>×</button>
                      </div>
                      {fee.readOnly && <small className="csc-debit-otherfee__source">Điều chỉnh tại nguồn chi phí kế toán.</small>}
                    </div>
                  ))}
                {otherDrafts.map((fee) => (
                    <div className="csc-debit-otherfee" key={fee.key}>
                      <div className="csc-debit-otherfee__grid">
                        <label className="csc-debit-otherfee__field">
                          <span className="csc-debit-otherfee__label">Tên phí</span>
                          <input className="csc-debit-input" aria-label={`Tên phí mới ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`} value={fee.name} disabled={frozen}
                            onChange={(event) => setAddedFee(fee.key, { name: event.target.value })} />
                        </label>
                        <label className="csc-debit-otherfee__field">
                          <span className="csc-debit-otherfee__label">Số tiền</span>
                          <input className="csc-debit-input csc-debit-input--amount" aria-label={`Số tiền phí mới ${row.containerNumber ?? `hàng ${chiIdx + 1}`}`} value={fee.amount} disabled={frozen}
                            onChange={(event) => setAddedFee(fee.key, { amount: event.target.value })} />
                        </label>
                      </div>
                    </div>
                  ))}
                <button type="button" className="csc-debit-addfee" aria-label="+ Thêm chi phí" disabled={frozen}
                  onClick={() => { if (row.tripId != null) addFee(row.tripId); }}>+ THÊM CHI PHÍ</button>
              </td>
              <td className={detention.warn ? 'csc-debit-warn-cell csc-debit-warn-cell--armed' : 'csc-debit-warn-cell'}>
                {detention.warn && <AlertTriangle aria-hidden="true" size={13} />}{detention.text}
              </td>
              <td className={repair.warn ? 'csc-debit-warn-cell csc-debit-warn-cell--armed' : 'csc-debit-warn-cell'}>
                {repair.warn && <AlertTriangle aria-hidden="true" size={13} />}{repair.text}
              </td>
              <td><span className="csc-debit-docs">{row.opsDocsStatus === 'READY' ? 'Đã đủ' : 'Chờ bổ sung'}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Adjust-cước panel: reason mandatory, contract freight kept visible for
 * comparison, and the before/after history beside the form. */
export function AdjustPanel({ detail, reason, setReason, pending, error, history, onSubmit }: {
  detail: ShipmentDebitDetail;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  error: string | null;
  history: Array<{ id: number; reason: string; adjustedAt: string }> | undefined;
  onSubmit: () => void;
}) {
  return (
    <div className="csc-debit-adjust">
      <p className="csc-debit-adjust__title">Điều chỉnh cước sau khóa — cước hợp đồng giữ lại để đối chiếu</p>
      <table className="csc-debit-table">
        <tbody>
          {detail.freightRows.map((row) => (
            <tr key={row.containerNumber}>
              <th scope="row">{row.containerNumber}{row.containerTypeLabel ? ` (${row.containerTypeLabel})` : ''}</th>
              <td>Cước hợp đồng: {row.freightCharge == null ? 'Chưa xác định' : formatMoney(row.freightCharge)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="csc-debit-adjust__reason">
        <span>Lý do (bắt buộc)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
      </label>
      {history && history.length > 0 && (
        <ul className="csc-debit-adjust__history">
          {history.map((item) => (
            <li key={item.id}>
              <span>{new Date(item.adjustedAt).toLocaleString('vi-VN')}</span>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="csc-debit-save-error" role="alert">{error}</span>}
      <button type="button" disabled={pending || reason.trim() === ''} onClick={onSubmit}>
        {pending ? 'Đang gửi…' : 'Gửi điều chỉnh'}
      </button>
    </div>
  );
}

/** Bảng 2.3 — per-container payables, read-only for the CUS. Money columns
 * read the wire's per-container fields (card _62): null stays "Chưa xác
 * định", never 0; the note column renders the container's freight note. */
export function PayablesTable({ detail }: { detail: ShipmentDebitDetail }) {
  // Card _64 AC4 — the bảng kê note carries the container's other-costs fee
  // names (deterministic stored order) appended to the user's note.
  const otherFeeNamesByContainer = new Map(detail.chiHoRows.map((row) => [
    row.containerNumber ?? `trip-${row.tripId}`,
    row.otherFees.filter((fee) => defaultFeeRouting(fee.name) === 'OTHER_COSTS').map((fee) => fee.name),
  ]));
  return (
    <table className="csc-debit-table csc-debit-table--payables">
      <caption>Bảng 2.3 — Phí Phải trả (chỉ xem)</caption>
      <thead><tr>
        <th scope="col">Số Container</th>
        <th scope="col">Cước trả</th>
        {/* Zone surcharge: the heading is CONFIG DATA rendered verbatim —
            place names are data, never identifiers. No configured zone keeps
            the interim '—' column; null amounts render '—', never 0. */}
        <th scope="col">{detail.zoneSurcharge?.label ?? '—'}</th>
        <th scope="col">Phí HQGS</th>
        <th scope="col">Phí Phát sinh</th>
        <th scope="col">Ghi chú</th>
      </tr></thead>
      <tbody>
        {detail.freightRows.map((row) => (
          <tr key={row.containerNumber ?? `trip-${row.tripId}`}>
            <td>{row.containerNumber ?? '—'}<small>{row.containerTypeLabel ?? ''}</small></td>
            <td>{money(row.payableFreight)}</td>
            <td>{detail.zoneSurcharge?.amount == null ? '—' : formatMoney(detail.zoneSurcharge.amount)}</td>
            <td>{money(row.customsFee)}</td>
            <td>{money(row.phatSinhFee)}</td>
            <td>{buildDebitNote(row.psActualNote, otherFeeNamesByContainer.get(row.containerNumber ?? `trip-${row.tripId}`) ?? [])}</td>
          </tr>
        ))}
        {payablesCommonRow(detail.payables)}
      </tbody>
    </table>
  );
}

/** Card _62 — the "Phí chung lô" row: container-NULL ops fees bucketed the
 *  same way as the container rows, so the sheet conserves. Hidden when the
 *  lot has no chung-lô rows (both sums null). */
function payablesCommonRow(payables: ShipmentDebitDetail['payables']) {
  if (payables.hqgsCommonFee == null && payables.phatSinhCommonFee == null) return null;
  return (
    <tr className="csc-debit-table__common-row">
      <td>Phí chung lô</td>
      <td>—</td>
      <td>—</td>
      <td>{money(payables.hqgsCommonFee)}</td>
      <td>{money(payables.phatSinhCommonFee)}</td>
      <td>—</td>
    </tr>
  );
}
