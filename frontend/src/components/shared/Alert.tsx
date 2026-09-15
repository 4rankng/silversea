import React from 'react';

/* ─── Alert ────────────────────────────────────────────────────────────────
 * Inline banner for status/error/info messages inside a page or modal body.
 * Wraps daisyUI's `.d-alert` (prefixed so it can't collide with anything in
 * this repo). Fills a real gap: before this, modal error states were
 * inline-styled boxes (see ProfileModal/PasswordModal `errorBoxStyle`).
 *
 * Variants map to daisyUI semantic colors, which in turn map to the NEPO
 * brand tokens defined in styles/tokens.css (`--color-error: #E32434`, etc.),
 * so the alert matches the rest of the UI automatically.
 * -------------------------------------------------------------------------- */

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';
export type AlertStyle = 'soft' | 'outline' | 'dash' | 'solid';

interface AlertProps {
  variant?: AlertVariant;
  /** Visual treatment. Default 'soft' (tinted background, gentle). */
  style?: AlertStyle;
  /** Optional leading icon (lucide-react component etc.). */
  icon?: React.ReactNode;
  /** Optional trailing action (button/link). */
  action?: React.ReactNode;
  className?: string;
  /** Separate inline-style prop to avoid clashing with the `style` variant. */
  wrapperStyle?: React.CSSProperties;
  children: React.ReactNode;
}

const VARIANT_CLASS: Record<AlertVariant, string> = {
  info: 'd-alert-info',
  success: 'd-alert-success',
  warning: 'd-alert-warning',
  error: 'd-alert-error',
};

const STYLE_CLASS: Record<AlertStyle, string> = {
  soft: 'd-alert-soft',
  outline: 'd-alert-outline',
  dash: 'd-alert-dash',
  // daisyUI's default (no modifier) is the "solid" variant — omit the class.
  solid: '',
};

export function Alert({
  variant = 'info',
  style = 'soft',
  icon,
  action,
  className = '',
  wrapperStyle,
  children,
}: AlertProps) {
  return (
    <div
      role="alert"
      className={`d-alert text-sm leading-[1.5] ${VARIANT_CLASS[variant]} ${STYLE_CLASS[style]} ${className}`.trim().replace(/\s+/g, ' ')}
      style={wrapperStyle}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}
