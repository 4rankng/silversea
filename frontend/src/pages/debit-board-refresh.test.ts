// QA 28/11 F18 (CR-010 3.1) — an approval made in ANOTHER tab (Chi phí Ops)
// never reached an open Debit view: both boards kept red amounts + the
// "Chờ kế toán duyệt chi phí" tooltip until a manual reload. main.tsx
// disables refetchOnWindowFocus app-wide and defaults staleTime to 5min, so
// nothing refetched. Each board query must own a modest foreground poll
// (15s), a local focus override, and a short staleness window so a returning
// tab refreshes immediately. Source-scan pins (vitest) because the behavior
// lives in react-query wiring, not in render output.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardQuery = (file: string) => {
  const source = readFileSync(join(here, file), 'utf8');
  const start = source.indexOf('const board = useQuery({');
  expect(start).toBeGreaterThan(-1, `${file} must declare a board useQuery`);
  const end = source.indexOf('});', start);
  return source.slice(start, end);
};

describe('QA 28/11 F18 — debit boards poll for cross-tab approvals', () => {
  it('ghep-bo-debit (DebitMergePage) polls every 15s and refetches on focus', () => {
    const q = boardQuery('accounting/DebitMergePage.tsx');
    expect(q).toContain('refetchInterval: 15_000');
    expect(q).toContain('refetchOnWindowFocus: true');
    expect(q).toContain('staleTime: 10_000');
  });

  it('shipments-debit (ShipmentDebitPage) polls every 15s and refetches on focus', () => {
    const q = boardQuery('ShipmentDebitPage.tsx');
    expect(q).toContain('refetchInterval: 15_000');
    expect(q).toContain('refetchOnWindowFocus: true');
    expect(q).toContain('staleTime: 10_000');
  });
});
