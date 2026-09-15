import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Role } from '@tingting/shared';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';
import { FormGroup, Modal } from '../UI';

type AdvanceDraft = { id: number; version: number; requesterId: number; status: string; amount: string; reason: string };

/** One compact recovery control reused by office, forwarder and OPS wallet lists. */
export function AdvanceDraftActions({ request }: { request: AdvanceDraft }) {
  return request.status === 'DRAFT' ? <DraftActions request={request} /> : null;
}

function DraftActions({ request }: { request: AdvanceDraft }) {
  const auth = useAuth();
  const user = auth?.user;
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'record' | 'void' | null>(null);
  const [amount, setAmount] = useState(request.amount);
  const [reason, setReason] = useState(request.reason);
  const [resolutionReason, setResolutionReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const command = useRef({ fingerprint: '', key: '' });
  const busy = useRef(false);
  const office = user && [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(user.role);
  const owner = user?.role === Role.OPS && user.userId === request.requesterId;
  if ((!office && !owner) || !Number.isInteger(request.version)) return null;
  const valid = resolutionReason.trim().length > 0 && resolutionReason.length <= 1000
    && (action === 'void' || (Number.isSafeInteger(Number(amount)) && Number(amount) > 0
      && Number(amount) <= 999_999_999_999_999 && reason.trim().length > 0 && reason.length <= 1000));
  function open(next: 'record' | 'void') {
    setAmount(request.amount); setReason(request.reason); setResolutionReason(''); setError('');
    command.current = { fingerprint: '', key: '' }; setAction(next);
  }
  async function save() {
    if (!valid || !action || busy.current) return;
    busy.current = true; setPending(true); setError('');
    const body = { expectedVersion: request.version, resolutionReason: resolutionReason.trim(),
      ...(action === 'record' ? { amount: Number(amount), reason: reason.trim() } : {}) };
    const fingerprint = JSON.stringify({ action, body });
    if (command.current.fingerprint !== fingerprint) command.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await api.post(`${owner ? '/forwarder/me' : ''}/advance-requests/${request.id}/${action}`, body, { idempotencyKey: command.current.key });
      setAction(null);
      await Promise.all([
        qk.adminForwarder.advanceRequestsAll, qk.adminForwarder.advanceBalances,
        qk.forwarder.forwarderAdvanceRequestsAll, qk.forwarder.advanceBalance, qk.ops.root,
      ].map(queryKey => queryClient.invalidateQueries({ queryKey })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xử lý tạm ứng. Vui lòng thử lại.'); }
    finally { busy.current = false; setPending(false); }
  }
  const close = () => { if (!busy.current) setAction(null); };
  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => open('record')}>Ghi sổ</button>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => open('void')}>Hủy tạm ứng</button>
    </div>
    <Modal isOpen={action !== null} title={action === 'void' ? 'Hủy tạm ứng chưa ghi sổ' : 'Ghi sổ tạm ứng cũ'} onClose={close} maxWidth={420}
      footer={<><button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>Đóng</button>
        <button type="button" className="btn btn-primary" disabled={pending || !valid} onClick={() => void save()}>{pending ? 'Đang lưu…' : action === 'void' ? 'Xác nhận hủy' : 'Ghi sổ tạm ứng'}</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted">Tạm ứng #{request.id} · Chưa ghi sổ. Thao tác lưu có hiệu lực ngay và giữ lịch sử đối chiếu.</p>
        {action === 'record' && <>
          <FormGroup label="Số tiền (₫) *" error={Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= 999_999_999_999_999 ? '' : 'Nhập số tiền nguyên dương hợp lệ.'}><input className="input" type="number" inputMode="numeric" min="1" max="999999999999999" step="1" required value={amount} disabled={pending} onChange={event => setAmount(event.target.value)} /></FormGroup>
          <FormGroup label="Nội dung tạm ứng *"><textarea className="input" rows={2} required maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></FormGroup>
        </>}
        <FormGroup label="Lý do xử lý *"><textarea className="input" rows={2} required maxLength={1000} value={resolutionReason} disabled={pending} onChange={event => setResolutionReason(event.target.value)} /></FormGroup>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Modal>
  </>;
}
