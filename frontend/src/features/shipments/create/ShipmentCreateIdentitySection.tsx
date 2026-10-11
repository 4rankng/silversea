import type { RefObject } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  USearchableField as SearchableField,
  USelectField as SelectField,
  UTextField as TextField,
} from './uui-fields';
import { ShipmentCreateSection } from './ShipmentCreateSections';
import { ShipmentReferenceConflictWarning } from './ShipmentReferenceConflictWarning';
import { formatVnMoney, type ShipmentCreateFormState } from './shipment-create-model';
import type { ShipmentReferenceConflict } from '../../../api/shipmentDuplicateClient';

type FormState = ShipmentCreateFormState;

export interface ShipmentCreateIdentitySectionProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  selectCustomer: (value: string) => void;
  customerOptions: { value: string; label: string }[];
  shippingLineOptions: { value: string; label: string }[];
  customerCustomText?: (text: string) => void;
  saving: boolean;
  issueByField: Map<string, string>;
  billConflict?: ShipmentReferenceConflict | null;
  bookingConflict?: ShipmentReferenceConflict | null;
  declarationConflict?: ShipmentReferenceConflict | null;
  getDeclarationConflict?: (value: string) => ShipmentReferenceConflict | undefined;
  customerAddButtonRef: RefObject<HTMLButtonElement | null>;
  shippingLineAddButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenCustomerDialog: () => void;
  onOpenShippingLineDialog: () => void;
}

