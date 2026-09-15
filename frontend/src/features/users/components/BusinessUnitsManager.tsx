import { useState } from 'react';
import { userClient } from '../../../api/userClient';
import { useToast } from '../../../components/shared/Toast';
import { BUSINESS_UNIT_STATUS_LABELS } from '../utils';
import type { BusinessUnit } from '../utils';

/**
 * Đơn vị phụ trách lifecycle manager (create / rename / deactivate /
 * reactivate). Extracted from UsersPage so the page stays under the
 * structure guard's new-file ceiling; DOM and copy are unchanged.
 *
 * Version tokens: every mutation carries the loaded row's updatedAt as the
 * optimistic-lock token (the backend 428s without it), and a conflict
 * refetches the authoritative rows while preserving the admin's draft —
 * recovery, never a reload loop.
 */
export function BusinessUnitsManager({
  businessUnits,
  onRefresh,
}: {
  businessUnits: BusinessUnit[];
  onRefresh: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [unitDraft, setUnitDraft] = useState({ code: '', name: '' });
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);

  // The units list is the version-token source of truth: every mutation
  // carries the loaded row's updatedAt so the backend's optimistic lock
  // (428 when absent) can actually pass, and a conflict refetches this list
  // to mint a fresh token instead of looping the admin through reloads.
  function unitVersion(id: number): string {
    return businessUnits.find((unit) => unit.id === id)?.updatedAt ?? '';
  }

  function isVersionConflict(err: unknown): boolean {
    const e = err as { status?: number; code?: string };
    return (e.status === 428 || e.status === 409) && e.code !== 'DUPLICATE_CODE';
  }

  function isDuplicateCode(err: unknown): boolean {
    return (err as { code?: string }).code === 'DUPLICATE_CODE';
  }

  async function handleSaveBusinessUnit() {
    if (!unitDraft.name.trim()) {
      setUnitError('Tên đơn vị là bắt buộc.');
      return;
    }
    setSavingUnit(true);
    setUnitError(null);
    try {
      if (editingUnitId != null) {
        await userClient.updateBusinessUnit(editingUnitId, {
          code: unitDraft.code.trim() || null,
          name: unitDraft.name.trim(),
        }, unitVersion(editingUnitId));
        toast({ kind: 'success', message: 'Đã cập nhật đơn vị phụ trách' });
      } else {
        await userClient.createBusinessUnit({
          code: unitDraft.code.trim() || null,
          name: unitDraft.name.trim(),
        });
        toast({ kind: 'success', message: 'Đã tạo đơn vị phụ trách' });
      }
      setUnitDraft({ code: '', name: '' });
      setEditingUnitId(null);
      await onRefresh();
    } catch (err) {
      if (editingUnitId != null && isDuplicateCode(err)) {
        setUnitError('Mã hoặc tên đơn vị phụ trách đã tồn tại. Vui lòng chọn mã/tên khác.');
      } else if (editingUnitId != null && isVersionConflict(err)) {
        // Conflict: reload the authoritative rows for a fresh token but keep
        // the admin's draft for review — never a blind retry loop.
        setUnitError('Đơn vị đã được cập nhật ở nơi khác — đã tải lại bản mới nhất. Kiểm tra thông tin rồi lưu lại.');
        await onRefresh();
      } else {
        setUnitError(err instanceof Error ? err.message : 'Không thể lưu đơn vị phụ trách');
      }
    } finally {
      setSavingUnit(false);
    }
  }

  async function handleDeactivateBusinessUnit(unit: BusinessUnit) {
    setSavingUnit(true);
    setUnitError(null);
    try {
      await userClient.deactivateBusinessUnit(unit.id, unit.updatedAt);
      toast({ kind: 'success', message: 'Đã ngưng sử dụng đơn vị phụ trách' });
      if (editingUnitId === unit.id) {
        setEditingUnitId(null);
        setUnitDraft({ code: '', name: '' });
      }
      await onRefresh();
    } catch (err) {
      if (isDuplicateCode(err)) {
        setUnitError('Mã hoặc tên đơn vị phụ trách đã tồn tại.');
      } else if (isVersionConflict(err)) {
        setUnitError('Đơn vị đã được cập nhật ở nơi khác — đã tải lại bản mới nhất. Thử lại sau khi kiểm tra.');
        await onRefresh();
      } else {
        setUnitError(err instanceof Error ? err.message : 'Không thể ngưng sử dụng đơn vị phụ trách');
      }
    } finally {
      setSavingUnit(false);
    }
  }

  async function handleReactivateBusinessUnit(unit: BusinessUnit) {
    setSavingUnit(true);
    setUnitError(null);
    try {
      await userClient.updateBusinessUnit(unit.id, { status: 'ACTIVE' }, unit.updatedAt);
      toast({ kind: 'success', message: 'Đã kích hoạt lại đơn vị phụ trách' });
      await onRefresh();
    } catch (err) {
      if (isVersionConflict(err)) {
        setUnitError('Đơn vị đã được cập nhật ở nơi khác — đã tải lại bản mới nhất. Thử lại sau khi kiểm tra.');
        await onRefresh();
      } else {
        setUnitError(err instanceof Error ? err.message : 'Không thể kích hoạt lại đơn vị phụ trách');
      }
    } finally {
      setSavingUnit(false);
    }
  }

  return (
    <section className="business-units">
      <div className="business-units__header">
        <div>
          <h2 className="business-units__title">Đơn vị phụ trách</h2>
          <p className="business-units__subtitle">
            Ngừng sử dụng để ẩn đơn vị khỏi các lựa chọn mới. Lịch sử và các liên kết hiện có vẫn được giữ nguyên.
          </p>
        </div>
      </div>

      <div className="business-units__form-grid">
        <label className="business-units__form-label">
          <span>Mã đơn vị</span>
          <input
            className="input"
            value={unitDraft.code}
            onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value }))}
            placeholder="Ví dụ: HCM"
            disabled={savingUnit}
          />
        </label>
        <label className="business-units__form-label">
          <span>Tên đơn vị</span>
          <input
            className="input"
            value={unitDraft.name}
            onChange={(event) => setUnitDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ví dụ: Điều hành miền Nam"
            disabled={savingUnit}
          />
        </label>
      </div>

      <div className="business-units__actions">
        <button type="button" onClick={handleSaveBusinessUnit} disabled={savingUnit} className="btn btn-primary">
          {editingUnitId != null ? 'Lưu đơn vị' : 'Tạo đơn vị'}
        </button>
        {editingUnitId != null && (
          <button
            type="button"
            onClick={() => {
              setEditingUnitId(null);
              setUnitDraft({ code: '', name: '' });
              setUnitError(null);
            }}
            disabled={savingUnit}
            className="btn btn-ghost"
          >
            Hủy sửa
          </button>
        )}
      </div>

      {unitError && <div className="users-error-banner">{unitError}</div>}

      <div className="business-units__list">
        {businessUnits.map((unit) => (
          <article
            key={unit.id}
            className="business-units__card"
          >
            <div>
              <strong>{unit.name}</strong>
              <div className="business-units__card-meta">
                {unit.code ? `Mã ${unit.code}` : 'Không có mã'} · {BUSINESS_UNIT_STATUS_LABELS[unit.status]}
              </div>
            </div>
            <div className="business-units__card-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditingUnitId(unit.id);
                  setUnitDraft({ code: unit.code ?? '', name: unit.name });
                  setUnitError(null);
                }}
                disabled={savingUnit}
              >
                Sửa
              </button>
              {unit.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleDeactivateBusinessUnit(unit)}
                  disabled={savingUnit}
                >
                  Ngưng dùng
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleReactivateBusinessUnit(unit)}
                  disabled={savingUnit}
                >
                  Kích hoạt lại
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
