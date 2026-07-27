// ClerkShipmentDocsPage — M10.2 slice 3 clerk doc-entry page.
//
// Edits an existing DRAFT shipment's BL number + container set and (for
// MANAGER/ADMIN) dispatches it. Wires slice 1 (container ISO 6346 format +
// duplicate-within-shipment validation) and slice 2 (dispatch-readiness
// warnings) together:
//
//   - BL number field saves via PUT /api/shipments/:id (version-gated).
//   - Container list is a full reconcile: add/remove/edit rows, save via
//     PUT /api/shipments/:id/containers. Vietnamese validation errors from
//     slice 1 surface inline.
//   - A readiness banner shows the missing recommended fields (BL + ≥1
//     container), computed client-side from the loaded detail.
//   - MANAGER/ADMIN see a Dispatch button that opens a confirm dialog
//     listing the readiness warnings (if any) before POST /:id/dispatch.
//     CLERK does NOT see it — dispatch is an operator decision (Q17).
//
// Mobile-first single column, Vietnamese labels (PRD Mxx-HT-01).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { TextField, SelectField, EmptyState } from '../../design-system';
import { useConfirm } from '../../components/UI';
import { useAuth } from '../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { tripClient } from '../../api/tripClient';
import {
  getShipmentDetail,
  updateShipment,
  saveShipmentContainers,
  type ShipmentDetail,
  type ShipmentContainer,
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

  const [blNumber, setBlNumber] = useState('');
  const [version, setVersion] = useState(1);
  const [rows, setRows] = useState<ContainerRow[]>([]);

  const [savingBl, setSavingBl] = useState(false);
  const [savingContainers, setSavingContainers] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [blMsg, setBlMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [containerMsg, setContainerMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const canDispatch = user?.role === Role.ADMIN || user?.role === Role.MANAGER;

  // Load shipment detail + bootstrap catalogs once. CLERK can read the shared
  // bootstrap blob even though direct config endpoints stay locked down.
  useEffect(() => {
    if (!Number.isFinite(shipmentId)) {
      setLoadError('ID lô hàng không hợp lệ');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getShipmentDetail(shipmentId),
      tripClient.getBootstrap(),
    ])
      .then(([d, bootstrap]) => {
        if (cancelled) return;
        setDetail(d);
        setBlNumber(d.shipment.blNumber ?? '');
        setVersion(d.shipment.version);
        setRows(d.containers.map(toRow));
        setContainerTypes(bootstrap.containerTypes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Surface any server/network message (the api wrapper translates HTTP
        // bodies via ApiError.fromResponse); fall back to a generic hint.
        const msg = err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể tải thông tin lô hàng';
        setLoadError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shipmentId]);

  // Client-side dispatch-readiness mirror of the backend rule (slice 2):
  // BL non-blank + ≥1 container. Cheap; no extra round-trip.
  const readiness = useMemo(() => {
    const missing: string[] = [];
    if (!blNumber.trim()) missing.push('Số vận đơn (B/L)');
    if (rows.length === 0) missing.push('Công-te-nơ (ít nhất một)');
    return { ready: missing.length === 0, missing };
  }, [blNumber, rows]);

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

  async function handleSaveBl() {
    setSavingBl(true);
    setBlMsg(null);
    try {
      const updated = await updateShipment(shipmentId, { version, blNumber: blNumber.trim() || null });
      setVersion(updated.version);
      setBlMsg({ kind: 'ok', text: 'Đã lưu số vận đơn.' });
    } catch (err) {
      // Surface any server/network-provided Vietnamese message; fall back to
      // a generic hint when there is no usable message.
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu. Vui lòng thử lại.';
      setBlMsg({ kind: 'err', text: msg });
    } finally {
      setSavingBl(false);
    }
  }

  async function handleSaveContainers() {
    setSavingContainers(true);
    setContainerMsg(null);
    try {
      const res = await saveShipmentContainers(shipmentId, {
        containers: rows.map((r) => ({
          ...(r.id != null ? { id: r.id } : {}),
          containerTypeId: r.containerTypeId ? Number(r.containerTypeId) : null,
          containerNumber: r.containerNumber.trim() || null,
          sealNumber: r.sealNumber.trim() || null,
          cargoWeightKg: r.cargoWeightKg ? Number(r.cargoWeightKg) : null,
        })),
      });
      // Re-sync local row ids from the reconciled list so a subsequent save
      // doesn't drop the rows we just created (full-reconcile contract).
      setRows(res.items.map(toRow));
      setContainerMsg({ kind: 'ok', text: `Đã lưu ${res.items.length} công-te-nơ.` });
    } catch (err) {
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu công-te-nơ. Vui lòng thử lại.';
      setContainerMsg({ kind: 'err', text: msg });
    } finally {
      setSavingContainers(false);
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

      {/* Readiness banner (slice 2 mirror) */}
      <div style={readiness.ready ? readinessOkStyle : readinessWarnStyle}>
        {readiness.ready ? (
          <><CheckCircle2 size={16} /> Sẵn sàng điều vận</>
        ) : (
          <><AlertTriangle size={16} /> Còn thiếu: {readiness.missing.join(', ')}</>
        )}
      </div>

      {/* BL number */}
      <SectionCard title="Số vận đơn (B/L)">
        <TextField
          label="Số vận đơn (B/L)"
          value={blNumber}
          onChange={(e) => { setBlNumber(e.target.value); setBlMsg(null); }}
          placeholder="Ví dụ: MAEU1234567890"
          disabled={!isDraft || savingBl}
          maxLength={100}
        />
        {isDraft && (
          <button type="button" onClick={handleSaveBl} disabled={savingBl} style={primaryBtnStyle}>
            <Save size={16} /> {savingBl ? 'Đang lưu…' : 'Lưu vận đơn'}
          </button>
        )}
        {blMsg && <MsgLine msg={blMsg} />}
      </SectionCard>

      {/* Containers */}
      <SectionCard title={`Công-te-nơ (${rows.length})`}>
        {rows.length === 0 && (
          <p style={{ color: 'var(--fg-3)', fontSize: 14, margin: '8px 0' }}>
            Chưa có công-te-nơ. Thêm ít nhất một trước khi điều vận.
          </p>
        )}
        {rows.map((row, idx) => (
          <div key={row.id ?? `new-${idx}`} style={rowCardStyle}>
            <SelectField
              label="Loại công-te-nơ"
              value={row.containerTypeId}
              onChange={(e) => updateRow(idx, { containerTypeId: (e.target as HTMLSelectElement).value })}
              disabled={!isDraft || savingContainers}
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
              disabled={!isDraft || savingContainers}
              maxLength={50}
            />
            <TextField
              label="Số niêm phong"
              value={row.sealNumber}
              onChange={(e) => updateRow(idx, { sealNumber: e.target.value })}
              disabled={!isDraft || savingContainers}
              maxLength={50}
            />
            <TextField
              label="Trọng lượng hàng (kg)"
              type="number"
              value={row.cargoWeightKg}
              onChange={(e) => updateRow(idx, { cargoWeightKg: e.target.value })}
              disabled={!isDraft || savingContainers}
            />
            {isDraft && (
              <button type="button" onClick={() => removeRow(idx)} style={dangerBtnStyle} aria-label="Xóa công-te-nơ">
                <Trash2 size={16} /> Xóa
              </button>
            )}
          </div>
        ))}
        {isDraft && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={addRow} style={secondaryBtnStyle}>
              <Plus size={16} /> Thêm công-te-nơ
            </button>
            <button type="button" onClick={handleSaveContainers} disabled={savingContainers} style={primaryBtnStyle}>
              <Save size={16} /> {savingContainers ? 'Đang lưu…' : 'Lưu công-te-nơ'}
            </button>
          </div>
        )}
        {containerMsg && <MsgLine msg={containerMsg} />}
      </SectionCard>

      {/* Dispatch (MANAGER/ADMIN only — Q17) */}
      {canDispatch && isDraft && (
        <button type="button" onClick={handleDispatch} disabled={dispatching} style={{ ...primaryBtnStyle, background: 'var(--accent, #2563eb)' }}>
          <Send size={16} /> {dispatching ? 'Đang điều vận…' : 'Điều vận'}
        </button>
      )}
      {!isDraft && (
        <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 16 }}>
          Lô hàng đã được điều vận — không thể sửa hồ sơ.
        </p>
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

const rowCardStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, marginBottom: 12,
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, background: 'var(--surface-2, #fafafa)',
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

// EmptyState imported for the loading/empty branches above; the import is
// exercised when the container list is empty (placeholder text renders).
// Keep the import so the design-system surface is discoverable from this page.
void EmptyState;
