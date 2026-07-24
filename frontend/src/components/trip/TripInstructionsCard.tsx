import { useEffect, useMemo, useState } from 'react';
import { useTripFormContext } from '../../hooks/useTripFormContext';
import './TripInstructionsCard.css';

/**
 * Manager-authored "Liên hệ & hướng dẫn" block (N2 / B1.3) — contact name,
 * contact phone, and free-text guidance for the driver.
 *
 * The fields are owned by the trip-form state and persisted by the unified
 * "Lưu cập nhật" submit (via PUT /api/trips/:id/instructions). This card is
 * purely the editor — no separate save button, no local GET, no loading state.
 * Removing the standalone save avoids the trap of a partially-saved trip
 * (figures saved, instructions not) after a network blip.
 *
 * On the create page the card is not mounted, so the three fields stay
 * empty; the upsert only runs in the edit-mode branch of handleSubmit.
 */
const NOTE_SUGGESTIONS_KEY = 'tingting.tripInstructions.noteSuggestions.v1';
const MAX_SUGGESTIONS = 12;
const BLOCKED_SUGGESTIONS = ['Lưu ý hun trùng'];

// B1c — one-tap reminder templates the manager can drop into the notes so
// drivers see consistent guidance. User-entered note lines are learned below.
const DEFAULT_REMINDER_TEMPLATES = [
  'Lưu ý cân hàng',
  'Lưu ý kẹp seal tạm',
  'Lưu ý lấy mẫu kiểm dịch',
  'Giao ngoài giờ hành chính',
  'Cẩn thận hàng giá trị cao',
];

function normalizeSuggestion(value: string): string | null {
  const text = value
    .replace(/^[\s•\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 3 || text.length > 100) return null;
  return text;
}

function suggestionsFromNotes(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map(normalizeSuggestion)
    .filter((value): value is string => !!value)
    .filter((value) => !BLOCKED_SUGGESTIONS.includes(value));
}

function loadStoredSuggestions(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTE_SUGGESTIONS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => normalizeSuggestion(String(value)))
      .filter((value): value is string => !!value)
      .filter((value) => !DEFAULT_REMINDER_TEMPLATES.includes(value))
      .filter((value) => !BLOCKED_SUGGESTIONS.includes(value))
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    return [];
  }
}

function saveStoredSuggestions(values: string[]) {
  try {
    localStorage.setItem(NOTE_SUGGESTIONS_KEY, JSON.stringify(values.slice(0, MAX_SUGGESTIONS)));
  } catch {
    // localStorage can be unavailable in private/locked-down browser contexts.
  }
}

export function TripInstructionsCard() {
  const { contactName, setContactName, contactPhone, setContactPhone,
    instructionsNotes, setInstructionsNotes } = useTripFormContext();
  const [learnedSuggestions, setLearnedSuggestions] = useState<string[]>(() => loadStoredSuggestions());
  const reminderTemplates = useMemo(() => {
    const seen = new Set<string>();
    return [...learnedSuggestions, ...DEFAULT_REMINDER_TEMPLATES].filter((value) => {
      if (BLOCKED_SUGGESTIONS.includes(value)) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }, [learnedSuggestions]);

  useEffect(() => {
    setLearnedSuggestions(prev => {
      const next = prev.filter((value) => !BLOCKED_SUGGESTIONS.includes(value));
      if (next.length !== prev.length) saveStoredSuggestions(next);
      return next;
    });
  }, []);

  function rememberCurrentNotes() {
    const nextFromNotes = suggestionsFromNotes(instructionsNotes)
      .filter((value) => !DEFAULT_REMINDER_TEMPLATES.includes(value))
      .filter((value) => !BLOCKED_SUGGESTIONS.includes(value));
    if (nextFromNotes.length === 0) return;
    setLearnedSuggestions(prev => {
      const next = [...nextFromNotes, ...prev].filter((value, index, arr) => arr.indexOf(value) === index).slice(0, MAX_SUGGESTIONS);
      saveStoredSuggestions(next);
      return next;
    });
  }

  // Append a templated reminder as a bullet line; skip if already present.
  function appendReminder(label: string) {
    if (instructionsNotes.includes(label)) return;
    const line = `• ${label}`;
    setInstructionsNotes(instructionsNotes.trim() ? `${instructionsNotes.trimEnd()}\n${line}` : line);
  }

  return (
    <div className="ti-card">
      <div className="ti-row">
        <div className="ti-field">
          <label className="ti-label">Liên hệ</label>
          <input
            className="input"
            type="text"
            maxLength={100}
            placeholder="Tên người liên hệ tại điểm giao/nhận"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
          />
        </div>
        <div className="ti-field ti-field--phone">
          <label className="ti-label">SĐT liên hệ</label>
          <input
            className="input"
            type="tel"
            maxLength={20}
            placeholder="0xxx xxx xxx"
            value={contactPhone}
            onChange={e => setContactPhone(e.target.value)}
          />
        </div>
      </div>
      <div className="ti-field">
        <label className="ti-label">Ghi chú hướng dẫn</label>
        <textarea
          className="input ti-textarea"
          placeholder="Hướng dẫn cho lái xe: giờ giao, địa chỉ cụ thể, lưu ý bốc xếp…"
          value={instructionsNotes}
          onChange={e => setInstructionsNotes(e.target.value)}
          onBlur={rememberCurrentNotes}
        />
      </div>
      <div className="ti-reminders">
        <span className="ti-reminders__label">Mẫu nhanh:</span>
        {reminderTemplates.map(t => (
          <button key={t} type="button" className="ti-chip" onClick={() => appendReminder(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="ti-hint">Lưu cùng nút "Lưu cập nhật" ở dưới.</div>
    </div>
  );
}
