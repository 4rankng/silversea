import { ArrowRight, CheckCircle2, MapPin } from 'lucide-react';
import type {
  AgentActionChip,
  AgentDirective,
  AgentResponse,
  AgentTutorialStep,
} from '@tingting/shared';

export interface TutorialCardProps {
  tutorial: Extract<AgentResponse, { type: 'tutorial' }>;
  onAction?: (d: AgentDirective) => void;
}

function stepCtaLabel(step: AgentTutorialStep): string {
  if (!step.directive) return '';
  if (step.directive.kind === 'navigate') return 'Mở trang';
  if (step.directive.kind === 'focus' || step.directive.kind === 'scrollTo') return 'Tô sáng';
  return 'Thực hiện';
}

export function TutorialCard({ tutorial, onAction }: TutorialCardProps) {
  return (
    <div className="agent-tutorial">
      <div className="agent-tutorial__head">
        <span className="agent-tutorial__badge" aria-hidden="true">
          <CheckCircle2 size={18} />
        </span>
        <div>
          <div className="agent-tutorial__eyebrow">Hướng dẫn từng bước</div>
          <div className="agent-tutorial__title">{tutorial.title}</div>
        </div>
      </div>

      <p className="agent-tutorial__summary">{tutorial.summary}</p>

      <ol className="agent-tutorial__steps">
        {tutorial.steps.map((step, index) => (
          <li className="agent-tutorial__step" key={`${step.title}-${index}`}>
            <span className="agent-tutorial__index">{index + 1}</span>
            <div className="agent-tutorial__copy">
              <div className="agent-tutorial__step-title">{step.title}</div>
              <div className="agent-tutorial__body">{step.body}</div>
              {step.example && <div className="agent-tutorial__example">{step.example}</div>}
            </div>
            {step.directive && (
              <button
                type="button"
                className="agent-tutorial__step-action"
                onClick={() => onAction?.(step.directive!)}
              >
                <MapPin size={14} aria-hidden="true" />
                <span>{stepCtaLabel(step)}</span>
              </button>
            )}
          </li>
        ))}
      </ol>

      {tutorial.actions && tutorial.actions.length > 0 && (
        <div className="agent-tutorial__actions">
          {tutorial.actions.map((action: AgentActionChip, index) => (
            <button
              type="button"
              className="agent-tutorial__action"
              key={`${action.label}-${index}`}
              onClick={() => onAction?.(action.directive)}
            >
              <span>{action.label}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
