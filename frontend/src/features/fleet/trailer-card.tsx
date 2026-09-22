import { useState, useMemo, memo } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../../design-system";
import { Truck, Plus, Pencil, Trash2, X, Loader2, ArrowRight } from "lucide-react";
import { Panel, StatusPill, Modal, useConfirm } from "../../components/UI";
import { StatusStrip } from "../../components/shared/StatusStrip";
import { useCRUD } from "../../hooks/useCRUD";
import { useTires } from "../../hooks/useTireQueries";
import { TrailerType, TRAILER_TYPE_LABELS } from "@tingting/shared";
import type { Tire, Truck as TruckType } from "@tingting/shared";
import { routes } from "../../lib/routes";

// Extracted form modals + shared fleet constants
import { TrailerFormModal, TRUCK_STATUS, DRIVER_STATUS, fleetStyles as styles } from ".";

import "../../pages/FleetPage.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const Plate = memo(function Plate({ plate, tag }: { plate: string; tag: string }) {
  return (
    <span className="fleet-plate">
      <span className="fleet-plate-tag">{tag}</span>
      {plate}
    </span>
  );
});

const TypeChip = memo(function TypeChip({ type }: { type: string | null }) {
  // Blank type renders the explicit unknown label on a neutral chip — never
  // an empty pill borrowing the 20FT style.
  const cls = type === TrailerType.FT40 ? "ft40" : type === TrailerType.FT20 ? "ft20" : "unknown";
  return <span className={`fleet-type-chip ${cls}`}>{type ? (TRAILER_TYPE_LABELS[type as TrailerType] || type) : "Chưa rõ loại"}</span>;
});

const StatusDot = memo(function StatusDot({ status }: { status: string }) {
  const variant = status === "ACTIVE" ? "success" : status === "MAINTENANCE" ? "warn" : "neutral";
  const label = TRUCK_STATUS[status] || DRIVER_STATUS[status] || status;
  return (
    <StatusPill variant={variant} dot>
      {label}
    </StatusPill>
  );
});

function fleetStatusColor(status: string): string {
  if (status === "ACTIVE") return "#059669";
  if (status === "MAINTENANCE") return "#D97706";
  return "#6B7280";
}

const TireQuickLink = memo(function TireQuickLink({ to, count }: { to: string; count: number }) {
  return (
    <Link to={to} className={`fleet-tire-link${count === 0 ? " fleet-tire-link--empty" : ""}`} onClick={(e) => e.stopPropagation()} aria-label={`Quản lý lốp, hiện có ${count} lốp`}>
      <span className="fleet-tire-link__count">{count}</span>
      <span>Lốp</span>
      <ArrowRight size={13} />
    </Link>
  );
});

function FleetStatusLegend({ maintenance = true }: { maintenance?: boolean }) {
  return (
    <span className="fleet-status-legend" aria-label="Chú giải trạng thái">
      <span className="fleet-legend-item">
        <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("ACTIVE") }} /> Hoạt động
      </span>
      {maintenance && (
        <span className="fleet-legend-item">
          <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("MAINTENANCE") }} /> Bảo trì
        </span>
      )}
      <span className="fleet-legend-item">
        <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("INACTIVE") }} /> Ngưng
      </span>
    </span>
  );
}

// ─── DetailModal — shared view dialog with edit/delete actions ────────────────

