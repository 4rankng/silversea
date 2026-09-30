import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import { animate, utils, type JSAnimation } from 'animejs';
import { AssetIcon, type AssetIconName } from './AssetIcon';
export { PageHeader } from './PageHeader';
import { useAnimatedOverlay } from '../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { bindFormGroupControl } from './form-group-control';
import { Tooltip } from './shared/Tooltip';
import { currentPathname, hasOperationalDensity } from '../lib/operational-density';
import { Sparkline } from '../design-system/Sparkline';
import { Button as UIButton, type ButtonProps as UIButtonProps } from './untitled-ui/base/buttons/button';
import { Label as UILabel } from './untitled-ui/base/input/label';
import { HintText as UIHintText } from './untitled-ui/base/input/hint-text';

/* The one modal module (card 20260930_227) lives in the design system; these
 * re-exports keep the long-standing `components/UI` import path working for
 * every existing dialog consumer. */
export {
  Modal,
  ModalChip,
  ModalChipLive,
  ModalChipGhost,
  ModalCompactContext,
  useConfirmShortcuts,
} from '../design-system/Modal';
import { useConfirmShortcuts } from '../design-system/Modal';
import { usePortalTarget } from '../design-system/hooks/usePortalTarget';

/* ─── Shared overlay animation defaults ────────────────────────────────────
 * The shared modal entrance/exit callbacks moved to the design-system modal
 * module (card 20260930_227); Drawer keeps its own keyframes here. */

/* ─── Extracted shared style constants ──────────────────────────────────── */
const FLEX_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

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

/* ─── Button (Untitled UI backed, wireframe-compatible API) ─────────────── */

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/** Wireframe variant → UUI color. */
const BTN_VARIANT_MAP: Record<NonNullable<BtnProps['variant']>, 'primary' | 'secondary' | 'tertiary' | 'primary-destructive'> = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'tertiary',
  danger: 'primary-destructive',
};

/** Preserve the caller's density intent; shared primitives add touch sizing. */
const BTN_SIZE_MAP = { sm: 'sm', md: 'md' } as const;

