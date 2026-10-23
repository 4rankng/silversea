// Card 191026181942 (DV3) — the LCL field-set of the "Phân bổ nhà xe" shell.
//
// The popover used to open the CONT allocation body (container 20'/40' counts
// per carrier per day) for EVERY lot — on an LCL lot that is nonsense
// business: a hàng lẻ owns no container, so the demand read 0/0 and the only
// editable numbers could never mean anything. ONE shell now selects the
// field-set by cargoMode (see DispatchAllocationPopover): FCL keeps the cont
// body untouched; this module owns the LCL body.
//
// LCL contract (lclspec — the "Gán xe nhóm" popup's own law, labels reused
// verbatim): the lot's allocation facts are its LOẠI XE TÍNH CƯỚC TRẢ ĐV, its
// NHÀ XE and its BKS pair. Of those, the pair a dispatcher may rewrite from a
// SINGLE lot is the BKS pair — `updateLclTruck` (POST /shipments/lcl/truck),
// the exact write "Đổi BKS nhóm" owns, which propagates BKS thực to the whole
// COST group and stamps the lot's "phân bổ xe" channel. Loại xe and nhà xe of
// hàng lẻ are GROUP facts (FB-090/161026232309): they are set by "Gán xe nhóm"
// (≥2 lô, same screen) or per-lot in Kế hoạch Chi tiết — the dialog states
// them as facts with that routing hint instead of offering dead editors.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listDispatchFleetResources,
  updateLclTruck,
} from '../../../api/dispatchPlanningClient';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { CloseButton } from '../../../components/untitled-ui/base/buttons/close-button';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { QuickAddButton } from '../../../components/shared/QuickAddButton';
import { useToast } from '../../../components/shared/Toast';
import { Modal } from '../../../design-system/Modal';
import { billBookingReference } from '../../../lib/business-reference';
import { QuickAddVehicleDialog } from '../detailed-plan/QuickAddVehicleDialog';
import { USearchableField } from '../../shipments/create/uui-searchable-field';
import { useCarrierAllocationOptions } from './useCarrierAllocationOptions';
import './DispatchAllocationPopover.css';

export interface DispatchAllocationLclDialogProps {
  shipment: ShipmentListItem;
  onClose: () => void;
  /** Called with the BKS-refreshed row after a successful save. */
  onSaved: (updated: ShipmentListItem) => void;
}

/** The lot's stored cost class as one label — name over code, '—' when unset. */
function costClassLabel(shipment: ShipmentListItem): string {
  const name = shipment.costVehicleClassName?.trim() || null;
  const code = shipment.costVehicleClassCode?.trim() || null;
  if (name && code && name !== code) return `${name} · ${code}`;
  return name ?? code ?? '—';
}

/** The lot's planned nhà xe — the carrier summary the backend projects
 * (LCL entries ride it with zero containers, card 191026181942). */
function carrierLabel(shipment: ShipmentListItem): string {
  return shipment.carrierAllocationSummary.map((entry) => entry.carrierLabel).join(', ') || '—';
}

