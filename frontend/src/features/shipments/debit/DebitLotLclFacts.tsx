// FB-093 — LCL lot facts strip on Chi phí - Quyết toán's expanded lot detail:
// THÔNG SỐ CONTAINER ("Lô lẻ | Thu: Xe 3.5T | Trả: Xe 10T"), PHÂN XE with the
// two-plate quick edit (BKS thực / BKS báo khách (Ảo) — combobox + free text,
// the truck being the cost group's shared identity) and the member's
// "Ghép cước cùng Bill X" note. FB-095 adds Hủy ghép (auto-promotes Lô 2 when
// the departing lot is the principal).
//
// UI provenance: Untitled UI PRO v8 base `button` + `select`/`combobox` via
// USearchableField — vendored at components/untitled-ui.
import { useEffect, useMemo, useState } from 'react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { updateLclTruck } from '../../../api/dispatchPlanningClient';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

export interface DebitLotLclFactsProps {
  row: ShipmentDebitLotRow;
  /** BKS suggestions — the internal fleet plus every carrier-fleet plate. */
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
  onChanged: () => void;
}

export function DebitLotLclFacts({ row, plateOptions, onChanged }: DebitLotLclFactsProps) {
  const { toast } = useToast();
  const [actual, setActual] = useState(row.actualTruckNo ?? '');
  const [billing, setBilling] = useState(row.billingTruckNo ?? '');
  const [savingTruck, setSavingTruck] = useState(false);

  useEffect(() => {
    setActual(row.actualTruckNo ?? '');
    setBilling(row.billingTruckNo ?? '');
  }, [row.shipmentId, row.actualTruckNo, row.billingTruckNo]);

  const truckDirty = useMemo(
    () => actual.trim() !== (row.actualTruckNo ?? '') || billing.trim() !== (row.billingTruckNo ?? ''),
    [actual, billing, row.actualTruckNo, row.billingTruckNo],
  );

  async function saveTruck() {
    setSavingTruck(true);
    try {
      await updateLclTruck({
        shipmentId: row.shipmentId,
        ...(actual.trim() !== (row.actualTruckNo ?? '') ? { actualTruckNo: actual.trim() } : {}),
        ...(billing.trim() !== (row.billingTruckNo ?? '') ? { billingTruckNo: billing.trim() } : {}),
      });
      toast({ kind: 'success', message: 'Đã cập nhật BKS của nhóm xe' });
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Cập nhật BKS thất bại' });
    } finally {
      setSavingTruck(false);
    }
  }

  const params: string[] = [];
  if (row.cargoMode === 'LCL') {
    params.push('Lô lẻ');
    if (row.revVehicleClassCode) params.push(`Thu: Xe ${row.revVehicleClassCode}`);
    if (row.costVehicleClassCode) params.push(`Trả: Xe ${row.costVehicleClassCode}`);
  }

  return (
    <div className="debit-lot-lcl-facts">
      <div className="debit-lot-lcl-facts__block">
        <small>THÔNG SỐ CONTAINER</small>
        <span>{params.length > 0 ? params.join(' | ') : '—'}</span>
      </div>
      <div className="debit-lot-lcl-facts__block">
        <small>PHÂN XE</small>
        <div className="debit-lot-lcl-facts__truck">
          <USearchableField
            label="Nhà xe - BKS thực"
            value={actual}
            onChange={setActual}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setActual}
            hideLabel={false}
          />
          <USearchableField
            label="BKS báo khách (Ảo)"
            value={billing}
            onChange={setBilling}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setBilling}
          />
          <UUIButton
            size="sm"
            color="secondary"
            onPress={() => void saveTruck()}
            isDisabled={!truckDirty || savingTruck}
          >
            {savingTruck ? 'Đang lưu…' : 'Lưu BKS'}
          </UUIButton>
        </div>
        {row.billingTruckNo && row.actualTruckNo && row.billingTruckNo !== row.actualTruckNo && (
          <span className="debit-lot-lcl-facts__billing-warn" title="Debit Note in BKS báo khách, không in BKS thực">
            Báo khách (Ảo): {row.billingTruckNo} — khác BKS thực
          </span>
        )}
      </div>
      {(row.costGroupId != null || row.revGroupId != null) && (
        <div className="debit-lot-lcl-facts__block">
          <small>NHÓM GHÉP</small>
          <span className="debit-lot-lcl-facts__groups">
            {row.costGroupId != null && (
              <>
                <span>Trả ĐV: Ghép ({row.costGroupOrder ?? '?'}/{row.costGroupMemberCount ?? '?'})</span>
                {row.costGroupPrincipalRef && <em>Ghép cùng Bill {row.costGroupPrincipalRef}</em>}
              </>
            )}
            {row.revGroupId != null && (
              <>
                <span>Thu khách: Ghép ({row.revGroupOrder ?? '?'}/{row.revGroupMemberCount ?? '?'})</span>
                {row.revGroupPrincipalRef && <em>Ghép cước cùng Bill {row.revGroupPrincipalRef}</em>}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