export function Btn({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: BtnProps) {
  return (
    <UIButton
      type={type}
      color={BTN_VARIANT_MAP[variant]}
      size={BTN_SIZE_MAP[size]}
      iconLeading={icon ?? undefined}
      isDisabled={disabled}
      className={className}
      {...(rest as UIButtonProps)}
    >
      {children}
    </UIButton>
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
      className={`filter-chip${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
      {count !== undefined && <span className="filter-chip__count">{count}</span>}
    </button>
  );
}

import { StatusText, type StatusVariant } from './shared/StatusText';

/* ─── Status Pill ───────────────────────────────────────────────────────── */

export type PillVariant = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

interface StatusPillProps {
  variant: PillVariant;
  children: React.ReactNode;
  dot?: boolean;
}

const PILL_STATUS_VARIANT_MAP: Record<PillVariant, StatusVariant> = {
  success: 'success',
  warn: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
};

export function StatusPill({ variant, children, dot = true }: StatusPillProps) {
  return (
    <StatusText variant={PILL_STATUS_VARIANT_MAP[variant] || 'neutral'} dot={dot}>
      {children}
    </StatusText>
  );
}

/* ─── Badge (legacy) ────────────────────────────────────────────────────── */

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'neutral';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const BADGE_STATUS_VARIANT_MAP: Record<NonNullable<BadgeProps['variant']>, StatusVariant> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
  outline: 'neutral',
};

export function Badge({ variant = 'neutral', children, className = '', style }: BadgeProps) {
  return (
    <StatusText variant={BADGE_STATUS_VARIANT_MAP[variant]} className={className} style={style}>
      {children}
    </StatusText>
  );
}

/* ─── Form group ────────────────────────────────────────────────────────── */

interface FormGroupProps {
  label: string;
  htmlFor?: string;
  helpText?: string;
  error?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function FormGroup({ label, htmlFor, helpText, error, children, style }: FormGroupProps) {
  const generatedId = useId();
  const feedbackId = error ? `${generatedId}-error` : helpText ? `${generatedId}-help` : undefined;
  const { fieldId, children: boundChildren } = bindFormGroupControl(children, generatedId, htmlFor, {
    descriptionId: feedbackId, invalid: Boolean(error),
  });
  return (
    <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <UILabel htmlFor={fieldId} className="text-xs font-semibold text-secondary">{label}</UILabel>
      {boundChildren}
      {error && (
        <UIHintText id={feedbackId} role="alert" isInvalid size="sm" style={{ marginTop: 4 }}>{error}</UIHintText>
      )}
      {helpText && !error && (
        <UIHintText id={feedbackId} size="sm" style={{ marginTop: 2 }}>{helpText}</UIHintText>
      )}
    </div>
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
  const titleId = useId();
  const portalTarget = usePortalTarget();
  const overlayRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  // In-flight anime.js handles. anime.js does not cancel animations targeting
  // the same property across separate `animate()` calls, so a reopen landing
  // mid-exit leaves the stale exit ticking — it finishes LAST and writes
  // translateX(100%) after the fresh entrance settled, parking an open drawer
  // (aria-hidden="false") off-screen at rect.x === viewport.width (card
  // 20260923_1 D1, 2560px). Each phase cancels the previous one first.
  const overlayAnimRef = useRef<JSAnimation | null>(null);
  const asideAnimRef = useRef<JSAnimation | null>(null);
  const stopDrawerAnimations = () => {
    overlayAnimRef.current?.cancel();
    asideAnimRef.current?.cancel();
    overlayAnimRef.current = null;
    asideAnimRef.current = null;
  };

  const { visible, handleClose, overlayToken } = useAnimatedOverlay({
    overlayRef,
    contentRef: asideRef,
    isOpen,
    onClose,
    entrance: (overlay, aside, prefersReduced) => {
      stopDrawerAnimations();
      if (prefersReduced) {
        utils.set(overlay, { opacity: 1 });
        utils.set(aside, { translateX: '0%' });
        return;
      }
      // Power eases, not `spring()`: an anime.js v4 spring IGNORES `duration`
      // (it drives the timeline from its own settlingDuration — ≈860ms in /
      // ≈1020ms out for the old pairs, with a ~460ms floor at any stiffness),
      // so the slide really ran ~3× its declared 420ms and the panel sat
      // off-screen long after the tap on mobile (card 20260923_1 D2).
      utils.set(overlay, { opacity: 0 });
      overlayAnimRef.current = animate(overlay, { opacity: [0, 1], duration: 200, ease: 'out(2)' });
      utils.set(aside, { translateX: '100%', willChange: 'transform' });
      asideAnimRef.current = animate(aside, {
        translateX: ['100%', '0%'],
        duration: 300,
        ease: 'out(3)',
      });
    },
    exit: (overlay, aside, onDone) => {
      stopDrawerAnimations();
      overlayAnimRef.current = animate(overlay, { opacity: [1, 0], duration: 220, ease: 'in(2)' });
      asideAnimRef.current = animate(aside, {
        translateX: ['0%', '100%'],
        duration: 240,
        ease: 'in(2)',
        onComplete: onDone,
      });
    },
  });
  useConfirmShortcuts({ isOpen, onConfirm, onCancel: onClose, overlayToken });
  useFocusTrap(asideRef, visible && isOpen);

  if (!portalTarget) return null;

  const densityClass = hasOperationalDensity(currentPathname()) ? ' drawer--operational-density' : '';

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
          className={`drawer${densityClass} ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={!isOpen}
        >
          <header className="drawer__head">
            <div className="drawer__heading">
              {headerGraphic}
              <div style={{ minWidth: 0 }}>
                <h2 id={titleId} className="drawer__title">{title}</h2>
                {subtitle && <p className="drawer__subtitle">{subtitle}</p>}
              </div>
            </div>
            <Tooltip label="Đóng (Esc)" side="bottom">
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
