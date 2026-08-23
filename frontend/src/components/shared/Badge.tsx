import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  success: {
    color: 'var(--success-text, #16a34a)',
    background: 'var(--success-soft, #dcfce7)',
    border: '1px solid var(--success, #bbf7d0)',
  },
  warning: {
    color: 'var(--warning-text, #D97706)',
    background: 'var(--warning-soft, #fef3c7)',
    border: '1px solid var(--warning, #fde68a)',
  },
  danger: {
    color: 'var(--danger-text, #dc2626)',
    background: 'var(--danger-soft, #fee2e2)',
    border: '1px solid var(--danger, #fecaca)',
  },
  info: {
    color: 'var(--info-text, #2563eb)',
    background: 'var(--info-soft, #dbeafe)',
    border: '1px solid var(--info, #bfdbfe)',
  },
  neutral: {
    color: 'var(--ink-2, #6b7280)',
    background: 'var(--surface-3, #f3f4f6)',
    border: '1px solid var(--line, #e5e7eb)',
  },
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Semantic badge pill for status indicators, tags, and labels.
 * Uses CSS variables with hardcoded fallbacks for backward compatibility.
 *
 * @example
 * <Badge variant="success">2 chiều</Badge>
 * <Badge variant="warning">Chờ duyệt</Badge>
 */
export function Badge({ variant = 'neutral', children, style, className }: BadgeProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 4,
        padding: '1px 5px',
        letterSpacing: '0.02em',
        verticalAlign: 'middle',
        lineHeight: 1.35,
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
