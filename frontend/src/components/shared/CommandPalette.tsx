import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import './CommandPalette.css';

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Hand-rolled over a portal + backdrop + arrow-key navigation. Mirrors the
 * overlay-lifecycle pattern from Modal/Drawer in components/UI.tsx (Escape
 * to close, focus trap on the input, click-outside to dismiss) but uses a
 * simpler opacity transition because keyboard UX matters more than spring
 * physics here.
 *
 * T4 adoption from the Tailkit MCP audit (a-c-command-palettes-07
 * retokenized to NEPO tokens). See
 * plans/260719-frontend-polish-tailkit/porting-notes.md.
 *
 * Usage:
 *   const nav = useCommandPalette();
 *   <CommandPaletteProvider commands={COMMANDS}>
 *     <button onClick={() => nav.open()}> … </button>
 *     {nav.open && <CommandPalette onClose={nav.close} />}
 *   </CommandPaletteProvider>
 *
 * Or wire the global hotkey directly:
 *   useCommandHotkey(() => setShow(true));  // Cmd/Ctrl+K
 */

export interface CommandItem {
  /** Stable id. */
  id: string;
  /** Visible label. Vietnamese in user-facing UIs. */
  label: string;
  /** Optional helper text shown muted next to the label. */
  hint?: string;
  /** Optional lucide-react icon. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Optional keyboard shortcut chips, e.g. ['Ctrl', 'N']. */
  shortcut?: string[];
  /** Optional group heading — items with the same group are clustered. */
  group?: string;
  /** Perform the action. Palette closes after running. */
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
  /** Override the placeholder. Default "Tìm lệnh hoặc trang…". */
  placeholder?: string;
}

export function CommandPalette({ open, commands, onClose, placeholder = 'Tìm lệnh hoặc trang…' }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset state every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Focus on next tick so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Filter + group once per query change.
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Keep activeIdx in range when the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const runActive = useCallback(() => {
    const cmd = filtered[activeIdx];
    if (!cmd) return;
    cmd.run();
    onClose();
  }, [filtered, activeIdx, onClose]);

  // Global keyboard handling while open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        runActive();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered.length, runActive, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="cmd-palette__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Bảng lệnh"
      onClick={onClose}
    >
      <div className="cmd-palette" role="document" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette__search">
          <Search size={18} className="cmd-palette__search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette__input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="cmd-palette-list"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="cmd-palette__empty">Không tìm thấy lệnh phù hợp.</div>
        ) : (
          <ul ref={listRef} id="cmd-palette-list" className="cmd-palette__list" role="listbox">
            {filtered.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isActive = idx === activeIdx;
              return (
                <li key={cmd.id} role="option" aria-selected={isActive} data-idx={idx}>
                  <button
                    type="button"
                    className={`cmd-palette__item${isActive ? ' cmd-palette__item--active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={runActive}
                  >
                    <span className="cmd-palette__item-main">
                      {Icon && (
                        <span className="cmd-palette__item-icon" aria-hidden="true">
                          <Icon size={16} />
                        </span>
                      )}
                      <span className="cmd-palette__item-label">{cmd.label}</span>
                      {cmd.hint && <span className="cmd-palette__item-hint">{cmd.hint}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

      </div>
    </div>,
    document.body,
  );
}

/**
 * Register a global Cmd/Ctrl+K hotkey that calls `onOpen`.
 * Returns nothing — call at the top level of the app shell.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook, not a component
export function useCommandHotkey(onOpen: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}

/** Free-text filter — matches on label + hint + group, case-insensitive, accent-ignored. */
function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    const haystack = [c.label, c.hint, c.group].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
