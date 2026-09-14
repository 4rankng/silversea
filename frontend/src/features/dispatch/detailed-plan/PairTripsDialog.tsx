import { useMemo, useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import type { TripDetail } from '@tingting/shared';

import { tripClient } from '../../../api/tripClient';
import { useTripDetail } from '../../../hooks/useTripQueries';
import { Modal } from '../../../components/UI';
import { UuiSelectField } from '../../../design-system';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

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
  vehicleCapacityKg: number;
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

  const partnerOptions = useMemo(() => candidates
    .filter((candidate) => candidate.dispatch?.tripId != null
      && candidate.dispatch.tripId !== baseTripId)
    .map((candidate) => ({
      value: String(candidate.dispatch!.tripId),
      label: `#${candidate.dispatch.tripId} · ${candidate.container.containerNumber ?? 'chưa có vỏ'} · ${candidate.customerRoute.routeName ?? ''}`,
    })), [candidates, baseTripId]);

  function draftFor(trip: TripDetail): PairDraftPayload | null {
    if (!trip.plannedStartAt || !trip.plannedEndAt
      || !trip.canonicalOrigin || !trip.canonicalDestination
      || !trip.cargoWeightKg || !trip.vehicleCapacityKg) {
      return null;
    }
    return {
      plannedStartAt: new Date(trip.plannedStartAt).toISOString(),
      plannedEndAt: new Date(trip.plannedEndAt).toISOString(),
      canonicalOrigin: trip.canonicalOrigin,
      canonicalDestination: trip.canonicalDestination,
      cargoWeightKg: Number(trip.cargoWeightKg),
      vehicleCapacityKg: Number(trip.vehicleCapacityKg),
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
      const result = await tripClient.createPair({
        firstTripId: baseFirst ? baseTripId : Number(partnerTripId),
        secondTripId: baseFirst ? Number(partnerTripId) : baseTripId,
        pairKind,
        firstTrip: first,
        secondTrip: second,
      });
      setWarnings(result.warnings ?? []);
      onPaired();
      if (!(result.warnings ?? []).length) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể ghép hai lệnh này.');
    } finally {
      setSaving(false);
    }
  }

  if (!row || baseTripId == null) return null;

  return (
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
          hint="Chọn lệnh cont còn lại của cặp (cùng xe, cùng tài xế)."
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
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
              Xong
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => { void handlePair(); }}
            disabled={saving || loadingBase || !baseTrip || !partnerTripId}
          >
            {saving ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
            {saving ? 'Đang ghép…' : 'Ghép chuyến'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
