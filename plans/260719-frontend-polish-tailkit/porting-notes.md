# Phase 3 — Porting notes & token-translation table

Shared reference for all 5 targets (T1-T5). Reuse this table verbatim in Phase 4 production code; do not re-derive per component.

## Universal retokenization rule

Every adopted Tailkit snippet **must** be retokenized against NEPO `var(--*)` tokens before it can ship. No exceptions. The structural JSX/HTML is reusable; the className soup is not.

## Token-translation table

Verified against `frontend/src/styles/tokens.css`.

### Backgrounds

| Tailkit class | NEPO token |
|---|---|
| `bg-white` | `var(--surface)` |
| `bg-gray-50`, `bg-secondary-50` | `var(--surface-2)` |
| `bg-gray-100`, `bg-secondary-100` | `var(--surface-3)` |
| `bg-emerald-700` (primary fill) | `var(--accent-2)` or `var(--brand)` |
| `bg-emerald-50` (tint) | `var(--accent-soft)` or `var(--surface-accent)` |
| `bg-linear-to-b from-secondary-100 to-transparent` | solid `var(--surface-2)` (gradients avoided per brand) |
| `bg-secondary-300/75 backdrop-blur-xs` (scrim) | `rgba(16, 21, 19, 0.5)` + `backdrop-filter: blur(8px)` |

### Text color

| Tailkit class | NEPO token |
|---|---|
| `text-gray-900`, `text-secondary-800` | `var(--ink)` |
| `text-gray-700`, `text-secondary-600` | `var(--ink-2)` |
| `text-gray-500`, `text-secondary-500` | `var(--ink-3)` |
| `text-emerald-500/600/700` | `var(--accent-2)` or `var(--accent-ink)` |
| `text-rose-500`, `text-red-500` | `var(--danger)` |
| `text-amber-500`, `text-orange-500` | `var(--warning)` |

### Borders

| Tailkit class | NEPO token |
|---|---|
| `border-gray-200`, `border-secondary-200` | `var(--line)` |
| `border-gray-300`, `border-secondary-300` | `var(--line-2)` |
| `border-dashed border-secondary-300` | `2px dashed var(--line-2)` |
| `border-emerald-700` | `var(--accent-2)` |

### Shadows

| Tailkit class | NEPO token |
|---|---|
| `shadow-xs`, `shadow-sm` | `var(--sh-sm)` |
| `shadow` | `var(--sh)` |
| `shadow-lg`, `shadow-xl` | `var(--sh-lg)` |

### Radii

| Tailkit class | NEPO token |
|---|---|
| `rounded` | `var(--r-sm)` (8px) |
| `rounded-lg` | `var(--r)` (12px) |
| `rounded-xl` | `var(--r-lg)` (18px) |
| `rounded-full` | `var(--radius-full)` |

### Type

| Tailkit class | NEPO token |
|---|---|
| `text-xs` (12px) | `var(--fs-xs)` |
| `text-sm` (14px) | `var(--fs-sm)` |
| `text-base` (16px) | `var(--fs-md)` |
| `text-lg` (18px) | `var(--fs-lg)` |
| `text-xl` (20px) | `var(--fs-xl)` |
| `text-2xl` (24px) | `var(--fs-2xl)` |
| `font-medium` | `var(--fw-medium)` (500) |
| `font-semibold` | `var(--fw-semibold)` (600) |
| `font-bold` / `font-extrabold` | `var(--fw-bold)` / `var(--fw-extrabold)` |

### Motion

| Tailkit class | NEPO token |
|---|---|
| `transition duration-150 ease-out` | `transition: all var(--t-normal)` (= 180ms `--ease`) |
| `transition duration-100 ease-in` | `transition: all var(--t-fast)` (120ms) |
| `hover:scale-105` | keep as Tailwind utility (works in v4) or `transform: scale(1.02)` on `:hover` |

### Layout / z-index

| Tailkit class | NEPO token |
|---|---|
| `z-60` (banner) | `var(--z-sticky)` (100) |
| `z-90` (command palette backdrop) | `var(--z-overlay)` (200) |
| `container mx-auto xl:max-w-7xl` | keep as Tailwind utility |

