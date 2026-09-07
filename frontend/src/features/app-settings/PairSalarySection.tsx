import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Truck } from 'lucide-react';

import { configClient } from '../../api/configClient';
import { Panel } from '../../components/UI';
import { formatCurrency } from '../../lib/format';

interface PairSalarySettings {
  kepSurcharge: number;
  ketHopSurcharge: number;
}

/**
 * Cài đặt → Lương: phụ phí ghép chuyến (LoHangKepKetHop §4.2, TC-GHEP-007).
 * Lương cặp = cuốc cơ bản + phụ phí theo loại cặp — values are whole VND and
 * read LIVE by pairing/recalc, so a change here propagates on the next tính
 * lương. 0 keeps the standard per-trip wage (rule inactive).
 */
export function PairSalarySection() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['config', 'pair-salary-settings'],
    queryFn: () => configClient.getPairSalarySettings(),
  });

  const [kepSurcharge, setKepSurcharge] = useState('0');
  const [ketHopSurcharge, setKetHopSurcharge] = useState('0');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setKepSurcharge(String(settings.data.kepSurcharge));
      setKetHopSurcharge(String(settings.data.ketHopSurcharge));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (next: PairSalarySettings) => configClient.savePairSalarySettings(next),
    onSuccess: () => {
      setMessage('Đã lưu phụ phí ghép chuyến.');
      void queryClient.invalidateQueries({ queryKey: ['config', 'pair-salary-settings'] });
    },
    onError: () => setMessage(null),
  });

  const kepValid = /^\d+$/.test(kepSurcharge.trim());
  const ketHopValid = /^\d+$/.test(ketHopSurcharge.trim());
  const valid = kepValid && ketHopValid;

  function handleSave() {
    setMessage(null);
    save.mutate({
      kepSurcharge: Number(kepSurcharge.trim() || '0'),
      ketHopSurcharge: Number(ketHopSurcharge.trim() || '0'),
    });
  }

  const disabled = settings.isLoading || settings.isError || save.isPending;

  return (
    <Panel
      title="Phụ phí ghép chuyến"
      subtitle="Lương cặp ghép = cuốc cơ bản + phụ phí — áp dụng cho cả Kẹp và Kết hợp"
      action={<Truck size={18} className="cfg-panel-action-icon" />}
    >
      <div className="cfg-section" style={{ display: 'grid', gap: 14 }}>
        <div className="field">
          <label htmlFor="pair-surcharge-kep">Phụ phí Kẹp (VND)</label>
          <input
            id="pair-surcharge-kep"
            className="input"
            type="number"
            min="0"
            step="1000"
            value={kepSurcharge}
            onChange={(event) => setKepSurcharge(event.target.value)}
            disabled={disabled}
          />
          <p className="cfg-field-hint">
            2 container 20' chạy đồng thời trên 1 mooc. Hiện tại: {formatCurrency(Number(kepSurcharge) || 0)}.
          </p>
        </div>
        <div className="field">
          <label htmlFor="pair-surcharge-ket-hop">Phụ phí Kết hợp (VND)</label>
          <input
            id="pair-surcharge-ket-hop"
            className="input"
            type="number"
            min="0"
            step="1000"
            value={ketHopSurcharge}
            onChange={(event) => setKetHopSurcharge(event.target.value)}
            disabled={disabled}
          />
          <p className="cfg-field-hint">
            Tái sử dụng vỏ container qua 2 lệnh nối tiếp. Hiện tại: {formatCurrency(Number(ketHopSurcharge) || 0)}.
          </p>
        </div>
      </div>
      <div className="cfg-form-actions">
        <button
          className="btn btn--primary"
          disabled={disabled || !valid}
          onClick={handleSave}
        >
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          {save.isPending ? 'Đang lưu…' : 'Lưu phụ phí'}
        </button>
        {!valid && (
          <span role="alert" className="cfg-form-error">
            Phụ phí phải là số nguyên VND không âm.
          </span>
        )}
        {save.error && (
          <span role="alert" className="cfg-form-error">
            {save.error instanceof Error ? save.error.message : 'Không thể lưu phụ phí ghép chuyến.'}
          </span>
        )}
        {message && !save.error && (
          <span role="status" className="cfg-field-hint">
            {message}
          </span>
        )}
        {settings.isError && (
          <span role="alert" className="cfg-form-error">
            {settings.error instanceof Error ? settings.error.message : 'Không thể tải phụ phí ghép chuyến.'}
          </span>
        )}
      </div>
    </Panel>
  );
}
