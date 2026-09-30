import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Role } from '@tingting/shared';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';
import { FormGroup, Modal } from '../UI';
import { NumberField } from '../../design-system';

type AdvanceDraft = {
  id: number; version: number; requesterId: number; status: string; amount: string; reason: string;
  /** Posted funding, net of reversals. Absent means UNKNOWN, never "unfunded". */
  fundedAmount?: number;
};

/** One compact recovery control reused by office, forwarder and OPS wallet lists. */
export function AdvanceDraftActions({ request }: { request: AdvanceDraft }) {
  if (request.status === 'DRAFT') return <DraftActions request={request} />;
  // Pre-demo audit: the OPS create path writes RECORDED (advance-request.service
  // `createAdvanceRequest`), so an OPS's own just-created request rendered no
  // action at all and the service refused it. The owner may withdraw it while NO
  // money has been funded. Shown only when the listing PROVES funding is 0: an
  // absent fundedAmount means unknown (shared type docs), and assuming
  // "unfunded" from unknown would offer a void the server must refuse.
  if (request.status === 'RECORDED' && request.fundedAmount === 0) return <DraftActions request={request} voidOnly />;
  return null;
}

function DraftActions({ request, voidOnly = false }: { request: AdvanceDraft; voidOnly?: boolean }) {
  const auth = useAuth();
  const user = auth?.user;
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'record' | 'void' | null>(null);
  const [amount, setAmount] = useState<number | ''>(request.amount ? Number(request.amount) : '');
  const [reason, setReason] = useState(request.reason);
  const [resolutionReason, setResolutionReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const command = useRef({ fingerprint: '', key: '' });
  const busy = useRef(false);
  const office = user && [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(user.role);
  const owner = user?.role === Role.OPS && user.userId === request.requesterId;
  // Office recovery stays DRAFT-only: withdrawing a RECORDED request is the
  // owner's own action, so `voidOnly` never renders for an office actor.
  if ((!office && !owner) || (voidOnly && !owner) || !Number.isInteger(request.version)) return null;
  const amountValid = typeof amount === 'number' && Number.isSafeInteger(amount)
    && amount > 0 && amount <= 999_999_999_999_999;
  const valid = resolutionReason.trim().length > 0 && resolutionReason.length <= 1000
    && (action === 'void' || (amountValid && reason.trim().length > 0 && reason.length <= 1000));
  function open(next: 'record' | 'void') {
    setAmount(request.amount ? Number(request.amount) : ''); setReason(request.reason); setResolutionReason(''); setError('');
    command.current = { fingerprint: '', key: '' }; setAction(next);
  }
  async function save() {
    if (!valid || !action || busy.current) return;
    busy.current = true; setPending(true); setError('');
    const body = { expectedVersion: request.version, resolutionReason: resolutionReason.trim(),
      ...(action === 'record' ? { amount, reason: reason.trim() } : {}) };
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
      {!voidOnly && <button type="button" className="btn btn-sm btn-primary" onClick={() => open('record')}>Ghi sổ</button>}
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => open('void')}>Hủy tạm ứng</button>
    </div>
    <Modal isOpen={action !== null} title={action === 'void' ? (voidOnly ? 'Hủy tạm ứng chưa giao tiền' : 'Hủy tạm ứng chưa ghi sổ') : 'Ghi sổ tạm ứng cũ'} onClose={close} maxWidth={420}
      footer={<><button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>Đóng</button>
        <button type="button" className="btn btn-primary" disabled={pending || !valid} onClick={() => void save()}>{pending ? 'Đang lưu…' : action === 'void' ? 'Xác nhận hủy' : 'Ghi sổ tạm ứng'}</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {/* business key render; id never user-facing — the draft payload carries no date/requester name */}
        <p className="text-muted">Tạm ứng{request.reason ? ` · ${request.reason}` : ''} · {voidOnly ? 'Chưa giao tiền' : 'Chưa ghi sổ'}. Thao tác lưu có hiệu lực ngay và giữ lịch sử đối chiếu.</p>
        {action === 'record' && <>
          <NumberField label="Số tiền (₫) *" grouped value={amount} disabled={pending} onChange={setAmount} error={amountValid ? '' : 'Nhập số tiền nguyên dương hợp lệ.'} />
          <FormGroup label="Nội dung tạm ứng *"><textarea className="input" rows={2} required maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></FormGroup>
        </>}
        <FormGroup label="Lý do xử lý *"><textarea className="input" rows={2} required maxLength={1000} value={resolutionReason} disabled={pending} onChange={event => setResolutionReason(event.target.value)} /></FormGroup>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Modal>
  </>;
}
