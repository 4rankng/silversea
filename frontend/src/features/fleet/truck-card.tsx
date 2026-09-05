import { useState, useMemo, memo } from "react";
import { Link } from "react-router-dom";
import { EmptyIllustration } from "../../components/shared";
import { Truck, UserCheck, Plus, Pencil, Trash2, X, Loader2, ArrowRight } from "lucide-react";
import { Panel, StatusPill, Modal, useConfirm } from "../../components/UI";
import { StatusStrip } from "../../components/shared/StatusStrip";
import { useCRUD } from "../../hooks/useCRUD";
import { useTires } from "../../hooks/useTireQueries";
import type { TireStatus } from "@tingting/shared";
import { TrailerType, TRAILER_TYPE_LABELS, TIRE_STATUS_LABELS } from "@tingting/shared";
import type { Tire, Truck as TruckType, Driver } from "@tingting/shared";
import { routes } from "../../lib/routes";
import { formatDate } from "../../lib/format";

// Extracted form modals + shared fleet constants
import { TruckFormModal, TRUCK_STATUS, DRIVER_STATUS, fleetStyles as styles } from ".";

import "../../pages/FleetPage.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DriverAvatarIcon = memo(function DriverAvatarIcon() {
  return (
    <span className="fleet-avatar" aria-hidden="true">
      <UserCheck size={14} />
    </span>
  );
});

const Plate = memo(function Plate({ plate, tag }: { plate: string; tag: string }) {
  return (
    <span className="fleet-plate">
      <span className="fleet-plate-tag">{tag}</span>
      {plate}
    </span>
  );
});

