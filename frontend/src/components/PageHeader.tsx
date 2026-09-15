import { ArrowLeft } from 'lucide-react';
import type { AssetIconName } from './AssetIcon';

type PageHeaderProps = {
  title: React.ReactNode;
  /** Retained for call-site compatibility; route descriptions are no longer page chrome. */
  description?: React.ReactNode;
  action?: React.ReactNode;
  onBack?: () => void;
  /** Compact visible module/record identity by default. Opt out only when
   *  another heading on the same page already supplies the exact identity. */
  showTitle?: boolean;
  /** Retained for call-site compatibility; page icons are no longer page chrome. */
  iconName?: AssetIconName;
};

export function PageHeader({ title, action, onBack, showTitle = true }: PageHeaderProps) {
  if (!showTitle && !onBack && !action) {
    return <h1 className="sr-only">{title}</h1>;
  }

  return (
    <div className={`page-header page-header--actions-only${action ? ' page-header--has-action' : ''}`}>
      {onBack && (
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={onBack}
          aria-label="Quay lại"
        >
          <ArrowLeft size={16} />
        </button>
      )}
      <h1 className={showTitle ? 'page-header__title-visible' : 'sr-only'}>{title}</h1>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