## Mandatory removals (NEPO is light-only — `tokens.css:22`)

Strip these from every adopted snippet:

- `dark:bg-secondary-800`, `dark:text-secondary-100`, `dark:from-secondary-700/50`, `dark:border-secondary-700`, `dark:bg-secondary-900`, `dark:placeholder:text-secondary-400`, `dark:hover:bg-secondary-800`, `dark:shadow-black/25`, `dark:focus:ring-secondary-600/40`, etc.
- **Grep guardrail (Phase 4):** `grep -rn 'dark:' frontend/src/components/shared frontend/src/design-system` must return zero lines for new/modified files.

## Icon swaps

| Tailkit (Heroicons) | NEPO (lucide-react) |
|---|---|
| `hi-user-group` | `Users` |
| `hi-plus` | `Plus` |
| `hi-x` | `X` |
| `hi-check-circle` | `CheckCircle` |
| `hi-x-circle` | `XCircle` |
| `hi-arrow-up` (rotated 45°) | `ArrowUpRight` |
| `hi-arrow-down` (rotated -45°) | `ArrowDownRight` |
| `hi-magnifying-glass` | `Search` |
| `hi-command-line` | `Terminal` |
| `hi-document-plus` | `FilePlus` |
| `hi-folder-plus` | `FolderPlus` |
| `hi-squares-plus` | `LayoutDashboard` |
| `hi-archive-box` | `Archive` |
| `hi-code-bracket-square` | `SquareCode` |

## Button swap

Tailkit ships hardcoded button classes (`bg-emerald-700 px-3 py-2 …`) that collide with NEPO's `Btn`. **Always replace with `<Btn variant="primary|secondary|ghost|danger" size="sm|md" icon={...}>`** from `components/UI.tsx:258-288`.

## Gotchas per target

### T1 — EmptyState with placeholders (`a-c-empty-states-05`)

- **Good news:** structural JSX is clean — icon + title + description + action + grid of placeholder cards.
- **Swap:** Heroicons → lucide (`hi-user-group` → `Users`, `hi-plus` → `Plus`).
- **Replace button:** hardcoded emerald button → `<Btn variant="primary" icon={<Plus size={14} />}>`.
- **Retokenize placeholder cards:** `bg-linear-to-b from-secondary-100 to-transparent` → solid `var(--surface-2)` with `var(--line)` dashed border for "preview" feel.
- **Drop `dark:*`.**
- **API design:** extend `EmptyStateProps` with optional `preview?: 'cards' | 'rows' | 'list'` prop, plus optional `previewCount?: number`. Default behavior unchanged.
- **Cost:** ~1.5h. Lowest-risk target.

### T2 — KPI sparkline (`a-c-statistics-11` inspiration only)

- **The Tailkit snippet uses pre-baked SVG `path` strings** with hardcoded coordinates. Useless for real data. Take **inspiration only**: the layout (left: percentage badge + big number + label; right: ~110px-wide sparkline area with gradient fill).
- **Hand-roll `Sparkline.tsx`:** takes `data: number[]`, computes a smoothed path in a 0–100 × 0–100 viewBox, supports `variant: 'up' | 'down' | 'neutral'` mapping to `--accent` / `--danger` / `--ink-3`.
- **Gradient fill:** use `<linearGradient>` from transparent → `var(--accent-soft)`. Replaces Tailkit's `bg-linear-to-t from-white`.
- **Extend `KPI`:** add optional `trend?: { data: number[]; pct: number; direction: 'up' | 'down' }`. When present, render trend badge + sparkline in the meta slot. Watermark icon becomes secondary.
- **Cost:** ~2h. Sparkline is ~40 lines of SVG+TS.

### T3 — Persistent Banner (`a-c-banners-01`)