const TypeChip = memo(function TypeChip({ type }: { type: string }) {
  const cls = type === TrailerType.FT40 ? "ft40" : "ft20";
  return <span className={`fleet-type-chip ${cls}`}>{TRAILER_TYPE_LABELS[type as TrailerType] || type}</span>;
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

function tireStatusVariant(status: TireStatus): "neutral" | "success" | "warn" {
  if (status === "IN_USE") return "success";
  return "neutral";
}

const TireDetailList = memo(function TireDetailList({ truckId, tires }: { truckId: number; tires: Tire[] }) {
  const mountedTires = tires.filter((tire) => tire.truckId === truckId && tire.status === "IN_USE");

  if (mountedTires.length === 0) {
    return <TireQuickLink to={routes.fleetTires(truckId)} count={0} />;
  }

  return (
    <div className="fleet-tire-detail">
      <div className="fleet-tire-detail__head">
        <span>
          <strong>{mountedTires.length}</strong> lốp đang lắp
        </span>
        <TireQuickLink to={routes.fleetTires(truckId)} count={mountedTires.length} />
      </div>
      <div className="fleet-tire-detail__list">
        {mountedTires.map((tire) => (
          <div className="fleet-tire-detail__row" key={tire.id}>
            <div className="fleet-tire-detail__main">
              <span className="fleet-tire-detail__serial">{tire.serial}</span>
              <span className="fleet-tire-detail__position">{tire.position || "Chưa nhập vị trí"}</span>
            </div>
            <div className="fleet-tire-detail__meta">
              <span>{tire.size || "—"}</span>
              {tire.purchasedAt && <span>Mua {formatDate(tire.purchasedAt)}</span>}
              <StatusPill variant={tireStatusVariant(tire.status)}>{TIRE_STATUS_LABELS[tire.status]}</StatusPill>
            </div>
          </div>
        ))}
      </div>
    </div>
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

export function TruckCard({ trucks, driverByTruck, trailers, crud }: { trucks: TruckType[]; driverByTruck: Map<number, Driver>; trailers: Array<{ id: number; licensePlate: string; type: string }>; crud: ReturnType<typeof useCRUD> }) {
  const [viewingId, setViewingId] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: tires = [] } = useTires();
  const active = trucks.filter((t) => t.status === "ACTIVE").length;
  const maint = trucks.filter((t) => t.status === "MAINTENANCE").length;
  const tireCountByTruck = useMemo(() => {
    const counts = new Map<number, number>();
    (tires as Tire[]).forEach((tire) => {
      if (tire.truckId && tire.status === "IN_USE") {
        counts.set(tire.truckId, (counts.get(tire.truckId) ?? 0) + 1);
      }
    });
    return counts;
  }, [tires]);

  return (
    <Panel flush>
      <div className="fleet-card-head">
        <div className="fleet-card-lead">
          <div className="fleet-card-icon">
            <Truck size={18} />
          </div>
          <div>
            <div className="fleet-card-title">
              Xe đầu kéo <span className="count-pill">{trucks.length}</span>
            </div>
            <div className="fleet-card-sub">Quản lý đầu kéo và trạng thái hoạt động</div>
          </div>
        </div>
        <div className="fleet-card-tools">
          <button className="btn btn--primary btn--sm" onClick={() => crud.setShowAddForm(true)}>
            <Plus size={13} /> Thêm xe
          </button>
        </div>
      </div>
      <div className="desktop-only">
        <div className="table-scroll">
          <table className="tt-table">
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Biển số xe đầu</th>
                <th>Rơ-moóc</th>
                <th>Lái xe gán</th>
                <th>Lốp</th>
              </tr>
            </thead>
            <tbody>
              {trucks.length === 0 && (
                <tr>
                  <td colSpan={5} style={styles.emptyRow}>
                    <EmptyIllustration name="empty-trucks" width={140} height={116} style={{ margin: "0 auto 8px", display: "block" }} />
                    <div>Chưa có dữ liệu</div>
                  </td>
                </tr>
              )}
              {trucks.map((t, i) => (
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
                    <Plate plate={t.licensePlate} tag="VN" />
                  </td>
                  <td>
                    {(() => {
                      const tr = t.currentTrailerId ? trailers.find((x) => x.id === t.currentTrailerId) : null;
                      return tr ? (
                        <span className="fleet-pair">
                          <Plate plate={tr.licensePlate} tag="RM" /> <TypeChip type={(tr.type as TrailerType) ?? TrailerType.FT40} />
                        </span>
                      ) : t.trailerPlateNumber ? (
                        <span className="fleet-pair">
                          <Plate plate={t.trailerPlateNumber} tag="RM" /> <TypeChip type={t.trailerType ?? TrailerType.FT40} />
                        </span>
                      ) : (
                        <span className="fleet-unassigned">—</span>
                      );
                    })()}
                  </td>
                  <td>
                    {driverByTruck.has(t.id) ? (
                      <span className="fleet-assigned">
                        <DriverAvatarIcon />
                        <span className="name">{driverByTruck.get(t.id)!.name}</span>
                      </span>
                    ) : (
                      <span className="fleet-unassigned">— Chưa phân —</span>
                    )}
                  </td>
                  <td>
                    <TireQuickLink to={routes.fleetTires(t.id)} count={tireCountByTruck.get(t.id) ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <div className="fleet-legend">
            <FleetStatusLegend />
          </div>
          <span>
            Hoạt động {active} · Bảo trì {maint}
          </span>
        </div>
      </div>
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {trucks.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)" }}>
              <EmptyIllustration name="empty-trucks" width={150} height={124} style={{ margin: "0 auto 8px", display: "block" }} />
              <div>Chưa có dữ liệu</div>
            </div>
          )}
          {trucks.map((t) => {
            const trailer = t.currentTrailerId ? trailers.find((x) => x.id === t.currentTrailerId) : null;
            const driver = driverByTruck.get(t.id);
            return (
              <div key={t.id} className="m-card" onClick={() => setViewingId(t.id)}>
                <StatusStrip color={fleetStatusColor(t.status)} />
                <div className="m-card__top">
                  <span className="m-card__title">
                    <span className="fleet-plate-tag" style={{ marginRight: 6, background: "var(--ink)", color: "#fff", padding: "3px 6px", borderRadius: 4, fontSize: 12, lineHeight: 1.35, letterSpacing: "0.5px" }}>
                      VN
                    </span>
                    {t.licensePlate}
                  </span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Rơ-moóc</span>
                  <span className="m-card__row-value">{trailer ? trailer.licensePlate : "—"}</span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Lái xe</span>
                  <span className="m-card__row-value">{driver ? driver.name : "— Chưa phân —"}</span>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Lốp</span>
                  <TireQuickLink to={routes.fleetTires(t.id)} count={tireCountByTruck.get(t.id) ?? 0} />
                </div>
                <div className="fleet-card-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingId(t.id);
                    }}
                  >
                    Xem
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ color: "var(--danger)" }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm('Xóa xe đầu kéo này?', { variant: 'danger', confirmLabel: 'Xóa' })) {
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
            <FleetStatusLegend />
          </div>
          <span>
            Hoạt động {active} · Bảo trì {maint}
          </span>
        </div>
      </div>
      {crud.error && <div style={styles.errorBanner}>{crud.error}</div>}
      <DetailModal
        isOpen={viewingId != null}
        title="Xe đầu kéo"
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
          if (id != null && await confirm('Xóa xe đầu kéo này?', { variant: 'danger', confirmLabel: 'Xóa' })) {
            crud.doDelete(id);
          }
        }}
        details={(() => {
          const t = viewingId != null ? trucks.find((x) => x.id === viewingId) : null;
          if (!t) return [];
          const tr = t.currentTrailerId ? trailers.find((x) => x.id === t.currentTrailerId) : null;
          const driver = driverByTruck.get(t.id);
          return [
            { label: "Biển số xe đầu", value: <Plate plate={t.licensePlate} tag="VN" /> },
            {
              label: "Rơ-moóc",
              value: tr ? (
                <span className="fleet-pair">
                  <Plate plate={tr.licensePlate} tag="RM" /> <TypeChip type={(tr.type as TrailerType) ?? TrailerType.FT40} />
                </span>
              ) : (
                <span className="fleet-unassigned">—</span>
              ),
            },
            {
              label: "Lái xe gán",
              value: driver ? (
                <span className="fleet-assigned">
                  <DriverAvatarIcon />
                  <span className="name">{driver.name}</span>
                </span>
              ) : (
                <span className="fleet-unassigned">— Chưa phân —</span>
              ),
            },
            { label: "Trạng thái", value: <StatusDot status={t.status} /> },
            { label: "Lốp", value: <TireDetailList truckId={t.id} tires={tires as Tire[]} /> },
          ];
        })()}
      />
      <TruckFormModal
        key={crud.editingId ?? (crud.showAddForm ? "add" : "closed")}
        isOpen={crud.showAddForm || crud.editingId != null}
        saving={crud.saving}
        item={crud.editingId != null ? trucks.find((t) => t.id === crud.editingId) : undefined}
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
