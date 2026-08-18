import React from 'react';
import { CardSection } from './CardSection';
import { FuelModeToggle } from './FuelModeToggle';
import { InputWithPrefix } from './InputWithPrefix';
import { CheckboxCard } from './CheckboxCard';
import { SectionDivider } from './SectionDivider';
import { useTripFormContext } from '../../hooks/useTripFormContext';
import { useCatalogs } from '../../hooks/useCatalogs';
import { UuiSelectField } from '../../design-system';

interface FuelTollsRevenueCardProps {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function FuelTollsRevenueCard({ collapsible, defaultCollapsed }: FuelTollsRevenueCardProps) {
  const form = useTripFormContext();
  const { data: catalogData } = useCatalogs();

  return (
    <CardSection
      number={3}
      title="Nhiên liệu, vé đường & doanh thu"
      subtitle="Định mức, chi phí đường bộ và doanh thu chuyến"
      badge="optional"
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
    >
      <div className="field" style={{ marginBottom: 8 }}>
        <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--fg-2)' }}>Chế độ tính dầu</label>
      </div>
      <FuelModeToggle value={form.fuelMode} onChange={form.setFuelMode} />

      {form.fuelMode === 'FLAT_RATE' && (
        <div className="field">
          <label>Số lít dầu khoán</label>
          <InputWithPrefix value={form.fuelLitersOverride} onChange={form.setFuelLitersOverride} placeholder="VD: 55" prefix="L" type="number" />
        </div>
      )}

      <div className="tc-form-row">
        <div className="field">
          <label>Số lít bổ sung</label>
          <InputWithPrefix value={form.fuelSupplementLiters} onChange={form.setFuelSupplementLiters} placeholder="0" prefix="L" type="number" />
        </div>
        <div className="field">
          <label>Lý do bổ sung</label>
          <input className="input" type="text" placeholder="VD: Chạy máy lạnh kéo dài" value={form.fuelSupplementReason} onChange={(e) => form.setFuelSupplementReason(e.target.value)} />
        </div>
      </div>

      <div className="tc-form-row tc-form-row--two" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Đơn giá nhiên liệu thực tế (₫/lít)</label>
          <InputWithPrefix
            value={form.fuelActualUnitPrice}
            onChange={form.setFuelActualUnitPrice}
            placeholder="Để trống = dùng giá cấu hình"
            prefix="₫"
            type="money"
            mono
          />
        </div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
            Nhập giá thực tế tại trạm nếu khác giá cấu hình. Để trống để dùng giá cấu hình hiện hành.
          </p>
        </div>
      </div>

      {form.carrierType === 'OWN' && (
        <div className="tc-form-row tc-form-row--two" style={{ marginTop: 16 }}>
          <UuiSelectField
            id="fuel-supplier-select-tolls"
            label="Nhà cung cấp nhiên liệu"
            value={form.fuelSupplierId === null || form.fuelSupplierId === undefined ? '' : String(form.fuelSupplierId)}
            onChange={(e) => form.setFuelSupplierId(e.target.value ? Number(e.target.value) : null)}
            options={[
              { value: '', label: '-- Chọn nhà cung cấp nhiên liệu --' },
              ...(catalogData?.suppliers?.filter((s) => (s as { isFuelSupplier?: boolean }).isFuelSupplier).map((s) => ({
                value: String(s.id),
                label: s.name,
              })) ?? []),
            ]}
          />
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
              Lựa chọn nhà cung cấp nhiên liệu cho chuyến này để ghi nhận công nợ.
            </p>
          </div>
        </div>
      )}

      <SectionDivider label="Vé đường bộ & doanh thu" />

      <div className="tc-form-row">
        <div className="field">
          <label>Tổng tiền đi đường</label>
          <InputWithPrefix value={form.tollsAddition} onChange={form.setTollsAddition} placeholder="2.700.000" prefix="đ" mono type="money" />
        </div>
        <div className="field">
          <label>Tiền vé (công ty) đã thanh toán</label>
          <InputWithPrefix value={form.tollsDiscount} onChange={form.setTollsDiscount} placeholder="400.000" prefix="đ" mono type="money" />
        </div>
      </div>

