import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role } from '@tingting/shared';
import { cusGroupsClient, type CusGroup } from '../../../api/cusGroups';
import { userClient } from '../../../api/userClient';
import { qk } from '../../../api/keys';
import { useToast } from '../../../components/shared/Toast';

/**
 * Nhóm CUS — tạo nhóm + thêm thành viên (team-based visibility cho vai CUS,
 * 18/11). Render trên /users cạnh Đơn vị phụ trách cho ADMIN/MANAGER/
 * ACCOUNTANT (user ruling 19/11 — giamdoc và ketoan quản nhóm CUS cùng
 * admin). Thành viên cùng nhóm ACTIVE thấy lô hàng + debit của nhau ngay ở
 * request kế (scope tính từ DB mỗi request — không cần đăng nhập lại).
 *
 * Pattern copy từ BusinessUnitsManager: draft form + error banner + toast,
 * membership là replace-all (multi-select checkbox → PUT /:id/members).
 */
export function CusGroupsManager() {
  const { toast } = useToast();
  const groupsQuery = useQuery({
    queryKey: qk.catalogs.cusGroups,
    queryFn: cusGroupsClient.list,
  });
  const groups = groupsQuery.data?.items ?? [];

  // Roster: chỉ user vai CUS ĐANG HOẠT ĐỘNG đủ điều kiện vào nhóm (backend
  // từ chối các user khác — 400). Lấy trọn bộ (limit 500 = trần list users).
  const candidatesQuery = useQuery({
    queryKey: qk.catalogs.cusGroupCandidates,
    queryFn: () => userClient.getUsers({ role: Role.CUS, limit: 500 }),
  });
  const candidates = useMemo(
    () => (candidatesQuery.data?.items ?? []).filter((user) => user.status === 'ACTIVE'),
    [candidatesQuery.data],
  );

  const [nameDraft, setNameDraft] = useState('');
  const [renameDraft, setRenameDraft] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multi-select membership: draft per group being edited.
  const [memberDraft, setMemberDraft] = useState<Record<number, number[]>>({});

  const refetch = async () => {
    await groupsQuery.refetch();
  };

  async function handleCreate() {
    if (!nameDraft.trim()) {
      setError('Tên nhóm là bắt buộc.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cusGroupsClient.create({ name: nameDraft.trim() });
      toast({ kind: 'success', message: 'Đã tạo nhóm CUS' });
      setNameDraft('');
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo nhóm CUS');
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(group: CusGroup) {
    const nextName = (renameDraft[group.id] ?? group.name).trim();
    if (!nextName || nextName === group.name.trim()) {
      setEditingId(null);
      setRenameDraft((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cusGroupsClient.update(group.id, { name: nextName });
      toast({ kind: 'success', message: 'Đã cập nhật nhóm CUS' });
      setEditingId(null);
      setRenameDraft((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật nhóm CUS');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(group: CusGroup) {
    setSaving(true);
    setError(null);
    try {
      await cusGroupsClient.update(group.id, { status: group.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      toast({
        kind: 'success',
        message: group.status === 'ACTIVE'
          ? 'Đã ngưng nhóm — thành viên quay về chỉ thấy lô của mình'
          : 'Đã kích hoạt lại nhóm',
      });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi trạng thái nhóm');
    } finally {
      setSaving(false);
    }
  }

  function draftMembers(group: CusGroup): number[] {
    return memberDraft[group.id] ?? group.members.map((member) => member.userId);
  }

  function toggleMember(group: CusGroup, userId: number) {
    setMemberDraft((current) => {
      const selected = current[group.id] ?? group.members.map((member) => member.userId);
      const next = selected.includes(userId)
        ? selected.filter((id) => id !== userId)
        : [...selected, userId];
      return { ...current, [group.id]: next };
    });
  }

  async function handleSaveMembers(group: CusGroup) {
    setSaving(true);
    setError(null);
    try {
      await cusGroupsClient.setMembers(group.id, draftMembers(group));
      toast({ kind: 'success', message: 'Đã lưu thành viên nhóm — hiệu lực ngay' });
      setMemberDraft((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu thành viên nhóm');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="business-units">
      <div className="business-units__header">
        <div>
          <h2 className="business-units__title">Nhóm CUS</h2>
          <p className="business-units__subtitle">
            Thành viên cùng nhóm thấy lô hàng + quyết toán của nhau; ngoài nhóm chỉ thấy lô của mình.
            Gán/xóa thành viên có hiệu lực ngay, không cần đăng nhập lại.
          </p>
        </div>
      </div>

      <div className="business-units__form-grid">
        <label className="business-units__form-label">
          <span>Tên nhóm</span>
          <input
            className="input"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Ví dụ: Team CS 1"
            disabled={saving}
          />
        </label>
      </div>

      <div className="business-units__actions">
        <button type="button" onClick={handleCreate} disabled={saving} className="btn btn--primary">
          Tạo nhóm
        </button>
      </div>

      {error && <div className="users-error-banner">{error}</div>}

      <div className="business-units__list">
        {groups.map((group) => (
          <article key={group.id} className="business-units__card">
            <div style={{ minWidth: 0 }}>
              {editingId === group.id ? (
                <input
                  className="input"
                  value={renameDraft[group.id] ?? group.name}
                  onChange={(event) => setRenameDraft((current) => ({ ...current, [group.id]: event.target.value }))}
                  disabled={saving}
                />
              ) : (
                <strong>{group.name}</strong>
              )}
              <div className="business-units__card-meta">
                {group.status === 'ACTIVE' ? 'Đang chia sẻ' : 'Đã ngưng — mỗi người chỉ thấy lô của mình'}
                {' · '}{group.members.length} thành viên
              </div>
              {candidates.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {candidates.map((user) => (
                    <label key={user.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={draftMembers(group).includes(user.id)}
                        onChange={() => toggleMember(group, user.id)}
                        disabled={saving}
                      />
                      <span>{user.fullName?.trim() || user.username || `#${user.id}`}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="business-units__card-actions">
              {editingId === group.id ? (
                <>
                  <button type="button" className="btn btn--primary" onClick={() => handleRename(group)} disabled={saving}>
                    Lưu tên
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setEditingId(null);
                      setRenameDraft((current) => {
                        const next = { ...current };
                        delete next[group.id];
                        return next;
                      });
                    }}
                    disabled={saving}
                  >
                    Hủy sửa
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setEditingId(group.id);
                    setRenameDraft((current) => ({ ...current, [group.id]: group.name }));
                  }}
                  disabled={saving}
                >
                  Sửa tên
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => handleSaveMembers(group)}
                disabled={saving || memberDraft[group.id] === undefined}
              >
                Lưu thành viên
              </button>
              <button
                type="button"
                className={group.status === 'ACTIVE' ? 'btn btn--danger' : 'btn btn--ghost'}
                onClick={() => handleToggleStatus(group)}
                disabled={saving}
              >
                {group.status === 'ACTIVE' ? 'Ngưng nhóm' : 'Kích hoạt lại'}
              </button>
            </div>
          </article>
        ))}
        {groups.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>
            Chưa có nhóm nào — tạo nhóm rồi chọn thành viên để chia sẻ lô hàng trong nhóm.
          </p>
        )}
      </div>
    </section>
  );
}
