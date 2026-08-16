import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TIRE_DISPOSAL_REASONS } from "@tingting/shared";
import type { Tire } from "@tingting/shared";
import type { Supplier } from "@tingting/shared";
import { formatErrorMessage } from "../../lib/api";
import { DateInput } from "../../design-system/forms/DateInput";
import { draftFromTire, patchFromDraft, positionPayloadFromLabel, type TireEditDraft, type TirePatch } from "../../features/tires/tireUtils";
import "../../pages/TruckTiresPage.css";

type VehicleKind = "truck" | "trailer";
type PositionManagerOpener = (onSelect?: (value: string) => void) => void;

import { PositionPicker, SupplierPicker } from './tire-controls';
function occupiedPositionsOn(tires: Tire[], kind: VehicleKind, vehicleId: number): Set<string> { return new Set(tires.filter(t => t.status === 'IN_USE' && (kind === 'truck' ? t.truckId === vehicleId : t.trailerId === vehicleId) && t.position).map(t => t.position!)); }

export function TireEditDialog({
  tire,
  suppliers,
  positionLabels,
  saving,
  onManagePositions,
  onsave,
  oncancel,
}: {
  tire: Tire;
  suppliers: Supplier[];
  positionLabels: string[];
  saving: boolean;
  onManagePositions: PositionManagerOpener;
  onsave: (patch: TirePatch) => Promise<unknown> | void;
  oncancel: () => void;
}) {
  const [draft, setDraft] = useState<TireEditDraft>(() => draftFromTire(tire, suppliers));

  const updateDraft = (key: keyof TireEditDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  // ESC closes the dialog (mirrors Modal/ConfirmDialog). useBackShortcut yields
  // while this role="dialog" is open (overlayState DOM fallback), so this
  // listener owns ESC without fighting the page-level back shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") oncancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oncancel]);

  const save = async () => {
    if (!draft.serial.trim()) return;
    await onsave(patchFromDraft(draft, suppliers));
  };

  return (
    <div className="ttp-dialog-overlay" role="presentation" onClick={oncancel}>
      <div className="ttp-dialog" role="dialog" aria-modal="true" aria-labelledby="ttp-edit-title" onClick={(e) => e.stopPropagation()}>
        <div className="ttp-dialog-head">
          <div>
            <h2 id="ttp-edit-title">Sửa thông tin lốp</h2>
            <p>{tire.serial}</p>
          </div>
          <button type="button" className="ttp-dialog-close" onClick={oncancel} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="ttp-edit-form">
          <div className="ttp-field">
            <label>Serial lốp *</label>
            <input className="input" value={draft.serial} onChange={(e) => updateDraft("serial", e.target.value)} autoFocus />
          </div>
          <div className="ttp-field">
            <label>Vị trí</label>
            <PositionPicker value={draft.position} labels={positionLabels} onChange={(value) => updateDraft("position", value)} onManage={onManagePositions} />
          </div>
          <div className="ttp-field">
            <label>Kích cỡ</label>
            <input className="input" value={draft.size} onChange={(e) => updateDraft("size", e.target.value)} />
          </div>
          <div className="ttp-field">
            <label>Ngày lắp</label>
            <DateInput className="input" value={draft.installedAt} onChange={(value) => updateDraft("installedAt", value)} />
          </div>
          <div className="ttp-field">
            <label>Nhà cung cấp</label>
            <SupplierPicker value={draft.supplierText} suppliers={suppliers} onChange={(value) => updateDraft("supplierText", value)} />
          </div>
          <div className="ttp-field">
            <label>Ngày mua</label>
            <DateInput className="input" value={draft.purchasedAt} onChange={(value) => updateDraft("purchasedAt", value)} />
          </div>
        </div>

        <div className="ttp-dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>
            Hủy
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={saving || !draft.serial.trim()}>
            {saving ? "Đang lưu…" : "Lưu cập nhật"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tháo lốp ra khỏi xe: chọn giữ làm dự phòng HOẶC thanh lý kèm lý do. */
export function UnmountTireDialog({ tire, saving, oncancel, onremove, ondispose }: { tire: Tire; saving: boolean; oncancel: () => void; onremove: (id: number) => Promise<unknown> | void; ondispose: (id: number, reason: string) => Promise<unknown> | void }) {
  const [choice, setChoice] = useState<"spare" | "dispose">("spare");
  const [reason, setReason] = useState<string>(TIRE_DISPOSAL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");

  const effectiveReason = reason === "Khác" ? customReason.trim() : reason;
  const reasonMissing = choice === "dispose" && (reason === "Khác" ? customReason.trim().length === 0 : false);
  const canConfirm = !reasonMissing;

  // ESC closes the dialog (mirrors the shared Modal/ConfirmDialog). useBackShortcut
  // already yields while this role="dialog" is open (overlayState DOM fallback), so
  // this listener owns the key without fighting the page-level back shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") oncancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oncancel]);

  const confirm = async () => {
    if (choice === "spare") {
      await onremove(tire.id);
    } else {
      if (!effectiveReason) return;
      await ondispose(tire.id, effectiveReason);
    }
  };

  return (
    <div className="ttp-dialog-overlay" role="presentation" onClick={oncancel}>
      <div className="ttp-dialog ttp-dialog--unmount" role="dialog" aria-modal="true" aria-labelledby="ttp-unmount-title" onClick={(e) => e.stopPropagation()}>
        <div className="ttp-dialog-head">
          <div>
            <h2 id="ttp-unmount-title">Tháo lốp ra khỏi xe</h2>
            <p>
              {tire.serial}
              {tire.position ? ` · ${tire.position}` : ""}
            </p>
          </div>
          <button type="button" className="ttp-dialog-close" onClick={oncancel} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="ttp-unmount-options">
          <label className={`ttp-unmount-choice ${choice === "spare" ? "is-active" : ""}`}>
            <input type="radio" name="unmount-choice" checked={choice === "spare"} onChange={() => setChoice("spare")} />
            <span className="ttp-unmount-choice__main">
              <strong>Giữ làm lốp dự phòng</strong>
              <small>Lốp về kho, có thể lắp lại sau.</small>
            </span>
          </label>

          <label className={`ttp-unmount-choice ${choice === "dispose" ? "is-active" : ""}`}>
            <input type="radio" name="unmount-choice" checked={choice === "dispose"} onChange={() => setChoice("dispose")} />
            <span className="ttp-unmount-choice__main">
              <strong>Thanh lý lốp</strong>
              <small>Đưa lốp ra khỏi sử dụng, ghi lý do.</small>
            </span>
          </label>
        </div>

        {choice === "dispose" && (
          <div className="ttp-field ttp-unmount-reason">
            <label>Lý do thanh lý *</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {TIRE_DISPOSAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {reason === "Khác" && <input className="input ttp-unmount-reason-custom" value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Ghi lý do khác" maxLength={120} autoFocus />}
          </div>
        )}

        <div className="ttp-dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void confirm();
            }}
            disabled={saving || !canConfirm}
          >
            {saving ? "Đang xử lý…" : choice === "dispose" ? "Thanh lý lốp" : "Tháo lốp"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstallTireDialog({
  tire,
  tires,
  isTruck,
  vehicleId,
  vehicleLabel,
  positionLabels,
  saving,
  onManagePositions,
  oncancel,
  oninstall,
}: {
  tire: Tire;
  tires: Tire[];
  isTruck: boolean;
  vehicleId: number;
  vehicleLabel: string;
  positionLabels: string[];
  saving: boolean;
  onManagePositions: PositionManagerOpener;
  oncancel: () => void;
  oninstall: (payload: { truckId?: number | null; trailerId?: number | null; position?: string | null }) => Promise<unknown> | void;
}) {
  const [positionText, setPositionText] = useState(tire.position ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") oncancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oncancel]);

  const occupied = occupiedPositionsOn(tires, isTruck ? "truck" : "trailer", vehicleId);
  const chosenRaw = positionPayloadFromLabel(positionText).position;
  const positionTaken = !!chosenRaw && occupied.has(chosenRaw);

  const confirm = async () => {
    if (positionTaken) return;
    setError("");
    try {
      await oninstall({
        ...(isTruck ? { truckId: vehicleId } : { trailerId: vehicleId }),
        position: chosenRaw,
      });
    } catch (err) {
      setError(formatErrorMessage(err));
    }
  };

  return (
    <div className="ttp-dialog-overlay" role="presentation" onClick={oncancel}>
      <div className="ttp-dialog ttp-dialog--unmount" role="dialog" aria-modal="true" aria-labelledby="ttp-install-title" onClick={(e) => e.stopPropagation()}>
        <div className="ttp-dialog-head">
          <div>
            <h2 id="ttp-install-title">Lắp lốp lên xe</h2>
            <p>
              {tire.serial} · {vehicleLabel}
            </p>
          </div>
          <button type="button" className="ttp-dialog-close" onClick={oncancel} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="ttp-edit-form">
          <div className="ttp-field ttp-field--serial">
            <label>Vị trí lắp</label>
            <PositionPicker value={positionText} labels={positionLabels} onChange={setPositionText} onManage={onManagePositions} />
            {positionTaken && <div className="ttp-position-error">Vị trí này trên {vehicleLabel} đã có lốp.</div>}
            {error && <div className="ttp-position-error">{error}</div>}
          </div>
        </div>

        <div className="ttp-dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void confirm();
            }}
            disabled={saving || positionTaken}
          >
            {saving ? "Đang xử lý…" : "Lắp lốp"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Move a mounted tire to another vehicle in one step (preserves install date). */
export function TransferTireDialog({
  tire,
  tires,
  vehicles,
  currentVehicleLabel,
  positionLabels,
  saving,
  onManagePositions,
  oncancel,
  ontransfer,
}: {
  tire: Tire;
  tires: Tire[];
  vehicles: { id: number; kind: "truck" | "trailer"; label: string }[];
  currentVehicleLabel: string;
  positionLabels: string[];
  saving: boolean;
  onManagePositions: PositionManagerOpener;
  oncancel: () => void;
  ontransfer: (payload: { truckId?: number | null; trailerId?: number | null; position?: string | null }) => Promise<unknown> | void;
}) {
  const [targetKey, setTargetKey] = useState("");
  const [positionText, setPositionText] = useState(tire.position ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") oncancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oncancel]);

  const target = vehicles.find((v) => `${v.kind}:${v.id}` === targetKey) ?? null;
  const chosenRaw = positionPayloadFromLabel(positionText).position;
  const positionTaken = target ? !!chosenRaw && occupiedPositionsOn(tires, target.kind, target.id).has(chosenRaw) : false;

  const confirm = async () => {
    if (!target || positionTaken) return;
    setError("");
    try {
      await ontransfer({
        ...(target.kind === "truck" ? { truckId: target.id } : { trailerId: target.id }),
        position: chosenRaw,
      });
    } catch (err) {
      setError(formatErrorMessage(err));
    }
  };

  return (
    <div className="ttp-dialog-overlay" role="presentation" onClick={oncancel}>
      <div className="ttp-dialog ttp-dialog--unmount" role="dialog" aria-modal="true" aria-labelledby="ttp-transfer-title" onClick={(e) => e.stopPropagation()}>
        <div className="ttp-dialog-head">
          <div>
            <h2 id="ttp-transfer-title">Chuyển lốp sang xe khác</h2>
            <p>
              {tire.serial} · đang trên {currentVehicleLabel}
            </p>
          </div>
          <button type="button" className="ttp-dialog-close" onClick={oncancel} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="ttp-edit-form">
          <div className="ttp-field">
            <label>Phương tiện nhận lốp *</label>
            <select className="input" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              <option value="">— Chọn xe / rơ-moóc —</option>
              <optgroup label="Xe đầu kéo">
                {vehicles
                  .filter((v) => v.kind === "truck")
                  .map((v) => (
                    <option key={`truck-${v.id}`} value={`truck:${v.id}`}>
                      {v.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Rơ-moóc">
                {vehicles
                  .filter((v) => v.kind === "trailer")
                  .map((v) => (
                    <option key={`trailer-${v.id}`} value={`trailer:${v.id}`}>
                      {v.label}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
          <div className="ttp-field">
            <label>Vị trí lắp</label>
            <PositionPicker value={positionText} labels={positionLabels} onChange={setPositionText} onManage={onManagePositions} />
          </div>
          {(positionTaken || error) && (
            <div className="ttp-field ttp-field--serial">
              {positionTaken && target && <div className="ttp-position-error">Vị trí này trên {target.label} đã có lốp.</div>}
              {error && <div className="ttp-position-error">{error}</div>}
            </div>
          )}
        </div>

        <div className="ttp-dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void confirm();
            }}
            disabled={saving || !target || positionTaken}
          >
            {saving ? "Đang xử lý…" : "Chuyển lốp"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only table of disposed (thanh lý) tires — kept for traceability. */
