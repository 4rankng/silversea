import { useMemo, useState } from 'react';
import { sumExcludingNegative } from '@tingting/shared';

import {
  createPhoiPhieuVoucher,
  type PhoiPhieuRow,
  type PhoiPhieuVoucherSource,
} from '../../api/phoiPhieuClient';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency, formatMoney } from '../../lib/format';
import { Drawer } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import { phoiChiHoFeeLabel } from './PhoiPhieuInvoiceCell';
import './phoi-phieu-dialogs.css';

/** SIL-1085 (K2.71) — why the consolidated phiếu leaves a khoản out. The
 *  rule K2.71 names is "chưa xác nhận" — the khoản the accountant can act on
 *  today (đối chiếu it, then it rides the next phiếu). The other reasons are
 *  the khoản's own state, said out loud instead of dropped in silence. */
export const PHOI_VOUCHER_EXCLUSION_REASONS: Record<
  NonNullable<PhoiPhieuVoucherSource['reason']>,
  string
> = {
  UNCONFIRMED: 'chưa xác nhận',
  SETTLED: 'đã thanh toán/ứng trước — không còn khoản mở',
  NO_PAYABLE: 'không có khoản chi trên lô',
  NO_RECEIVABLE: 'không có khoản thu khách trên lô',
  NOT_CHI_HO: 'chi phí lái xe — đi đường thanh toán riêng, không vào phiếu chi hộ',
};

interface PreviewLine {
  row: PhoiPhieuRow;
  source: PhoiPhieuVoucherSource;
  /** The trip's visible identity — the board names a trip by its Bill/Booking
   *  (the same token the chip's aria-label carries); the trip code is the
   *  fallback when the lot carries no bill yet. */
  trip: string;
}

/** The preview's lines for a selection — the board's note and the drawer's
 *  two tables read THIS one computation, so the number beside the button and
 *  the number inside the drawer are never two stories. */
export function phoiPhieuVoucherPreviewLines(
  rows: PhoiPhieuRow[],
  direction: 'IN' | 'OUT',
): PreviewLine[] {
  return rows.flatMap((row) => {
    const trip = row.billOrBooking?.trim()
      ? billBookingReference(row.billOrBooking)
      : row.tripCode ?? 'Chưa có số Bill/Booking';
    const sources = row.voucherSources?.[direction];
    // An older in-flight payload carries no disposition: fall back to the
    // chip's own reconciliation flag, so the drawer still names the khoản
    // that is missing its đối chiếu instead of dropping it.
    if (!sources) {
      return (row.chiHoRows ?? []).map((chip) => ({
        row,
        trip,
        source: {
          sourceId: chip.sourceId,
          entryId: chip.entryId,
          sourceKind: chip.sourceKind ?? 'OPS',
          costType: chip.costType ?? null,
          feeName: chip.feeName,
          invoiceNumber: chip.invoiceNumber,
          confirmed: chip.confirmed,
          amount: 0,
          included: chip.confirmed,
          reason: chip.confirmed ? null : 'UNCONFIRMED' as const,
        },
      }));
    }
    return sources.map((source) => ({ row, trip, source }));
  });
}

interface Props {
  direction: 'IN' | 'OUT';
  /** The selected board rows — the preview reads THEIR chi-hộ khoản. */
  rows: PhoiPhieuRow[];
  treasuryAccountId: string;
  stkAccounts: Array<{ id: number; code: string; name: string }>;
  onTreasuryAccountChange: (value: string) => void;
  onClose: () => void;
  /** The phiếu was issued — the board clears the selection and refreshes. */
  onIssued: (voucher: { code: string; entries: number; total: number }) => void;
}

/**
 * SIL-1085 (K2.71) — the phơi-phiếu board's confirm step.
 *
 * Before this drawer the button issued straight from the selection: the
 * counter said "5 khoản" over eight chips, the three unconfirmed khoản were
 * dropped in silence, and nothing named them (KB OpsVanHanh §9.2 rule 1:
 * "màn hình nêu tên từng khoản chưa đối chiếu theo tên phí, không nêu mã nội
 * bộ"). The drawer now shows BOTH lists before a single đồng is moved: the
 * khoản the phiếu will carry, and every khoản it leaves out with the reason —
 * fee name + số hóa đơn + chuyến, so the accountant can act on the missing
 * ones without opening each trip.
 *
 * The lists come from the board row's own `voucherSources` disposition, whose
 * rule IS the counter's rule — so the number on the button and the number in
 * this drawer are the same money, never two stories.
 */
