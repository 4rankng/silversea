// TourController — the persistent tour chrome rendered at the app root (a
// sibling of <AppRoutes/>, OUTSIDE the agent Drawer so it survives route changes
// and never inherits the drawer's navigate-close behavior). Renders nothing
// unless a tour is active or a resume prompt is pending. Fixed bottom-right,
// styled to match the .agent-tutorial card family.
//
// Phase 3 additions: a missing-target recovery panel (status === 'target_missing')
// with "Thử lại" / "Bỏ qua bước", and a manual-fallback "Tôi đã làm xong" button
// for interaction steps (status === 'waiting_for_action').
import { AlertTriangle, ArrowLeft, ArrowRight, Check, RefreshCw, X } from 'lucide-react';
import { useTourController } from '../../context/TourControllerContext';
import { getInProgressStep } from '../../lib/tourProgress';
import { TourStepBody } from './TourStepBody';
import './agent.css';

export function TourController() {
  const {
    tour,
    currentStep,
    status,
    resumable,
    start,
    next,
    prev,
    skip,
    complete,
    manualAdvance,
    retryTarget,
    dismissResume,
  } = useTourController();

  if (resumable && !tour) {
    return (
      <div className="agent-tour agent-tour--resume" role="dialog" aria-label="Tiếp tục hướng dẫn">
        <div className="agent-tour__resume-body">
          <div className="agent-tour__resume-eyebrow">Tiếp tục hướng dẫn?</div>
          <div className="agent-tour__resume-name">{resumable.title}</div>
        </div>
        <div className="agent-tour__resume-actions">
          <button
            type="button"
            className="agent-tour__btn agent-tour__btn--ghost"
            onClick={dismissResume}
          >
            Để sau
          </button>
          <button
            type="button"
            className="agent-tour__btn agent-tour__btn--primary"
            onClick={() => start(resumable.id, getInProgressStep(resumable.id, resumable.version) ?? 0)}
          >
            Tiếp tục
          </button>
        </div>
      </div>
    );
  }

  if (!tour) return null;

  const step = tour.steps[currentStep];
  const isLast = currentStep >= tour.steps.length - 1;
  const isInteractionStep = status === 'waiting_for_action';
  const targetMissing = status === 'target_missing';

  return (
    <div className="agent-tour" role="dialog" aria-label={`Hướng dẫn: ${tour.title}`}>
      <div className="agent-tour__head">
        <div className="agent-tour__title">{tour.title}</div>
        <button
          type="button"
          className="agent-tour__close"
          aria-label="Bỏ qua hướng dẫn"
          onClick={skip}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="agent-tour__progress">
        Bước {currentStep + 1} / {tour.steps.length}
      </div>

      <div className="agent-tour__step">
        <TourStepBody step={step} index={currentStep} />
      </div>

      {targetMissing ? (
        <div className="agent-tour__recovery" role="alert">
          <div className="agent-tour__recovery-head">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Không tìm thấy phần tử trên trang</span>
          </div>
          <div className="agent-tour__recovery-body">
            Có thể giao diện đã thay đổi. Bạn có thể thử lại hoặc bỏ qua bước này.
          </div>
          <div className="agent-tour__recovery-actions">
            <button
              type="button"
              className="agent-tour__btn agent-tour__btn--ghost"
              onClick={retryTarget}
            >
              <RefreshCw size={15} aria-hidden="true" /> Thử lại
            </button>
            <button
              type="button"
              className="agent-tour__btn agent-tour__btn--primary"
              onClick={next}
            >
              Bỏ qua bước <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="agent-tour__actions">
          <button
            type="button"
            className="agent-tour__btn agent-tour__btn--ghost"
            onClick={prev}
            disabled={currentStep === 0}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Trước
          </button>
          {isInteractionStep ? (
            // Interaction step: the primary action is the manual fallback
            // (the auto-advance happens silently when the event fires). Show
            // "Tôi đã làm xong" so a missed event never traps the user. This
            // takes priority over isLast — a last step CAN be an interaction
            // step (e.g. create-trip's "Lưu chuyến" waits for trip.created).
            <button
              type="button"
              className="agent-tour__btn agent-tour__btn--primary"
              onClick={manualAdvance}
            >
              <Check size={15} aria-hidden="true" /> Tôi đã làm xong
            </button>
          ) : isLast ? (
            <button
              type="button"
              className="agent-tour__btn agent-tour__btn--primary"
              onClick={complete}
            >
              <Check size={15} aria-hidden="true" /> Xong
            </button>
          ) : (
            <button
              type="button"
              className="agent-tour__btn agent-tour__btn--primary"
              onClick={next}
            >
              Tiếp theo <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
