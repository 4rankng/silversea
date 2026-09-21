import { db } from '../db';
import { seedDriverFeeNorms } from './seed-driver-fee-norms';
import { seedForwarderExpenseTypes } from './seed-expense-types';

/** Card 20260922_1 — the make-demo seed step: applies the chi-phi catalogs
 *  (forwarder expense types, the card-4/5 families included) and the card-7
 *  fee-norm ladder, fill-only. Catalogs only — no users, no demo data (a
 *  half-filled catalog is a defect; demo data is not). A failure here fails
 *  the cut loudly instead of shipping an unfilled environment. */
async function main() {
  const norms = await seedDriverFeeNorms();
  console.log(`[seed-cut] driver_fee_norms: ${norms.inserted} inserted (fill-only)`);
  const types = await seedForwarderExpenseTypes();
  console.log(`[seed-cut] forwarder_expense_types: ${types.inserted} inserted, ${types.backfilled} categories backfilled (fill-only)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cut catalog seed failed:', err);
    process.exit(1);
  });
