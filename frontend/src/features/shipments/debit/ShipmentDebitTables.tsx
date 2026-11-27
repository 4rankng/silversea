import { LedgerMatrix } from '../../../components/shared/LedgerMatrix';
// Settlement workspace blocks + the draft/delta helpers they render from.
// Split from ShipmentDebitWorkspace.tsx at the guard's new-file ceiling:
// the container keeps queries, mutations and the action rail; this module
// is the pure rendering and delta math.
//
// SIL-837 (owner QA 14/11, REV2 danh sách phẳng + ngăn trượt): the Chốt-giá-bán
// drawer reads as TWO named blocks instead of the old per-container matrices
// ("Cước vận tải" / "Phí Chi Hộ & Tiền Treo"):
//   - "Phí Có HĐ" (chỉ đọc) — every Ops-sourced figure: cước vận tải auto
//     components, chi hộ items (HD numbers kept), tiền treo/repair brackets.
//   - "Phí Không HĐ" (nhập được) — the PS thực tế + ghi chú per container and
//     the Phí khác rows with the dual [Thực chi Ops (ro) | Thu khách hàng
//     (input)] pair, plus [+ Thêm chi phí].
// The dual-input and PS aria-labels are UNCHANGED from the matrix era so the
// wired typing flows (SIL-782 sell edits, SIL-790 seeds) keep their names.
import { AlertTriangle } from 'lucide-react';
import type { ShipmentDebitDetail } from '../../../api/shipmentDebit';
import { type DraftState } from './ShipmentDebitTables.draft';
import { formatMoney, formatDateTimeVN } from '../../../lib/format';

export { DRAFT_EMPTY, buildDraft, deltaIsEmpty, buildDelta, type DraftState } from './ShipmentDebitTables.draft';

const money = (value: number | null | undefined) => (value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value));

/** The drawing's bracketed hold format for tiền treo cells: warn when above
 * zero; null = chưa xác định — never rendered as 0. */
const bracketMoney = (value: number | null | undefined): { text: string; warn: boolean } => {
  if (value == null || Number.isNaN(value)) return { text: 'Chưa xác định', warn: false };
  return { text: `[ ${formatMoney(value)} đ ]`, warn: value > 0 };
};

/** REV2 (SIL-837) — khối "Phí Có HĐ": chỉ đọc. Every Ops-sourced figure of the
 * lot — freight auto components, chi hộ items with their HD numbers, and the
 * bracketed tiền treo/repair holds. Nothing here is editable; the CUS-owned
 * money lives in DebitKhongHdBlock. */