export function PhoiPhieuVoucherPreviewDrawer({
  direction,
  rows,
  treasuryAccountId,
  stkAccounts,
  onTreasuryAccountChange,
  onClose,
  onIssued,
}: Props) {
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = direction === 'IN' ? 'thu' : 'chi';

  const lines = useMemo<PreviewLine[]>(
    () => phoiPhieuVoucherPreviewLines(rows, direction),
    [rows, direction],
  );

  const included = lines.filter((line) => line.source.included);
  const excluded = lines.filter((line) => !line.source.included);
  const unconfirmed = excluded.filter((line) => line.source.reason === 'UNCONFIRMED');
  // The same negative-row rule the consolidated phiếu's group total uses.
  const total = sumExcludingNegative(included, (line) => line.source.amount);

  const disabledReason = !treasuryAccountId ? 'Chọn số tài khoản quỹ (STK)' : undefined;

  async function issue() {
    if (!treasuryAccountId) {
      setError('Chọn số tài khoản quỹ (STK).');
      return;
    }
    setIssuing(true);
    setError(null);
    try {
      const voucher = await createPhoiPhieuVoucher({
        tripIds: rows.map((row) => row.tripId),
        direction,
        treasuryAccountId: Number(treasuryAccountId),
      });
      onIssued(voucher);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Không lập được phiếu.');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={`Xem trước lập phiếu ${verb}`}
      subtitle={`${rows.length} chuyến · ${included.length} khoản sẽ được lập phiếu · ${excluded.length} khoản bị loại`}
      className="ppc-voucher-preview"
      footer={(
        <div className="ppc-lots-bar" role="region" aria-label="Thanh hành động lập phiếu">
          <p className="ppc-lots-bar__count" role="status">
            {included.length} khoản sẽ được lập phiếu
            {unconfirmed.length > 0 ? ` · ${unconfirmed.length} khoản chưa xác nhận bị bỏ qua` : ''}
          </p>
          <UuiSelectField
            label="Tài khoản chi (STK)"
            hideLabel
            ariaLabel="Tài khoản chi (STK)"
            value={treasuryAccountId}
            onChange={(event) => onTreasuryAccountChange(event.target.value)}
            options={[
              { value: '', label: '— Chọn STK —' },
              ...stkAccounts.map((account) => ({ value: String(account.id), label: `${account.code} - ${account.name}` })),
            ]}
            width="content"
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={issuing || included.length === 0 || !treasuryAccountId}
            title={disabledReason ?? (included.length === 0 ? 'Không có khoản nào đủ điều kiện lập phiếu' : undefined)}
            onClick={() => void issue()}
          >
            {issuing ? 'Đang lập…' : `Xác nhận lập phiếu ${verb} (${included.length})`}
          </button>
        </div>
      )}
    >
      {error && <p role="alert" className="phoi-detail-error">{error}</p>}
      <section className="ppc-voucher-preview__group" aria-label="Khoản sẽ được lập phiếu">
        <h3 className="ppc-voucher-preview__title">Sẽ được lập phiếu ({included.length} khoản)</h3>
        {included.length === 0 ? (
          <p className="ppc-voucher-preview__empty">Không có khoản nào đủ điều kiện lập phiếu trong lựa chọn này.</p>
        ) : (
          <div className="record-table-wrap">
            <table className="record-table ops-table ppc-voucher-preview__table">
              <thead>
                <tr>
                  <th scope="col">Nội dung phí</th>
                  <th scope="col">Số hóa đơn</th>
                  <th scope="col">Chuyến</th>
                  <th scope="col">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {included.map((line) => (
                  <tr key={`${line.source.sourceId}-${line.row.tripId}`}>
                    <td>{phoiChiHoFeeLabel(line.source)}</td>
                    <td>{line.source.invoiceNumber ?? '—'}</td>
                    <td>{line.trip}</td>
                    <td>{formatMoney(line.source.amount)} ₫</td>
                  </tr>
                ))}
                <tr className="ppc-voucher-preview__total">
                  <td colSpan={3}>Tổng lập phiếu</td>
                  <td>{formatCurrency(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ppc-voucher-preview__group" aria-label="Khoản bị loại khỏi phiếu">
        <h3 className="ppc-voucher-preview__title">Bị loại khỏi phiếu ({excluded.length} khoản)</h3>
        {excluded.length === 0 ? (
          <p className="ppc-voucher-preview__empty">Không có khoản nào bị loại — toàn bộ khoản chi hộ trong lựa chọn đều được lập phiếu.</p>
        ) : (
          <div className="record-table-wrap">
            <table className="record-table ops-table ppc-voucher-preview__table">
              <thead>
                <tr>
                  <th scope="col">Nội dung phí</th>
                  <th scope="col">Số hóa đơn</th>
                  <th scope="col">Chuyến</th>
                  <th scope="col">Lý do bị loại</th>
                </tr>
              </thead>
              <tbody>
                {excluded.map((line) => (
                  <tr key={`${line.source.sourceId}-${line.row.tripId}`}>
                    <td>{phoiChiHoFeeLabel(line.source)}</td>
                    <td>{line.source.invoiceNumber ?? '—'}</td>
                    <td>{line.trip}</td>
                    <td className="ppc-voucher-preview__reason">
                      {line.source.reason ? PHOI_VOUCHER_EXCLUSION_REASONS[line.source.reason] : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Drawer>
  );
}
