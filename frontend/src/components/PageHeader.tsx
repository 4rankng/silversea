import { ArrowLeft } from 'lucide-react';
import type { AssetIconName } from './AssetIcon';

type PageHeaderProps = {
  title: React.ReactNode;
  /** Retained for call-site compatibility; route descriptions are no longer page chrome. */
  description?: React.ReactNode;
  action?: React.ReactNode;
  onBack?: () => void;
  /** Render the title as a compact VISIBLE heading instead of sr-only — for
   *  module surfaces (config catalog) whose only visible header was the app
   *  topbar's generic context. */
  showTitle?: boolean;
  /** Retained for call-site compatibility; page icons are no longer page chrome. */
  iconName?: AssetIconName;
};

export function PageHeader({ title, action, onBack, showTitle }: PageHeaderProps) {
  if (!onBack && !action) {
    return <h1 className="sr-only">{title}</h1>;
  }

  return (
    <div className={`page-header page-header--actions-only${action ? ' page-header--has-action' : ''}`}>
      <h1 className={showTitle ? 'page-header__title-visible' : 'sr-only'}>{title}</h1>
      {onBack && (
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={onBack}
          aria-label="Quay lại"
        >
          <ArrowLeft size={16} />
        </button>
      )}
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
