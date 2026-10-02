import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('QA-AUDIT-UI-37 recoverable source reference display', () => {
  it('renders only authoritative business fields while retaining trip link identity', () => {
    const source = readFileSync(resolve(process.cwd(),'src/features/recoverable-costs/RecoverableCostsWorkspace.tsx'),'utf8');
    expect(source).not.toMatch(/\{item\.(?:shipmentCode|tripCode)/);
    expect(source).toContain('item.shipmentReference');
    expect(source).toContain('item.tripReference');
    expect(source).toContain('Chưa có số Bill/Booking');
    expect(source).toContain('to={`/trips/${item.tripId}`}');
    expect(source).toContain('sortKey="shipmentReference"');
    expect(source).toContain('sortKey="tripReference"');
  });
});
