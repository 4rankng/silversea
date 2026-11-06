import { type RefObject } from 'react';
import { Pencil, Plus } from 'lucide-react';
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
  customerAddButtonRef: RefObject<HTMLButtonElement | null>;
  shippingLineAddButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenCustomerDialog: () => void;
  onOpenShippingLineDialog: () => void;
  /**
   * SIL-171 edit mode: PUT /shipments/:id cannot persist the create-only
   * intake flags (hasDeposit → deposit trackers; the ad-hoc identity XOR).
   * Those controls hide here instead of reporting a silent success, and an
   * ad-hoc lot's customer identity locks (converting it in-place would write
   * customerId onto a row that keeps isAdHoc=true).
   */
  editMode?: boolean;
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
  customerAddButtonRef,
  shippingLineAddButtonRef,
  onOpenCustomerDialog,
  onOpenShippingLineDialog,
  editMode = false,
}: ShipmentCreateIdentitySectionProps) {
  // SIL-521 (owner 26/10) retired the LOT-LEVEL tờ khai strip; SIL-660
  // (owner 02/11) brought ONE lot-level input back for the hàng lẻ tab
  // (lẻ = 1 lô 1 cont), SIL-673 (owner ruling 03/11) moved it up into this
  // section above Số Bill/Booking, and SIL-678 (customer 04/11, same
  // requester) set the two side by side — Bill/Booking left, tờ khai right.
  // Display position only.
  return (
    <ShipmentCreateSection
      id="identity"
      title="Nhận diện lô"
      description="Khách hàng, chứng từ và hướng xuất nhập khẩu."
    >
      {/* BAND 1 — identity. SIL-168 (owner ruling B 24/10, khách gửi lại yêu
          cầu lần 3): Hình thức XNK picked FIRST, riding beside Khách hàng —
          the Số Bill/Booking field it gates sits directly below. Supersedes
          the FB-127 reading (9f174360: Bill/Booking trước XNK, 2 cụm divider)
          and restores the 2425726d band map the customer quoted verbatim on
          23+24/10. Older history: 2425726d superseded the A.3 order of card
          181026200200 (Bill/Booking → tờ khai → Nhập/Xuất → Hãng tàu). Gate
          blNumber XOR bookingRef theo hướng GIỮ NGUYÊN (FB-113).
          SIL-499 onescreen: `--contact` is the wide-band grid hook — the
          contact/refs bands stack in column 1 while choices flags stack in
          column 2 (ClerkShipmentCreatePage.onescreen.css). SIL-521: the tờ
          khai strip band is retired — declaration entry is per-cont. */}
      <div className="csc-identity-grid csc-identity-grid--contact">
        <div
          className="csc-identity-grid__customer csc-field-with-trailing"
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
            // SIL-171: an ad-hoc lot's identity is immutable on edit — the
            // update contract keeps isAdHoc, so converting it here would
            // persist customerId onto a still-ad-hoc row (XOR break).
            disabled={saving || (editMode && form.isAdHoc)}
            error={issueByField.get('shipment-customer')}
            className="csc-customer-field"
            popoverClassName="csc-customer-popover"
            optionClassName="csc-customer-option"
            searchable
            // SIL-641 residual (id 745): the decorative search glyph reserved
            // ~42px inside the flex row, so this field's inner typing box
            // measured 40px narrower than the plain-text sibling across the
            // row (QA Δ42/Δ40, 03/11). See hideSearchIcon on USearchableField.
            hideSearchIcon
            {...(form.isAdHoc && customerCustomText ? { onCustomValue: customerCustomText } : {})}
          />
          <button
            ref={customerAddButtonRef as RefObject<HTMLButtonElement>}
            type="button"
            onClick={onOpenCustomerDialog}
            disabled={saving}
            className="csc-trailing-action"
            aria-label="Thêm khách hàng"
            title="Thêm khách hàng"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        {/* SIL-641 (id 745) equal-width law now holds by construction: every
            identity cell renders its control at the FULL cell width, so all
            controls share one right edge without placeholder slots. SIL-681
            (owner 04/11) retired the "control + gap 8 + action slot 36"
            pattern — the two quick-add affordances live INSIDE their inputs
            (trailing actions), so no cell reserves an external 44px any
            more. */}
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
      </div>

      {/* BAND 2 — Số Bill/Booking (gated by the direction picked above), then
          Số tờ khai beside it on Hàng lẻ (SIL-678), and Hãng tàu on BOTH
          modes (SIL-681 r2 — full-width row on LCL, right half on FCL). The
          handler is verbatim — the Bill-vs-Booking switch and the
          prerequisite hint on the booking field keep working; a
          not-yet-directed lot shows the hint directly under the picker that
          sets it. SIL-499: `--refs` = wide-band grid hook (column 1). */}
      <div className="csc-identity-grid csc-identity-grid--refs">
        {/* SIL-641 (id 745): same full-width law as the trade-direction cell
            above — see the note there. */}
        <div className="csc-identity-grid__booking" data-field-id="shipment-booking-ref">
          <TextField
            id="shipment-booking-ref"
            label="Số Bill/Booking"
            required
            value={form.tradeDirection === 'IMPORT' ? form.blNumber : form.bookingRef}
            onChange={(event) => update(form.tradeDirection === 'IMPORT' ? 'blNumber' : 'bookingRef', event.target.value)}
            maxLength={100}
            // QA1-001: the fallback used to read "Chọn Nhập hoặc Xuất", which
            // described the trade-direction picker sitting next to this field—
            // on a disabled input it read as if this field were that picker.
            // Name this field instead; the hint below already states the
            // prerequisite, so there is nothing to repeat here.
            placeholder={form.tradeDirection === 'IMPORT' ? 'Nhập số Bill (hàng Nhập)' : form.tradeDirection === 'EXPORT' ? 'Nhập số Booking (hàng Xuất)' : 'Nhập số Bill/Booking'}
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
        {/* SIL-678 (customer 04/11, supersedes SIL-673's stacked layout):
            the hàng-lẻ tờ khai cell rides the refs band's RIGHT column —
            the same slot hãng tàu occupies for FCL — so Số Bill/Booking
            (left) and Số tờ khai (right) share ONE row. DISPLAY-POSITION
            ONLY: the exact same UTextField for the lot's single container
            (SIL-601: lẻ = 1 lô 1 cont), same declarationNumber state, same
            shipment_declarations persist path (SIL-660 — no validation, no
            payload change). FCL never renders it (per-cont column stays —
            SIL-600/SIL-701). The cell renders its control full width — the
            SIL-641 shared-right-edge law holds by construction (SIL-681). */}
        {form.cargoMode === 'LCL' && (
          <div
            className="csc-identity-grid__declaration"
            data-field-id="shipment-lcl-declaration-number"
          >
            <TextField
              id="shipment-lcl-declaration-number"
              label="Số tờ khai"
              value={form.declarationNumber}
              onChange={(event) => update('declarationNumber', event.target.value)}
              disabled={saving}
              error={issueByField.get('shipment-lcl-declaration-number')}
            />
          </div>
        )}

        {/* SIL-681 r2 (QA fail comment 3885, 06/11): Hãng tàu MUST exist on
            the hàng-lẻ tab too — the old `cargoMode === 'FCL'` gate (from the
            79ed4e03 section split) left LCL with no carrier entry at all,
            while the carrier still rides the lot (CusQuickEdit + the detail
            ledger edit it; the root payload nulled it for LCL since
            0abff7aa). Same trailing pattern as FCL (SIL-681): the '✎' lives
            INSIDE the input at the right end, same height as the input,
            same dialog. On LCL the refs band's right column is taken by the
            Số tờ khai cell (SIL-678), so the carrier cell spans the full
            row below (1 / -1) — no orphan half-cell, control full-width per
            the SIL-641 shared-right-edge law. Behavior/state unchanged:
            same form state `shippingLineName`, same options, same dialog. */}
        <div
          className={`csc-identity-grid__shipping-line csc-field-with-trailing${form.cargoMode === 'LCL' ? ' csc-identity-grid__shipping-line--lcl' : ''}`}
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
            // FB-114 verify-fail (171026185348): the dropdown is the SERVER
            // catalog (defaults + SHIPPING_LINE suppliers). The pencil
            // dialog persists its name there (survives reload for every
            // user) AND writes this lot's field; a name typed straight into
            // the field rides this lot only.
            // SIL-499: the old 2-sentence usage hint under the field is
            // GONE — §8 of the design law book bans lecturing helper text
            // (trained operators), and at half-width columns it wrapped to
            // four lines and alone cost ~50px of the one-viewport budget.
            // The affordances keep their names: the pencil button's
            // aria-label/title still says what it adds.
            searchable
            // SIL-641 residual (id 745): same inner-box parity as the
            // customer field — see hideSearchIcon on USearchableField.
            hideSearchIcon
          />
          <button
            ref={shippingLineAddButtonRef as RefObject<HTMLButtonElement>}
            type="button"
            onClick={onOpenShippingLineDialog}
            disabled={saving}
            className="csc-trailing-action"
            aria-label="Đặt tên hãng tàu cho lô này"
            title="Đặt tên hãng tàu cho lô này"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* BAND 4 — the Tuỳ chọn flags on their own full-width band. All three
          boolean flags share the ONE .csc-flag-checkbox chip treatment
          (density pass, owner 11/10). DOM order keeps the flag contract:
          Lệnh chạy ngoài → Có cược container → Đóng kết hợp. SIL-499:
          `--choices` = wide-band grid hook (column 2, above the strip). */}
      <div className="csc-identity-grid csc-identity-grid--choices">
        <div
          className="csc-identity-grid__flags csc-identity-grid__flags--solo"
          data-field-id="shipment-deposit"
        >
          <span className="csc-identity-grid__flags-label">Tuỳ chọn</span>
          <div className="csc-identity-grid__flags-row">
            {/* SIL-171: create-only intake flags hide on edit — the update
                contract cannot persist them, so showing them would report a
                silent success. "Đóng kết hợp" stays (the update chain
                supports it). */}
            {!editMode && (
              <label className="csc-flag-checkbox" data-field-id="shipment-is-adhoc">
                <input
                  type="checkbox"
                  checked={form.isAdHoc}
                  onChange={(event) => update('isAdHoc', event.target.checked)}
                  disabled={saving}
                />
                <span>Lệnh chạy ngoài</span>
              </label>
            )}
            {!editMode && (
              <label className="csc-flag-checkbox" data-field-id="shipment-has-deposit">
                <input
                  type="checkbox"
                  checked={form.hasDeposit}
                  onChange={(event) => update('hasDeposit', event.target.checked)}
                  disabled={saving}
                />
                <span><strong>Có cược container</strong></span>
              </label>
            )}
            <label className="csc-flag-checkbox" data-field-id="shipment-is-combined">
              <input
                type="checkbox"
                checked={form.isCombined}
                onChange={(event) => update('isCombined', event.target.checked)}
                disabled={saving}
              />
              <span><strong>Đóng kết hợp</strong></span>
            </label>
            {!editMode && form.hasDeposit && (
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
    </ShipmentCreateSection>
  );
}
