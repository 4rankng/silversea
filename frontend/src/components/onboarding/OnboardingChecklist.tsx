// OnboardingChecklist — the floating activation panel (Phase 6).
//
// Renders nothing for non-office roles (gated in Layout). For office roles,
// shows a collapsible bottom-right card: a progress bar + the role's tasks.
// Each task completes when its product event fires (event-driven via the hook);
// a task with a tourId shows a "Bắt đầu" chip that launches the curated tour.
//
// Visibility policy:
//   - Auto-open on the user's FIRST session (no prior task rows on the server).
//   - Thereafter collapsed with a progress badge; re-opened on click.
//   - Dismiss writes 'dismissed' to the server and hides the panel for the
//     session (re-openable from the badge).
//   - Hidden entirely once the checklist reaches 100%.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import { useOnboardingChecklist } from '../../hooks/useOnboardingChecklist';
import { useAuth } from '../../hooks/useAuth';
import { useTourController } from '../../context/TourControllerContext';
import { BRAND } from '../../brand';
import './onboarding-checklist.css';

const OFFICE_ROLES = new Set(['ADMIN', 'MANAGER', 'ACCOUNTANT']);

export function OnboardingChecklist({ onOpenTutorialLibrary }: { onOpenTutorialLibrary?: () => void }) {
  const { user } = useAuth();
  const { tour } = useTourController();
  const { tasks, total, completedCount, pct, loading, launchTour, dismiss } = useOnboardingChecklist();
  const [open, setOpen] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const restoredForUserId = useRef<number | null>(null);

  const isOffice = user && OFFICE_ROLES.has(user.role);
  // Admin master switch: when the onboarding tutorial is disabled app-wide,
  // hide the panel entirely (the admin "turned off the onboarding tutorial").
  // Defaults to enabled when the flag is undefined (still loading / not set).
  const onboardingEnabled = user?.onboardingEnabled !== false;

  // Auto-open on first session (no completed/dismissed task rows yet). Once the
  // server returns any rows, we treat the user as past first-run.
  useEffect(() => {
    if (!user || !isOffice || loading || total === 0 || restoredForUserId.current === user.userId) return;
    restoredForUserId.current = user.userId;
    const hasDismissedTasks = tasks.some((t) => t.taskStatus === 'dismissed');
    if (hasDismissedTasks) {
      // A user who chose "Để sau" should return to the compact re-open badge,
      // not be shown the full panel again after a refresh.
      setSessionDismissed(true);
      setOpen(false);
      return;
    }
    // If nothing has ever been recorded for this user, auto-open once.
    const hasAnyHistory = tasks.some((t) => t.taskStatus !== 'pending');
    if (!hasAnyHistory) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isOffice, total, tasks]);

  if (!onboardingEnabled || !isOffice || total === 0 || tour) return null;
  // Hide entirely when 100% complete (onboarding done) or session-dismissed.
  if (pct === 100) return null;
  if (sessionDismissed && !open) {
    // Collapsed-dismissed: show only a small badge the user can re-open.
    return (
      <button
        type="button"
        className="ob-checklist ob-checklist--badge"
        aria-label="Mở hướng dẫn bắt đầu"
        onClick={() => {
          setSessionDismissed(false);
          setOpen(true);
        }}
      >
        <Sparkles size={16} aria-hidden="true" /> {pct}%
      </button>
    );
  }

  return (
    <div className="ob-checklist" role="dialog" aria-label={`Bắt đầu sử dụng ${BRAND.productName}`}>
      <button
        type="button"
        className="ob-checklist__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="ob-checklist__head-text">
          <div className="ob-checklist__eyebrow">Bắt đầu sử dụng</div>
          <div className="ob-checklist__title">Hoàn thành {completedCount}/{total}</div>
        </div>
        <div className="ob-checklist__head-right">
          <div className="ob-checklist__pct">{pct}%</div>
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </div>
      </button>

      {open && (
        <>
          <div className="ob-checklist__bar" aria-hidden="true">
            <div className="ob-checklist__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <ul className="ob-checklist__list">
            {tasks.map((t) => (
              <li
                key={t.id}
                className={`ob-checklist__item${t.taskStatus === 'completed' ? ' is-done' : ''}`}
              >
                <span className="ob-checklist__check" aria-hidden="true">
                  {t.taskStatus === 'completed' ? <Check size={14} /> : <span className="ob-checklist__dot" />}
                </span>
                <span className="ob-checklist__item-title">{t.title}</span>
                {t.tourId && t.taskStatus !== 'completed' && (
                  <button
                    type="button"
                    className="ob-checklist__tour-btn"
                    onClick={() => launchTour(t.id)}
                  >
                    Hướng dẫn
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="ob-checklist__foot">
            {onOpenTutorialLibrary && <button type="button" className="ob-checklist__dismiss" onClick={onOpenTutorialLibrary}>Xem tất cả hướng dẫn</button>}
            <button
              type="button"
              className="ob-checklist__dismiss"
              onClick={() => {
                dismiss();
                setSessionDismissed(true);
                setOpen(false);
              }}
            >
              <X size={13} aria-hidden="true" /> Để sau
            </button>
          </div>
        </>
      )}
    </div>
  );
}
