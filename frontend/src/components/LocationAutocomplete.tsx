import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPlaceSuggestions, PlaceSuggestion } from '../lib/maps';
import { useClickOutside } from '../hooks/useClickOutside';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import type { Port } from '@tingting/shared';

interface LocationAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  required?: boolean;
}

interface MergedSuggestion {
  key: string;
  description: string;
  source: 'port' | 'place';
  hint?: string;          // shown under description (e.g. port code, city)
}

export function LocationAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  style,
  required,
}: LocationAutocompleteProps) {
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(() => Math.random().toString(36).substring(2, 15));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const skipNextOpenRef = useRef(false);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

  const [isFocused, setIsFocused] = useState(false);

  const refreshSessionToken = useCallback(() => {
    setSessionToken(Math.random().toString(36).substring(2, 15));
  }, []);

  useClickOutside(wrapperRef, closeDropdown, { escapeKey: true });

  // Cached location suggestions; fires once per session for all autocomplete inputs.
  const { data: ports = [] } = useQuery<Port[]>({
    queryKey: qk.catalogs.portsCatalog,
    queryFn: () => configClient.getPorts(),
    staleTime: 5 * 60 * 1000,
  });

  // Local fuzzy match against the ports catalog. We always show matching ports
  // FIRST so HP-area users can pick the canonical name in one tap. Google Places
  // results follow underneath as the fallback for off-catalog locations.
  //
  // Behaviour:
  //   • Empty query → show top 8 ports (browse the whole catalog)
  //   • Query that matches at least 1 port → show matching ports (up to 6)
  //   • Query that matches no port → show nothing. The earlier code fell back
  //     to the top 8 catalog here, but that meant typing "Ha Noi" would keep
  //     showing the 8 Hải Phòng ports and never reach Google Places — see
  //     the bug report at /trips/new. Google Places results come in via the
  //     debounced fetch below; the user can also clear the field to browse
  //     the full port catalog.
  const portMatches = useMemo<MergedSuggestion[]>(() => {
    const q = value.trim().toLowerCase();
    const allAsSuggestions = (rows: Port[]) => rows.map((p) => ({
      key: `port-${p.id}`,
      description: p.name,
      source: 'port' as const,
      hint: [p.code, p.city].filter(Boolean).join(' · '),
    }));
    if (!q) {
      return allAsSuggestions(ports.slice(0, 8));
    }
    const matched = ports.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.code ?? '').toLowerCase().includes(q) ||
      (p.address ?? '').toLowerCase().includes(q)
    );
    return allAsSuggestions(matched.slice(0, 6));
  }, [ports, value]);

  // Fetch place suggestions with debounce (only for queries ≥3 chars)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (value.trim().length >= 3) {
        setLoading(true);
        const results = await fetchPlaceSuggestions(value, sessionToken);
        if (results.length > 0 && !(results.length === 1 && results[0].description === value)) {
          setPlaceSuggestions(results);
        } else {
          setPlaceSuggestions([]);
        }
        setLoading(false);
      } else {
        setPlaceSuggestions([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [value, sessionToken]);

  // Merge port matches + Google Places (deduping by description)
  const allSuggestions = useMemo<MergedSuggestion[]>(() => {
    const seen = new Set<string>();
    const out: MergedSuggestion[] = [];
    for (const p of portMatches) {
      const k = p.description.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
    for (const s of placeSuggestions) {
      const k = s.description.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push({
          key: `place-${s.placeId}`,
          description: s.description,
          source: 'place',
        });
      }
    }
    return out;
  }, [portMatches, placeSuggestions]);

  // Open/close the dropdown whenever the merged list changes and we have focus.
  // skipNextOpenRef is set by handleSelect to prevent the dropdown from
  // reopening when onChange causes portMatches to recompute with the new value.
  useEffect(() => {
    if (!isFocused) return;
    if (skipNextOpenRef.current) {
      skipNextOpenRef.current = false;
      return;
    }
    setIsOpen(allSuggestions.length > 0);
  }, [allSuggestions, isFocused]);

  const handleSelect = (suggestion: MergedSuggestion) => {
    skipNextOpenRef.current = true;
    onChange(suggestion.description);
    setIsOpen(false);
    setPlaceSuggestions([]);
    refreshSessionToken();
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        className={className}
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setIsFocused(true);
          // Show port catalog immediately on focus, even with empty input.
          if (allSuggestions.length > 0) setIsOpen(true);
        }}
        onBlur={() => {
          // Delay blur to allow click on suggestion
          setTimeout(() => setIsFocused(false), 200);
        }}
        required={required}
        autoComplete="off"
      />

      {isOpen && allSuggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 0,
            margin: '4px 0 0 0',
            listStyle: 'none',
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--border-2, var(--line))',
            borderRadius: 'var(--radius-md, 10px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {allSuggestions.map((s) => (
            <li
              key={s.key}
              onClick={() => handleSelect(s)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                borderBottom: '1px solid var(--border-1, var(--line))',
                color: 'var(--fg-1, var(--ink))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-2, var(--surface-2))';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLLIElement).style.background = 'transparent';
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description}
                </div>
                {s.hint && (
                  <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3, var(--ink-3))', marginTop: 1 }}>
                    {s.hint}
                  </div>
                )}
              </div>
              {s.source === 'port' && (
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'rgba(16,185,129,0.15)',
                    color: '#059669',
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    flexShrink: 0,
                  }}
                >
                  CẢNG/BÃI
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