- **Good news:** very simple — fixed top bar, brand background, icon + message + close button.
- **Retokenize:** `bg-emerald-700` → `var(--accent-2)` or per-variant (`--info`, `--warning`, `--danger`, `--success`). White text on brand is already NEPO convention (`--fg-on-brand`).
- **z-index:** use `var(--z-sticky)` (100), **not** Tailkit's `z-60`. Below modals/overlays but above page content.
- **Dismissible:** store dismissal in `localStorage` keyed by banner id so it doesn't reappear next page-load.
- **Build over daisyUI `.d-alert`** when possible — already integrates with the `nepo` theme. Wrap in `<div class="d-alert d-alert-<variant>">` with sticky positioning wrapper.
- **Cost:** ~1.5h.

### T4 — Command palette (`a-c-command-palettes-07`)

- **Largest scope.** Snippet shows: trigger button with `Ctrl+K` hint, backdrop, palette container, search input with `role="combobox"`, listbox with `role="option"`, keyboard shortcut chips per command.
- **Retokenize backdrop:** `bg-secondary-300/75 backdrop-blur-xs` → `rgba(16, 21, 19, 0.5)` + `backdrop-filter: blur(8px)`. (NEPO has `--glass-blur: blur(14px) saturate(140%)` — reuse.)
- **Retokenize active option:** `hover:bg-emerald-600 hover:text-white` → `var(--accent-2)` background + `var(--fg-on-brand)` text.
- **Build over a portal + Escape-to-close pattern** (mirror `Modal`/`Drawer` from `UI.tsx:412-580`). Reuse `useConfirmShortcuts` for Escape handling. Add arrow-key navigation (new helper, since `useConfirmShortcuts` only covers Enter/Escape).
- **Data source:** a static route registry + recent-items from `localStorage`. **Do NOT** try to index all 36 pages dynamically in this plan — start with a hand-curated command list (~15-20 items: top pages + actions like "Tạo chuyến mới", "Báo cáo P&L", "Đăng xuất").
- **Icon swaps:** Heroicons → lucide per table above.
- **Cost:** ~4h.

### T5 — Shared Tabs primitive (daisyUI-native)

- **No Tailkit snippet needed.** daisyUI ships `.d-tabs` (prefixed). Source: existing inline implementations in `PeriodFilter.tsx`, `PayableListPage.tsx`, `chatbot-monitoring-details.tsx`, `chatbot-monitoring-summary.tsx` (and `DebtDetailPage.tsx`, owned by sibling plan).
- **API:**
  ```ts
  <Tabs
    tabs={[{ id: 'all', label: 'Tất cả', count: 42 }, { id: 'open', label: 'Đang mở' }]}
    value={active}
    onChange={setActive}
  />
  ```
- **Wrap daisyUI:**
  ```jsx
  <div className="d-tabs d-tabs-boxed">
    {tabs.map(t => (
      <button
        key={t.id}
        className={`d-tab ${value === t.id ? 'd-tab-active' : ''}`}
        onClick={() => onChange(t.id)}
        role="tab"
        aria-selected={value === t.id}
      >
        {t.label}{t.count !== undefined && <span className="d-badge d-badge-sm ml-2">{t.count}</span>}
      </button>
    ))}
  </div>
  ```
- **Migration:** swap inline implementations one file at a time. **Exclude `DebtDetailPage` / `PayableDetailPage`** until sibling plan ships.
- **Cost:** ~1.5h primitive + ~30min per page migration.

## Surviving targets after spike (no drops)

All 5 picked targets survived the spike — none was dropped for being too expensive to retokenize.

## Spike files

- `spike/T1-empty-state.html` — runnable retokenized demo (Phase 3 deliverable).
- T2-T5 are documented above; production code lands in Phase 4 directly because the patterns are small enough to not need a separate HTML demo.

## Forbidden-class grep (run before Phase 4 close)

```bash
grep -rnE '(bg|text|border|ring)-(gray|slate|zinc|neutral|stone|secondary)-[0-9]' \
  frontend/src/components/shared frontend/src/design-system
grep -rn 'dark:' \
  frontend/src/components/shared frontend/src/design-system
grep -rn 'hi-outline\|hi-solid\|hi-micro\|hi-mini' \
  frontend/src/components/shared frontend/src/design-system
```

All three must return zero lines for new/modified files.
