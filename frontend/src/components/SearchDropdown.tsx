import React, { useEffect, useRef } from 'react';
import type { SearchItem, SearchItemType } from '../data/searchRegistry';
import { EmptyIllustration } from './shared';
import { AssetIcon } from './AssetIcon';

interface Props {
  items: SearchItem[];
  query: string;
  activeIndex: number;
  onSelect: (item: SearchItem) => void;
  onHover: (index: number) => void;
}

const GROUP_LABELS: Record<SearchItemType, string> = {
  page: 'TRANG',
  config: 'CẤU HÌNH',
  action: 'THAO TÁC',
};

function highlightText(text: string, query: string): React.ReactNode {
  const lowerQ = query.toLowerCase().trim();
  if (!lowerQ) return text;
  const idx = text.toLowerCase().indexOf(lowerQ);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'transparent', color: 'var(--accent, #818cf8)', fontWeight: 700 }}>
        {text.slice(idx, idx + lowerQ.length)}
      </mark>
      {text.slice(idx + lowerQ.length)}
    </>
  );
}

export function SearchDropdown({ items, query, activeIndex, onSelect, onHover }: Props) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (items.length === 0) {
    return (
      <div style={dropdownStyle}>
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 'var(--text-body-size)', lineHeight: 1.45 }}>
          <EmptyIllustration name="empty-search" width={118} height={96} style={{ margin: '0 auto 8px', display: 'block' }} />
          <div>Không có kết quả</div>
        </div>
      </div>
    );
  }

  const itemsWithIndex = items.map((item, flatIdx) => ({ item, flatIdx }));
  const typeOrder: SearchItemType[] = ['page', 'config', 'action'];
  const groups = typeOrder
    .map(type => ({
      type,
      label: GROUP_LABELS[type],
      entries: itemsWithIndex.filter(({ item }) => item.type === type),
    }))
    .filter(g => g.entries.length > 0);

  return (
    <div style={dropdownStyle}>
      {groups.map(group => (
        <div key={group.type}>
          <div style={groupHeaderStyle}>{group.label}</div>
          {group.entries.map(({ item, flatIdx }) => {
            const isActive = flatIdx === activeIndex;
            return (
              <button
                type="button"
                key={`${item.type}-${item.id}`}
                ref={el => { itemRefs.current[flatIdx] = el; }}
                style={{
                  ...itemStyle,
                  background: isActive ? 'var(--surface-3)' : 'transparent',
                }}
                onMouseEnter={() => onHover(flatIdx)}
                onClick={() => onSelect(item)}
              >
                <span style={{ flexShrink: 0, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AssetIcon name={item.iconName} size={18} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--fg-1)', lineHeight: 1.35 }}>
                    {highlightText(item.label, query)}
                  </div>
                  {item.description && (
                    <div style={{
                      fontSize: 'var(--text-caption-size)',
                      lineHeight: 1.35,
                      color: 'var(--fg-3)',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {item.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  width: '100%',
  minWidth: 0,
  maxWidth: 'min(480px, calc(100vw - 32px))',
  maxHeight: 'min(360px, calc(100dvh - 120px))',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
  zIndex: 999,
  padding: '8px',
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 'var(--text-caption-size)',
  lineHeight: 1.35,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
  padding: '10px 10px 6px',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  border: 'none',
  borderRadius: 7,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 80ms',
};
