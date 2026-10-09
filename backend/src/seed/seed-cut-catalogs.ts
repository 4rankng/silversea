import { seedDriverFeeNorms } from './seed-driver-fee-norms';
import { seedForwarderExpenseTypes } from './seed-expense-types';
import { seedExpenseCategories } from './seed-expense-categories';
import { seedXeNhaCustomer } from './seed-xe-nha-customer';

/** Card 20260922_1 (+ card 20260921_9 AC3, card 091026225710) — the make-demo seed step: applies
 *  the chi-phi catalogs, the card-7 fee-norm ladder, expense categories (including fuel),
 *  and the xe-nhà customer code, fill-only. Catalogs only — no users, no demo data (a half-filled
 *  catalog is a defect; demo data is not). A failure here fails the cut
 *  loudly instead of shipping an unfilled environment. */
async function main() {
  const norms = await seedDriverFeeNorms();
  console.log(`[seed-cut] driver_fee_norms: ${norms.inserted} inserted (fill-only)`);
  const types = await seedForwarderExpenseTypes();
  console.log(`[seed-cut] forwarder_expense_types: ${types.inserted} inserted, ${types.backfilled} categories backfilled (fill-only)`);
  const expenseCats = await seedExpenseCategories();
  console.log(`[seed-cut] expense_categories: ${expenseCats.inserted} inserted (fill-only)`);
  const xeNha = await seedXeNhaCustomer();
  console.log(`[seed-cut] customers: ${xeNha.inserted} xe-nhà row inserted (fill-only)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cut catalog seed failed:', err);
    process.exit(1);
  });
