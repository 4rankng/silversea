import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignPhoiPhieuTruckAccountant, assignPhoiPhieuTruckAccountantsBatch, listPhoiPhieuTruckAssignments } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { UuiSelectField } from '../../design-system';

/**
 * Card 20260921_8 — vehicle → kế toán phơi phiếu assignments: one vehicle
 * belongs to exactly one accountant; the unassigned bucket stays visible so
 * nothing is missed. Saves go through the version-guarded reassignment API.
 *
 * Card 20260929_207 (extracted from PhoiPhieuControlPage.tsx): the batch-assign
 * work grew the page past the 400L new-file ceiling, so this panel and its row
 * moved here whole rather than being allowed to push the page over.
 */
export function PhoiPhieuTruckAssignments() {
  const queryClient = useQueryClient();
  const boardQuery = useQuery({
    queryKey: qk.phoiPhieu.truckAssignments,
    queryFn: listPhoiPhieuTruckAssignments,
  });
  const [message, setMessage] = useState<string | null>(null);
  // Card 20260928_166: the unassigned bucket is a WORKING SET, not a sentence.
  // It used to render as one comma-joined line of plates with no control on it,
  // so the 46 trucks PM's split needs could be read but never assigned.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [batchAccountant, setBatchAccountant] = useState('');
  const assignments = boardQuery.data?.assignments ?? [];
  const unassigned = boardQuery.data?.unassignedTrucks ?? [];
  const accountants = boardQuery.data?.accountants ?? [];
  const allPicked = unassigned.length > 0 && picked.size === unassigned.length;
  const togglePicked = (truckId: number) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(truckId)) next.delete(truckId); else next.add(truckId);
    return next;
  });
  const batchMutation = useMutation({
    mutationFn: () => assignPhoiPhieuTruckAccountantsBatch(
      { accountantId: batchAccountant === '' ? null : Number(batchAccountant), truckIds: [...picked] },
      crypto.randomUUID(),
    ),
    onSuccess: () => {
      setPicked(new Set());
      setMessage(`Đã phân công ${picked.size} xe.`);
      void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.truckAssignments });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { truckId: number; accountantId: number | null; expectedVersion: number }) =>
      assignPhoiPhieuTruckAccountant(input.truckId, { accountantId: input.accountantId, expectedVersion: input.expectedVersion }),
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.truckAssignments });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return (
    <details style={{ margin: '16px 0' }}>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--text-body-size)' }}>Phân công xe cho kế toán phơi phiếu</summary>
      {message && <p role="alert">{message}</p>}
      <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)', margin: '8px 0' }}>
        <caption>Xe đã phân công</caption>
        <thead><tr><th>Biển số</th><th>Kế toán phụ trách</th><th aria-label="Lưu" /></tr></thead>
        <tbody>
          {assignments.map((row) => (
            <AssignmentRow key={row.truckId} row={row} accountants={accountants} onSave={saveMutation.mutate} />
          ))}
          {assignments.length === 0 && <tr><td colSpan={3}>Chưa có xe nào được phân công.</td></tr>}
        </tbody>
      </table>
      {/* Card 20260928_166 AC1: the 39-truck split. Pick the trucks, pick the
          accountant, assign in ONE all-or-nothing call. The scope is stated on
          the control itself, because the header select-all it replaced used to
          mean "everything on this page" with no label saying so. */}
      <div className="ppc-assign-batch">
        <div className="ppc-assign-batch__bar">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setPicked(allPicked ? new Set() : new Set(unassigned.map((t) => t.truckId)))}
            disabled={unassigned.length === 0}
            title={allPicked ? 'Bỏ chọn tất cả xe chưa phân công' : `Chọn cả ${unassigned.length} xe chưa phân công`}
          >
            {allPicked ? 'Bỏ chọn tất cả' : `Chọn tất cả (${unassigned.length})`}
          </button>
          <UuiSelectField
            label="Kế toán phụ trách cho xe đã chọn"
            hideLabel
            value={batchAccountant}
            onChange={(event) => setBatchAccountant(event.target.value)}
            options={[{ value: '', label: '— Chọn kế toán —' }, ...accountants.map((a) => ({ value: String(a.id), label: a.fullName ?? `Kế toán #${a.id}` }))]}
            width="content"
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={picked.size === 0 || batchMutation.isPending}
            onClick={() => batchMutation.mutate()}
          >
            {batchMutation.isPending ? 'Đang gán…' : `Phân công ${picked.size} xe`}
          </button>
          <span className="ppc-assign-batch__count" role="status">
            {unassigned.length === 0
              ? 'Mọi xe đã có kế toán phụ trách.'
              : `Đã chọn ${picked.size}/${unassigned.length} xe chưa phân công`}
          </span>
        </div>
        {unassigned.length === 0 ? null : (
          <ul className="ppc-assign-batch__list">
            {unassigned.map((truck) => (
              <li key={truck.truckId}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(truck.truckId)}
                    onChange={() => togglePicked(truck.truckId)}
                    aria-label={`Chọn xe ${truck.plate}`}
                  />
                  <span>{truck.plate}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function AssignmentRow({ row, accountants, onSave }: {
  row: { truckId: number; plate: string; accountantId: number | null; version: number };
  accountants: Array<{ id: number; fullName: string | null }>;
  onSave: (input: { truckId: number; accountantId: number | null; expectedVersion: number }) => void;
}) {
  const [picked, setPicked] = useState<string>(row.accountantId == null ? '' : String(row.accountantId));
  return (
    <tr>
      <td>{row.plate}</td>
      <td>
        <UuiSelectField
          label={`Kế toán phụ trách ${row.plate}`}
          hideLabel
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          options={[{ value: '', label: '— Chưa gán —' }, ...accountants.map((accountant) => ({ value: String(accountant.id), label: accountant.fullName ?? `Kế toán #${accountant.id}` }))]}
          width="content"
        />
      </td>
      <td>
        <button
          type="button"
          onClick={() => onSave({ truckId: row.truckId, accountantId: picked === '' ? null : Number(picked), expectedVersion: row.version })}
        >
          Lưu
        </button>
      </td>
    </tr>
  );
}
