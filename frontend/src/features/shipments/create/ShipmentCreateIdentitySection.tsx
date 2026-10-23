import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
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
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [flashValue, setFlashValue] = useState<string | null>(null);
  const declInputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { clearTimeout(flashTimer.current ?? undefined); }, []);
  /** One code per token; duplicates dropped, order preserved (bulk edit). */
  function parseDeclarations(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }
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
    // A duplicate flashes the chip it collided with (owner reference) instead
    // of silently doing nothing.
    if (skipped > 0) {
      const duplicate = declarations.find((value) => tokens.includes(value)) ?? null;
      if (duplicate) {
        setFlashValue(duplicate);
        clearTimeout(flashTimer.current ?? undefined);
        flashTimer.current = window.setTimeout(() => setFlashValue(null), 900);
      }
    }
  }
  return (
    <ShipmentCreateSection
      id="identity"
      title="Nhận diện lô"
      description="Khách hàng, chứng từ và hướng xuất nhập khẩu."
    >
      {/* FB-127 (TIEPVU-21, Tiệp Vũ 23/10 — yêu cầu MỚI NHẤT, thắng bố cục
          A.3 của card 261023093200): Số Bill/Booking phải đứng TRƯỚC Hình
          thức XNK. Form chia 2 cụm có divider — chứng từ giấy trước, phân
          loại nghiệp vụ sau. RULE (PRD docs/prd/TaoMoiLoHang.md): "Thứ tự
          field chốt theo luồng chứng từ giấy; thay đổi sau này cần approval
          Lead Ops." Gate blNumber XOR bookingRef theo Hình thức XNK GIỮ
          NGUYÊN (FB-113): Bill/Booking disable + hint cho tới khi chọn
          hướng (picker giờ nằm dưới, cụm 2). */}
      <div className="csc-identity-cluster">
        <p className="csc-identity-cluster__heading">Chứng từ &amp; định danh</p>
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
              // FB-114 verify-fail (171026185348): the dropdown is the SERVER
              // catalog (defaults + SHIPPING_LINE suppliers). The pencil
              // dialog persists its name there (survives reload for every
              // user) AND writes this lot's field; a name typed straight into
              // the field rides this lot only. The hint must never claim a
              // catalog add the field itself does not make.
              hint="Danh mục hãng tàu lấy từ Nhà cung cấp loại 'Hãng tàu'. Tên nhập tay lưu cùng lô hàng này; dùng nút bút chì để thêm vào danh mục chung."
              searchable
            />
            <button
              ref={shippingLineAddButtonRef as RefObject<HTMLButtonElement>}
              type="button"
              onClick={onOpenShippingLineDialog}
              disabled={saving}
              className="csc-append-button"
              aria-label="Đặt tên hãng tàu cho lô này"
              title="Đặt tên hãng tàu cho lô này"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        </div>

        {/* `Số tờ khai` dense chip input — chứng từ hải quan, giữ vị trí cuối
            cụm 1 (card 261023093200 dời xuống cuối; FB-127 giữ nguyên vị trí
            này trong cụm chứng từ). Built to the owner's reference ("Số tờ
            khai - dense chip input.html"): a head row with the count and the
            two bulk actions, ONE bordered field holding every code as a chip
            plus the inline entry, and a foot with the paste/Enter/Backspace
            hint and the status line. N codes cost N chips, never a form field
            each; the field scrolls inside itself so a long list never grows
            the page. */}
      <div className="csc-declaration-strip" data-field-id="shipment-declarations">
        <div className="csc-declaration-strip__head">
          <span className="csc-declaration-strip__title">Số tờ khai</span>
          <span className="csc-declaration-strip__count">{declarations.length}</span>
          <div className="csc-declaration-strip__actions">
            <button
              type="button"
              className="csc-declaration-strip__action"
              disabled={saving || declarations.length === 0}
              onClick={() => { setBulkText(declarations.join('\n')); setBulkEdit(true); }}
            >
              Sửa hàng loạt
            </button>
            <button
              type="button"
              className="csc-declaration-strip__action"
              disabled={saving || declarations.length === 0}
              onClick={() => { update('declarationNumbers', []); setDeclDraft(''); setDeclNotice(''); }}
            >
              Xóa tất cả
            </button>
          </div>
        </div>

        {bulkEdit ? (
          <div className="csc-declaration-strip__bulk">
            <textarea
              className="csc-declaration-strip__bulk-input"
              aria-label="Sửa danh sách số tờ khai"
              rows={3}
              placeholder="Mỗi dòng một số"
              value={bulkText}
              disabled={saving}
              onChange={(event) => setBulkText(event.target.value)}
            />
            <div className="csc-declaration-strip__bulk-actions">
              <button
                type="button"
                className="csc-utility-button"
                disabled={saving}
                onClick={() => {
                  const next = parseDeclarations(bulkText);
                  update('declarationNumbers', next);
                  setBulkEdit(false);
                  setDeclNotice(next.length > 0 ? `Đã lưu ${next.length} số.` : '');
                }}
              >
                Xong
              </button>
              <button type="button" className="csc-utility-button" disabled={saving} onClick={() => setBulkEdit(false)}>
                Hủy
              </button>
            </div>
          </div>
        ) : (
          <div
            className="csc-declaration-strip__field"
            role="group"
            aria-label="Số tờ khai"
            onClick={() => declInputRef.current?.focus()}
          >
            {declarations.map((value, index) => (
              <span
                key={value}
                className={`csc-declaration-chip${conflictFor(value, index) ? ' csc-declaration-chip--conflict' : ''}${flashValue === value ? ' csc-declaration-chip--flash' : ''}`}
              >
                {/* The code itself is the edit affordance: one click moves it
                    back into the entry (and out of the list). */}
                <button
                  type="button"
                  className="csc-declaration-chip__value"
                  aria-label={`Sửa tờ khai ${index + 1}: ${value}`}
                  title="Sửa số tờ khai này"
                  disabled={saving}
                  onClick={(event) => {
                    event.stopPropagation();
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
                  title="Xóa"
                  disabled={saving}
                  onClick={(event) => {
                    event.stopPropagation();
                    update('declarationNumbers', declarations.filter((_, i) => i !== index));
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <input
              ref={declInputRef}
              className="csc-declaration-strip__input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Số tờ khai"
              placeholder="Nhập hoặc dán nhiều số…"
              value={declDraft}
              disabled={saving}
              onChange={(event) => setDeclDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  if (declDraft.trim()) commitDeclarations(declDraft);
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
          </div>
        )}

        <div className="csc-declaration-strip__foot">
          <span className="csc-declaration-strip__hint">
            Dán nhiều số, ngăn cách bằng dấu phẩy hoặc xuống dòng · Enter để thêm · Backspace xóa số cuối
          </span>
          <span className="csc-declaration-strip__notice" role="status" aria-live="polite">{declNotice}</span>
        </div>
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
      </div>

      {/* FB-127 cụm 2 — "Phân loại nghiệp vụ": Hình thức XNK + Tuỳ chọn, sau
          divider. Hình thức XNK đứng SAU Số Bill/Booking (yêu cầu Tiệp Vũ
          23/10); gate dữ liệu giữ nguyên — Bill/Booking (cụm 1) disable tới
          khi hướng được chọn tại đây. */}
      <div className="csc-identity-cluster">
        <p className="csc-identity-cluster__heading">Phân loại nghiệp vụ</p>
        <div className="csc-identity-grid">
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
          {/* The Tuỳ chọn flags share the ONE .csc-flag-checkbox chip
              treatment (density pass, owner 11/10). DOM order keeps the flag
              contract: Lệnh chạy ngoài → Có cược container → Đóng kết hợp. */}
          <div className="csc-identity-grid__flags" data-field-id="shipment-deposit">
            <span className="csc-identity-grid__flags-label">Tuỳ chọn</span>
            <div className="csc-identity-grid__flags-row">
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
      </div>
    </ShipmentCreateSection>
  );
}
