import React from 'react';
import { Inbox } from 'lucide-react';
import { Btn } from '../UI';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';
import './EmptyState.css';

interface EmptyStateProps {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  illustration?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, illustration, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state-panel ${className}`}>
      {illustration ? (
        <img
          src={resolveEmptyIllustration(illustration)}
          alt=""
          aria-hidden="true"
          className="empty-state-panel__illustration"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="empty-state-panel__icon"><Icon size={24} /></div>
      )}
      <div className="empty-state-panel__title">{title}</div>
      {description && <div className="empty-state-panel__desc">{description}</div>}
      {action && (
        <div className="empty-state-panel__action">
          <Btn variant="secondary" onClick={action.onClick}>{action.label}</Btn>
        </div>
      )}
    </div>
  );
}
