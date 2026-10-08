import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_VAT_RATE } from '@tingting/shared';
import { qk } from '../../api/keys';
import { configClient } from '../../api/configClient';
import { UuiSelectField } from '../../design-system';
import './VatRateConfigCard.css';

const RATE_OPTIONS = [
  { value: '0', label: '0% — Không tính VAT' },
  { value: '0.05', label: '5%' },
  { value: '0.08', label: '8%' },
  { value: '0.1', label: '10%' },
];

function rateLabel(rate: number): string {
  const option = RATE_OPTIONS.find((candidate) => Number(candidate.value) === rate);
  return option ? option.label : `${rate * 100}%`;
}

/**
 * Thuế suất VAT của công ty (card 081026104400-511) — singleton config card on
 * /admin-center. ADMIN selects only within the policy whitelist {0, 5, 8, 10}%;
 * the configured rate is the fallback wherever a VAT computation has no
 * explicit rate of its own. Unconfigured shows the shared 8% default as the
 * offered value while status text says "Chưa cấu hình".
 */
export function VatRateConfigCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.configCounts.vatConfig,
    queryFn: () => configClient.getVatConfig(),
  });

  const configured = query.data ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const value = selected ?? String(configured?.vatRate ?? DEFAULT_VAT_RATE);

  const save = useMutation({
    mutationFn: () => configClient.saveVatConfig({
      vatRate: Number(value),
      expectedUpdatedAt: configured?.updatedAt ?? null,
    }),
    onSuccess: async () => {
      setError(null);
      setSavedFlash(true);
      await queryClient.invalidateQueries({ queryKey: qk.configCounts.vatConfig });
    },
    onError: async (saveError) => {
      setSavedFlash(false);
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được thuế suất VAT.');
      await queryClient.invalidateQueries({ queryKey: qk.configCounts.vatConfig });
    },
  });

  const dirty = selected != null && Number(selected) !== (configured?.vatRate ?? DEFAULT_VAT_RATE);

  return (
    <section className="vat-rate-config" aria-labelledby="vat-rate-config-title">
      <header>
        <div>
          <h3 id="vat-rate-config-title">Thuế suất VAT của công ty</h3>
          <p>Mức thuế dùng làm mặc định ở mọi nơi tính VAT khi dòng dữ liệu không có thuế suất riêng. Chuyến và loại phí có thuế suất tường minh vẫn ưu tiên mức tường minh.</p>
        </div>
      </header>

      {query.isLoading ? (
        <div className="vat-rate-config__state" role="status">Đang tải thuế suất…</div>
      ) : query.isError ? (
        <div className="vat-rate-config__state is-unavailable" role="alert">Không đọc được thuế suất VAT. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></div>
      ) : (
        <div className="vat-rate-config__body">
          <div className="vat-rate-config__status" role="status">
            {configured
              ? <span>Đang áp dụng: <strong>{rateLabel(configured.vatRate)}</strong></span>
              : <span>Chưa cấu hình — mặc định <strong>{rateLabel(DEFAULT_VAT_RATE)}</strong></span>}
            {savedFlash && !dirty && <span className="vat-rate-config__saved">Đã lưu</span>}
          </div>
          <div className="vat-rate-config__controls">
            <UuiSelectField
              id="vatRateConfig"
              label="Thuế suất VAT"
              value={value}
              onChange={(event) => {
                setSelected(event.target.value);
                setSavedFlash(false);
              }}
              options={RATE_OPTIONS}
              disabled={save.isPending}
              size="md"
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Đang lưu…' : 'Lưu thuế suất'}
            </button>
          </div>
          {error && <div className="vat-rate-config__error" role="alert">{error}</div>}
        </div>
      )}
    </section>
  );
}
