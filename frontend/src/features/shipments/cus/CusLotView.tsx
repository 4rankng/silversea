import { useEffect, useState } from 'react';
import { CopyPlus, Loader2 } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { formatMoney, formatWeight } from '../../../lib/format';
import { formatTimeShortDate } from '../../../lib/shipment-operations';
import {
  accountingConfirmationLabel,
  deriveShipmentSignals,
  dispatchStatusLabel,
} from './cusUtils';

/**
 * SIL-485 (owner mockup 25/10, superseding the earlier "workspace view mode"
 * consult for the drawer body): the Tổng quan drawer reads as a designed
 * lot review — status chips on the head row, a four-step workflow stepper
 * (Chốt lịch → Phân xe → Đối soát → Khóa lô), then read-only cards: Nhận
 * diện lô, Thông tin hàng (the container sheet), Lịch & ghi chú and Đối
 * soát. Editing stays out of the drawer: the footer "Sửa" navigates to
 * /shipments/:id/edit where ShipmentCreateWorkspace owns the form.
 *
 * SIL-498 (customer 25/10): the ONE deliberate inline exception is tờ khai —
 * a per-CONT document number the customer enters right in the Thông tin hàng
 * sheet. Each row carries its own input (or plain text when the lot is not
 * writable), and the first row owns the copy affordance that fans the saved
 * number out to the lot's still-empty rows (BE copy endpoint — never
 * overwrites a divergent sibling). Everything else stays read-only.
 *
 * Every value renders from the same CUS workspace payload the workboard row
 * already reads (list item + lazily loaded detail); a missing value is "—",
 * never an invented default.
 */

const CHIPS_TONE_CLASS: Record<string, string> = {
  warning: 'cus-lot-chip--amber',
  info: 'cus-lot-chip--mint',
  danger: 'cus-lot-chip--danger',
};

/** The head-row chips: cargo mode solid + the operational signal pills
 *  (amber warning / mint informational), exactly the mockup's one-line run. */
export function CusLotStatusChips({ item }: { item: ShipmentCusWorkspaceListItem }) {
  return (
    <span className="cus-lot-chips" aria-label="Trạng thái lô hàng">
      {item.cargoMode && <span className="cus-lot-chip cus-lot-chip--solid">Hàng {item.cargoMode}</span>}
      {deriveShipmentSignals(item).map((signal) => (
        <span key={signal.key} className={`cus-lot-chip ${CHIPS_TONE_CLASS[signal.tone] ?? 'cus-lot-chip--amber'}`}>
          {signal.label}
        </span>
      ))}
    </span>
  );
}

interface LotStep {
  label: string;
  done: boolean;
}

/** Step done/current derivation — the same readiness fields the workboard
 *  tabs count, read left to right; the first unfinished step is current. */
function deriveLotSteps(item: ShipmentCusWorkspaceListItem): LotStep[] {
  return [
    { label: 'Chốt lịch', done: item.operational.scheduleReadiness === 'SCHEDULED' },
    { label: 'Phân xe', done: item.operational.vehicleReadiness === 'READY' },
    { label: 'Đối soát', done: item.accountingConfirmation.status === 'CONFIRMED' },
    { label: 'Khóa lô', done: item.activeLock != null },
  ];
}

