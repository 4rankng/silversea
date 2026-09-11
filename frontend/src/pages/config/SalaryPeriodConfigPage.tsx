import { useState, useEffect } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { CalendarDays, Settings2, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/UI';
import { useSalaryPeriodDefault, useUpdateSalaryPeriodDefault } from '../../hooks/useSalaryQueries';
import './SalaryPeriodConfigPage.css';

/** Describe the default rule in human language */
function describeDefault(startDay: number, endDay: number): string {
  if (startDay <= endDay) {
    const endLabel = endDay === 31 ? 'cuối tháng' : `ngày ${endDay}`;
    return `Ngày ${startDay} đến ${endLabel} trong cùng tháng`;
  }
  return `Ngày ${startDay} tháng trước → Ngày ${endDay} tháng này`;
}

export default function SalaryPeriodConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const { data: defaultConfig, error: queryError } = useSalaryPeriodDefault();
  const updateDefault = useUpdateSalaryPeriodDefault();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'calendar' | 'custom'>('calendar');
  const [startDay, setStartDay] = useState(26);
  const [endDay, setEndDay] = useState(25);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (defaultConfig) {
      const s = defaultConfig.defaultStartDay ?? 1;
      const e = defaultConfig.defaultEndDay ?? 31;
      if (s === 1 && e === 31) {
        setMode('calendar');
        setStartDay(26);
        setEndDay(25);
      } else {
        setMode('custom');
        setStartDay(s);
        setEndDay(e);
      }
    }
  }, [defaultConfig]);

  async function saveDefault() {
    setSaveSuccess(false);
    setSaveMessage(null);
    try {
      const s = mode === 'calendar' ? 1 : startDay;
      const e = mode === 'calendar' ? 31 : endDay;
      await updateDefault.mutateAsync({ startDay: s, endDay: e });
      setSaveSuccess(true);
      setSaveMessage(null);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch {
      // Error surfaced via updateDefault.error state
    }
  }

  // Determine the display rule
  const currentStart = defaultConfig?.defaultStartDay ?? 1;
  const currentEnd = defaultConfig?.defaultEndDay ?? 31;
  const currentDesc = describeDefault(currentStart, currentEnd);

  // Live preview description of the form selection
  const previewDesc = mode === 'calendar'
    ? 'Ngày 1 đến cuối tháng trong cùng tháng'
    : describeDefault(startDay, endDay);

  return (
    <div ref={pageRef} className="sp-wrap" style={{ maxWidth: 840 }}>
      <PageHeader 
        title="Kỳ lương" 
        description="Thiết lập quy tắc mặc định cho chu kỳ chấm công và tính lương." 
        onBack={() => navigate('/config')} 
        iconName="salary-period"
      />

      {/* ── Global Default Rule ── */}
      <div className="sp-default-card">
        <div className="sp-default-card__header">
          <span className="sp-default-card__icon"><Settings2 size={16} /></span>
          <div>
            <h3 className="sp-default-card__title">Quy tắc mặc định</h3>
            <p className="sp-default-card__subtitle">
              Áp dụng cho tất cả các tháng
            </p>
          </div>
          {defaultConfig && (
            <span className="sp-badge sp-badge--active">
              <span className="sp-badge__dot" />
              Đang áp dụng
            </span>
          )}
        </div>

        <div className="sp-default-card__body">
          {/* Mode Selector */}
          <div className="sp-mode-selector">
            <label className={`sp-mode-card ${mode === 'calendar' ? 'active' : ''}`}>
              <input
                type="radio"
                name="periodMode"
                value="calendar"
                checked={mode === 'calendar'}
                onChange={() => setMode('calendar')}
                className="sr-only"
              />
              <span className="sp-mode-card__title">Cuối tháng</span>
              <span className="sp-mode-card__desc">
                Từ ngày 1 đến ngày cuối cùng của tháng (Ví dụ: 01/05 - 31/05)
              </span>
            </label>

            <label className={`sp-mode-card ${mode === 'custom' ? 'active' : ''}`}>
              <input
                type="radio"
                name="periodMode"
                value="custom"
                checked={mode === 'custom'}
                onChange={() => {
                  setMode('custom');
                  // Use sensible defaults if transitioning
                  if (startDay === 1 || endDay === 31) {
                    setStartDay(26);
                    setEndDay(25);
                  }
                }}
                className="sr-only"
              />
              <span className="sp-mode-card__title">Khác (Tùy chỉnh)</span>
              <span className="sp-mode-card__desc">
                Kỳ lương liên tháng, ví dụ từ 26 tháng trước đến 25 tháng này
              </span>
            </label>
          </div>

          {/* Mode info banner */}
          <div className={`sp-mode-hint ${mode === 'calendar' ? 'sp-mode-hint--same' : 'sp-mode-hint--cross'}`}>
            <CalendarDays size={14} />
            <span>
              {mode === 'calendar'
                ? 'Chế độ cùng tháng: ngày bắt đầu và kết thúc trong cùng tháng lương'
                : 'Chế độ liên tháng: bắt đầu từ tháng trước, kết thúc tháng hiện tại'}
            </span>
          </div>

          {/* Configuration Inputs */}
          {mode === 'custom' ? (
            <div className="sp-default-card__fields">
              <UuiSelectField
                label="Ngày bắt đầu (tháng trước)"
                value={String(startDay)}
                onChange={e => {
                  const val = Number(e.target.value);
                  setStartDay(val);
                  // Automatically adjust endDay if it's no longer valid/contiguous
                  if (endDay >= val) {
                    setEndDay(val - 1);
                  }
                }}
                options={Array.from({ length: 27 }, (_, i) => i + 2).map(d => ({
                  value: String(d),
                  label: `Ngày ${d}`,
                }))}
              />

              <UuiSelectField
                label="Ngày kết thúc (tháng này)"
                value={String(endDay)}
                onChange={e => setEndDay(Number(e.target.value))}
                options={Array.from({ length: startDay - 1 }, (_, i) => i + 1).map(d => ({
                  value: String(d),
                  label: `Ngày ${d}`,
                }))}
              />

              <div className="sp-preview">
                <span className="sp-preview__label">Ví dụ (tháng này):</span>
                <span className="sp-preview__value">{previewDesc}</span>
              </div>
            </div>
          ) : (
            <div className="sp-preview" style={{ alignSelf: 'flex-start', margin: 0 }}>
              <span className="sp-preview__label">Ví dụ (tháng này):</span>
              <span className="sp-preview__value">{previewDesc}</span>
            </div>
          )}

          {queryError && (
            <p className="sp-hint sp-hint--warn">Không thể tải cấu hình hiện tại — backend có thể đang khởi động.</p>
          )}

          <div className="sp-default-card__actions">
            <button
              className="btn btn--primary"
              onClick={saveDefault}
              disabled={updateDefault.isPending}
              style={{ minWidth: 140 }}
            >
              {updateDefault.isPending ? 'Đang lưu…' : 'Lưu mặc định'}
            </button>
            {saveSuccess && (
              <span className="sp-save-success">✓ Đã lưu thành công</span>
            )}
            {!saveSuccess && saveMessage && (
              <span className="sp-save-success">{saveMessage}</span>
            )}
          </div>

          <div className="sp-current-rule">
            <Info size={13} />
            <span>
              Cấu hình hiện tại: <strong>{currentDesc}</strong> {!defaultConfig && ' (Mặc định hệ thống)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
