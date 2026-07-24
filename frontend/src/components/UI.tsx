import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import { animate, utils, spring } from 'animejs';
import { AssetIcon, type AssetIconName } from './AssetIcon';
import { useAnimatedOverlay, type EntranceFn, type ExitFn } from '../hooks/useAnimatedOverlay';
import { usePressAnimation } from '../hooks/animations/usePressAnimation';
import { Tooltip } from './shared/Tooltip';
import { Sparkline } from '../design-system/Sparkline';

/* ─── Shared overlay animation defaults ──────────────────────────────────── */

const overlayEntrance: EntranceFn = (overlay, content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    utils.set(content, { opacity: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
  utils.set(content, { opacity: 0, willChange: 'opacity' });
  animate(content, {
    opacity: [0, 1],
    duration: 180,
    ease: 'out(2)',
  });
};

const overlayExit: ExitFn = (overlay, content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)' });
  animate(content, {
    opacity: [1, 0],
    duration: 160,
    ease: 'in(3)',
    onComplete: onDone,
  });
};

/* ─── Extracted shared style constants ──────────────────────────────────── */

const FLEX_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

/* ─── Portal target helper ──────────────────────────────────────────────── */

function usePortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.body);
  }, []);
  return target;
}

/* ─── Global confirm shortcuts ──────────────────────────────────────────────
 * Canonical keyboard pattern for any dialog/modal/drawer that asks the user
 * to confirm or cancel something:
 *   - Enter  → triggers the primary/confirm action (if provided)
 *   - Escape → triggers the cancel/close action
 *
 * Used by ConfirmDialog, Modal, Drawer below. Also exported so any one-off
 * custom dialog elsewhere in the app can opt-in by calling this hook.
 *
 * Listener is only attached while `isOpen` is true. Enter is suppressed when
 * focus is inside a <textarea> or contenteditable element so multi-line
 * editing still works naturally.
 * -------------------------------------------------------------------------- */
// eslint-disable-next-line react-refresh/only-export-components -- shared hook, not a component
export function useConfirmShortcuts(opts: {
  isOpen: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const { isOpen, onConfirm, onCancel } = opts;
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && onConfirm) {
        const target = e.target as HTMLElement | null;
        if (e.shiftKey || e.isComposing) return;
        if (target) {
          const tag = target.tagName;
          if (tag === 'TEXTAREA') return;
          if (target.isContentEditable) return;
          if (tag === 'BUTTON') return;
        }
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onConfirm, onCancel]);
}

/* ─── KPI Metric Card ───────────────────────────────────────────────────── */

export interface KPITrend {
  /** Numeric series for the sparkline. Empty array = no sparkline drawn. */
  data: number[];
  /** Signed percentage change vs previous period, e.g. 17 or -3.2. */
  pct: number;
  /** Accessible label passed through to the sparkline, e.g. "Doanh thu 7 ngày". */
  ariaLabel: string;
}

interface KPIProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  assetIconName?: AssetIconName;
  meta?: React.ReactNode;
  variant?: 'success' | 'warn' | 'danger' | 'accent' | 'info' | 'default';
  compact?: boolean;
  onClick?: () => void;
  /**
   * Optional trend — when present, renders a percentage badge + inline
   * sparkline in the meta slot. The watermark icon is hidden to make room.
   * T2 adoption (Tailkit a-c-statistics-11 pattern, hand-rolled SVG).
   */
  trend?: KPITrend;
}

