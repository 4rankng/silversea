import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClickOutside } from './useClickOutside';

describe('useClickOutside native Escape ownership', () => {
  it('consumes one Escape when child cleanup precedes a later parent document listener', () => {
    function Child({ rebindParent }: { rebindParent: () => void }) {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      const close = useCallback(() => {
        // A native browser can commit between same-document listeners. Force
        // that timing here, rather than relying on fireEvent's batched updates.
        flushSync(() => setOpen(false));
      }, []);
      useClickOutside(ref, close, { enabled: open, escapeKey: true });
      return <>
        <button onClick={() => setOpen(true)}>Open child</button>
        {open && <div ref={ref} role="dialog" aria-label="Child">
          <button onClick={rebindParent}>Rebind parent listener</button>
        </div>}
      </>;
    }
    function Parent() {
      const [open, setOpen] = useState(true);
      const [revision, setRevision] = useState(0);
      const ref = useRef<HTMLDivElement>(null);
      useClickOutside(ref, () => setOpen(false), { enabled: open, escapeKey: true });
      return open && <div ref={ref} role="dialog" aria-label="Parent">
        <span>Revision {revision}</span>
        <Child rebindParent={() => setRevision((value) => value + 1)} />
      </div>;
    }
    render(<Parent />);
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rebind parent listener' }));
    expect(screen.getByText('Revision 1')).toBeTruthy();

    const observed: boolean[] = [];
    const unrelatedListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') observed.push(event.defaultPrevented);
    };
    document.addEventListener('keydown', unrelatedListener);
    try {
      const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      fireEvent(document.body, first);
      expect(screen.queryByRole('dialog', { name: 'Child' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Parent' })).toBeTruthy();
      expect(first.defaultPrevented).toBe(true);
      // Consuming Escape does not suppress unrelated listeners on this target.
      expect(observed).toEqual([true]);

      const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      fireEvent(document.body, second);
      expect(screen.queryByRole('dialog', { name: 'Parent' })).toBeNull();
      expect(second.defaultPrevented).toBe(true);
      expect(observed).toEqual([true, true]);
    } finally {
      document.removeEventListener('keydown', unrelatedListener);
    }
  });

  it('respects an Escape already consumed by another owner', () => {
    function Layer() {
      const [open, setOpen] = useState(true);
      const ref = useRef<HTMLDivElement>(null);
      useClickOutside(ref, () => setOpen(false), { enabled: open, escapeKey: true });
      return open && <div ref={ref} role="dialog" aria-label="Retained layer" />;
    }
    render(<Layer />);
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    consumed.preventDefault();
    fireEvent(document.body, consumed);
    expect(screen.getByRole('dialog', { name: 'Retained layer' })).toBeTruthy();
  });

  it('separates optional Escape cancellation from true outside dismissal without changing event consumption', () => {
    const dismissed: string[] = [];
    const canceled: string[] = [];
    function Layer() {
      const ref = useRef<HTMLDivElement>(null);
      useClickOutside(ref, () => dismissed.push('outside'), { escapeKey: true, onEscape: () => canceled.push('escape') });
      return <div ref={ref} role="dialog" aria-label="Calendar boundary" />;
    }
    render(<Layer />);
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    consumed.preventDefault();
    fireEvent(document.body, consumed);
    expect(canceled).toEqual([]);
    expect(dismissed).toEqual([]);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(document.body, escape);
    expect(canceled).toEqual(['escape']);
    expect(dismissed).toEqual([]);
    expect(escape.defaultPrevented).toBe(true);
    if (typeof window.PointerEvent === 'function') fireEvent.pointerDown(document.body);
    else fireEvent.mouseDown(document.body);
    expect(dismissed).toEqual(['outside']);
    expect(canceled).toEqual(['escape']);
  });
});
