import { useRef, useState, type RefObject } from 'react';
import { Plus, X } from 'lucide-react';
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
  const declarations = form.declarationNumbers ?? [];
  const [declDraft, setDeclDraft] = useState('');
  const [declNotice, setDeclNotice] = useState('');
  const declInputRef = useRef<HTMLInputElement>(null);
  const conflictFor = (value: string, index: number): ShipmentReferenceConflict | undefined => (
    getDeclarationConflict
      ? getDeclarationConflict(value)
      : (index === 0 ? declarationConflict ?? undefined : undefined)
  );
  /** Commit one or many typed/pasted codes. Locally duplicate numbers are
   *  skipped, never stored twice — `form.declarationNumbers` stays a set of
   *  non-empty strings (the server-side cross-shipment conflict path is a
   *  separate concern and untouched). */
  function commitDeclarations(text: string) {
    const tokens = text.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
    const seen = new Set(declarations);
    const added: string[] = [];
    let skipped = 0;
    for (const token of tokens) {
      if (seen.has(token) || added.includes(token)) { skipped += 1; continue; }
      seen.add(token); added.push(token);
    }
    if (added.length > 0) update('declarationNumbers', [...declarations, ...added]);
    setDeclDraft('');
    setDeclNotice(
      added.length > 0
        ? (skipped > 0 ? `Đã thêm ${added.length} số, bỏ qua ${skipped} số trùng.` : `Đã thêm ${added.length} số.`)
        : (skipped > 0 ? `Bỏ qua ${skipped} số trùng.` : ''),
    );
  }
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
            className="csc-append-button"
            aria-label="Thêm khách hàng"
            title="Thêm khách hàng"
          >
            <Plus size={15} aria-hidden="true" />
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
              className="csc-append-button"
              aria-label="Thêm hãng tàu"
              title="Thêm hãng tàu"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        <div
          className={`csc-identity-grid__flags${form.cargoMode === 'FCL' ? '' : ' csc-identity-grid__flags--solo'}`}
          data-field-id="shipment-deposit"
        >
          <span className="csc-identity-grid__flags-label">Tuỳ chọn</span>
          <div className="csc-identity-grid__flags-row">
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
            <label className="csc-flag-checkbox" data-field-id="shipment-is-combined">
              <input
                type="checkbox"
                checked={form.isCombined}
                onChange={(event) => update('isCombined', event.target.checked)}
                disabled={saving}
              />
              <span><strong>Đóng kết hợp</strong></span>
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
      </div>

      {/* BAND 3 — one dense `Số tờ khai` strip: label + count pill, the codes
          as removable chips, an inline entry input and the paste hint (owner
          mock 11/10 "dense layout"). It replaces the per-declaration row list:
          a code is a short identifier, so N rows cost N form fields for no
          benefit. Every chip keeps an accessible remove name ("Xóa tờ khai N")
          and the per-code cross-shipment conflict warning still renders under
          the strip. */}
      <div className="csc-declaration-strip" data-field-id="shipment-declarations">
        <span className="csc-declaration-strip__title">Số tờ khai</span>
        <span className="csc-declaration-strip__count">{declarations.length}</span>
        <ul className="csc-declaration-chips" role="list">
          {declarations.map((value, index) => (
            <li
              key={value}
              className={`csc-declaration-chip${conflictFor(value, index) ? ' csc-declaration-chip--conflict' : ''}`}
            >
              <span className="csc-declaration-chip__index" aria-hidden="true">{index + 1}</span>
              {/* The code itself is the edit affordance: it comes back into the
                  input (and leaves the list) so a typo is one click away. */}
              <button
                type="button"
                className="csc-declaration-chip__value"
                aria-label={`Sửa tờ khai ${index + 1}: ${value}`}
                title="Sửa số tờ khai này"
                disabled={saving}
                onClick={() => {
                  setDeclDraft(value);
                  setDeclNotice('');
                  update('declarationNumbers', declarations.filter((_, i) => i !== index));
                  declInputRef.current?.focus();
                }}
              >
                {value}
              </button>
              <button
                type="button"
                className="csc-declaration-chip__remove"
                aria-label={`Xóa tờ khai ${index + 1}`}
                disabled={saving}
                onClick={() => update('declarationNumbers', declarations.filter((_, i) => i !== index))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={declInputRef}
          className="csc-declaration-strip__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Số tờ khai"
          placeholder="Nhập số tờ khai, nhấn Enter — hoặc dán nhiều số (phẩy / xuống dòng)"
          title="Dán nhiều số, ngăn cách bằng dấu phẩy hoặc xuống dòng."
          value={declDraft}
          disabled={saving}
          onChange={(event) => setDeclDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDeclarations(declDraft);
            } else if (event.key === 'Backspace' && declDraft === '' && declarations.length > 0) {
              update('declarationNumbers', declarations.slice(0, -1));
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[\s,;]/.test(text)) {
              event.preventDefault();
              commitDeclarations(text);
            }
          }}
        />
        <button
          type="button"
          className="csc-utility-button csc-declaration-strip__add"
          disabled={saving}
          onClick={() => commitDeclarations(declDraft)}
        >
          <Plus size={15} aria-hidden="true" />Thêm
        </button>
        <span className="csc-declaration-strip__notice" role="status" aria-live="polite">{declNotice}</span>
      </div>
      {declarations.map((value, index) => {
        const conflict = conflictFor(value, index);
        return conflict
          ? (
            <div key={`conflict-${value}`} className="csc-field-warning">
              <ShipmentReferenceConflictWarning conflict={conflict} fieldLabel="Số tờ khai" />
            </div>
          )
          : null;
      })}
    </ShipmentCreateSection>
  );
}
