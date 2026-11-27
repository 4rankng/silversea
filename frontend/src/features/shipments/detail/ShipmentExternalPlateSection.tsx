import { useCallback, useEffect, useState } from 'react';
import { TripExternalPlateDialog } from '../../../components/trip/TripExternalPlateDialog';
import { useToast } from '../../../components/shared/Toast';
import { getCusShipmentWorkspaceDetail, type ExternalTripPlateContext } from '../../../api/shipmentClient';
import type { ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import { canUpdateExternalTripPlate } from '../cus/cusUtils';
import './ShipmentExternalPlateSection.css';

/**
 * SIL-1034 (K4.23) — the PHÂN XE read-edit strip on the post-create review
 * page (/shipments/:id): the Chứng từ user lands here from the create flow
 * and legacy links, and until now the page carried no plate surface at all —
 * the waiting-for-plate external trip (Điều vận assigned the vendor, left
 * the biển trống) had no CUS-side place to fill its real plate.
 *
 * Both sides of the write already exist: the shared TripExternalPlateDialog
 * (SIL-714) and `PATCH /api/shipments/trips/:tripId/external-plate`, whose
 * server allowlist already admits CUS with `assertCusTripVisible` scoping.
 * This section is ONLY the surface: it self-loads through the CUS-admitted
 * `cus-workspace/:id` read (the workspace form's own loader is a different
 * authority), lists the lot's external trips, and offers the plate entry on
 * exactly the rows `canUpdateExternalTripPlate` admits. No other assignment
 * write is exposed here — quyền CUS tối thiểu.
 */

const TRIP_STATUS_LABEL: Record<string, string> = {
  CREATED: 'Chờ nhận việc',
  IN_TRANSIT: 'Đang chạy',
  COMPLETED: 'Hoàn thành',
  CANCELED: 'Đã hủy',
};

export function ShipmentExternalPlateSection({ shipmentId }: { shipmentId: number }) {
  const { toast } = useToast();
  const [externalLines, setExternalLines] = useState<ShipmentCusWorkspaceContainerLine[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [plateTripId, setPlateTripId] = useState<number | null>(null);
  const [plateCarrierName, setPlateCarrierName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      setExternalLines(detail.containers.filter((line) => line.tripId != null && line.carrierType === 'EXTERNAL'));
      setLoadError('');
    } catch (error) {
      setExternalLines(null);
      setLoadError((error as Error).message || 'Không tải được thông tin phân xe của lô.');
    }
  }, [shipmentId]);

  useEffect(() => { void load(); }, [load]);

  const openPlateDialog = useCallback((line: ShipmentCusWorkspaceContainerLine) => {
    setPlateCarrierName(line.carrierName ?? null);
    setPlateTripId(line.tripId ?? null);
  }, []);

  const handlePlateSaved = useCallback((context: ExternalTripPlateContext) => {
    setPlateTripId(null);
    toast({ kind: 'success', message: `Đã cập nhật biển số xe ngoài${context.externalPlateNumber ? `: ${context.externalPlateNumber}` : ''}.` });
    void load();
  }, [load, toast]);

  // A lot without external trips carries no section — the review page stays
  // exactly what it was (no empty PHÂN XE frame).
  if (externalLines !== null && externalLines.length === 0) return null;

  return (
    <section className="external-plate" data-component="external-plate-section" aria-label="Phân xe — chuyến xe ngoài">
      <div className="external-plate__heading">
        <h2>Phân xe — chuyến xe ngoài</h2>
        <p>Chuyến xe ngoài đang chờ biển: nhập biển số thực sau khi nhà xe nhận việc.</p>
      </div>
      {externalLines === null ? (
        loadError
          ? <p className="external-plate__error" role="alert">{loadError}</p>
          : <p className="external-plate__loading">Đang tải thông tin phân xe…</p>
      ) : (
        <ul className="external-plate__list">
          {externalLines.map((line) => {
            const awaiting = canUpdateExternalTripPlate(line);
            return (
              <li key={line.id} className="external-plate__line">
                <span className="external-plate__container">{line.containerNumber?.trim() || `Cont ${line.ordinal}`}</span>
                <span className="external-plate__carrier">{line.carrierName || 'Chưa có nhà xe'}</span>
                <span className="external-plate__status">{TRIP_STATUS_LABEL[line.tripStatus ?? ''] ?? '—'}</span>
                <span className={'external-plate__value' + (awaiting ? ' external-plate__value--awaiting' : '')}>
                  {line.plateNumber?.trim() ? line.plateNumber : 'Chờ biển'}
                </span>
                {/* K2.45 (SIL-1082) — the carrier payment-term reason rides the
                    workspace line (server read-time field), so the review page
                    explains an undetermined hạn thanh toán without a fetch. */}
                {line.paymentTermWarning && (
                  <span className="external-plate__warning" role="status">{line.paymentTermWarning}</span>
                )}
                {awaiting && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm external-plate__update"
                    onClick={() => openPlateDialog(line)}
                  >
                    Cập nhật biển số
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <TripExternalPlateDialog
        tripId={plateTripId}
        carrierName={plateCarrierName}
        onClose={() => setPlateTripId(null)}
        onSaved={handlePlateSaved}
      />
    </section>
  );
}
