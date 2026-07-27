import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { TextField, SelectField } from '../../design-system';
import { useConfirm } from '../../components/UI';
import { useAuth } from '../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { tripClient } from '../../api/tripClient';
import {
  addShipmentDocument,
  createShipmentDeclaration,
  getShipmentDetail,
  replaceShipmentDocument,
  reviewShipmentChangeRequest,
  updateShipment,
  updateShipmentDeclaration,
  saveShipmentContainers,
  type ShipmentChangeRequest,
  type ShipmentDeclaration,
  type ShipmentDetail,
  type ShipmentContainer,
  type ShipmentDocument,
} from '../../api/shipmentClient';

interface ClerkContainerTypeOption {
  id: number;
  code: string;
  name: string;
}

/** One editable container row. `id` undefined = new row. */
interface ContainerRow {
  id?: number;
  containerTypeId: string;
  containerNumber: string;
  sealNumber: string;
  cargoWeightKg: string;
}

interface ShipmentFormState {
  bookingRef: string;
  blNumber: string;
  contactName: string;
  contactPhone: string;
  expectedDeliveryDate: string;
  pickupLocation: string;
  deliveryLocation: string;
  responsibleUnitId: string;
}

function toRow(c: ShipmentContainer): ContainerRow {
  return {
    id: c.id,
    containerTypeId: c.containerTypeId != null ? String(c.containerTypeId) : '',
    containerNumber: c.containerNumber ?? '',
    sealNumber: c.sealNumber ?? '',
    cargoWeightKg: c.cargoWeightKg ?? '',
  };
}

const EMPTY_ROW: ContainerRow = {
  containerTypeId: '',
  containerNumber: '',
  sealNumber: '',
  cargoWeightKg: '',
};

const EMPTY_DOC_FORM = {
  type: 'OTHER' as const,
  storageKey: '',
  expiresAt: '',
};

const EMPTY_DECLARATION_FORM = {
  id: null as number | null,
  declarationNumber: '',
  issuedAt: '',
  scope: 'SINGLE' as 'SINGLE' | 'SHARED',
  note: '',
};

