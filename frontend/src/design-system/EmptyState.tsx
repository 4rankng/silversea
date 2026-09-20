import type { ReactNode, ComponentType } from 'react';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';
import './EmptyState.css';

/**
 * Empty state primitive.
 *
 * Two preview modes:
 *   - default: icon/illustration + title + description + action (original behavior).
 *   - `preview="cards"|"rows"|"list"`: shows faded placeholder shapes behind the
 *     message so users can visualise what content will look like once added.
 *
 * The preview variant is the T1 adoption from the Tailkit MCP audit
 * (a-c-empty-states-05 retokenized to NEPO tokens). See
 * plans/260719-frontend-polish-tailkit/porting-notes.md.
 */

export type EmptyStatePreview = 'cards' | 'rows' | 'list';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Branded illustration key resolved via lib/emptyIllustrations. */
  illustration?: string;
  /** Optional leading icon (lucide-react component). Ignored when `illustration` is set. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  action?: ReactNode;
  /** When set, renders faded placeholder previews of upcoming content. */
  preview?: EmptyStatePreview;
  /** Number of placeholder items. Defaults to 3 (cards) or 4 (rows/list). */
  previewCount?: number;
  /**
   * `compact` = the operational list face (card _41): smaller illustration,
   * tighter padding, ≤160px tall on phones — replaces the retired
   * .empty-state chrome from components/UI.css.
   */
  variant?: 'default' | 'compact';
  /** Forwarded to the root (e.g. role="alert" for error faces). */
  role?: 'alert' | 'status';
  className?: string;
}

export function EmptyState({
  title,
  description,
  illustration,
  icon: Icon,
  action,
  preview,
  previewCount,
  variant,
  role,
  className,
}: EmptyStateProps) {
  const showPreview = Boolean(preview);
  const count = previewCount ?? (preview === 'cards' ? 3 : 4);
  const cls = ['ds-empty-state', showPreview ? `ds-empty-state--with-preview ds-empty-state--preview-${preview}` : '', variant === 'compact' ? 'ds-empty-state--compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role={role}>
      <div className="ds-empty-state__message">
        {illustration ? (
          <img
            src={resolveEmptyIllustration(illustration)}
            alt=""
            aria-hidden="true"
            className="ds-empty-state__illustration"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : Icon ? (
          <div className="ds-empty-state__icon" aria-hidden="true">
            <Icon size={28} />
          </div>
        ) : null}
        <h3 className="ds-empty-state__title">{title}</h3>
        {description && <p className="ds-empty-state__description">{description}</p>}
        {action && <div className="ds-empty-state__action">{action}</div>}
      </div>

      {showPreview && (
        <div className="ds-empty-state__preview" aria-hidden="true">
          {Array.from({ length: count }).map((_, i) => (
            <PreviewShape key={i} variant={preview!} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One faded placeholder shape. Token-driven, no Tailwind palette classes. */
function PreviewShape({ variant }: { variant: EmptyStatePreview }) {
  if (variant === 'cards') {
    return (
      <div className="ds-empty-state__preview-card">
        <div className="ds-empty-state__preview-avatar" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w33" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w75" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w50" />
      </div>
    );
  }
  if (variant === 'rows') {
    return (
      <div className="ds-empty-state__preview-row">
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w20" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w60" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w40" />
        <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w25" />
      </div>
    );
  }
  // list
  return (
    <div className="ds-empty-state__preview-list-item">
      <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w10" />
      <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w50" />
      <div className="ds-empty-state__preview-line ds-empty-state__preview-line--w30" />
    </div>
  );
}
