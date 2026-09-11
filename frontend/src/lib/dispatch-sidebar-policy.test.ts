import { describe, expect, it } from 'vitest';
import { isDispatchFullwidthPage, shouldCloseSidebarOnDispatchEntry } from './dispatch-sidebar-policy';
import { WIDE_DESKTOP_MIN_WIDTH } from '../components/Layout';

// Customer doc2 BUG2 (cd8a1aa2): on /dispatch-detail the plan table is the
// primary surface — the sidebar yields before the grid flips to cards, and
// every non-dispatch route keeps the stock sidebar behavior (architect T6:
// default-OFF, additive-only).
describe('dispatch-detail sidebar policy', () => {
  it('treats only the dispatch-detail surface as full-width', () => {
    expect(isDispatchFullwidthPage('/dispatch-detail')).toBe(true);
    expect(isDispatchFullwidthPage('/dispatch-detail/sub')).toBe(true);
    expect(isDispatchFullwidthPage('/dispatch')).toBe(false);
    expect(isDispatchFullwidthPage('/dispatch-detailx')).toBe(false);
    expect(isDispatchFullwidthPage('/shipments')).toBe(false);
    expect(isDispatchFullwidthPage('/')).toBe(false);
  });

  it('closes only on dispatch-detail entry below the Layout wide-desktop threshold', () => {
    expect(shouldCloseSidebarOnDispatchEntry('/dispatch-detail', 1024)).toBe(true);
    expect(shouldCloseSidebarOnDispatchEntry('/dispatch-detail', 1439)).toBe(true);
    expect(shouldCloseSidebarOnDispatchEntry('/dispatch-detail', WIDE_DESKTOP_MIN_WIDTH)).toBe(false);
    // Regression (architect T6): non-dispatch routes untouched at 768/1024.
    expect(shouldCloseSidebarOnDispatchEntry('/shipments', 768)).toBe(false);
    expect(shouldCloseSidebarOnDispatchEntry('/shipments', 1024)).toBe(false);
    expect(shouldCloseSidebarOnDispatchEntry('/', 768)).toBe(false);
  });
});