export function DebitCoHdBlock({ detail }: { detail: ShipmentDebitDetail }) {
  const freightRows = detail.freightRows.filter((row) =>
    row.freightCharge != null || row.fuelSurcharge != null || row.customsCustomerCharge != null);
  const chiHoRows = detail.chiHoRows.filter((row) =>
    row.items.length > 0 || row.carrierDetention != null || row.repairAdvance != null);
  const empty = freightRows.length === 0 && chiHoRows.length === 0;
  return (
    <section className="csc-debit-block csc-debit-block--ro" aria-label="Phí Có HĐ">
      <h3 className="csc-debit-block__title">Phí Có HĐ <small className="csc-debit-block__tag">chỉ đọc</small></h3>
      <p className="csc-debit-block__hint">Cước vận tải auto (theo tuyến/loại xe) và chi hộ có hóa đơn do nguồn chi phí kế toán quản lý.</p>
      {empty && <p className="csc-debit-block__empty">Chưa có khoản phí có hóa đơn trên lô.</p>}
      {freightRows.map((row) => (
        <div className="csc-debit-block__row" key={row.containerNumber ?? `trip-${row.tripId}`}>
          <span className="csc-debit-block__container">{row.containerNumber ?? 'Chưa có số container'}</span>
          <span className="csc-debit-block__figure">Cước thu: {row.freightCharge == null ? '(auto)' : formatMoney(row.freightCharge)}</span>
          <span className="csc-debit-block__figure">Phụ phí xăng dầu: {row.fuelSurcharge == null ? '(auto)' : formatMoney(row.fuelSurcharge)}</span>
          <span className="csc-debit-block__figure">Phí hải quan: {row.customsCustomerCharge == null ? '—' : formatMoney(row.customsCustomerCharge)}</span>
          {/* SIL-1136 (KB honest-empty law): the NÂNG/HẠ line renders on
              every freight row — missing ports read "Chưa có thông tin",
              never a silently absent line. */}
          <span className="csc-debit-block__channel">Nâng: {row.liftSiteLabel ?? 'Chưa có thông tin'} · Hạ: {row.dropSiteLabel ?? 'Chưa có thông tin'}</span>
        </div>
      ))}
      {chiHoRows.map((row, index) => {
        const detention = bracketMoney(row.carrierDetention);
        const repair = bracketMoney(row.repairAdvance);
        return (
          <div className="csc-debit-block__row" key={row.containerNumber ?? `chi-${index}`}>
            <span className="csc-debit-block__container">{row.containerNumber ?? 'Chưa có số container'}</span>
            {row.items.map((item) => (
              <span className="csc-debit-item csc-debit-item--ro" key={item.id}>
                <span className="csc-debit-item__amount">{money(item.amount)}</span>
                {item.invoiceNumber && <small className="csc-debit-item__hd">HD: {item.invoiceNumber}</small>}
              </span>
            ))}
            {row.carrierDetention != null && (
              <span className={`csc-debit-block__bracket ${detention.warn ? 'csc-debit-block__bracket--armed' : ''}`}>
                {detention.warn && <AlertTriangle aria-hidden="true" size={13} />}{detention.text}
              </span>
            )}
            {row.repairAdvance != null && (
              <span className={`csc-debit-block__bracket ${repair.warn ? 'csc-debit-block__bracket--armed' : ''}`}>
                {repair.warn && <AlertTriangle aria-hidden="true" size={13} />}{repair.text}
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** REV2 (SIL-837) — khối "Phí Không HĐ": nhập được. The CUS-owned money:
 * PS thực tế + ghi chú per container, the Phí khác rows (each with the dual
 * [Thực chi Ops chỉ đọc | Thu khách hàng nhập] pair), draft rows, and the
 * [+ Thêm chi phí] entry. */
export function DebitKhongHdBlock({ detail, draft, frozen, setFreight, setFeeSell, addFee, removeFee, setAddedFee }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setFreight: (containerNumber: string, patch: Partial<{ psActual: string; note: string }>) => void;
  setFeeSell: (feeId: number, value: string) => void;
  addFee: (tripId: number) => void;
  removeFee: (feeId: number) => void;
  setAddedFee: (key: string, patch: Partial<{ name: string; amount: string; sell: string }>) => void;
}) {
  const psRows = detail.freightRows.filter((row) => row.containerNumber != null);
  // SIL-837 — the add entry acts LOT-wide: a draft needs SOME tripId (the
  // addOtherFees wire requires one), so fall back to the lot's first known
  // trip instead of the per-container row the matrix era used. A lot with no
  // trip at all keeps the button visible but explains itself — a click that
  // does nothing is exactly the silent failure QA filed (SIL-837 §3).
  const anyTripId = detail.chiHoRows.find((row) => row.tripId != null)?.tripId
    ?? detail.freightRows.find((row) => row.tripId != null)?.tripId
    ?? null;
  // Draft rows render as ONE block-level group under the lot's first known
  // container label — a lot-scope fallback trip (fee row with tripId null)
  // has no chi-hộ anchor of its own, and a per-trip anchor would duplicate
  // the draft on every container of the same trip.
  const draftLabel = detail.chiHoRows[0]?.containerNumber ?? 'lô';
  const otherOf = (row: ShipmentDebitDetail['chiHoRows'][number], index: number) => (
    <>
      {row.otherFees.map((fee) => (
        <div className="csc-debit-otherfee" key={fee.id}>
          <span className="csc-debit-item__name">{fee.name}</span>
          <div className="csc-debit-otherfee__dual">
            <label className="csc-debit-otherfee__field">
              <span className="csc-debit-otherfee__label">Thực chi Ops</span>
              <span className="csc-debit-otherfee__ro" aria-label={`Thực chi Ops phí khác ${fee.name} ${row.containerNumber ?? `hàng ${index + 1}`}`}>{fee.amount == null ? '—' : formatMoney(fee.amount)}</span>
            </label>
            <label className="csc-debit-otherfee__field">
              <span className="csc-debit-otherfee__label">Thu khách hàng</span>
              <input
                className="csc-debit-input csc-debit-input--amount"
                aria-label={`Thu khách hàng phí khác ${fee.name} ${row.containerNumber ?? `hàng ${index + 1}`}`}
                value={draft.feeSells[fee.id] ?? ''}
                disabled={frozen}
                onChange={(event) => setFeeSell(fee.id, event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="csc-debit-otherfee__remove" aria-label={`Xóa phí khác ${fee.name}`} disabled={frozen} onClick={() => removeFee(fee.id)}>×</button>
          {fee.readOnly && <small className="csc-debit-otherfee__source">Thực chi Ops do nguồn chi phí kế toán quản lý — chỉ xem.</small>}
        </div>
      ))}
    </>
  );
  return (
    <section className="csc-debit-block" aria-label="Phí Không HĐ">
      <h3 className="csc-debit-block__title">Phí Không HĐ <small className="csc-debit-block__tag">nhập được</small></h3>
      {detail.chiHoRows.length === 0 && (
        <div className="csc-debit-otherfee--empty" data-testid="debit-no-fee-block">
          <span>Thực chi Ops: 0 ₫ (chỉ xem)</span>
          <span>Thu khách hàng: chưa có phí không hóa đơn trên lô — khi Ops khai phí phát sinh, cặp ô Thực chi Ops / Thu khách hàng hiện tại đây.</span>
        </div>
      )}
      {psRows.map((row) => {
        const cells = draft.freight[row.containerNumber!] ?? { psActual: '', note: '' };
        return (
          <div className="csc-debit-block__row csc-debit-block__row--edit" key={row.containerNumber}>
            <span className="csc-debit-block__container">{row.containerNumber}</span>
            <label className="csc-debit-otherfee__field">
              <span className="csc-debit-otherfee__label">Phát sinh thực tế</span>
              <input
                className="csc-debit-input"
                aria-label={`PS thực tế ${row.containerNumber}`}
                placeholder="PS thực tế"
                value={cells.psActual}
                disabled={frozen}
                onChange={(event) => setFreight(row.containerNumber!, { psActual: event.target.value })}
              />
            </label>
            <label className="csc-debit-otherfee__field">
              <span className="csc-debit-otherfee__label">Ghi chú PS</span>
              <input
                className="csc-debit-input"
                aria-label={`Ghi chú PS ${row.containerNumber}`}
                placeholder="Ghi chú phí PS"
                value={cells.note}
                disabled={frozen}
                onChange={(event) => setFreight(row.containerNumber!, { note: event.target.value })}
              />
            </label>
          </div>
        );
      })}
      {detail.chiHoRows.map((row, index) => (
        <div className="csc-debit-block__row csc-debit-block__row--edit" key={row.containerNumber ?? `fee-${index}`}>
          <span className="csc-debit-block__container">{row.containerNumber ?? `Hàng ${index + 1}`}</span>
          {otherOf(row, index)}
        </div>
      ))}
      {draft.addedFees.map((fee) => (
        <div className="csc-debit-block__row csc-debit-block__row--edit" key={fee.key}>
          <span className="csc-debit-block__container">{draftLabel}</span>
          <div className="csc-debit-otherfee">
            <div className="csc-debit-otherfee__grid">
              <label className="csc-debit-otherfee__field">
                <span className="csc-debit-otherfee__label">Tên phí</span>
                <input className="csc-debit-input" aria-label={`Tên phí mới ${draftLabel}`} value={fee.name} disabled={frozen}
                  onChange={(event) => setAddedFee(fee.key, { name: event.target.value })} />
              </label>
              <label className="csc-debit-otherfee__field">
                <span className="csc-debit-otherfee__label">Số tiền</span>
                <input className="csc-debit-input csc-debit-input--amount" aria-label={`Số tiền phí mới ${draftLabel}`} value={fee.amount} disabled={frozen}
                  onChange={(event) => setAddedFee(fee.key, { amount: event.target.value })} />
              </label>
            </div>
            {/* SIL-790 — the draft row pairs the same [Thực chi Ops |
                Thu khách hàng] as saved rows: Ops amount is '—' (nguồn chi
                phí kế toán fills it later); CUS types the sell straight here
                and Lưu creates the fee with it. */}
            <div className="csc-debit-otherfee__dual">
              <label className="csc-debit-otherfee__field">
                <span className="csc-debit-otherfee__label">Thực chi Ops</span>
                <span className="csc-debit-otherfee__ro" aria-label={`Thực chi Ops phí mới ${draftLabel}`}>—</span>
              </label>
              <label className="csc-debit-otherfee__field">
                <span className="csc-debit-otherfee__label">Thu khách hàng</span>
                <input className="csc-debit-input csc-debit-input--amount" aria-label={`Thu khách hàng phí mới ${draftLabel}`} value={fee.sell} disabled={frozen}
                  onChange={(event) => setAddedFee(fee.key, { sell: event.target.value })} />
              </label>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="csc-debit-addfee"
        aria-label="+ Thêm chi phí"
        disabled={frozen || anyTripId == null}
        title={anyTripId == null ? 'Lô chưa có chuyến — không thể thêm phí' : undefined}
        onClick={() => { if (anyTripId != null) addFee(anyTripId); }}
      >+ THÊM CHI PHÍ</button>
    </section>
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
      <LedgerMatrix caption="Cước hợp đồng theo container" className="csc-debit-table"
        columns={[{ key: 'container', label: 'Số container' }, { key: 'freight', label: 'Cước hợp đồng', primary: true }]}
        rows={detail.freightRows.map((row) => ({ key: row.containerNumber ?? `trip-${row.tripId}`,
          title: row.containerNumber ?? 'Chưa có số container', cells: [
            <>{row.containerNumber}{row.containerTypeLabel ? ` (${row.containerTypeLabel})` : ''}</>,
            <>Cước hợp đồng: {row.freightCharge == null ? 'Chưa xác định' : formatMoney(row.freightCharge)}</>,
          ],
        }))}
      />
      <label className="csc-debit-adjust__reason">
        <span>Lý do (bắt buộc)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
      </label>
      {history && history.length > 0 && (
        <ul className="csc-debit-adjust__history">
          {history.map((item) => (
            <li key={item.id}>
              <span>{formatDateTimeVN(item.adjustedAt)}</span>
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