export function DispatchAllocationLclDialog({ shipment, onClose, onSaved }: DispatchAllocationLclDialogProps) {
  const { toast } = useToast();
  const [actualTruckNo, setActualTruckNo] = useState(shipment.actualTruckNo ?? '');
  const [billingTruckNo, setBillingTruckNo] = useState(shipment.billingTruckNo ?? '');
  // Ref, not state (AssignTruckGroupDialog/Đổi BKS nhóm law): the flag only
  // gates the auto-copy effect, and a stored "BKS báo khách" must read as
  // hand-edited so a reopen never clobbers it with BKS thực.
  const billingTouchedRef = useRef(Boolean(shipment.billingTruckNo?.trim()));
  const [plateOptions, setPlateOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FB-066 lần 3 (card 201026101600, QA R27) — quick-add a plate straight
  // from the "BKS thực" picker, the affordance the Gán xe nhóm / Đổi BKS
  // nhóm dialogs already own (22c9c80b). The nonce re-runs the fleet fetch
  // so a just-registered plate joins the option list; the interim list keeps
  // it selectable before the refetch lands (sibling law).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddSeed, setQuickAddSeed] = useState('');
  const [fleetNonce, setFleetNonce] = useState(0);
  const [interimPlates, setInterimPlates] = useState<string[]>([]);

  // BKS is a SELECTOR over the fleet of the nhà xe already planned on the lot
  // (round-19 law); a lot without one keeps free text — "BKS gõ tay" is the
  // card's own escape. A failed load degrades to free text, never a dead field.
  const plannedCarrier = shipment.carrierAllocationSummary[0];
  useEffect(() => {
    let cancelled = false;
    const request = plannedCarrier?.carrierType === 'EXTERNAL' && plannedCarrier.externalCarrierId != null
      ? listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId: plannedCarrier.externalCarrierId, limit: 50 })
      : plannedCarrier?.carrierType === 'OWN'
        ? listDispatchFleetResources('TRUCK', { limit: 50 })
        : null;
    if (!request) {
      setPlateOptions([]);
      return undefined;
    }
    request.then((response) => {
      if (cancelled) return;
      const plates = (response.items as Array<{ licensePlate?: string | null }>)
        .map((item) => item.licensePlate?.trim())
        .filter((plate): plate is string => Boolean(plate));
      setPlateOptions([...new Set(plates)].map((plate) => ({ value: plate, label: plate })));
    }).catch(() => { if (!cancelled) setPlateOptions([]); });
    return () => { cancelled = true; };
  }, [plannedCarrier?.carrierType, plannedCarrier?.externalCarrierId, fleetNonce]);

  // The created plate rides the picker immediately (before the refetch lands
  // it) — deduped against the fetched list, keyed by the plate itself.
  const plateChoices = useMemo(() => {
    const seen = new Set<string>();
    const merged: Array<{ value: string; label: string }> = [];
    for (const plate of [...interimPlates, ...plateOptions.map((option) => option.value)]) {
      if (!plate || seen.has(plate)) continue;
      seen.add(plate);
      merged.push({ value: plate, label: plate });
    }
    return merged;
  }, [interimPlates, plateOptions]);

  // FB-066 lần 3 — the quick-add registration target: the lot's planned nhà
  // xe (OWN → the internal truck catalog, EXTERNAL → that nhà xe's Xe ngoài
  // list). A lot WITHOUT one makes the dialog ask ("hãng/nhà xe nếu cần")
  // over the house carrier set — never a silent wrong-target registration.
  const { options: carrierCatalog } = useCarrierAllocationOptions();
  const quickAddCarrierId = plannedCarrier?.carrierType === 'EXTERNAL' ? plannedCarrier.externalCarrierId ?? null : null;
  const quickAddCarrierName = plannedCarrier?.carrierType === 'OWN'
    ? 'SilverSea — xe nội bộ'
    : plannedCarrier?.carrierLabel ?? '';
  const quickAddCarrierChoices = useMemo(
    () => (plannedCarrier
      ? undefined
      : carrierCatalog.map((option) => ({ carrierId: option.externalCarrierId ?? null, label: option.label }))),
    [plannedCarrier, carrierCatalog],
  );

  const handleVehicleCreated = (_vehicleId: number, licensePlate: string) => {
    // "chọn ngay vào ô" — the new plate lands in BKS thực (the untouched
    // BKS ảo auto-copy effect follows it), the allocation dialog NEVER
    // closes, and its draft state (nhà xe facts, typed fields) survives.
    setActualTruckNo(licensePlate);
    setInterimPlates((prev) => [...prev, licensePlate]);
    setFleetNonce((nonce) => nonce + 1);
    setQuickAddOpen(false);
  };

  // Auto-copy: BKS báo khách follows BKS thực until the operator edits it by
  // hand (lclspec "auto-copy từ thực tế").
  useEffect(() => {
    if (!billingTouchedRef.current) setBillingTruckNo(actualTruckNo.trim());
  }, [actualTruckNo]);

  async function save() {
    if (saving) return;
    setError(null);
    const actual = actualTruckNo.trim();
    if (!actual) {
      setError('Nhập BKS thực của xe chạy chuyến');
      return;
    }
    const billing = billingTouchedRef.current ? billingTruckNo.trim() : '';
    setSaving(true);
    try {
      await updateLclTruck({
        shipmentId: shipment.id,
        actualTruckNo: actual,
        // A billing equal to (or copied from) the actual plate stays off the
        // payload — the server already treats copy-from-actual as the default
        // (same wire shape as Đổi BKS nhóm / Gán xe nhóm). FB-141 sweep: a
        // TOUCHED-but-blank ảo field sends `null` — an explicit clear back to
        // the "lấy BKS thực" default — instead of omitting the field and
        // leaving the stored ảo value orphaned in the DB.
        ...(billing && billing !== actual
          ? { billingTruckNo: billing }
          : billingTouchedRef.current && !billing
            ? { billingTruckNo: null }
            : {}),
      });
      toast({
        kind: 'success',
        message: `Đã lưu BKS lô lẻ ${billBookingReference(shipment.blNumber, shipment.bookingRef)} — BKS thực ${actual}`,
      });
      onSaved({
        ...shipment,
        actualTruckNo: actual,
        // Cleared ảo reads back as the actual plate (the fallback the server
        // now holds after the explicit null).
        billingTruckNo: billing && billing !== actual ? billing : actual,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Không lưu được BKS. Vui lòng thử lại.');
      setSaving(false);
    }
  }

  const saveDisabledReason = saving
    ? 'Đang lưu phân bổ…'
    : null;

  return (
    <Modal
      chrome="bare"
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title="Phân bổ nhà xe"
      ariaLabel="Phân bổ nhà xe"
      ariaDescribedBy="dispatch-allocation-description"
      backdropDismiss
    >
      <div className="dispatch-allocation-popover">
        <div className="dispatch-allocation-popover__header">
          <div className="dispatch-allocation-popover__heading">
            <p className="dispatch-allocation-popover__eyebrow">Kế hoạch tổng quát</p>
            <h3 id="dispatch-allocation-title">Phân bổ nhà xe</h3>
            <div className="dispatch-allocation-popover__shipment">
              <strong>{billBookingReference(shipment.blNumber, shipment.bookingRef)}</strong>
              <span>{shipment.customerName ?? 'Chưa có tên khách hàng'}</span>
            </div>
          </div>
          <CloseButton size="xs" label="Đóng" slot={null} onPress={() => { if (!saving) onClose(); }} />
        </div>
        <p id="dispatch-allocation-description" className="dispatch-allocation-popover__description">
          Lô hàng lẻ — không phân bổ container. Điều vận ghi trực tiếp cặp BKS chạy chuyến.
        </p>

        <section aria-labelledby="dispatch-allocation-lcl-facts-title" className="dispatch-allocation-popover__summary">
          <div className="dispatch-allocation-popover__summary-heading">
            <div>
              <h4 id="dispatch-allocation-lcl-facts-title">Phân bổ hàng lẻ hiện tại</h4>
              <p className="dispatch-allocation-popover__summary-subtitle">
                Loại xe và nhà xe của hàng lẻ thuộc nhóm ghép — đổi qua “Gán xe nhóm” (chọn ≥2 lô) hoặc Kế hoạch Chi tiết.
              </p>
            </div>
          </div>
          <dl className="dispatch-allocation-lcl__facts">
            <div className="dispatch-allocation-lcl__fact">
              <dt>Loại xe tính cước trả ĐV</dt>
              <dd>{costClassLabel(shipment)}</dd>
            </div>
            <div className="dispatch-allocation-lcl__fact">
              <dt>Nhà xe</dt>
              <dd>{carrierLabel(shipment)}</dd>
            </div>
          </dl>
        </section>

        <div className="dispatch-allocation-lcl__fields">
          {/* FB-066 lần 3 (card 201026101600, QA R27) — the "BKS thực" picker
              carries the "+ Thêm nhanh" quick-add the Gán xe nhóm / Đổi BKS
              nhóm dialogs already own, PLUS the dropdown "Thêm mới: <số>"
              option for an unregistered typed plate (both affordances, owner
              scope). The label lives in the head row (a <label> may wrap
              exactly one labelable control — card 101026163010). */}
          <div className="dispatch-allocation-lcl__field">
            <div className="dispatch-allocation-lcl__field-head">
              <span className="dispatch-allocation-lcl__label">BKS thực (xe chạy chuyến) <span aria-hidden="true">*</span></span>
              <QuickAddButton
                onClick={() => { setQuickAddSeed(''); setQuickAddOpen(true); }}
                disabled={saving}
              >
                Thêm nhanh
              </QuickAddButton>
            </div>
            <USearchableField
              label="BKS thực (xe chạy chuyến)"
              hideLabel
              value={actualTruckNo}
              onChange={setActualTruckNo}
              onCustomValue={setActualTruckNo}
              options={plateChoices}
              placeholder={plannedCarrier ? 'Chọn BKS của nhà xe hoặc gõ mới' : 'Gõ BKS xe chạy chuyến'}
              searchable
              allowsCustomValue
              required
              disabled={saving}
              createOption={{
                label: (typed) => (typed.trim() ? `Thêm mới: ${typed.trim()}` : 'Thêm mới'),
                onSelect: (typed) => {
                  setQuickAddSeed(typed.trim());
                  setQuickAddOpen(true);
                },
              }}
            />
          </div>
          <USearchableField
            label="BKS báo khách (ảo)"
            value={billingTruckNo}
            onChange={(next) => { billingTouchedRef.current = true; setBillingTruckNo(next); }}
            onCustomValue={(text) => { billingTouchedRef.current = true; setBillingTruckNo(text); }}
            options={plateChoices}
            placeholder={actualTruckNo ? actualTruckNo : 'Trống = tự động dùng BKS thực'}
            searchable
            allowsCustomValue
            disabled={saving}
            hint="Debit Note (FB-094) sẽ in BKS này, tuyệt đối không in BKS thực. Mặc định dùng BKS thực tế nếu để trống."
          />
        </div>

        {error && (
          <div className="dispatch-allocation-popover__notice is-error" role="alert">{error}</div>
        )}

        <div className="dispatch-allocation-popover__actions">
          <DisabledActionTip id="dispatch-allocation-lcl-cancel" reason={saving ? 'Đang lưu phân bổ — chưa hủy được.' : null}>
            <UUIButton
              size="sm"
              color="secondary"
              aria-disabled={saving || undefined}
              onPress={() => { if (saving) return; onClose(); }}
            >
              Hủy
            </UUIButton>
          </DisabledActionTip>
          <DisabledActionTip id="dispatch-allocation-lcl-save" reason={saveDisabledReason}>
            <UUIButton
              size="sm"
              color="primary"
              className="dispatch-allocation-popover__save"
              onPress={() => { void save(); }}
              aria-disabled={saving || undefined}
              isLoading={saving}
            >
              {saving ? 'Đang lưu…' : 'Lưu phân bổ'}
            </UUIButton>
          </DisabledActionTip>
        </div>
      </div>
      {/* FB-066 lần 3 — the quick-add rides as a nested dialog so the
          allocation draft (facts, typed BKS, open menus) never leaves; only
          the quick-add surface closes on create. */}
      <QuickAddVehicleDialog
        isOpen={quickAddOpen}
        carrierId={quickAddCarrierId}
        carrierName={quickAddCarrierName}
        initialPlate={quickAddSeed}
        carrierChoices={quickAddCarrierChoices}
        onClose={() => setQuickAddOpen(false)}
        onCreated={handleVehicleCreated}
      />
    </Modal>
  );
}