      <div className="tc-form-row" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Số trạm thu phí</label>
          <input className="input mono" type="number" placeholder="4" value={form.tollsStations} onChange={(e) => form.setTollsStations(e.target.value)} style={{ maxWidth: '200px' }} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 8, fontWeight: 600, display: "flex", gap: 6 }}>
        <span>Lái xe thực lĩnh:</span>
        <span className="mono" style={{ color: 'var(--brand, #10B981)' }}>
          {(() => {
            const base = Number(form.roadAllowanceBaseApplied) || 0;
            const discount = Number(form.tollsDiscount) || 0;
            const addition = Number(form.tollsAddition) || 0;
            const stations = Number(form.tollsStations) || 0;
            const perStation = form.tollPerStationApplied ?? 55000;
            const returnBonus = form.hasReturnCargo ? (form.returnCargoBonusApplied ?? 300000) : 0;
            const tongTien = addition > 0 ? (addition + returnBonus) : (base - (stations * perStation) + returnBonus);
            const salary = Number(form.driverSalary) || 0;
            const twoPoint = Number(form.twoPointDeliveryBonus) || 0;
            const shift = Number(form.vehicleShiftAllowance) || 0;
            return Math.max(0, tongTien + salary + twoPoint + shift - discount).toLocaleString("vi-VN");
          })()} đ
        </span>
      </div>

      <div className="tc-form-row" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Số ngày tính lương</label>
          <input className="input mono" type="number" placeholder="1" min="1" max="31"
            value={form.tripWageDays} onChange={(e) => form.setTripWageDays(e.target.value)} />
          <div className="tc-field-hint">
            Số ngày tính lương (mặc định = ngày đi → ngày về + 1)
          </div>
        </div>
        <div className="field">
          <label>Tiền lương lái xe</label>
          <InputWithPrefix value={form.driverSalary} onChange={form.setDriverSalary} placeholder="850.000" prefix="đ" mono type="money" />
        </div>
      </div>

      <div className="tc-form-row" style={{ marginTop: 16 }}>
        <CheckboxCard
          checked={form.hasReturnCargo}
          onChange={form.setHasReturnCargo}
          label="Chuyến về có hàng"
          description={form.returnCargoBonusApplied != null
            ? `Cộng ${form.returnCargoBonusApplied.toLocaleString('vi-VN')} đ vào tiền đi đường`
            : 'Áp dụng định mức chuyến đôi'}
          id="cb-return"
        />
      </div>

      <div className="tc-form-row tc-form-row--two" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Trả hàng 2 điểm (đ)</label>
          <InputWithPrefix value={form.twoPointDeliveryBonus} onChange={form.setTwoPointDeliveryBonus} placeholder="200.000" prefix="đ" mono type="money" />
        </div>
        <div className="field">
          <label>Lưu ca xe (đ)</label>
          <InputWithPrefix value={form.vehicleShiftAllowance} onChange={form.setVehicleShiftAllowance} placeholder="200.000" prefix="đ" mono type="money" />
        </div>
      </div>

      <div className="tc-form-row tc-form-row--two" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Doanh thu đóng/ trả hàng</label>
          <InputWithPrefix value={form.revenueEmptyReturn} onChange={form.setRevenueEmptyReturn} placeholder="4.200.000" prefix="đ" mono type="money" />
          {form.suggestedPrice !== null && (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
              Gợi ý từ bảng giá: {form.suggestedPrice.toLocaleString('vi-VN')} đ{Number(form.containerCount) > 1 ? ` × ${form.containerCount} cont = ${(form.suggestedPrice * Number(form.containerCount)).toLocaleString('vi-VN')} đ` : ''}
            </div>
          )}
        </div>
        <div className="field">
          <label>Doanh thu kết hợp</label>
          <InputWithPrefix value={form.revenueCombine} onChange={form.setRevenueCombine} placeholder="2.000.000" prefix="đ" mono type="money" />
        </div>
      </div>

      <div className="tc-form-row tc-form-row--two" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Hoa hồng khách hàng (đ)</label>
          <InputWithPrefix value={form.customerCommission} onChange={form.setCustomerCommission} placeholder="0" prefix="đ" mono type="money" />
          <div className="tc-field-hint">
            Trừ trực tiếp vào doanh thu chuyến. Mặc định 0 = không có hoa hồng.
          </div>
        </div>
      </div>
    </CardSection>
  );
}
