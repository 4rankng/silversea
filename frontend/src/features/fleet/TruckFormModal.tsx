import { useState, useEffect } from "react";
import { Save, X, Loader2, Truck, Tag, Factory, Weight, Fuel, Calendar, FileText } from "lucide-react";
import { Modal } from "../../components/UI";
import { Input } from "../../components/untitled-ui/base/input/input";
import { TextArea } from "../../components/untitled-ui/base/textarea/textarea";
import { EntityFormSection, UnitInput, DateField, RequiredHint } from "../../components/shared/EntityFormParts";
import { UuiSelectField } from "../../design-system/forms/UuiSelectField";
import { SearchableSelect } from "../../design-system";
import { TrailerType } from "@tingting/shared";
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
  carrierOptions = [],
  trailerOptions = [],
}: {
  saving: boolean;
  item?: TruckType;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  isOpen: boolean;
  /** Nhà xe catalog (EXTERNAL_CARRIER fleet list) — the owning-carrier picker. */
  carrierOptions?: Array<{ id: number; name: string }>;
  trailerOptions?: Array<{ id: number; licensePlate: string; type: string | null; coupledToPlate: string | null }>;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || "");
  // '' = chưa phân (saves explicit null = UNASSIGN per the carrier-link
  // contract); a numeric string saves that carrier id.
  const [carrierId, setCarrierId] = useState(item?.carrierId != null ? String(item.carrierId) : "");
  // Only send the coupling when the operator touched the picker — an
  // untouched edit must not resend a possibly-stale link (the coupled
  // trailer may have been deleted or gone inactive since load, which would
  // 400 an otherwise-unrelated save).
  const [currentTrailerId, setCurrentTrailerId] = useState(item?.currentTrailerId != null ? String(item.currentTrailerId) : "");
  const [trailerTouched, setTrailerTouched] = useState(false);
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
      setCarrierId(item?.carrierId != null ? String(item.carrierId) : "");
      setCurrentTrailerId(item?.currentTrailerId != null ? String(item.currentTrailerId) : "");
      setTrailerTouched(false);
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
      carrierId: carrierId === "" ? null : Number(carrierId),
      ...(trailerTouched ? { currentTrailerId: currentTrailerId === "" ? null : Number(currentTrailerId) } : {}),
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
      ariaLabel={item ? `Sửa xe đầu kéo ${item.licensePlate}` : "Thêm xe đầu kéo"}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={920}
      footer={
        <>
          <RequiredHint />
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
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <EntityFormSection icon={Truck} label="Thông tin xe">
          <Input
            label="Biển số xe đầu kéo"
            isRequired
            icon={Truck}
            value={plate}
            onChange={setPlate}
            placeholder="Ví dụ: 60C-12345"
            autoFocus
            inputClassName="uppercase tabular-nums"
          />
          <Input
            label="Loại hình xe"
            icon={Tag}
            value={vehicleClass}
            onChange={setVehicleClass}
            placeholder="Loại hình xe"
          />
          <UuiSelectField
            label="Nhà xe"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
            options={[
              { value: '', label: '— Chưa phân —' },
              ...carrierOptions.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
          {/*
            Rơ-moóc coupling — the assignment path the trailer form's guidance
            promises. Searchable by plate; each option shows the type and the
            trailer's CURRENT truck so a transfer is visible before it's made
            (the service auto-clears the old truck's link on save).
          */}
          <div>
            <label id="truck-trailer-label" className="text-xs font-medium text-foreground/70">Rơ-moóc đang ghép</label>
            <SearchableSelect
              id="truck-trailer-select"
              value={currentTrailerId}
              onChange={(v) => { setTrailerTouched(true); setCurrentTrailerId(v); }}
              options={[
                { value: '', label: '— Chưa ghép —', searchText: 'chưa ghép' },
                ...(trailerOptions ?? []).map((t) => ({
                  value: String(t.id),
                  label: `${t.licensePlate} · ${t.type ? (t.type === TrailerType.FT40 ? '40FT' : t.type === TrailerType.FT20 ? '20FT' : t.type) : 'Chưa rõ loại'}${t.coupledToPlate ? ` · đang ghép ${t.coupledToPlate}` : ''}`,
                  searchText: `${t.licensePlate} ${t.type ?? ''} ${t.coupledToPlate ?? ''}`,
                })),
              ]}
              placeholder="Chọn rơ-moóc"
              searchPlaceholder="Tìm biển số rơ-moóc"
            />
          </div>
          <Input
            label="Hãng xe"
            icon={Factory}
            value={brand}
            onChange={setBrand}
            placeholder="Hãng xe"
          />
          <UnitInput
            label="Trọng tải kéo"
            unit="tấn"
            icon={Weight}
            value={String(towCapacityTons)}
            onChange={setTowCapacityTons}
            min={0}
            placeholder="0"
          />
          <UnitInput
            label="Mức dầu có hàng"
            unit="L/100km"
            icon={Fuel}
            value={String(fuelLPer100kmLoaded)}
            onChange={setFuelLPer100kmLoaded}
            min={0}
            placeholder="0"
            padClassName="pr-20"
          />
          <UnitInput
            label="Mức dầu không hàng"
            unit="L/100km"
            icon={Fuel}
            value={String(fuelLPer100kmEmpty)}
            onChange={setFuelLPer100kmEmpty}
            min={0}
            placeholder="0"
            padClassName="pr-20"
          />
        </EntityFormSection>

        <EntityFormSection icon={Calendar} label="Lịch bảo trì">
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
        </EntityFormSection>

        <EntityFormSection icon={FileText} label="Ghi chú">
          <div className="col-span-full">
            <TextArea
              value={note}
              onChange={setNote}
              placeholder="Ghi chú"
              rows={2}
            />
          </div>
        </EntityFormSection>
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
    <DateField
      id={id}
      label={label}
      labelSuffix={badgeText ? (
        <span className={`truck-alert-badge truck-alert-badge--${alert!.status}`}>
          {badgeText}
        </span>
      ) : undefined}
      value={value}
      onChange={onChange}
    />
  );
}
