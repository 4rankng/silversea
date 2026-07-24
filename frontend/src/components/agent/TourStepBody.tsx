// TourStepBody — the shared per-step copy (index + title + body + example)
// extracted from TutorialCard so the drawer's static tutorial and the app-root
// TourController render steps identically (DRY). The caller owns the surrounding
// layout + any CTA (TutorialCard adds a per-step action button; TourController
// drives progression with its own Next/Prev/Skip chrome).
import type { AgentTutorialStep } from '@tingting/shared';

export function TourStepBody({ step, index }: { step: AgentTutorialStep; index: number }) {
  return (
    <>
      <span className="agent-tutorial__index" aria-hidden="true">
        {index + 1}
      </span>
      <div className="agent-tutorial__copy">
        <div className="agent-tutorial__step-title">{step.title}</div>
        <div className="agent-tutorial__body">{step.body}</div>
        {step.example && <div className="agent-tutorial__example">{step.example}</div>}
      </div>
    </>
  );
}
