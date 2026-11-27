import { useMemo, useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import type { TripDetail } from '@tingting/shared';

import { tripClient } from '../../../api/tripClient';
import { useTripDetail } from '../../../hooks/useTripQueries';
import { useTrailers } from '../../../hooks/useCatalogQueries';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { Modal, useConfirm } from '../../../components/UI';
import { UuiSelectField } from '../../../design-system';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { partnerEligibleForKind } from './pairCandidates';
import { pairWeightPreSaveWarning } from './pairWeightWarning';

interface PairTripsDialogProps {
  /** Row whose trip starts the pair; null keeps the dialog closed. */
  row: DispatchDetailPlanRow | null;
  /** Unpaired OWN-carrier rows with trips — partner candidates. */
  candidates: DispatchDetailPlanRow[];
  onClose: () => void;
  /** Called after a successful pairing so the caller refetches the grid. */
  onPaired: () => void;
}

interface PairDraftPayload {
  plannedStartAt: string;
  plannedEndAt: string;
  canonicalOrigin: string;
  canonicalDestination: string;
  cargoWeightKg: number;
  /** Card 211026152138 — null when the trip carries no snapshotted capacity:
   *  the pair saves with a soft warning instead of being blocked. */
  vehicleCapacityKg: number | null;
  expectedVersion: number;
}

/**
 * Ghép chuyến entry point on the live dispatch-detail grid (LoHangKepKetHop
 * §3.1): pick the pair kind + partner order; drafts are derived from each
 * trip's STORED planning authority (the backend rejects forged drafts), with
 * the earlier planned start submitted as the first leg for sequential
 * KẾT HỢP pairs. All kind rules (2×20', cùng ngày, nối tiếp, same vỏ…) are
 * enforced server-side and surfaced here as the Vietnamese error message.
 */
export function PairTripsDialog({ row, candidates, onClose, onPaired }: PairTripsDialogProps) {
  const baseTripId = row?.dispatch?.tripId ?? null;
  const { data: baseTrip, isLoading: loadingBase } = useTripDetail(
    baseTripId != null ? String(baseTripId) : undefined,
  );

  const [partnerTripId, setPartnerTripId] = useState('');
  const [pairKind, setPairKind] = useState<'KEP' | 'KET_HOP'>('KET_HOP');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const { confirm, dialog: weightConfirmDialog } = useConfirm();
  // SIL-1148 (KB Ch.3 §3.6 K3.52 + Ch.4 K4.59) — the pre-save weight confirm
  // keys on the rig's DECLARED 'Tải trọng tối đa' (trailers.max_payload_tons),
  // not the snapshot: the issue path's inference (mooc bucket ?? tow rating,
  // SIL-674) fills trips.vehicleCapacityKg for rigs whose declaration is
  // empty, which made the missing-capacity advisory unreachable for exactly
  // the QA-reported pairing. A failed/still-loading catalog falls back to the
  // snapshot law (declaredCapacityKg undefined) — never a false nag.
  const { data: trailers } = useTrailers();
  /** The trip's rig DECLARED 'Tải trọng tối đa' in kg: null = trailer record
   *  exists but the rating is undeclared ('xe chưa khai tải trọng');
   *  undefined = no trailer fact resolvable (catalog loading / trailer gone)
   *  → the snapshot law keeps owning the verdict. */
  const declaredCapacityFor = (trip: TripDetail): number | null | undefined => {
    if (trip.trailerId == null) return undefined;
    const trailer = (trailers ?? []).find((entry) => entry.id === trip.trailerId);
    if (trailer == null) return undefined;
    return trailer.maxPayloadTons != null ? trailer.maxPayloadTons * 1000 : null;
  };

  // Sweep (card 20261008_1): the submit used to disable silently — every
  // disable cause now carries its own aria-described reason
  // (DisabledActionTip) instead of a bare `disabled`. The "Xong" acknowledge
  // keeps NO disable at all: a new save starts with setWarnings([]), so the
  // button unmounts instead of ever rendering disabled (its old
  // `disabled={saving}` was unreachable) — always enabled when present.
  const submitDisabledReason = saving
    ? 'Đang ghép chuyến…'
    : loadingBase
      ? 'Đang tải dữ liệu lệnh ghép…'
      : !baseTrip
        ? 'Không tải được thông tin lệnh — thử mở lại.'
        : !partnerTripId
          ? 'Chọn lệnh ghép cùng để tiếp tục.'
          : null;

  const partnerOptions = useMemo(() => candidates
    .filter((candidate) => candidate.dispatch?.tripId != null
      && candidate.dispatch.tripId !== baseTripId)
    // SIL-1047 (KB §8.1.2 K8.3) — the suggestion list obeys the size law:
    // 40ft never appears as a Kẹp partner, Kết hợp drops proven size
    // mismatches. The server's block stays the backstop.
    .filter((candidate) => partnerEligibleForKind(candidate, row, pairKind))
    .map((candidate) => ({
      value: String(candidate.dispatch!.tripId),
      // business key render; id never user-facing — Bill của lô + vỏ + tuyến
      label: [candidate.docs.billNumber, candidate.container.containerNumber ?? 'chưa có vỏ', candidate.customerRoute.routeName].filter(Boolean).join(' · '),
    })), [candidates, baseTripId, row, pairKind]);

  function draftFor(trip: TripDetail): PairDraftPayload | null {
    // Card 211026152138 — vehicleCapacityKg is NOT required: a rig without a
    // declared capacity pairs with a server-side soft warning instead of the
    // old client-side dead end. Schedule, locations and cargo weight stay
    // mandatory (the backend's authority checks still verify them).
    if (!trip.plannedStartAt || !trip.plannedEndAt
      || !trip.canonicalOrigin || !trip.canonicalDestination
      || !trip.cargoWeightKg) {
      return null;
    }
    return {
      plannedStartAt: new Date(trip.plannedStartAt).toISOString(),
      plannedEndAt: new Date(trip.plannedEndAt).toISOString(),
      canonicalOrigin: trip.canonicalOrigin,
      canonicalDestination: trip.canonicalDestination,
      cargoWeightKg: Number(trip.cargoWeightKg),
      vehicleCapacityKg: trip.vehicleCapacityKg != null ? Number(trip.vehicleCapacityKg) : null,
      expectedVersion: trip.version,
    };
  }

  async function handlePair() {
    if (!baseTrip || baseTripId == null || !partnerTripId || saving) return;
    setSaving(true);
    setError('');
    setWarnings([]);
    try {
      const partnerDetail = await tripClient.getTrip(Number(partnerTripId));
      const baseDraft = draftFor(baseTrip);
      const partnerDraft = draftFor(partnerDetail);
      if (!baseDraft || !partnerDraft) {
        setError('Chuyến thiếu lịch kế hoạch / điểm đi đến / khối lượng — bổ sung trước khi ghép.');
        return;
      }
      // Sequential (KẾT HỢP) pairs require the earlier start as leg 1; KẸP
      // runs simultaneously so the order is irrelevant to the rule check.
      const baseFirst = baseDraft.plannedStartAt <= partnerDraft.plannedStartAt;
      const first = baseFirst ? baseDraft : partnerDraft;
      const second = baseFirst ? partnerDraft : baseDraft;
      // SIL-969 (KB Ch.3 §3.3.6, K3.52) — the overload / missing-capacity
      // advisories surface BEFORE the save as a soft 'Vẫn lưu?' confirm:
      // "Xác nhận" saves exactly as before, "Hủy" keeps the pair unsaved. The
      // confirm runs inside the `saving` window so a double click cannot start
      // two submits while the dispatcher decides. Backend save rules and its
      // response warnings are unchanged. SIL-1148 — the warning reads the
      // rigs' DECLARED 'Tải trọng tối đa' beside the stored snapshot; the
      // declared value is a MIRROR fact only, never part of the save payload
      // (the backend verifies the drafts against the stored snapshot law).
      const preSaveWarning = pairWeightPreSaveWarning(
        {
          cargoWeightKg: first.cargoWeightKg,
          vehicleCapacityKg: first.vehicleCapacityKg,
          declaredCapacityKg: baseFirst ? declaredCapacityFor(baseTrip) : declaredCapacityFor(partnerDetail),
        },
        {
          cargoWeightKg: second.cargoWeightKg,
          vehicleCapacityKg: second.vehicleCapacityKg,
          declaredCapacityKg: baseFirst ? declaredCapacityFor(partnerDetail) : declaredCapacityFor(baseTrip),
        },
      );
      if (preSaveWarning != null) {
        const proceed = await confirm(`${preSaveWarning} Vẫn lưu?`);
        if (!proceed) return;
      }
      const result = await tripClient.createPair({
        firstTripId: baseFirst ? baseTripId : Number(partnerTripId),
        secondTripId: baseFirst ? Number(partnerTripId) : baseTripId,
        pairKind,
        firstTrip: first,
        secondTrip: second,
      });
      // The warning the dispatcher just confirmed is moved, not repeated: drop
      // it from the post-save banner. The FE advisory may name the computable
      // total after the plain const (SIL-1148), while the backend repeats the
      // bare message — prefix-match, so the suffixed confirm still absorbs
      // its server twin. Any warning this pre-check did not predict still
      // renders there (the backend stays the authority).
      const remainingWarnings = (result.warnings ?? [])
        .filter((warning) => preSaveWarning == null || !preSaveWarning.startsWith(warning));
      setWarnings(remainingWarnings);
      onPaired();
      if (!remainingWarnings.length) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể ghép hai lệnh này.');
    } finally {
      setSaving(false);
    }
  }

  if (!row || baseTripId == null) return null;

  return (
    <>
      <Modal
        isOpen
        title="Ghép chuyến điều vận"
        onClose={onClose}
        maxWidth={560}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>
            Ghép 2 lệnh cont chạy chung 1 xe — Kẹp (2×20' cùng lúc) hoặc Kết hợp (tái dùng vỏ, nối tiếp).
            Hệ thống tự kiểm tra điều kiện và tính phí đường/lương theo cặp.
          </div>

          <UuiSelectField
            id="pair-kind"
            label="Loại ghép"
            value={pairKind}
            onChange={(event) => setPairKind(event.target.value as 'KEP' | 'KET_HOP')}
            disabled={saving}
            options={[
              { value: 'KET_HOP', label: 'Kết hợp — tái dùng vỏ, 2 lệnh nối tiếp' },
              { value: 'KEP', label: "Kẹp — 2 cont 20' chạy cùng lúc" },
            ]}
          />

          <UuiSelectField
            id="pair-partner"
            label="Lệnh ghép cùng"
            value={partnerTripId}
            onChange={(event) => setPartnerTripId(event.target.value)}
            disabled={saving}
            hint="Chọn lệnh cont còn lại của cặp — các lệnh cùng lô được xếp trước (Kẹp), hoặc chọn lệnh khác cho Kết hợp."
            options={[
              { value: '', label: '— Chọn lệnh ghép —' },
              ...partnerOptions,
            ]}
          />

          {error && (
            <p role="alert" className="form-error" style={{ color: 'var(--danger)', margin: 0 }}>
              {error}
            </p>
          )}
          {warnings.map((warning) => (
            <p key={warning} role="status" style={{ color: 'var(--warning, #b45309)', margin: 0, fontSize: 'var(--text-data-size)' }}>
              {warning}
            </p>
          ))}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {warnings.length > 0 && (
              <button type="button" className="btn btn--secondary" onClick={onClose}>
                Xong
              </button>
            )}
            <DisabledActionTip id="pair-trips-submit" reason={submitDisabledReason}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => { if (submitDisabledReason) return; void handlePair(); }}
                aria-disabled={submitDisabledReason != null || undefined}
              >
                {saving ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
                {saving ? 'Đang ghép…' : 'Ghép chuyến'}
              </button>
            </DisabledActionTip>
          </div>
        </div>
      </Modal>
      {weightConfirmDialog}
    </>
  );
}
