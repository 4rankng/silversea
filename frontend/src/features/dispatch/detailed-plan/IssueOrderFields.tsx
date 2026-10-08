import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { TextField, UuiSelectField } from '../../../design-system';
import type { IssueOrderDraft, OwnTruckDriver } from './useIssueOrder';


interface IssueOrderFieldsProps {
  row: DispatchDetailPlanRow;
  ownTruck: OwnTruckDriver | null;
  loadingOwnTruck: boolean;
  /** Card 20261005_387 — ACTIVE trailers for the per-trip override picker
   *  (owned by useIssueOrder; empty until the own-fleet catalog loads). */
  trailerOptions?: Array<{ id: number; licensePlate: string; type: string | null }>;
  issueDraft: IssueOrderDraft;
  setIssueDraft: (updater: (current: IssueOrderDraft) => IssueOrderDraft) => void;
  onFieldTouched: () => void;
  /** Distinguishes DOM ids between the inline editor's issue section and the
   *  grid's standalone quick-issue dialog when both could exist in the DOM. */
  idPrefix?: string;
}

/**
 * Driver inputs for issuing a dispatch order — shared by the full plan
 * editor's inline "Phát lệnh" section and the grid's quick-issue dialog.
 * The customer ruling removed the date/time picker: planned times ride the
 * row's CUS-locked schedule (delivery date + run hour) with a wall-clock
 * fallback, both computed in useIssueOrder — dispatchers never pick times.
 *
 * Card 20261005_387: own-fleet issues also show the tractor's current trailer
 * coupling and an OPTIONAL per-trip override (the issue API has always accepted
 * trailerId). No pick = the coupling, exactly as before; a different pick shows
 * a comparison note naming both plates so the choice is auditable on sight.
 */
export function IssueOrderFields({
  row,
  ownTruck,
  loadingOwnTruck,
  trailerOptions = [],
  issueDraft,
  setIssueDraft,
  onFieldTouched,
  idPrefix = 'dispatch-issue',
}: IssueOrderFieldsProps) {
  const currentPlate = row.dispatch.assignedPlate;
  const coupling = ownTruck?.currentTrailerId != null
    ? { id: ownTruck.currentTrailerId, plate: ownTruck.currentTrailerPlate, type: ownTruck.trailerType }
    : null;
  const override = issueDraft.trailerId;
  const overridePlate = override != null
    ? trailerOptions.find((trailer) => trailer.id === override)?.licensePlate
    : null;
  // The tractor's own trailer must stay selectable even when it left the
  // ACTIVE catalog (unhooked/deleted) — the backend still accepts it while it
  // exists, and the picker must not lie about the default.
  const couplingMissingFromOptions = coupling != null
    && !trailerOptions.some((trailer) => trailer.id === coupling.id);

  return (
    <>
      {row.dispatch.carrierType === 'OWN' ? (
        <>
          <p className="dispatch-assignment-dialog__issue-driver">
            Tài xế: {loadingOwnTruck
              ? 'Đang tải…'
              : ownTruck?.driverName ?? (
                <span className="dispatch-assignment-dialog__issue-warning">
                  Xe {currentPlate} chưa gán tài xế — vào Danh mục Xe nội bộ để gán trước.
                </span>
              )}
          </p>
          {ownTruck != null && (
            <>
              <p className="dispatch-assignment-dialog__issue-driver">
                Moóc đang ghép: {coupling
                  ? `${coupling.plate ?? 'chưa rõ biển số'}${coupling.type ? ` · ${coupling.type}` : ''}`
                  : 'chưa ghép moóc — chọn moóc bên dưới'}
              </p>
              <UuiSelectField
                id={`${idPrefix}-trailer-${row.fulfillmentId}`}
                label="Moóc cho chuyến (ghi đè)"
                value={override != null ? String(override) : ''}
                onChange={(event) => {
                  setIssueDraft((current) => ({ ...current, trailerId: event.target.value === '' ? null : Number(event.target.value) }));
                  onFieldTouched();
                }}
                options={[
                  { value: '', label: coupling
                    ? `Dùng moóc đang ghép (${coupling.plate ?? 'chưa rõ biển số'})`
                    : '— Chọn moóc —' },
                  ...trailerOptions.map((trailer) => ({
                    value: String(trailer.id),
                    label: `${trailer.licensePlate}${trailer.type ? ` · ${trailer.type}` : ''}`,
                  })),
                  ...(couplingMissingFromOptions && coupling != null
                    ? [{ value: String(coupling.id), label: `${coupling.plate ?? 'Moóc đang ghép'} (moóc đang ghép)` }]
                    : []),
                ]}
              />
              {override != null && override !== coupling?.id && (
                <p className="dispatch-assignment-dialog__issue-driver">
                  Ghi đè moóc: {overridePlate ?? 'moóc đã chọn'} thay cho moóc đang ghép {coupling?.plate ?? 'chưa ghép'}.
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <TextField
            id={`${idPrefix}-driver-name-${row.fulfillmentId}`}
            label="Tên tài xế (nhà xe ngoài) — không bắt buộc"
            autoComplete="off"
            value={issueDraft.externalDriverName}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverName: event.target.value })); onFieldTouched(); }}
          />
          <TextField
            id={`${idPrefix}-driver-phone-${row.fulfillmentId}`}
            label="SĐT tài xế (nhà xe ngoài)"
            autoComplete="off"
            value={issueDraft.externalDriverPhone}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverPhone: event.target.value })); onFieldTouched(); }}
          />
        </>
      )}

    </>
  );
}
