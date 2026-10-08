import { useEffect, useState } from 'react';
import { Building2, Clock, FileText, Hash, Landmark, Loader2, Phone, Save, User, X } from 'lucide-react';
import { SupplierType, type Supplier } from '@tingting/shared';
import { Input } from '../../components/untitled-ui/base/input/input';
import { TextArea } from '../../components/untitled-ui/base/textarea/textarea';
import { EntityFormSection, UnitInput, RequiredHint } from '../../components/shared/EntityFormParts';
import { Modal, ModalChip, ModalChipLive } from '../../components/UI';
import { SupplierTypePicker } from './SupplierTypePicker';

/**
 * The add/edit supplier form.
 *
 * It lived inside `pages/SupplierListPage.tsx`, which pushed that page past its
 * frozen LOC ceiling and made a shared component look page-private — the
 * dispatch suppliers view has been reaching across into a page module to import
 * it. It is shared, so it lives with the other supplier pieces.
 */
export function SupplierFormModal({ item, saving, onsave, oncancel, isOpen }: {
  item?: Supplier; saving: boolean; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean;
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [note, setNote] = useState(item?.note || '');
  const [chiHoDueDays, setChiHoDueDays] = useState<string>(item?.chiHoDueDays != null ? String(item.chiHoDueDays) : '');
  const [cuocDueDays, setCuocDueDays] = useState<string>(item?.cuocDueDays != null ? String(item.cuocDueDays) : '');
  const [types, setTypes] = useState<SupplierType[]>(item?.types ?? []);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || '');
      setContactPerson(item?.contactPerson || '');
      setPhone(item?.phone || '');
      setTaxCode(item?.taxCode || '');
      setNote(item?.note || '');
      setChiHoDueDays(item?.chiHoDueDays != null ? String(item.chiHoDueDays) : '');
      setCuocDueDays(item?.cuocDueDays != null ? String(item.cuocDueDays) : '');
      setTypes(item?.types ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const handleSave = () => {
    if (!name.trim()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim() || name.trim(),
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      taxCode: taxCode.trim() || undefined,
      note: note.trim() || undefined,
      chiHoDueDays: chiHoDueDays.trim() === '' ? null : Number(chiHoDueDays),
      cuocDueDays: cuocDueDays.trim() === '' ? null : Number(cuocDueDays),
      types,
      // Reporting-only; the backend rejects a primaryType outside `types`.
      primaryType: types[0] ?? null,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? item.name : 'Thêm nhà cung cấp'}
      subtitle={item ? 'Sửa nhà cung cấp' : undefined}
      polished
      ariaLabel={item ? `Sửa nhà cung cấp — ${item.name}` : 'Thêm nhà cung cấp'}
      headerRight={
        !item ? undefined : item.status === 'ACTIVE'
          ? <ModalChipLive>Đang hoạt động</ModalChipLive>
          : <ModalChip>Ngừng hoạt động</ModalChip>
      }
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={960}
      footer={
        <>
          <RequiredHint />
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm nhà cung cấp'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <EntityFormSection icon={Building2} label="Thông tin nhà cung cấp">
          <Input
            size="sm"
            label="Tên nhà cung cấp"
            isRequired
            icon={Building2}
            value={name}
            onChange={setName}
            placeholder="Ví dụ: Garage Auto 123"
            autoFocus
          />
          <Input
            size="sm"
            label="Tên viết tắt"
            icon={Hash}
            value={shortName}
            onChange={setShortName}
            placeholder="Để trống sẽ dùng tên đầy đủ"
          />
          <Input
            size="sm"
            label="Mã số thuế"
            icon={Landmark}
            value={taxCode}
            maxLength={20}
            onChange={setTaxCode}
            placeholder="Ví dụ: 0312…"
            inputClassName="tabular-nums"
          />
          <Input
            size="sm"
            label="Người liên hệ"
            icon={User}
            value={contactPerson}
            onChange={setContactPerson}
            placeholder="Ví dụ: Anh Tuấn · Kế toán"
          />
          <Input
            size="sm"
            label="Điện thoại"
            icon={Phone}
            value={phone}
            onChange={setPhone}
            placeholder="Ví dụ: 0912…"
            inputClassName="tabular-nums"
          />
        </EntityFormSection>
        <SupplierTypePicker types={types} onChange={setTypes} />
        <EntityFormSection icon={Clock} label="Điều khoản thanh toán">
          <UnitInput
            size="sm"
            label="Hạn thanh toán Chi hộ"
            unit="ngày"
            icon={Clock}
            value={chiHoDueDays}
            onChange={setChiHoDueDays}
            min={0}
            max={365}
            placeholder="Ví dụ: 15"
          />
          <UnitInput
            size="sm"
            label="Hạn thanh toán Cước"
            unit="ngày"
            icon={Clock}
            value={cuocDueDays}
            onChange={setCuocDueDays}
            min={0}
            max={365}
            placeholder="Ví dụ: 30"
          />
        </EntityFormSection>

        <EntityFormSection icon={FileText} label="Ghi chú">
          <div className="col-span-full">
            <TextArea
              value={note}
              onChange={setNote}
              placeholder="Ghi chú thêm…"
              rows={3}
            />
          </div>
        </EntityFormSection>
      </div>
    </Modal>
  );
}