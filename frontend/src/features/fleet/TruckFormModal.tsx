import { useState, useEffect } from "react";
import { Save, X, Loader2 } from "lucide-react";
import { Modal } from "../../components/UI";
import { DateInput } from "../../design-system/forms/DateInput";
import {
  computeVehicleAlerts,
} from "@tingting/shared";
import type { Truck as TruckType, VehicleAlert } from "@tingting/shared";
// Own stylesheet: this modal also renders on /fleet/vehicles (dispatch
// catalogs), whose route chunk never loads the /fleet page cards that
// normally pull FleetPage.css in. Without this import the dialog ships
// unstyled outside /fleet.
import "../../pages/FleetPage.css";

export function TruckFormModal({
  saving,
  item,
  onsave,
  oncancel,
  isOpen,
}: {
  saving: boolean;
  item?: TruckType;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  isOpen: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || "");
  const [vehicleClass, setVehicleClass] = useState(item?.vehicleClass || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [towCapacityTons, setTowCapacityTons] = useState<string | number>(item?.towCapacityTons ?? "");
  const [fuelLPer100kmLoaded, setFuelLPer100kmLoaded] = useState<string | number>(item?.fuelLPer100kmLoaded ?? "");
  const [fuelLPer100kmEmpty, setFuelLPer100kmEmpty] = useState<string | number>(item?.fuelLPer100kmEmpty ?? "");
  const [nextInspectionDate, setNextInspectionDate] = useState(
    item?.nextInspectionDate ?? "",
  );
  const [insuranceExpiryDate, setInsuranceExpiryDate] = useState(
    item?.insuranceExpiryDate ?? "",
  );
  const [note, setNote] = useState(item?.note || "");

  useEffect(() => {
    if (isOpen) {
      setPlate(item?.licensePlate || "");
      setVehicleClass(item?.vehicleClass || "");
      setBrand(item?.brand || "");
      setTowCapacityTons(item?.towCapacityTons ?? "");
      setFuelLPer100kmLoaded(item?.fuelLPer100kmLoaded ?? "");
      setFuelLPer100kmEmpty(item?.fuelLPer100kmEmpty ?? "");
      setNextInspectionDate(item?.nextInspectionDate ?? "");
      setInsuranceExpiryDate(item?.insuranceExpiryDate ?? "");
      setNote(item?.note || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const alerts = computeVehicleAlerts({
    nextInspectionDate:
      (nextInspectionDate || item?.nextInspectionDate) ?? null,
    insuranceExpiryDate:
      (insuranceExpiryDate || item?.insuranceExpiryDate) ?? null,
    lastOilServiceDate: null,
  });
  const alertFor = (
    field: "nextInspectionDate" | "insuranceExpiryDate" | "lastOilServiceDate",
  ) => alerts.find((a) => a.field === field);

  const handleSave = () => {
    if (!plate.trim()) return;
    onsave({
      licensePlate: plate.trim(),
      vehicleClass: vehicleClass.trim() || undefined,
      brand: brand.trim() || undefined,
      towCapacityTons: towCapacityTons !== "" ? Number(towCapacityTons) : null,
      fuelLPer100kmLoaded: fuelLPer100kmLoaded !== "" ? Number(fuelLPer100kmLoaded) : null,
      fuelLPer100kmEmpty: fuelLPer100kmEmpty !== "" ? Number(fuelLPer100kmEmpty) : null,
      nextInspectionDate: nextInspectionDate || null,
      insuranceExpiryDate: insuranceExpiryDate || null,
      note: note.trim() || undefined,
    });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? item.licensePlate : "Thêm xe đầu kéo"}
      subtitle={item ? 'Sửa xe' : undefined}
      polished
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={920}
      footer={
        <div className="fleet-form-actions">
          <p className="modal__hint"><span className="modal__req-mark">*</span> Trường bắt buộc</p>
          <button className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button
            className="btn btn--primary btn--sm"
            disabled={saving || !plate.trim()}
            onClick={handleSave}
          >
            {saving ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Save size={14} />
            )}
            {item ? "Cập nhật" : "Thêm xe"}
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        <div className="fleet-form__grid fleet-form__grid--truck">
          <div className="field fleet-form__field fleet-form__field--wide">
            <label htmlFor="truck-plate">
              Biển số xe đầu kéo <span>*</span>
            </label>
            <input
              id="truck-plate"
              className="input"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="Ví dụ: 60C-12345"
              autoFocus
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="truck-vehicleClass">Loại hình xe</label>
            <input
              id="truck-vehicleClass"
              className="input"
              value={vehicleClass}
              onChange={(e) => setVehicleClass(e.target.value)}
              placeholder="Loại hình xe"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="truck-brand">Hãng xe</label>
            <input
              id="truck-brand"
              className="input"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Hãng xe"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="truck-towCapacityTons">Trọng tài kéo (tấn)</label>
            <input
              id="truck-towCapacityTons"
              className="input"
              type="number"
              value={towCapacityTons}
              onChange={(e) => setTowCapacityTons(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="truck-fuelLPer100kmLoaded">Mức dầu có hàng (L/100km)</label>
            <input
              id="truck-fuelLPer100kmLoaded"
              className="input"
              type="number"
              value={fuelLPer100kmLoaded}
              onChange={(e) => setFuelLPer100kmLoaded(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="truck-fuelLPer100kmEmpty">Mức dầu không hàng (L/100km)</label>
            <input
              id="truck-fuelLPer100kmEmpty"
              className="input"
              type="number"
              value={fuelLPer100kmEmpty}
              onChange={(e) => setFuelLPer100kmEmpty(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="truck-alert-fields">
          <TruckDateField
            id="truck-inspection"
            label="Hạn đăng kiểm"
            value={nextInspectionDate}
            onChange={setNextInspectionDate}
            alert={alertFor("nextInspectionDate")}
          />
          <TruckDateField
            id="truck-insurance"
            label="Hạn bảo hiểm TNDS"
            value={insuranceExpiryDate}
            onChange={setInsuranceExpiryDate}
            alert={alertFor("insuranceExpiryDate")}
          />
        </div>

        <div className="field fleet-form__field fleet-form__field--wide" style={{ marginTop: 12 }}>
          <label htmlFor="truck-note">Ghi chú</label>
          <textarea
            id="truck-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú"
            rows={2}
          />
        </div>
      </div>
    </Modal>
  );
}

/** One labelled date input with an optional overdue/due badge. */
function TruckDateField({
  id,
  label,
  value,
  onChange,
  alert,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  alert?: VehicleAlert;
}) {
  const badgeText = alert
    ? alert.daysUntil < 0
      ? `Quá hạn ${Math.abs(alert.daysUntil)} ngày`
      : `Còn ${alert.daysUntil} ngày`
    : null;
  return (
    <div className="field truck-alert-field">
      <label htmlFor={id} className="truck-alert-field__label">
        {label}
        {badgeText && (
          <span
            className={`truck-alert-badge truck-alert-badge--${alert!.status}`}
          >
            {badgeText}
          </span>
        )}
      </label>
      <DateInput id={id} className="input" value={value} onChange={onChange} />
    </div>
  );
}