export function KPI({ label, value, unit, icon: Icon, assetIconName, meta, variant = 'default', compact, onClick, trend }: KPIProps) {
  const variantClass = variant === 'default' ? '' : `kpi--${variant}`;
  const showTrend = trend && trend.data.length > 1;
  const trendDirection: 'up' | 'down' | 'neutral' = !trend ? 'neutral' : trend.pct > 0 ? 'up' : trend.pct < 0 ? 'down' : 'neutral';
  const TrendArrow = trendDirection === 'up' ? ArrowUpRight : trendDirection === 'down' ? ArrowDownRight : null;
  return (
    <div
      className={`kpi ${variantClass} ${onClick ? 'kpi--clickable' : ''} ${compact ? 'kpi--compact' : ''} ${showTrend ? 'kpi--with-trend' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {showTrend && (
          <span className={`kpi__trend-badge kpi__trend-badge--${trendDirection}`} aria-hidden="true">
            {TrendArrow && <TrendArrow size={12} />}
            <span>{Math.abs(trend!.pct)}%</span>
          </span>
        )}
      </div>
      <div className="kpi__value">
        {value}
        {unit && <span className="kpi__value-unit">{unit}</span>}
      </div>
      {meta && <div className="kpi__meta">{meta}</div>}
      {showTrend ? (
        <div className="kpi__sparkline">
          <Sparkline
            data={trend!.data}
            variant={trendDirection}
            ariaLabel={trend!.ariaLabel}
            width={96}
          />
        </div>
      ) : (assetIconName || Icon) && (
        <div className="kpi__watermark" aria-hidden="true">
          {assetIconName ? (
            <AssetIcon name={assetIconName} size={72} className="kpi__watermark-asset" />
          ) : Icon ? (
            <Icon size={72} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─── Page Header ───────────────────────────────────────────────────────── */

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onBack?: () => void;
  /**
   * Branded icon key (rendered via <AssetIcon> against /assets/icons/<slug>.png).
   * The icon appears in a 44×44 tinted chip next to the title. The branded
   * PNGs have a white background, so the chip gives them a clean container
   * on any page surface. Only use on light-background pages.
   */
  iconName?: AssetIconName;
}

export function PageHeader({ title, description, action, onBack, iconName }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-main" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {onBack && (
          <button
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onBack}
            aria-label="Quay lại"
            style={{ marginTop: 4 }}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        {iconName && (
          <div className="page-header-icon" aria-hidden="true">
            <AssetIcon name={iconName} size={28} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-subtitle">{description}</p>}
        </div>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

/* ─── Panel (wireframe canonical) ───────────────────────────────────────── */

interface PanelProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Panel({ title, subtitle, action, children, flush, className = '', style }: PanelProps) {
  return (
    <div className={`panel ${className}`} style={style}>
      {(title || action || subtitle) && (
        <div className="panel__head">
          <div style={{ minWidth: 0 }}>
            {title && <h3 className="panel__title">{title}</h3>}
            {subtitle && <p className="panel__subtitle">{subtitle}</p>}
          </div>
          {action && <div style={{ ...FLEX_ROW, flexWrap: 'wrap' }}>{action}</div>}
        </div>
      )}
      <div className={`panel__body${flush ? ' panel__body--flush' : ''}`}>{children}</div>
    </div>
  );
}

/* ─── Card (alias for Panel — backward compat) ──────────────────────────── */

interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  noPadding?: boolean;
}

export function Card({ title, subtitle, action, children, style, className = '', noPadding = false }: CardProps) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      action={action}
      flush={noPadding}
      className={className}
      style={style}
    >
      {children}
    </Panel>
  );
}

/* ─── Button (wireframe variants) ───────────────────────────────────────── */

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Btn({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  icon,
  children,
  className = '',
  onPointerDown: restPointerDown,
  onPointerUp: restPointerUp,
  onPointerLeave: restPointerLeave,
  ...rest
}: BtnProps) {
  const { ref: pressRef, handlers: pressHandlers } = usePressAnimation({ axis: 'x' });
  const sizeClass = size === 'sm' ? ' btn--sm' : '';
  const iconOnly = !children && icon ? ' btn--icon' : '';

  return (
    <button
      ref={pressRef as React.RefObject<HTMLButtonElement>}
      type={type}
      className={`btn btn--${variant}${sizeClass}${iconOnly} ${className}`}
      onPointerDown={(e) => { pressHandlers.onPointerDown(); restPointerDown?.(e); }}
      onPointerUp={(e) => { pressHandlers.onPointerUp(); restPointerUp?.(e); }}
      onPointerLeave={(e) => { pressHandlers.onPointerLeave(); restPointerLeave?.(e); }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/* ─── Toolbar (table filters wrapper) ───────────────────────────────────── */

interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export function Toolbar({ children, className = '' }: ToolbarProps) {
  return <div className={`toolbar ${className}`}>{children}</div>;
}

/* ─── Filter pill ───────────────────────────────────────────────────────── */

interface FilterPillProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
}

export function FilterPill({ active, onClick, children, icon, count }: FilterPillProps) {
  return (
    <button
      type="button"
      className={`filter-pill${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
      {count !== undefined && <span className="filter-pill__count">{count}</span>}
    </button>
  );
}

/* ─── Status Pill ───────────────────────────────────────────────────────── */

export type PillVariant = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

interface StatusPillProps {
  variant: PillVariant;
  children: React.ReactNode;
  dot?: boolean;
}

export function StatusPill({ variant, children, dot = true }: StatusPillProps) {
  return (
    <span className={`pill pill--${variant}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/* ─── Plate Tag ─────────────────────────────────────────────────────────── */

interface PlateTagProps {
  plate: string;
  className?: string;
}

export function PlateTag({ plate, className = '' }: PlateTagProps) {
  return <span className={`plate ${className}`}>{plate}</span>;
}

/* ─── Badge (legacy) ────────────────────────────────────────────────────── */

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'neutral';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  const badgeClassMap: Record<string, string> = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    outline: 'badge-outline',
    neutral: 'badge-neutral',
  };
  return (
    <span className={`badge ${badgeClassMap[variant] || 'badge-neutral'} ${className}`}>
      {children}
    </span>
  );
}

/* ─── Form group ────────────────────────────────────────────────────────── */

interface FormGroupProps {
  label: string;
  helpText?: string;
  error?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function FormGroup({ label, helpText, error, children, style }: FormGroupProps) {
  const fieldId = useId();
  return (
    <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label htmlFor={fieldId} style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{label}</label>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { id: fieldId });
        }
        return child;
      })}
      {error && (
        <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--danger)', marginTop: 4 }}>{error}</span>
      )}
      {helpText && !error && (
        <span className="field-help" style={{ color: 'var(--ink-3)', marginTop: 2 }}>
          {helpText}
        </span>
      )}
    </div>
  );
}

/* ─── Modal ─────────────────────────────────────────────────────────────── */

interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onConfirm?: () => void;
  maxWidth?: number | string;
}

export function Modal({ isOpen, title, onClose, children, footer, onConfirm, maxWidth = 540 }: ModalProps) {
  useConfirmShortcuts({ isOpen, onConfirm, onCancel: onClose });
  const portalTarget = usePortalTarget();
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { visible, handleClose } = useAnimatedOverlay({
    overlayRef,
    contentRef,
    isOpen,
    onClose,
    entrance: overlayEntrance,
    exit: overlayExit,
  });

  if (!portalTarget) return null;

  // Forward maxWidth via CSS variable so mobile overrides (max-width: 100%) win.
  const cssVars = { '--modal-max-w': typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth } as React.CSSProperties;
  return createPortal(
    visible ? (
      <div
        ref={overlayRef}
        className="modal"
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
      >
        <div
          ref={contentRef}
          className="modal__content"
          style={cssVars}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal__head">
            <h3 className="modal__title">{title}</h3>
            <Tooltip label="Đóng (Esc)">
              <button
                className="btn btn--ghost btn--icon btn--sm modal__close"
                onClick={handleClose}
                aria-label="Đóng"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="modal__body">
            {children}
          </div>
          {footer && (
            <div className="modal__foot">
              {footer}
            </div>
          )}
        </div>
      </div>
    ) : null,
    portalTarget,
  );
}

/* ─── Drawer ────────────────────────────────────────────────────────────── */

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onConfirm?: () => void;
  className?: string;
  headerGraphic?: React.ReactNode;
}

export function Drawer({ isOpen, onClose, title, subtitle, children, footer, onConfirm, className = '', headerGraphic }: DrawerProps) {
  useConfirmShortcuts({ isOpen, onConfirm, onCancel: onClose });
  const portalTarget = usePortalTarget();
  const overlayRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  const { visible, handleClose } = useAnimatedOverlay({
    overlayRef,
    contentRef: asideRef,
    isOpen,
    onClose,
    entrance: (overlay, aside, prefersReduced) => {
      if (prefersReduced) {
        utils.set(overlay, { opacity: 1 });
        utils.set(aside, { translateX: '0%' });
        return;
      }
      utils.set(overlay, { opacity: 0 });
      animate(overlay, { opacity: [0, 1], duration: 200, ease: 'out(2)' });
      utils.set(aside, { translateX: '100%', willChange: 'transform' });
      animate(aside, {
        translateX: ['100%', '0%'],
        duration: 420,
        ease: spring({ stiffness: 200, damping: 24 }),
      });
    },
    exit: (overlay, aside, onDone) => {
      animate(overlay, { opacity: [1, 0], duration: 220, ease: 'in(2)' });
      animate(aside, {
        translateX: ['0%', '100%'],
        duration: 350,
        ease: spring({ stiffness: 180, damping: 20 }),
        onComplete: onDone,
      });
    },
  });

  if (!portalTarget) return null;

  return createPortal(
    visible ? (
      <>
        <div
          ref={overlayRef}
          className="drawer-overlay"
          onClick={handleClose}
          aria-hidden={!isOpen}
        />
        <aside
          ref={asideRef}
          className={`drawer ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-hidden={!isOpen}
        >
          <header className="drawer__head">
            <div className="drawer__heading">
              {headerGraphic}
              <div style={{ minWidth: 0 }}>
                <h2 className="drawer__title">{title}</h2>
                {subtitle && <p className="drawer__subtitle">{subtitle}</p>}
              </div>
            </div>
            <Tooltip label="Đóng (Esc)">
              <button
                className="drawer__close"
                onClick={handleClose}
                aria-label="Đóng"
                type="button"
              >
                <X size={18} />
              </button>
            </Tooltip>
          </header>
          <div className="drawer__body">{children}</div>
          {footer && <div className="drawer__foot">{footer}</div>}
        </aside>
      </>
    ) : null,
    portalTarget,
  );
}

export { ConfirmDialog, useConfirm } from './confirm-dialog';
