import { useId, useRef, useState } from 'react';
import { treasuryAccountFundSchema, treasuryAccountSetupSchema } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import { customerServiceFinanceClient, type TreasuryPosition } from '../../api/customerServiceFinanceClient';
import { businessDateISO } from '../../lib/format';

type Account = TreasuryPosition['accounts'][number];
export function TreasuryAccountDrawer({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [fundCode, setFundCode] = useState(account?.fundCode ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('BANK');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [balance, setBalance] = useState<number | ''>(0);
  const [date, setDate] = useState(businessDateISO);
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const close = () => { if (!lock.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    const edit = treasuryAccountFundSchema.safeParse({ fundCode, reason, expectedVersion: account?.version });
    const create = treasuryAccountSetupSchema.safeParse({ fundCode, code, name, type, bankName: type === 'BANK' ? bankName : undefined,
      bankAccountNumber: type === 'BANK' ? bankAccountNumber : undefined, openingBalance: balance, openingBalanceDate: date, reason, openingBalanceEvidence: evidence });
    const parsed = account ? edit : create;
    if (!parsed.success) { setError('Chọn nguồn quỹ và điền đầy đủ thông tin hợp lệ. Số dư phải là số nguyên VND.'); return; }
    const payload = JSON.stringify(parsed.data);
    if (command.current?.payload !== payload) command.current = { payload, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError('');
    try {
      if (account && edit.success) await customerServiceFinanceClient.updateTreasuryAccountFund(account.accountId, edit.data, command.current.key);
      else if (create.success) await customerServiceFinanceClient.createTreasuryAccount(create.data, command.current.key);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được. Giữ nguyên nội dung và thử lại.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Drawer isOpen onClose={close} title={account ? 'Phân nguồn quỹ' : 'Thêm tài khoản quỹ'} subtitle={account?.name}
    footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button className="btn btn--primary" form={id} type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu tài khoản'}</button></>}>
    <form id={id} className="treasury-account-form" noValidate onSubmit={event => void save(event)}>
      {error && <p role="alert" className="treasury-notice treasury-notice--error">{error}</p>}
      <p>{account ? 'Chỉ thay đổi nguồn quỹ của tài khoản; giữ nguyên số dư và lịch sử giao dịch.' : 'Thiết lập tài khoản thực tế để ghi thu / chi. Không gửi tiền qua ngân hàng.'}</p>
      <UuiSelectField label="Nguồn quỹ" required value={fundCode} disabled={busy} onChange={event => setFundCode(event.target.value)} options={[{ value: '', label: 'Chọn nguồn quỹ' }, { value: 'COMPANY', label: 'Quỹ công ty' }, { value: 'TM', label: 'Quỹ TM' }]} />
      {!account && <>
        <div className="treasury-account-fields">
          <TextField controlSize="sm" label="Mã tài khoản" required maxLength={50} value={code} disabled={busy} onChange={event => setCode(event.target.value)} />
          <TextField controlSize="sm" label="Tên tài khoản" required maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </div>
        <UuiSelectField label="Loại tài khoản" value={type} disabled={busy} onChange={event => setType(event.target.value)} options={[{ value: 'BANK', label: 'Ngân hàng' }, { value: 'CASH', label: 'Tiền mặt' }]} />
        {type === 'BANK' && <div className="treasury-account-fields">
          <TextField controlSize="sm" label="Ngân hàng" maxLength={160} value={bankName} disabled={busy} onChange={event => setBankName(event.target.value)} />
          <TextField controlSize="sm" label="Số tài khoản ngân hàng" maxLength={80} value={bankAccountNumber} disabled={busy} onChange={event => setBankAccountNumber(event.target.value)} />
        </div>}
        <div className="treasury-account-fields">
          <NumberField controlSize="sm" label="Số dư đầu kỳ (VND)" required value={balance} step={1} disabled={busy} onChange={setBalance} />
          <DateField controlSize="sm" label="Ngày số dư đầu kỳ" required value={date} disabled={busy} onChange={setDate} />
        </div>
        <TextField controlSize="sm" label="Chứng từ số dư đầu kỳ" required maxLength={255} value={evidence} disabled={busy} onChange={event => setEvidence(event.target.value)} />
      </>}
      <TextField controlSize="sm" label="Lý do" required maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
    </form>
  </Drawer>;
}
