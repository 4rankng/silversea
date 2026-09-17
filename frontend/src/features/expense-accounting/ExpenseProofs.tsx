import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { photoSrc } from '../../lib/api/photo';
import { sourceRef } from './expense-accounting-model';
import './ExpenseProofs.css';

export function ExpenseProofs({ entry, canUpload }: { entry: ExpenseAccountingEntry; canUpload: boolean }) {
  const cache = useQueryClient();
  const lock = useRef(false);
  const [keys, setKeys] = useState(entry.photoStorageKeys);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload(next: File) {
    if (lock.current) return;
    setFile(next); setError('');
    if (next.size > 15 * 1024 * 1024) { setError('Ảnh tối đa 15 MB. Chọn ảnh nhỏ hơn.'); return; }
    lock.current = true; setBusy(true);
    try {
      const result = await expenseAccountingClient.uploadProof(sourceRef(entry), next);
      setKeys(current => [...new Set([...current, result.storageKey])]); setFile(null);
      await cache.invalidateQueries({ queryKey: qk.expenseAccounting.all });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ảnh chưa tải thành công. File vẫn được giữ để thử lại.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="expense-proofs" aria-label="Chứng từ khoản chi">
    <h3 className="expense-accounting-subtitle">Chứng từ</h3>
    {keys.length > 0 && <div className="expense-accounting-photos">{keys.map((key, index) => <a key={key} href={photoSrc(key)} target="_blank" rel="noreferrer"><img src={photoSrc(key)} alt={`Chứng từ ${index + 1}`} /></a>)}</div>}
    {canUpload && <label className="btn btn--secondary expense-accounting-file">{busy ? 'Đang tải ảnh…' : 'Bổ sung ảnh chứng từ'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/heic,image/heif" disabled={busy} onChange={event => { const next = event.target.files?.[0]; event.currentTarget.value = ''; if (next) void upload(next); }} /></label>}
    {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    {file && !busy && <div className="expense-accounting-file"><span>{file.name}</span><button type="button" className="btn btn--secondary btn--sm" onClick={() => void upload(file)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => { setFile(null); setError(''); }}>Bỏ ảnh chưa tải</button></div>}
    {!keys.length && !file && <p className="expense-accounting-hint">Chưa có ảnh chứng từ.</p>}
  </section>;
}