export function ShipmentCreateIdentitySection({
  form,
  update,
  selectCustomer,
  customerOptions,
  shippingLineOptions,
  customerCustomText,
  saving,
  issueByField,
  billConflict,
  bookingConflict,
  declarationConflict,
  getDeclarationConflict,
  customerAddButtonRef,
  shippingLineAddButtonRef,
  onOpenCustomerDialog,
  onOpenShippingLineDialog,
}: ShipmentCreateIdentitySectionProps) {
  const declarationList = form.declarationNumbers && form.declarationNumbers.length > 0
    ? form.declarationNumbers
    : [form.declarationNumber || ''];
  return (
    <ShipmentCreateSection
      id="identity"
      title="Nhận diện lô"
      description="Khách hàng, chứng từ và hướng xuất nhập khẩu."
    >
      {/* BAND 1 — identity. Three single fields share a row; nothing tall
          rides with them. */}
      <div className="csc-identity-grid">
        <div
          className="csc-identity-grid__customer csc-field-with-append"
          data-field="shipment-customer"
          data-field-id="shipment-customer"
        >
          <SearchableField
            id="shipment-customer"
            label="Khách hàng"
            required
            value={form.customerId}
            onChange={selectCustomer}
            allowsCustomValue={form.isAdHoc}
            options={customerOptions}
            placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên mới' : 'Gõ để tìm kiếm'}
            disabled={saving}
            error={issueByField.get('shipment-customer')}
            className="csc-customer-field"
            popoverClassName="csc-customer-popover"
            optionClassName="csc-customer-option"
            searchable
            {...(form.isAdHoc && customerCustomText ? { onCustomValue: customerCustomText } : {})}
          />
          <button
            ref={customerAddButtonRef as RefObject<HTMLButtonElement>}
            type="button"
            onClick={onOpenCustomerDialog}
            disabled={saving}
            className="csc-utility-button csc-utility-button--dashed csc-append-button"
          >
            <Plus size={15} aria-hidden="true" />Thêm khách hàng
          </button>
        </div>

        <div className="csc-identity-grid__trade-direction" data-field-id="shipment-trade-direction">
          <SelectField
            id="shipment-trade-direction"
            label="Hình thức xuất nhập khẩu"
            required
            value={form.tradeDirection}
            onChange={(event) => update('tradeDirection', event.target.value as FormState['tradeDirection'])}
            disabled={saving}
            error={issueByField.get('shipment-trade-direction')}
            options={[
              { value: '', label: '— Chọn hình thức —' },
              { value: 'IMPORT', label: 'Nhập khẩu' },
              { value: 'EXPORT', label: 'Xuất khẩu' },
            ]}
          />
        </div>

        <div className="csc-identity-grid__booking" data-field-id="shipment-booking-ref">
          <TextField
            id="shipment-booking-ref"
            label="Số Bill/Booking"
            required
            value={form.tradeDirection === 'IMPORT' ? form.blNumber : form.bookingRef}
            onChange={(event) => update(form.tradeDirection === 'IMPORT' ? 'blNumber' : 'bookingRef', event.target.value)}
            maxLength={100}
            placeholder={form.tradeDirection === 'IMPORT' ? 'Nhập số Bill (hàng Nhập)' : form.tradeDirection === 'EXPORT' ? 'Nhập số Booking (hàng Xuất)' : 'Chọn Nhập hoặc Xuất'}
            disabled={!form.tradeDirection || saving}
            hint={!form.tradeDirection ? 'Chọn Hình thức xuất nhập khẩu trước' : undefined}
            error={issueByField.get('shipment-booking-ref')}
            warning={
              (form.tradeDirection === 'IMPORT' ? billConflict : bookingConflict) ? (
                <ShipmentReferenceConflictWarning
                  conflict={(form.tradeDirection === 'IMPORT' ? billConflict : bookingConflict)!}
                  fieldLabel={form.tradeDirection === 'IMPORT' ? 'Số Bill' : 'Số Booking'}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      {/* BAND 2 — carrier + the two flags, so a one-row field never shares a
          grid row with the 1-to-N declaration list below. */}
      <div className="csc-identity-grid">
        {form.cargoMode === 'FCL' && (
          <div
            className="csc-identity-grid__shipping-line csc-field-with-append"
            data-field-id="shipment-shipping-line"
          >
            <SearchableField
              id="shipment-shipping-line"
              label="Hãng tàu"
              value={form.shippingLineName}
              onChange={(value) => update('shippingLineName', value)}
              allowsCustomValue
              options={shippingLineOptions}
              placeholder="Gõ chọn hoặc nhập hãng tàu"
              disabled={saving}
              error={issueByField.get('shipment-shipping-line')}
              searchable
            />
            <button
              ref={shippingLineAddButtonRef as RefObject<HTMLButtonElement>}
              type="button"
              onClick={onOpenShippingLineDialog}
              disabled={saving}
              className="csc-utility-button csc-utility-button--dashed csc-append-button"
            >
              <Plus size={15} aria-hidden="true" />Thêm hãng tàu
            </button>
          </div>
        )}

        <div
          className={`csc-identity-grid__flags${form.cargoMode === 'FCL' ? '' : ' csc-identity-grid__flags--solo'}`}
          data-field-id="shipment-deposit"
        >
          {/* All three boolean flags share the ONE .csc-flag-checkbox chip
              treatment and now live on one band: the ad-hoc lot toggle sits
              with its peers instead of riding the section header as a lone
              heavy box (density pass, owner 11/10). DOM order keeps the flag
              contract: Lệnh chạy ngoài → Có cược container → Đóng kết hợp. */}
          <label className="csc-flag-checkbox" data-field-id="shipment-is-adhoc">
            <input
              type="checkbox"
              checked={form.isAdHoc}
              onChange={(event) => update('isAdHoc', event.target.checked)}
              disabled={saving}
            />
            <span>Lệnh chạy ngoài</span>
          </label>
          <label className="csc-flag-checkbox" data-field-id="shipment-has-deposit">
            <input
              type="checkbox"
              checked={form.hasDeposit}
              onChange={(event) => update('hasDeposit', event.target.checked)}
              disabled={saving}
            />
            <span><strong>Có cược container</strong></span>
          </label>
          {form.hasDeposit && (
            <div className="csc-deposit-amount" data-field-id="shipment-deposit-amount">
              <TextField
                id="shipment-deposit-amount"
                label="Tiền cược dự kiến"
                value={form.depositAmount}
                onChange={(event) => update('depositAmount', formatVnMoney(event.target.value))}
                maxLength={15}
                placeholder="Ví dụ: 5.000.000"
                disabled={saving}
              />
            </div>
          )}
        </div>
      </div>

      {/* BAND 3 — declaration repeater. Full width, compact rows: the code is a
          short identifier, so it takes a content-sized track and the row's
          remaining width carries the per-declaration duplicate warning. The
          group legend is the label; every row control keeps its own accessible
          name ("Số tờ khai", "Số tờ khai 2", …). */}
      <div className="csc-declaration-ledger" data-field-id="shipment-declarations">
        <div className="csc-declaration-ledger__head">
          <span className="csc-declaration-ledger__title">Số tờ khai</span>
          <span className="csc-declaration-ledger__count">{declarationList.length}</span>
        </div>
        <ul className="csc-declaration-list" role="list">
          {declarationList.map((decl, index) => {
            const conflict = getDeclarationConflict
              ? getDeclarationConflict(decl)
              : (index === 0 ? declarationConflict : undefined);
            return (
              <li key={index} className="csc-declaration-row">
                <span className="csc-declaration-row__index" aria-hidden="true">{index + 1}</span>
                <div className="csc-declaration-row__field">
                  <TextField
                    label={index === 0 ? 'Số tờ khai' : `Số tờ khai ${index + 1}`}
                    hideLabel
                    value={decl}
                    onChange={(event) => {
                      const next = [...declarationList];
                      next[index] = event.target.value;
                      update('declarationNumbers', next);
                    }}
                    maxLength={50}
                    disabled={saving}
                    placeholder={index === 0 ? 'Số tờ khai' : `Số tờ khai ${index + 1}`}
                    warning={
                      conflict ? (
                        <ShipmentReferenceConflictWarning conflict={conflict} fieldLabel="Số tờ khai" />
                      ) : undefined
                    }
                  />
                </div>
                {declarationList.length > 1 && (
                  <button
                    type="button"
                    className="csc-icon-button csc-icon-button--danger csc-declaration-row__remove"
                    aria-label={`Xóa tờ khai ${index + 1}`}
                    onClick={() => {
                      const next = declarationList.filter((_, i) => i !== index);
                      update('declarationNumbers', next.length > 0 ? next : ['']);
                    }}
                    disabled={saving}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            update('declarationNumbers', [...declarationList, '']);
          }}
          disabled={saving}
          className="csc-utility-button csc-utility-button--dashed csc-declaration-list__add"
        >
          <Plus size={15} aria-hidden="true" />Thêm tờ khai
        </button>
      </div>
    </ShipmentCreateSection>
  );
}
