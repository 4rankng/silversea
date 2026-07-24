import { useEffect, useState, type ReactNode, type ComponentType } from 'react';
import { X } from 'lucide-react';
import './Banner.css';

/**
 * Persistent page-top banner.
 *
 * Distinct from `components/shared/Alert` (which is an inline status block).
 * A Banner is sticky, spans the page width, dismissible, and remembers
 * dismissal across reloads when `dismissKey` is provided.
 *
 * Use cases: "Kỳ lương đã khoá", "Hệ thống bảo trì 23:00 tonight", "Có 3 công nợ quá hạn".
 *
 * T3 adoption from the Tailkit MCP audit (a-c-banners-01 retokenized).
 * daisyUI's `.d-alert` is intentionally NOT used here — we need sticky
 * positioning and full-bleed behaviour that daisyUI's alert primitive
 * doesn't model. Pure NEPO tokens.
 */

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  variant?: BannerVariant;
  /** Leading icon (lucide-react component). Picked automatically by variant if omitted. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Main message. Can include inline links via ReactNode. */
  children: ReactNode;
  /** Optional trailing action (button/link). */
  action?: ReactNode;
  /** When set, dismissal is persisted in localStorage under this key. */
  dismissKey?: string;
  /** Override the default sticky behaviour. Default true. */
  sticky?: boolean;
  /** Hide the X button. Default false. */
  nonDismissable?: boolean;
  className?: string;
}

export function Banner({
  variant = 'info',
  icon: Icon,
  children,
  action,
  dismissKey,
  sticky = true,
  nonDismissable = false,
  className,
}: BannerProps) {
  const storageKey = dismissKey ? `nepo.banner.dismissed.${dismissKey}` : null;
  const [dismissed, setDismissed] = useState(false);

  // Read persisted dismissal on mount only — avoids SSR/hydration mismatch concerns.
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (localStorage.getItem(storageKey) === '1') setDismissed(true);
    } catch {
      /* localStorage unavailable (private mode / SSR) — fall through to visible. */
    }
  }, [storageKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, '1');
      } catch {
        /* ignore write failure */
      }
    }
  };

  const cls = [
    'nepo-banner',
    `nepo-banner--${variant}`,
    sticky ? 'nepo-banner--sticky' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status">
      <div className="nepo-banner__inner">
        <div className="nepo-banner__content">
          {Icon && (
            <span className="nepo-banner__icon" aria-hidden="true">
              <Icon size={18} />
            </span>
          )}
          <div className="nepo-banner__message">{children}</div>
        </div>
        {action && <div className="nepo-banner__action">{action}</div>}
        {!nonDismissable && (
          <button
            type="button"
            className="nepo-banner__close"
            onClick={handleDismiss}
            aria-label="Đóng thông báo"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
