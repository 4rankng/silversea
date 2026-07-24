import React from 'react';
import './RouteChips.css';
import type { RouteOption } from '../../hooks/useTripOptions';

interface RouteChipsProps {
  routes: RouteOption[];
  onSelect: (routeId: number) => void;
}

export function RouteChips({ routes, onSelect }: RouteChipsProps) {
  const visible = routes.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div className="tc-route-suggest">
      {visible.map((route) => {
        const parts = route.name.split('→');
        return (
          <span
            key={route.id}
            className="tc-route-chip"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(route.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(route.id); }}
          >
            {parts[0]?.trim()}
            {parts.length > 1 && (
              <>
                <span className="tc-route-chip__arrow">→</span>
                {parts[1]?.trim()}
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
