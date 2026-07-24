import { z } from 'zod';
const positiveNumeric = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const num = Number(val);
  if (isNaN(num) || num <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phải là số dương' });
    return z.NEVER;
  }
  return num;
});
const expenseSchema = z.object({
  amount: positiveNumeric
});
const result = expenseSchema.safeParse({ amount: 0 });
if (!result.success) {
  console.log(JSON.stringify(result.error.issues, null, 2));
}
