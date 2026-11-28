import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ShipmentCreateSection } from './ShipmentCreateSections';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';

/**
 * SIL-1144 (KB Ch.10 §10.6.7, QA-Retest4 28/11) — the /shipments/:id review
 * page's "Tờ khai hải quan" band. The create/edit register
 * (ShipmentDeclarationSection) is create+edit-only; this band gives the
 * read-only review the SAME completeness voice (§3.4.2 — có tờ khai cấp
 * container = ĐẦY ĐỦ, không có = VẪN THIẾU) over the SAME per-container
 * values, with the ONE write SIL-720 already sanctions on this page:
 * clearing a row's declaration through the per-container command (the same
 * wire the inline SỐ TỜ KHAI cell rides), then the host reloads the lot.
 *
 * No add slot here: adding a declaration slot IS adding a container row, and
 * the review page deliberately carries no container-mutation affordances
 * (SIL-481's review law; SIL-1160 keeps Xóa container on the Sửa lô form
 * only) — the full add/delete register lives on the create/edit form and on
 * the CUS drawer. An accounting-locked lot renders read-only with the lock
 * reason captioned, exactly like the inline cell.
 */

export interface ShipmentDeclarationReviewBandProps {
  /** The reviewed lot — null never wires a delete (no made-up target). */
  shipmentId: number | null;
  /** The lot version the rows were read at — the command's stale guard. */
  version: number | null;
  isFcl: boolean;
  /** FCL: one entry per container row, in sheet order. */
  rows: ReadonlyArray<{ containerId: number | null; context: string; declarationNumber: string }>;
  /** LCL: the lot-level number (single-declaration by law, read-only here). */
  lclDeclarationNumber?: string;
  /** The host's SIL-551 gate, the accounting lock already subtracted. */
  canEdit: boolean;
  lockedReason?: string | null;
  /** The host's lot reload after a successful clear. */
  onSaved: () => void;
}

function CompletenessPill({ present }: { present: boolean }) {
  return (
    <span className={`csc-decl-pill${present ? ' csc-decl-pill--ok' : ' csc-decl-pill--missing'}`}>
      {present ? 'Đầy đủ' : 'Vẫn thiếu'}
    </span>
  );
}

export function ShipmentDeclarationReviewBand({
  shipmentId,
  version,
  isFcl,
  rows,
  lclDeclarationNumber = '',
  canEdit,
  lockedReason = null,
  onSaved,
}: ShipmentDeclarationReviewBandProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearRow = async (containerId: number) => {
    if (shipmentId == null || version == null) return;
    setBusyId(containerId);
    setError(null);
    try {
      await updateCusShipmentContainerLine(
        shipmentId,
        containerId,
        { expectedShipmentVersion: version, declarationNumber: null },
        crypto.randomUUID(),
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message
        : 'Không xóa được tờ khai. Vui lòng thử lại.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ShipmentCreateSection id="declaration" title="Tờ khai hải quan">
      {error && <p className="csc-decl-review__error" role="alert">{error}</p>}
      {isFcl ? (
        <div className="csc-decl-rows">
          {rows.map((row, index) => {
            const present = row.declarationNumber.trim() !== '';
            return (
              <div key={row.containerId ?? index} className="csc-decl-row" data-field-id={`declaration-review-row-${index + 1}`}>
                <span className="csc-decl-row__context">{row.context}</span>
                <CompletenessPill present={present} />
                <span className={present ? 'csc-decl-row__value' : 'csc-decl-row__value csc-decl-row__value--empty'}>
                  {row.declarationNumber.trim() || 'Chưa có tờ khai'}
                </span>
                {canEdit && row.containerId != null && shipmentId != null && version != null && (
                  <button
                    type="button"
                    className="csc-icon-button csc-icon-button--danger"
                    aria-label={`Xóa tờ khai ${row.declarationNumber.trim() || row.context}`}
                    title="Xóa tờ khai"
                    disabled={busyId != null || !present}
                    onClick={() => { if (busyId == null) void clearRow(row.containerId!); }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="csc-decl-rows">
          <div className="csc-decl-row" data-field-id="declaration-review-row-lcl">
            <span className="csc-decl-row__context">Tờ khai cấp lô</span>
            <CompletenessPill present={lclDeclarationNumber.trim() !== ''} />
            <span className={lclDeclarationNumber.trim() !== '' ? 'csc-decl-row__value' : 'csc-decl-row__value csc-decl-row__value--empty'}>
              {lclDeclarationNumber.trim() || 'Chưa có tờ khai'}
            </span>
          </div>
        </div>
      )}
      {lockedReason && <p className="csc-decl-review__lock" role="note">{lockedReason}</p>}
    </ShipmentCreateSection>
  );
}
