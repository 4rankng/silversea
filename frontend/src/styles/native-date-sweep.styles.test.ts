import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260925_9 (native-date site sweep, part 2 of the _46/_47 class sweep):
// every remaining native <input type="date"> renders a browser-locale
// placeholder (dd/mm/yyyy) that breaks the one-date-control-family contract
// the segmented BufferedUuiDateInput owns since _46. All six hosts must ride
// the shared field. Assertion is file-local (no new type="date" may appear).

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const NATIVE_DATE_HOSTS = [
  'src/pages/accounting/AccountingDebitClosePage.tsx',
  'src/pages/accounting/DebitSettlementRoundDialog.tsx',
  'src/features/shipments/detail/ShipmentContainerLedger.tsx',
  'src/features/accounting/PhoiPhieuChiHoDialog.tsx',
  'src/features/accounting/InvoiceTrackingFormModal.tsx',
  // Card 20260926_1: the CUS add-container row rode a native datetime-local.
  { host: 'src/features/shipments/cus/CusContainerAddRow.tsx', pattern: /type=["']date(?:time)?-local["']/ },
];

describe('no native date inputs remain (card 20260925_9)', () => {
  for (const entry of NATIVE_DATE_HOSTS) {
    const host = typeof entry === 'string' ? entry : entry.host;
    const pattern = typeof entry === 'string' ? /type=["']date["']/ : entry.pattern;
    it(`segmented date field only: ${host}`, () => {
      const src = read(host);
      expect(src).not.toMatch(pattern);
    });
  }
});