export function CusLotStepper({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const steps = deriveLotSteps(item);
  const current = steps.findIndex((step) => !step.done);  return (
    <ol className="cus-lot-stepper" aria-label="Tiến trình lô hàng">
      {steps.map((step, index) => {
        const state = step.done ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={step.label} className={`cus-lot-stepper__step cus-lot-stepper__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="cus-lot-stepper__dot">{index + 1}</span>
            <span className="cus-lot-stepper__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function FactCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cus-lot-fact">
      <span className="cus-lot-microlabel">{label}</span>
      <span className="cus-lot-fact__value">{children}</span>
    </div>
  );
}

const dash = '—';

/** NHÀ MÁY resolves through the detail's site catalog — the line stores an
 *  id, the master-data label rides the selectors the detail already carries. */
function siteLabel(detail: ShipmentCusWorkspaceDetail | undefined, siteId: number | null): string {
  if (siteId == null || !detail) return dash;
  return detail.selectors.operationalSites.find((site) => site.id === siteId)?.name ?? dash;
}

function carrierLine(line: ShipmentCusWorkspaceContainerLine): string {
  return [line.carrierName, line.plateNumber].filter(Boolean).join(' · ') || dash;
}

const DISPATCH_CHIP_CLASS: Record<ShipmentCusWorkspaceContainerLine['dispatchStatus'], string> = {
  AWAITING_VEHICLE: 'cus-lot-dispatch--awaiting',
  PLANNED: 'cus-lot-dispatch--planned',
  CREATED: 'cus-lot-dispatch--created',
  IN_TRANSIT: 'cus-lot-dispatch--transit',
  COMPLETED: 'cus-lot-dispatch--completed',
};

/** SIL-498 callbacks the host page owns: the drawer stays presentational, the
 *  page performs the container-line write / copy call, reloads the detail and
 *  surfaces the toast. A rejected promise leaves the draft standing so the
 *  user can retry or Escape-revert. */
export interface CusLotDeclarationActions {
  onSaveDeclaration: (line: ShipmentCusWorkspaceContainerLine, value: string) => Promise<void>;
  onCopyDeclaration: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
}

/** One row's tờ khai cell: an inline input when the lot is writable (the
 *  customer enters the number right here, per-cont — SPEC SIL-498), plain
 *  text otherwise. Commit rides Enter or blur, only when the trimmed draft
 *  actually differs from the persisted value; Escape reverts the draft. The
 *  copy affordance (first row only) repeats the reviewed ledger rule: it
 *  fans the PERSISTED number out to still-empty siblings, so it shows only
 *  while the draft matches the saved value — a retyped-but-unsaved value
 *  must never look copyable. */
function DeclarationCell({
  line,
  isFirst,
  emptySiblingCount,
  editable,
  actions,
}: {
  line: ShipmentCusWorkspaceContainerLine;
  isFirst: boolean;
  emptySiblingCount: number;
  editable: boolean;
  actions?: CusLotDeclarationActions;
}) {
  const persisted = (line.declarationNumber ?? '').trim();
  const [draft, setDraft] = useState(persisted);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  // The drawer reloads the detail after every save; reseed the draft from
  // the persisted value so the round-trip never reads as an unsaved edit.
  useEffect(() => { setDraft(persisted); }, [persisted]);
  const dirty = draft.trim() !== persisted;

  const commit = async () => {
    if (!editable || busy || !dirty || !actions) return;
    setBusy(true);
    try {
      await actions.onSaveDeclaration(line, draft.trim());
    } finally {
      setBusy(false);
    }
  };

  if (!editable || !actions) {
    return persisted
      ? <span className="cus-lot-decl__value">{persisted}</span>
      : <span className="cus-lot-quiet">Chưa có tờ khai</span>;
  }

  const copyReady = isFirst && persisted !== '' && emptySiblingCount > 0 && !dirty;

  return (
    <div className="cus-lot-decl">
      <input
        className="cus-lot-decl__input"
        type="text"
        inputMode="text"
        autoComplete="off"
        maxLength={50}
        aria-label={`Số tờ khai — container ${line.ordinal}${line.containerNumber ? ` (${line.containerNumber})` : ''}`}
        placeholder="Nhập số tờ khai…"
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            setDraft(persisted);
          }
        }}
        onBlur={() => { void commit(); }}
      />
      {copyReady && (
        <button
          type="button"
          className="cus-lot-decl__copy"
          aria-label={`Copy tờ khai cho các dòng dưới (${emptySiblingCount} dòng trống)`}
          title={`Copy tờ khai cho các dòng dưới — điền ${emptySiblingCount} dòng trống, không ghi đè dòng đã có số`}
          disabled={copying || busy}
          onClick={() => {
            setCopying(true);
            actions.onCopyDeclaration(line).finally(() => setCopying(false));
          }}
        >
          <CopyPlus size={14} aria-hidden="true" />
          {copying ? 'Đang copy…' : 'Copy tờ khai'}
        </button>
      )}
    </div>
  );
}

/** Đối soát CHI PHÍ — the FinanceEvidence derivation, restated for the
 *  mockup's micro-label pair (value only, no icon rail). */
function financeCostLine(item: ShipmentCusWorkspaceListItem): { text: string; tone: 'ok' | 'danger' | 'quiet' } {
  if (item.finance.isLoss) {
    const revenue = Number(item.finance.customerInvoiceTotal ?? 0) + Number(item.finance.customerNoInvoiceTotal ?? 0);
    const cost = Number(item.finance.totalCost ?? 0);
    return { text: `Lỗ ${formatMoney(String(Math.max(0, cost - revenue)))} ₫`, tone: 'danger' };
  }
  if (item.finance.customerChargeTotalsAvailable) return { text: 'Không ghi nhận lỗ', tone: 'ok' };
  return { text: 'Chưa đủ số liệu', tone: 'quiet' };
}

export function CusLotView({
  item,
  detail,
  loading,
  error,
  onRetry,
  canEditDeclaration = false,
  declarationActions,
}: {
  item: ShipmentCusWorkspaceListItem;
  detail?: ShipmentCusWorkspaceDetail;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  /** SIL-498: the host page resolves the write gate — writable lot field,
   *  intake-mutation role and no accounting lock — before passing true. */
  canEditDeclaration?: boolean;
  declarationActions?: CusLotDeclarationActions;
}) {
  const containers = detail?.containers ?? [];
  const totalWeight = containers.reduce((sum, line) => sum + Number(line.raw.cargoWeightKg ?? 0), 0);
  // One authority for count AND join — the same list the workboard row joins
  // (card 20260921_3), so the card can never inflate N past what it prints.
  // SIL-498: prefer the DETAIL summary — an inline tờ khai save force-reloads
  // the detail, so the card's count updates with the sheet; the list item
  // only catches up on the next 30s poll.
  const declarationNumbers = detail?.summary.declarationNumbers ?? item.declarationNumbers ?? [];
  // Per-cont copy targets: rows still without a number, excluding the first
  // row itself (the copy source — SPEC SIL-498: the button lives on dòng đầu).
  const firstLine = containers[0] ?? null;
  const emptyDeclarationSiblingCount = firstLine
    ? containers.filter((candidate) => candidate.id !== firstLine.id && !(candidate.declarationNumber ?? '').trim()).length
    : 0;
  const financeCost = financeCostLine(item);
  const confirmationAttention = item.accountingConfirmation.status !== 'CONFIRMED';

  return (
    <div className="cus-lot-view">
      <CusLotStepper item={item} />

      {loading && !detail ? (
        <div className="cus-lot-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải chi tiết lô…</div>
      ) : error ? (
        <div className="cus-inline-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Thử lại</button></div>
      ) : (
        <>
          <section className="cus-lot-card" aria-labelledby={`cus-lot-identity-${item.id}`}>
            <header className="cus-lot-card__band">
              <h3 id={`cus-lot-identity-${item.id}`}>Nhận diện lô</h3>
              <p>Khách hàng, chứng từ và hướng xuất nhập khẩu</p>
            </header>
            <div className="cus-lot-card__body">
              <div className="cus-lot-fact-grid">
                <FactCell label="Khách hàng">{item.customerName ?? dash}</FactCell>
                <FactCell label="Hình thức XNK">{item.raw.tradeDirection === 'EXPORT' ? 'Xuất' : item.raw.tradeDirection === 'IMPORT' ? 'Nhập' : dash}</FactCell>
                <FactCell label="Số bill/booking">{item.billOrBookNumber ?? dash}</FactCell>
                <FactCell label="Hãng tàu">{item.shippingLineName ?? dash}</FactCell>
              </div>
              <div className="cus-lot-fact-grid cus-lot-fact-grid--secondary">
                <div className="cus-lot-fact">
                  <span className="cus-lot-microlabel">Tuỳ chọn</span>
                  <span className="cus-lot-flags">
                    <span className={`cus-lot-flag${item.raw.isAdHoc ? ' cus-lot-flag--on' : ''}`}>Lệnh chạy ngoài: {item.raw.isAdHoc ? 'Có' : 'Không'}</span>
                    <span className={`cus-lot-flag${item.isCombined ? ' cus-lot-flag--on' : ''}`}>Đóng kết hợp: {item.isCombined ? 'Có' : 'Không'}</span>
                  </span>
                </div>
                <FactCell label={`Số tờ khai (${declarationNumbers.length})`}>
                  {declarationNumbers.length === 0
                    ? <span className="cus-lot-quiet">Chưa có tờ khai</span>
                    : declarationNumbers.join(', ')}
                </FactCell>
              </div>
            </div>
          </section>

          <section className="cus-lot-card" aria-labelledby={`cus-lot-cargo-${item.id}`}>
            <header className="cus-lot-card__band">
              <h3 id={`cus-lot-cargo-${item.id}`}>Thông tin hàng</h3>
              <p>
                {containers.length} container · Trọng lượng {containers.length > 0 && totalWeight > 0 ? formatWeight(String(totalWeight)) : dash}
              </p>
            </header>
            <div className="cus-lot-card__body cus-lot-card__body--flush">
              {containers.length === 0 ? (
                <p className="cus-lot-quiet cus-lot-empty-line">Chưa có container trong lô.</p>
              ) : (
                <div className="cus-lot-table-scroll">
                  <table className="cus-lot-table">
                    <caption className="sr-only">Danh sách container của lô hàng</caption>
                    <thead>
                      <tr>
                        <th scope="col">STT</th>
                        <th scope="col">Số container</th>
                        <th scope="col">Số tờ khai</th>
                        <th scope="col">Loại</th>
                        <th scope="col">Nhà máy</th>
                        <th scope="col">Tuyến đường</th>
                        <th scope="col">Nhà xe / BKS</th>
                        <th scope="col">Cảng nâng</th>
                        <th scope="col">Cảng hạ</th>
                        <th scope="col">Trọng lượng</th>
                        <th scope="col">Đóng / trả</th>
                        <th scope="col">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {containers.map((line, index) => (
                        <tr key={line.id}>
                          <th scope="row">{line.ordinal}</th>
                          <td>{line.containerNumber ?? <span className="cus-lot-quiet">Chưa có số cont</span>}</td>
                          <td>
                            <DeclarationCell
                              line={line}
                              isFirst={index === 0}
                              emptySiblingCount={index === 0 ? emptyDeclarationSiblingCount : 0}
                              editable={canEditDeclaration}
                              actions={declarationActions}
                            />
                          </td>
                          <td>{line.containerTypeLabel ?? dash}</td>
                          <td>{siteLabel(detail, line.operationalSiteId)}</td>
                          <td>{line.routeName ?? dash}</td>
                          <td>{carrierLine(line)}</td>
                          <td>{line.liftSite ?? dash}</td>
                          <td>{line.dropoffSite ?? dash}</td>
                          <td className="cus-lot-table__num">{line.raw.cargoWeightKg ? formatWeight(line.raw.cargoWeightKg) : dash}</td>
                          <td>{line.customerAppointmentAt ? formatTimeShortDate(line.customerAppointmentAt) : dash}</td>
                          <td>
                            <span className={`cus-lot-dispatch ${DISPATCH_CHIP_CLASS[line.dispatchStatus]}`}>{dispatchStatusLabel(line.dispatchStatus)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <div className="cus-lot-cards-row">
            <section className="cus-lot-card" aria-labelledby={`cus-lot-schedule-${item.id}`}>
              <header className="cus-lot-card__band"><h3 id={`cus-lot-schedule-${item.id}`}>Lịch &amp; ghi chú</h3></header>
              <div className="cus-lot-card__body">
                <div className="cus-lot-fact-grid cus-lot-fact-grid--two">
                  <FactCell label="Lịch cont">
                    {item.appointmentGroups.length === 0
                      ? <span className="cus-lot-quiet">Chưa có lịch</span>
                      : item.appointmentGroups.map((group) => (
                        <span key={`${group.at}-${group.factoryName ?? ''}`} className="cus-lot-appointment">
                          {formatTimeShortDate(group.at)}{group.factoryName ? ` · ${group.factoryName}` : ''} · {group.containerSummary}
                        </span>
                      ))}
                  </FactCell>
                  <FactCell label="Phơi phiếu">{item.documentCustody.label ?? 'Chưa xác định'}</FactCell>
                  <FactCell label="Ngày giờ đóng/trả">{item.plannedReturnAt ? formatTimeShortDate(item.plannedReturnAt) : dash}</FactCell>
                  <FactCell label="Ghi chú">
                    {[item.customerNotes, item.operationalNotes].filter(Boolean).join(' — ') || dash}
                  </FactCell>
                </div>
              </div>
            </section>

            <section className="cus-lot-card" aria-labelledby={`cus-lot-finance-${item.id}`}>
              <header className="cus-lot-card__band"><h3 id={`cus-lot-finance-${item.id}`}>Đối soát</h3></header>
              <div className="cus-lot-card__body">
                <div className="cus-lot-fact-grid cus-lot-fact-grid--two">
                  <FactCell label="Chi phí">
                    <span className={financeCost.tone === 'danger' ? 'cus-lot-tone-danger' : financeCost.tone === 'ok' ? 'cus-lot-tone-ok' : undefined}>{financeCost.text}</span>
                  </FactCell>
                  <FactCell label="Tài chính">
                    <span className={confirmationAttention ? 'cus-lot-tone-warn' : 'cus-lot-tone-ok'}>{accountingConfirmationLabel(item.accountingConfirmation)}</span>
                  </FactCell>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
