-- Add optional salary effective date to drivers. When set, the salary
-- computation uses baseSalary only from this date onward; null means
-- "effective immediately" (backwards-compatible with existing rows).
ALTER TABLE "drivers" ADD COLUMN "salary_effective_date" date;
