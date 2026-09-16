import { useEffect, useId, useRef, useState } from 'react';
import { ListBox, ListBoxItem, type Selection } from 'react-aria-components';
import './DateTimePickerPanels.css';

const pad2 = (value: number) => String(value).padStart(2, '0');
const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const parse = (value: string) => isTime(value)
  ? { hour: Number(value.slice(0, 2)), minute: Number(value.slice(3, 5)) }
  : { hour: null, minute: null };

/** Five-minute shortcuts plus exact 24h entry. Partial selection never invents
 * the other part, and opening or cancelling never rounds an existing minute.
 * List selections only update the value and keep the panel open (user ruling
 * 2026-09-16); the explicit Xong button — and Enter in the exact entry — fire
 * onApply so hosts can close the panel. */
export function TimePanel({ value, onPick, onApply }: { value: string; onPick: (time: string) => void; onApply?: (time: string) => void }) {
  const [draft, setDraft] = useState<{ hour: number | null; minute: number | null }>(() => parse(value));
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [minuteChosen, setMinuteChosen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => { setDraft(parse(value)); setText(value); setInvalid(false); setMinuteChosen(false); }, [value]);
  useEffect(() => {
    const scrollSelected = () => root.current?.querySelectorAll<HTMLElement>('[aria-selected="true"]').forEach((item) => {
      const list = item.parentElement;
      if (list) list.scrollTop = Math.max(0, item.offsetTop - (list.clientHeight - item.offsetHeight) / 2);
    });
    // React Aria may mount its collection after the parent's initial effect.
    // Wait for those nodes/layout, and scroll only each list, never the page.
    let frame = requestAnimationFrame(scrollSelected);
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scrollSelected); });
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [draft.hour, draft.minute]);
  const choose = (part: 'hour' | 'minute', keys: Selection) => {
    if (keys === 'all') return;
    // An empty toggle means deliberately activating the selected option again.
    // Arrow focus alone does not select or close the picker.
    const selected = [...keys][0] ?? draft[part];
    if (selected == null) return;
    const next = { ...draft, [part]: Number(selected) };
    setDraft(next); setInvalid(false);
    setText(`${next.hour == null ? '--' : pad2(next.hour)}:${next.minute == null ? '--' : pad2(next.minute)}`);
    if (part === 'minute') setMinuteChosen(true);
    if (next.hour != null && next.minute != null && (part === 'minute' || minuteChosen)) {
      onPick(`${pad2(next.hour)}:${pad2(next.minute)}`);
    }
  };
  const applyExact = () => {
    if (!isTime(text)) { setInvalid(true); return; }
    onPick(text);
    onApply?.(text);
  };
  const minutes = Array.from({ length: 12 }, (_, n) => n * 5);
  if (draft.minute != null && !minutes.includes(draft.minute)) minutes.push(draft.minute);
  minutes.sort((a, b) => a - b);
  return <div ref={root} className="dtp-time" role="group" aria-label="Chọn giờ (24h)"
    onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}
    onKeyUp={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}>
    <div className="dtp-time__exact">
      <label htmlFor={id}>Giờ chính xác</label>
      <input id={id} aria-label="Giờ chính xác (HH:mm)" type="text" inputMode="numeric" maxLength={5} autoComplete="off"
        placeholder="HH:mm" value={text} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => { const raw = event.target.value; const next = /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw; setText(next); setDraft(parse(next)); setMinuteChosen(false); setInvalid(false); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyExact(); } }} />
      <button type="button" onClick={applyExact}>Xong</button>
    </div>
    {invalid && <small id={`${id}-error`} className="dtp-time__error" role="alert">Nhập giờ hợp lệ (00:00–23:59).</small>}
    {(['hour', 'minute'] as const).map((part) => <div className="dtp-time__column" key={part}>
      <div className="dtp-time__label">{part === 'hour' ? 'Giờ' : 'Phút'}</div>
      <ListBox aria-label={part === 'hour' ? 'Giờ 00–23' : 'Phút 00–59'} className="dtp-time__list"
        selectionMode="single" selectionBehavior="toggle"
        selectedKeys={draft[part] == null ? [] : [draft[part]]} onSelectionChange={(keys) => choose(part, keys)}>
        {(part === 'hour' ? Array.from({ length: 24 }, (_, n) => n) : minutes).map((n) => <ListBoxItem id={n} key={n} textValue={pad2(n)} className="dtp-time__option">{pad2(n)}</ListBoxItem>)}
      </ListBox>
    </div>)}
  </div>;
}