function DetailModal({ isOpen, title, onClose, details, onEdit, onDelete, deleting, itemId }: { isOpen: boolean; title: string; onClose: () => void; details: Array<{ label: string; value: React.ReactNode }>; onEdit: () => void; onDelete?: () => void; deleting: number | null; itemId: number }) {
  const primary = details[0];
  const status = details.find((d) => d.label === "Trạng thái");
  const secondary = details.filter((d, i) => i !== 0 && d.label !== "Trạng thái");

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      maxWidth={620}
      footer={
        <div className="fleet-detail-actions">
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            <X size={14} /> Đóng
          </button>
          <button className="btn btn--primary btn--sm" onClick={onEdit}>
            <Pencil size={13} /> Sửa
          </button>
          {onDelete && (
            <button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)" }} disabled={deleting === itemId} onClick={onDelete}>
              {deleting === itemId ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              Xóa
            </button>
          )}
        </div>
      }
    >
      <div className="fleet-detail">
        {primary && (
          <div className="fleet-detail__hero">
            <div className="fleet-detail__identity">
              <div className="fleet-detail__label">{primary.label}</div>
              <div className="fleet-detail__primary">{primary.value}</div>
            </div>
            {status && (
              <div className="fleet-detail__status">
                <div className="fleet-detail__label">Trạng thái</div>
                <div>{status.value}</div>
              </div>
            )}
          </div>
        )}

        <div className="fleet-detail__grid">
          {secondary.map((d, i) => (
            <div className={`fleet-detail__item${d.label === "Lốp" ? " fleet-detail__item--wide" : ""}`} key={`${d.label}-${i}`}>
              <div className="fleet-detail__label">{d.label}</div>
              <div className="fleet-detail__value">{d.value}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── TrailerCard ────────────────────────────────────────────────────────────

export function TrailerCard({ trailers, trucks, crud }: { trailers: Array<{ id: number; licensePlate: string; type: string | null; status: string }>; trucks: TruckType[]; crud: ReturnType<typeof useCRUD> }) {
  const [viewingId, setViewingId] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: tires = [] } = useTires();
  // Build reverse lookup: trailerId → truck plate, so we can show which đầu
  // kéo each rơ-moóc is currently coupled to.
  const truckByTrailer = useMemo(() => {
    const m = new Map<number, TruckType>();
    trucks.forEach((t) => {
      if (t.currentTrailerId) m.set(t.currentTrailerId, t);
    });
    return m;
  }, [trucks]);
  // Count IN_USE tires per rơ-moóc for the Lốp quick-link badge.
  const tireCountByTrailer = useMemo(() => {
    const counts = new Map<number, number>();
    (tires as Tire[]).forEach((tire) => {
      if (tire.trailerId && tire.status === "IN_USE") {
        counts.set(tire.trailerId, (counts.get(tire.trailerId) ?? 0) + 1);
      }
    });
    return counts;
  }, [tires]);
  const ft40 = trailers.filter((t) => t.type === TrailerType.FT40).length;
  const ft20 = trailers.filter((t) => t.type === TrailerType.FT20).length;
  // Fleet sheets routinely leave Loại Moóc blank (the column is nullable by
  // design), so the subtotals must reconcile with the list through an
  // explicit unknown bucket — ft40 + ft20 + unknown === trailers.length.
  // Counts anything outside the two known types (null included).
  const unknownType = trailers.length - ft40 - ft20;
  const active = trailers.filter((t) => t.status === "ACTIVE").length;

  return (
    <Panel flush>
      <div className="fleet-card-head">
        <div className="fleet-card-lead">
          <div className="fleet-card-icon">
            <Truck size={18} />
          </div>
          <div>
            <div className="fleet-card-title">
              Rơ-moóc <span className="count-pill">{trailers.length}</span>
            </div>
            <div className="fleet-card-sub">Quản lý rơ-moóc · Tách chi phí sửa chữa, đăng kiểm, thay lốp theo từng rơ-moóc</div>
          </div>
        </div>
        <div className="fleet-card-tools">
          <button className="btn btn--primary btn--sm" onClick={() => crud.setShowAddForm(true)}>
            <Plus size={13} /> Thêm rơ-moóc
          </button>
        </div>
      </div>
      <div className="desktop-only">
        <div className="table-scroll">
          <table className="tt-table">
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Biển số rơ-moóc</th>
                <th>Loại</th>
                <th>Đầu kéo đang ghép</th>
                <th>Lốp</th>
              </tr>
            </thead>
            <tbody>
              {trailers.length === 0 && (
                <tr>
                  <td colSpan={5} style={styles.emptyRow}>
                    <EmptyState variant="compact" context="trucks" title={'Chưa có rơ-moóc nào. Bấm "Thêm rơ-moóc" để tạo mới.'} />
                  </td>
                </tr>
              )}
              {trailers.map((t, i) => {
                const coupledTruck = truckByTrailer.get(t.id);
                return (
                  <tr
                    key={t.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setViewingId(t.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setViewingId(t.id);
                      }
                    }}
                  >
                    <td className="num fleet-status-cell">
                      <StatusStrip color={fleetStatusColor(t.status)} />
                      {i + 1}
                    </td>
                    <td>
                      <Plate plate={t.licensePlate} tag="RM" />
                    </td>
                    <td>
                      <TypeChip type={t.type} />
                    </td>
                    <td>
                      {coupledTruck ? (
                        <span className="fleet-pair">
                          <Plate plate={coupledTruck.licensePlate} tag="VN" />
                        </span>
                      ) : (
                        <span className="fleet-unassigned">— Chưa ghép —</span>
                      )}
                    </td>
                    <td>
                      <TireQuickLink to={routes.fleetTrailerTires(t.id)} count={tireCountByTrailer.get(t.id) ?? 0} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <div className="fleet-legend">
            <span>
              <strong style={styles.fontMono}>{ft40}</strong> × 40FT
            </span>
            <span style={styles.dotSep}>·</span>
            <span>
              <strong style={styles.fontMono}>{ft20}</strong> × 20FT
            </span>
            {unknownType > 0 && (
              <>
                <span style={styles.dotSep}>·</span>
                <span>
                  <strong style={styles.fontMono}>{unknownType}</strong> × Chưa rõ loại
                </span>
              </>
            )}
            <span style={styles.dotSep}>·</span>
            <span>{active} đang hoạt động</span>
            <span style={styles.dotSep}>·</span>
            <FleetStatusLegend />
          </div>
          <span>Hiển thị {trailers.length}</span>
        </div>
      </div>
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {trailers.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)" }}>
              <EmptyState variant="compact" context="trucks" title="Chưa có rơ-moóc nào" />
            </div>
          )}
          {trailers.map((t) => {
            const coupledTruck = truckByTrailer.get(t.id);
            return (
              <div key={t.id} className="m-card" onClick={() => setViewingId(t.id)}>
                <StatusStrip color={fleetStatusColor(t.status)} />
                <div className="m-card__top">
                  <span className="m-card__title">
                    <span className="fleet-plate-tag" style={{ marginRight: 6, background: "var(--ink)", color: "#fff", padding: "3px 6px", borderRadius: 4, fontSize: 'var(--text-body-size)', lineHeight: 1.35, letterSpacing: "0.5px" }}>
                      RM
                    </span>
                    {t.licensePlate}
                  </span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Loại</span>
                  <span>
                    <TypeChip type={t.type} />
                  </span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Đầu kéo ghép</span>
                  <span className="m-card__row-value">{coupledTruck ? coupledTruck.licensePlate : "— Chưa ghép —"}</span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Lốp</span>
                  <TireQuickLink to={routes.fleetTrailerTires(t.id)} count={tireCountByTrailer.get(t.id) ?? 0} />
                </div>
                <div className="fleet-card-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      crud.setEditingId(t.id);
                    }}
                  >
                    Sửa
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ color: "var(--danger)" }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm('Xóa rơ-moóc này?', { variant: 'danger', confirmLabel: 'Xóa' })) {
                        crud.doDelete(t.id);
                      }
                    }}
                  >
                    Xóa
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="table-foot">
          <div className="fleet-legend">
            <span>
              <strong style={styles.fontMono}>{ft40}</strong> × 40FT
            </span>
            <span style={styles.dotSep}>·</span>
            <span>
              <strong style={styles.fontMono}>{ft20}</strong> × 20FT
            </span>
            {unknownType > 0 && (
              <>
                <span style={styles.dotSep}>·</span>
                <span>
                  <strong style={styles.fontMono}>{unknownType}</strong> × Chưa rõ loại
                </span>
              </>
            )}
            <span style={styles.dotSep}>·</span>
            <span>{active} đang hoạt động</span>
            <span style={styles.dotSep}>·</span>
            <FleetStatusLegend />
          </div>
          <span>Hiển thị {trailers.length}</span>
        </div>
      </div>
      {crud.error && <div style={styles.errorBanner}>{crud.error}</div>}
      <DetailModal
        isOpen={viewingId != null}
        title="Rơ-moóc"
        onClose={() => setViewingId(null)}
        itemId={viewingId ?? 0}
        deleting={crud.deleting}
        onEdit={() => {
          const id = viewingId;
          setViewingId(null);
          if (id != null) crud.setEditingId(id);
        }}
        onDelete={async () => {
          const id = viewingId;
          setViewingId(null);
          if (id != null && await confirm('Xóa rơ-moóc này?', { variant: 'danger', confirmLabel: 'Xóa' })) {
            crud.doDelete(id);
          }
        }}
        details={(() => {
          const t = viewingId != null ? trailers.find((x) => x.id === viewingId) : null;
          if (!t) return [];
          const coupledTruck = truckByTrailer.get(t.id);
          return [
            { label: "Biển số rơ-moóc", value: <Plate plate={t.licensePlate} tag="RM" /> },
            { label: "Loại", value: <TypeChip type={t.type} /> },
            { label: "Đầu kéo đang ghép", value: coupledTruck ? <Plate plate={coupledTruck.licensePlate} tag="VN" /> : <span className="fleet-unassigned">— Chưa ghép —</span> },
            { label: "Lốp", value: <TireQuickLink to={routes.fleetTrailerTires(t.id)} count={tireCountByTrailer.get(t.id) ?? 0} /> },
            { label: "Trạng thái", value: <StatusDot status={t.status} /> },
          ];
        })()}
      />
      <TrailerFormModal
        key={crud.editingId ?? (crud.showAddForm ? "add" : "closed")}
        isOpen={crud.showAddForm || crud.editingId != null}
        saving={crud.saving}
        item={crud.editingId != null ? trailers.find((t) => t.id === crud.editingId) : undefined}
        onsave={(d) => {
          if (crud.editingId != null) crud.doUpdate(crud.editingId, d);
          else crud.doCreate(d);
        }}
        oncancel={crud.cancelForm}
      />
      {confirmDialog}
    </Panel>
  );
}

// ─── Card Components ─────────────────────────────────────────────────────────