export default function ClerkShipmentDocsPage() {
  const { id } = useParams<{ id: string }>();
  const shipmentId = id ? Number(id) : NaN;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [containerTypes, setContainerTypes] = useState<ClerkContainerTypeOption[]>([]);

  const [shipmentForm, setShipmentForm] = useState<ShipmentFormState>({
    bookingRef: '',
    blNumber: '',
    contactName: '',
    contactPhone: '',
    expectedDeliveryDate: '',
    pickupLocation: '',
    deliveryLocation: '',
    responsibleUnitId: '',
  });
  const [version, setVersion] = useState(1);
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOC_FORM);
  const [replaceDocumentTarget, setReplaceDocumentTarget] = useState<ShipmentDocument | null>(null);
  const [declarationForm, setDeclarationForm] = useState(EMPTY_DECLARATION_FORM);

  const [savingShipment, setSavingShipment] = useState(false);
  const [savingContainers, setSavingContainers] = useState(false);
  const [savingDocument, setSavingDocument] = useState(false);
  const [savingDeclaration, setSavingDeclaration] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [shipmentMsg, setShipmentMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [containerMsg, setContainerMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [documentMsg, setDocumentMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [declarationMsg, setDeclarationMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [reviewMsg, setReviewMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const canDispatch = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const canReview = canDispatch;
  const assignedResponsibleUnitIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of user?.businessUnitIds ?? []) ids.add(id);
    if (detail?.shipment.responsibleUnitId != null) ids.add(detail.shipment.responsibleUnitId);
    return [...ids];
  }, [detail?.shipment.responsibleUnitId, user?.businessUnitIds]);

  async function loadPageData(currentShipmentId: number) {
    const [loadedDetail, bootstrap] = await Promise.all([
      getShipmentDetail(currentShipmentId),
      tripClient.getBootstrap(),
    ]);
    setDetail(loadedDetail);
    setVersion(loadedDetail.shipment.version);
    setRows(loadedDetail.containers.map(toRow));
    setContainerTypes(bootstrap.containerTypes);
    setShipmentForm({
      bookingRef: loadedDetail.shipment.bookingRef ?? '',
      blNumber: loadedDetail.shipment.blNumber ?? '',
      contactName: loadedDetail.shipment.contactName ?? '',
      contactPhone: loadedDetail.shipment.contactPhone ?? '',
      expectedDeliveryDate: loadedDetail.shipment.expectedDeliveryDate ?? '',
      pickupLocation: loadedDetail.shipment.pickupLocation ?? '',
      deliveryLocation: loadedDetail.shipment.deliveryLocation ?? '',
      responsibleUnitId: loadedDetail.shipment.responsibleUnitId != null
        ? String(loadedDetail.shipment.responsibleUnitId)
        : '',
    });
  }

  useEffect(() => {
    if (!Number.isFinite(shipmentId)) {
      setLoadError('ID lô hàng không hợp lệ');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPageData(shipmentId)
      .then(() => {
        if (cancelled) return;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể tải thông tin lô hàng';
        setLoadError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shipmentId]);

  const readiness = useMemo(() => {
    const missing: string[] = [];
    if (!shipmentForm.blNumber.trim()) missing.push('Số vận đơn (B/L)');
    if (rows.length === 0) missing.push('Công-te-nơ (ít nhất một)');
    return { ready: missing.length === 0, missing };
  }, [shipmentForm.blNumber, rows]);

  function updateRow(idx: number, patch: Partial<ContainerRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setContainerMsg(null);
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
    setContainerMsg(null);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setContainerMsg(null);
  }

  async function reloadCurrentDetail() {
    await loadPageData(shipmentId);
  }

  async function handleSaveShipment() {
    setSavingShipment(true);
    setShipmentMsg(null);
    try {
      const updated = await updateShipment(shipmentId, {
        expectedVersion: version,
        bookingRef: shipmentForm.bookingRef.trim() || null,
        blNumber: shipmentForm.blNumber.trim() || null,
        contactName: shipmentForm.contactName.trim() || null,
        contactPhone: shipmentForm.contactPhone.trim() || null,
        expectedDeliveryDate: shipmentForm.expectedDeliveryDate || null,
        pickupLocation: shipmentForm.pickupLocation.trim() || null,
        deliveryLocation: shipmentForm.deliveryLocation.trim() || null,
        responsibleUnitId: shipmentForm.responsibleUnitId ? Number(shipmentForm.responsibleUnitId) : null,
      });
      await reloadCurrentDetail();
      setShipmentMsg({
        kind: 'ok',
        text: updated.message ?? (updated.changeMode === 'REQUESTED'
          ? 'Đã gửi yêu cầu thay đổi kế hoạch.'
          : 'Đã lưu thông tin lô hàng.'),
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu. Vui lòng thử lại.';
      setShipmentMsg({ kind: 'err', text: msg });
    } finally {
      setSavingShipment(false);
    }
  }

  async function handleSaveContainers() {
    setSavingContainers(true);
    setContainerMsg(null);
    try {
      const res = await saveShipmentContainers(shipmentId, {
        expectedVersion: version,
        containers: rows.map((r) => ({
          ...(r.id != null ? { id: r.id } : {}),
          containerTypeId: r.containerTypeId ? Number(r.containerTypeId) : null,
          containerNumber: r.containerNumber.trim() || null,
          sealNumber: r.sealNumber.trim() || null,
          cargoWeightKg: r.cargoWeightKg ? Number(r.cargoWeightKg) : null,
        })),
      });
      setVersion(res.shipmentVersion);
      await reloadCurrentDetail();
      setContainerMsg({
        kind: 'ok',
        text: res.message ?? `Đã lưu ${res.items.length} công-te-nơ.`,
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu công-te-nơ. Vui lòng thử lại.';
      setContainerMsg({ kind: 'err', text: msg });
    } finally {
      setSavingContainers(false);
    }
  }

  async function handleSaveDocument() {
    setSavingDocument(true);
    setDocumentMsg(null);
    try {
      if (!documentForm.storageKey.trim()) {
        setDocumentMsg({ kind: 'err', text: 'Cần nhập storage key của tài liệu.' });
        return;
      }
      if (replaceDocumentTarget) {
        await replaceShipmentDocument(shipmentId, replaceDocumentTarget.id, {
          storageKey: documentForm.storageKey.trim(),
          expiresAt: documentForm.expiresAt || null,
        });
      } else {
        await addShipmentDocument(shipmentId, {
          type: documentForm.type,
          storageKey: documentForm.storageKey.trim(),
        });
      }
      await reloadCurrentDetail();
      setDocumentMsg({
        kind: 'ok',
        text: replaceDocumentTarget ? 'Đã thay thế tài liệu.' : 'Đã thêm tài liệu.',
      });
      setDocumentForm(EMPTY_DOC_FORM);
      setReplaceDocumentTarget(null);
    } catch (err) {
      setDocumentMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể lưu tài liệu.',
      });
    } finally {
      setSavingDocument(false);
    }
  }

  async function handleSaveDeclaration() {
    setSavingDeclaration(true);
    setDeclarationMsg(null);
    try {
      if (declarationForm.id != null) {
        await updateShipmentDeclaration(shipmentId, declarationForm.id, {
          declarationNumber: declarationForm.declarationNumber.trim() || null,
          issuedAt: declarationForm.issuedAt || null,
          scope: declarationForm.scope,
          note: declarationForm.note.trim() || null,
        });
      } else {
        await createShipmentDeclaration(shipmentId, {
          declarationNumber: declarationForm.declarationNumber.trim() || null,
          issuedAt: declarationForm.issuedAt || null,
          scope: declarationForm.scope,
          note: declarationForm.note.trim() || null,
        });
      }
      await reloadCurrentDetail();
      setDeclarationMsg({
        kind: 'ok',
        text: declarationForm.id != null ? 'Đã cập nhật tờ khai.' : 'Đã thêm tờ khai.',
      });
      setDeclarationForm(EMPTY_DECLARATION_FORM);
    } catch (err) {
      setDeclarationMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể lưu tờ khai.',
      });
    } finally {
      setSavingDeclaration(false);
    }
  }

  async function handleReviewRequest(request: ShipmentChangeRequest, resolution: 'APPLIED' | 'REJECTED') {
    setReviewingRequestId(request.id);
    setReviewMsg(null);
    try {
      const result = await reviewShipmentChangeRequest(shipmentId, request.id, resolution);
      await reloadCurrentDetail();
      setReviewMsg({ kind: 'ok', text: result.message });
    } catch (err) {
      setReviewMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể xử lý yêu cầu thay đổi.',
      });
    } finally {
      setReviewingRequestId(null);
    }
  }

  async function handleDispatch() {
    const warningText = readiness.ready
      ? 'Điều vận lô hàng sang chuyến?'
      : `Lô hàng còn thiếu: ${readiness.missing.join(', ')}. Điều vận tiếp tục?`;
    const ok = await confirm(warningText, {
      variant: readiness.ready ? 'primary' : 'warning',
      confirmLabel: 'Điều vận',
    });
    if (!ok) return;

    setDispatching(true);
    try {
      // Dispatch requires route/cargo/container-type — the operator chooses
      // these at dispatch time. For this slice we reuse the FIRST container's
      // type when available; a richer dispatch form is the existing operator
      // flow at /shipments/:id (out of scope here).
      const firstRowWithType = rows.find((r) => r.containerTypeId);
      const containerTypeId = firstRowWithType ? Number(firstRowWithType.containerTypeId) : 0;
      if (!containerTypeId) {
        setContainerMsg({ kind: 'err', text: 'Cần ít nhất một công-te-nơ có loại công-te-nơ để điều vận.' });
        return;
      }
      // A route + cargo type are also required; this slice cannot pick them
      // meaningfully on the clerk's behalf, so route the operator to the
      // existing dispatch surface where they choose. CLERK never reaches
      // here (no dispatch button).
      navigate(`/shipments/${shipmentId}`);
    } finally {
      setDispatching(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>
        <div style={{ color: 'var(--danger)', padding: 16 }}>{loadError}</div>
      </div>
    );
  }
  if (!detail) return null;

  const isDraft = detail.shipment.status === 'DRAFT';
  const isPostDispatch = !isDraft;

  return (
    <div style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Quay lại"
        style={backBtnStyle}
      >
        <ArrowLeft size={18} /> Quay lại
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>
        Hồ sơ lô {detail.shipment.shipmentCode ?? `#${detail.shipment.id}`}
      </h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, marginBottom: 16 }}>
        Khách hàng: {detail.shipment.customerName ?? `#${detail.shipment.customerId}`}
        {' · '}Trạng thái: {isDraft ? 'Bản nháp' : detail.shipment.status}
      </p>

      <div style={readiness.ready ? readinessOkStyle : readinessWarnStyle}>
        {readiness.ready ? (
          <><CheckCircle2 size={16} /> Sẵn sàng điều vận</>
        ) : (
          <><AlertTriangle size={16} /> Còn thiếu: {readiness.missing.join(', ')}</>
        )}
      </div>

      {isPostDispatch && (
        <div style={infoBannerStyle}>
          Sau khi điều vận, các thay đổi kế hoạch như đơn vị phụ trách, thời gian hoặc điểm nhận/giao sẽ tạo yêu cầu chờ quản lý hoặc điều vận áp dụng. Các bổ sung chứng từ và hồ sơ khai báo vẫn lưu trực tiếp.
        </div>
      )}

      <SectionCard title="Thông tin lô hàng">
        <SelectField
          label="Đơn vị phụ trách"
          value={shipmentForm.responsibleUnitId}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, responsibleUnitId: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment || assignedResponsibleUnitIds.length === 0}
        >
          <option value="">— Chưa gán —</option>
          {assignedResponsibleUnitIds.map((unitId) => (
            <option key={unitId} value={String(unitId)}>{`Đơn vị #${unitId}`}</option>
          ))}
        </SelectField>
        <TextField
          label="Mã booking"
          value={shipmentForm.bookingRef}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, bookingRef: event.target.value }));
            setShipmentMsg(null);
          }}
          placeholder="Ví dụ: BK-001"
          disabled={savingShipment}
          maxLength={100}
        />
        <TextField
          label="Số vận đơn (B/L)"
          value={shipmentForm.blNumber}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, blNumber: event.target.value }));
            setShipmentMsg(null);
          }}
          placeholder="Ví dụ: MAEU1234567890"
          disabled={savingShipment}
          maxLength={100}
        />
        <TextField
          label="Người liên hệ"
          value={shipmentForm.contactName}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, contactName: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Số điện thoại liên hệ"
          value={shipmentForm.contactPhone}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, contactPhone: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Ngày giao dự kiến"
          type="date"
          value={shipmentForm.expectedDeliveryDate}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, expectedDeliveryDate: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Điểm nhận"
          value={shipmentForm.pickupLocation}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, pickupLocation: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Điểm giao"
          value={shipmentForm.deliveryLocation}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, deliveryLocation: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <button type="button" onClick={handleSaveShipment} disabled={savingShipment} style={primaryBtnStyle}>
          <Save size={16} /> {savingShipment ? 'Đang lưu…' : (isPostDispatch ? 'Lưu hoặc gửi yêu cầu' : 'Lưu hồ sơ lô hàng')}
        </button>
        {shipmentMsg && <MsgLine msg={shipmentMsg} />}
      </SectionCard>

      <SectionCard title={`Công-te-nơ (${rows.length})`}>
        {rows.length === 0 && (
          <p style={{ color: 'var(--fg-3)', fontSize: 14, margin: '8px 0' }}>
            Chưa có công-te-nơ. {isDraft ? 'Thêm ít nhất một trước khi điều vận.' : 'Thay đổi công-te-nơ sau điều vận sẽ tạo yêu cầu xem xét.'}
          </p>
        )}
        {rows.map((row, idx) => (
          <div key={row.id ?? `new-${idx}`} style={rowCardStyle}>
            <SelectField
              label="Loại công-te-nơ"
              value={row.containerTypeId}
              onChange={(e) => updateRow(idx, { containerTypeId: (e.target as HTMLSelectElement).value })}
              disabled={savingContainers}
            >
              <option value="">— Chọn —</option>
              {containerTypes.map((ct) => (
                <option key={ct.id} value={String(ct.id)}>{ct.name}</option>
              ))}
            </SelectField>
            <TextField
              label="Số công-te-nơ (ISO 6346)"
              value={row.containerNumber}
              onChange={(e) => updateRow(idx, { containerNumber: e.target.value })}
              placeholder="Ví dụ: MSKU1234565"
              disabled={savingContainers}
              maxLength={50}
            />
            <TextField
              label="Số niêm phong"
              value={row.sealNumber}
              onChange={(e) => updateRow(idx, { sealNumber: e.target.value })}
              disabled={savingContainers}
              maxLength={50}
            />
            <TextField
              label="Trọng lượng hàng (kg)"
              type="number"
              value={row.cargoWeightKg}
              onChange={(e) => updateRow(idx, { cargoWeightKg: e.target.value })}
              disabled={savingContainers}
            />
            <button type="button" onClick={() => removeRow(idx)} style={dangerBtnStyle} aria-label="Xóa công-te-nơ">
              <Trash2 size={16} /> Xóa
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={addRow} style={secondaryBtnStyle}>
            <Plus size={16} /> Thêm công-te-nơ
          </button>
          <button type="button" onClick={handleSaveContainers} disabled={savingContainers} style={primaryBtnStyle}>
            <Save size={16} /> {savingContainers ? 'Đang lưu…' : (isPostDispatch ? 'Lưu hoặc gửi yêu cầu cont' : 'Lưu công-te-nơ')}
          </button>
        </div>
        {containerMsg && <MsgLine msg={containerMsg} />}
      </SectionCard>

      <SectionCard title="Tờ khai">
        {detail.declarations.length > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.declarations.map((declaration: ShipmentDeclaration) => (
              <article key={declaration.id} style={listRowStyle}>
                <div>
                  <strong>{declaration.declarationNumber || `Tờ khai #${declaration.id}`}</strong>
                  <div style={mutedTextStyle}>
                    {declaration.scope ?? 'SINGLE'} · {declaration.issuedAt ? new Date(declaration.issuedAt).toLocaleString('vi-VN') : 'Chưa có ngày phát hành'}
                  </div>
                </div>
                <button
                  type="button"
                  style={secondaryBtnStyle}
                  onClick={() => setDeclarationForm({
                    id: declaration.id,
                    declarationNumber: declaration.declarationNumber ?? '',
                    issuedAt: declaration.issuedAt ? declaration.issuedAt.slice(0, 16) : '',
                    scope: declaration.scope ?? 'SINGLE',
                    note: declaration.note ?? '',
                  })}
                >
                  Sửa
                </button>
              </article>
            ))}
          </div>
        )}
        <TextField
          label="Số tờ khai"
          value={declarationForm.declarationNumber}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, declarationNumber: event.target.value }))}
          disabled={savingDeclaration}
        />
        <TextField
          label="Ngày giờ phát hành"
          type="datetime-local"
          value={declarationForm.issuedAt}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, issuedAt: event.target.value }))}
          disabled={savingDeclaration}
        />
        <SelectField
          label="Phạm vi tờ khai"
          value={declarationForm.scope}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, scope: (event.target as HTMLSelectElement).value as 'SINGLE' | 'SHARED' }))}
          disabled={savingDeclaration}
        >
          <option value="SINGLE">Riêng lẻ</option>
          <option value="SHARED">Dùng chung</option>
        </SelectField>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Ghi chú</span>
          <textarea
            value={declarationForm.note}
            onChange={(event) => setDeclarationForm((current) => ({ ...current, note: event.target.value }))}
            rows={3}
            disabled={savingDeclaration}
            style={textareaStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSaveDeclaration} disabled={savingDeclaration} style={primaryBtnStyle}>
            <Save size={16} /> {savingDeclaration ? 'Đang lưu…' : (declarationForm.id != null ? 'Cập nhật tờ khai' : 'Thêm tờ khai')}
          </button>
          {declarationForm.id != null && (
            <button type="button" onClick={() => setDeclarationForm(EMPTY_DECLARATION_FORM)} style={secondaryBtnStyle}>
              Hủy sửa
            </button>
          )}
        </div>
        {declarationMsg && <MsgLine msg={declarationMsg} />}
      </SectionCard>

      <SectionCard title="Tài liệu chứng từ">
        {detail.documents.length > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.documents.map((document: ShipmentDocument) => (
              <article key={document.id} style={listRowStyle}>
                <div>
                  <strong>{document.type ?? 'OTHER'}</strong>
                  <div style={mutedTextStyle}>{document.storageKey}</div>
                </div>
                <button
                  type="button"
                  style={secondaryBtnStyle}
                  onClick={() => {
                    setReplaceDocumentTarget(document);
                    setDocumentForm({
                      type: (document.type ?? 'OTHER') as typeof EMPTY_DOC_FORM.type,
                      storageKey: '',
                      expiresAt: document.expiresAt ?? '',
                    });
                  }}
                >
                  Thay thế
                </button>
              </article>
            ))}
          </div>
        )}
        {!replaceDocumentTarget && (
          <SelectField
            label="Loại tài liệu"
            value={documentForm.type}
            onChange={(event) => setDocumentForm((current) => ({ ...current, type: (event.target as HTMLSelectElement).value as typeof EMPTY_DOC_FORM.type }))}
            disabled={savingDocument}
          >
            <option value="BOOKING">BOOKING</option>
            <option value="BL">BL</option>
            <option value="DO">DO</option>
            <option value="DECLARATION">DECLARATION</option>
            <option value="OTHER">OTHER</option>
          </SelectField>
        )}
        <TextField
          label={replaceDocumentTarget ? `Storage key tài liệu mới thay cho #${replaceDocumentTarget.id}` : 'Storage key tài liệu'}
          value={documentForm.storageKey}
          onChange={(event) => setDocumentForm((current) => ({ ...current, storageKey: event.target.value }))}
          disabled={savingDocument}
        />
        <TextField
          label="Ngày hết hạn (nếu có)"
          type="date"
          value={documentForm.expiresAt}
          onChange={(event) => setDocumentForm((current) => ({ ...current, expiresAt: event.target.value }))}
          disabled={savingDocument}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSaveDocument} disabled={savingDocument} style={primaryBtnStyle}>
            <Save size={16} /> {savingDocument ? 'Đang lưu…' : (replaceDocumentTarget ? 'Thay thế tài liệu' : 'Thêm tài liệu')}
          </button>
          {replaceDocumentTarget && (
            <button
              type="button"
              onClick={() => {
                setReplaceDocumentTarget(null);
                setDocumentForm(EMPTY_DOC_FORM);
              }}
              style={secondaryBtnStyle}
            >
              Hủy thay thế
            </button>
          )}
        </div>
        {documentMsg && <MsgLine msg={documentMsg} />}
      </SectionCard>

      <SectionCard title={canReview ? 'Yêu cầu thay đổi chờ xử lý' : 'Yêu cầu thay đổi đã gửi'}>
        {reviewMsg && <MsgLine msg={reviewMsg} />}
        {detail.pendingChangeRequests.length === 0 ? (
          <p style={mutedParagraphStyle}>Chưa có yêu cầu thay đổi nào đang chờ xử lý.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.pendingChangeRequests.map((request) => (
              <article key={request.id} style={listRowStyle}>
                <div>
                  <strong>{request.requestKind === 'PLAN_UPDATE' ? 'Đổi kế hoạch' : 'Đổi công-te-nơ'}</strong>
                  <div style={mutedTextStyle}>
                    Phiên bản gốc {request.sourceVersion} · {request.requester?.fullName ?? request.requester?.username ?? `User #${request.requestedBy}`}
                  </div>
                </div>
                {canReview ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={primaryBtnStyle}
                      disabled={reviewingRequestId === request.id}
                      onClick={() => handleReviewRequest(request, 'APPLIED')}
                    >
                      Áp dụng
                    </button>
                    <button
                      type="button"
                      style={dangerBtnStyle}
                      disabled={reviewingRequestId === request.id}
                      onClick={() => handleReviewRequest(request, 'REJECTED')}
                    >
                      Từ chối
                    </button>
                  </div>
                ) : (
                  <span style={mutedTextStyle}>Đang chờ quản lý hoặc điều vận xử lý</span>
                )}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      {canDispatch && isDraft && (
        <button type="button" onClick={handleDispatch} disabled={dispatching} style={{ ...primaryBtnStyle, background: 'var(--accent, #2563eb)' }}>
          <Send size={16} /> {dispatching ? 'Đang điều vận…' : 'Điều vận'}
        </button>
      )}

      {dialog}
    </div>
  );
}

// ─── Inline presentational helpers (kept local; the page is the only consumer) ──

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none',
  border: 'none', color: 'var(--fg-2)', fontSize: 14, padding: '8px 0', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 20px', background: 'var(--fg-3)', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 20px', background: 'transparent', color: 'var(--accent, #2563eb)',
  border: '1px solid var(--accent, #2563eb)', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 40, padding: '0 14px', background: 'transparent', color: 'var(--danger)',
  border: '1px solid var(--danger)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const readinessOkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
  borderRadius: 8, fontSize: 14, color: 'var(--ok, #16a34a)',
  background: 'rgba(22,163,74,0.08)',
};

const readinessWarnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
  borderRadius: 8, fontSize: 14, color: 'var(--warn, #d97706)',
  background: 'rgba(217,119,6,0.08)',
};

const infoBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  marginBottom: 16,
  borderRadius: 8,
  fontSize: 14,
  color: 'var(--fg-2)',
  background: 'rgba(37,99,235,0.08)',
};

const rowCardStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, marginBottom: 12,
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, background: 'var(--surface-2, #fafafa)',
};

const listRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  flexWrap: 'wrap',
};

const mutedTextStyle: React.CSSProperties = {
  color: 'var(--fg-3)',
  fontSize: 13,
};

const mutedParagraphStyle: React.CSSProperties = {
  color: 'var(--fg-3)',
  fontSize: 14,
  margin: 0,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  padding: 10,
  font: 'inherit',
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

function MsgLine({ msg }: { msg: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <div role={msg.kind === 'err' ? 'alert' : 'status'} style={{
      color: msg.kind === 'err' ? 'var(--danger)' : 'var(--ok, #16a34a)',
      fontSize: 14, padding: '4px 0',
    }}>
      {msg.text}
    </div>
  );
}
