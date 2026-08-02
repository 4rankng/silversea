import type { KeyboardEvent, ReactNode } from 'react';
import './Tabs.css';

/**
 * Shared Tabs primitive — daisyUI-backed (`.d-tabs` is prefixed in tokens.css
 * so it cannot collide with anything). Replaces the hand-rolled
 * `role="tablist" + role="tab"` markup inlined in 5+ pages:
 *   - PayableListPage.tsx (category chips)
 *   - components/debt/PeriodFilter.tsx (month vs range mode)
 *   - DebtDetailPage.tsx (workspace tabs — owned by sibling plan, migrate later)
 *
 * Two variants cover both existing patterns:
 *   - 'boxed': pill-style container (daisyUI `d-tabs-boxed`) — good for primary navigation.
 *   - 'bordered': underline-style (daisyUI `d-tabs-border`) — good for in-card sections.
 *   - 'plain': raw chips with active state — drop-in for Payables' category chips.
 *
 * Adopted from the Tailkit MCP audit (T5). Not a Tailkit snippet — daisyUI-native.
 * See plans/260719-frontend-polish-tailkit/porting-notes.md for the API rationale.
 */

export type TabsVariant = 'boxed' | 'bordered' | 'plain';

export interface TabItem {
  /** Stable id used for active matching and list keys. */
  id: string;
  /** Visible label. Vietnamese in user-facing UIs. */
  label: ReactNode;
  /** Optional count badge (e.g. open items count). */
  count?: number;
  /** Disable this tab. */
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: TabsVariant;
  /** Accessible label for the tablist. Always provide in Vietnamese. */
  ariaLabel: string;
  className?: string;
}

export function Tabs({ tabs, value, onChange, variant = 'boxed', ariaLabel, className }: TabsProps) {
  const variantClass = variant === 'boxed' ? 'd-tabs-boxed' : variant === 'bordered' ? 'd-tabs-border' : '';
  const cls = ['ds-tabs', `ds-tabs--${variant}`, variantClass, className].filter(Boolean).join(' ');
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const tablist = event.currentTarget.parentElement;
    if (!tablist) return;
    const enabledTabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const currentIndex = enabledTabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || enabledTabs.length === 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = enabledTabs.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabledTabs.length;

    const nextTab = enabledTabs[nextIndex];
    nextTab.focus();
    nextTab.click();
  };

  return (
    <div className={cls} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const isActive = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ds-tab-${t.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={t.disabled}
            className={`ds-tabs__btn d-tab${isActive ? ' ds-tabs__btn--active' : ''}`}
            onClick={() => !t.disabled && onChange(t.id)}
            onKeyDown={handleKeyDown}
          >
            <span className="ds-tabs__label">{t.label}</span>
            {t.count !== undefined && (
              <span className={`ds-tabs__count${isActive ? ' ds-tabs__count--active' : ''}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
