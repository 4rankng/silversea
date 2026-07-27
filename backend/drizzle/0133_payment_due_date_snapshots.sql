ALTER TABLE "billing_documents" ADD COLUMN "original_due_date" date;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "processing_due_date" date;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "payment_term_days_applied" integer;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "payment_date_policy_applied" varchar(30);--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "original_due_date" date;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "processing_due_date" date;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "payment_term_days_applied" integer;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "payment_date_policy_applied" varchar(30);--> statement-breakpoint
WITH document_terms AS (
	SELECT
		d.id,
		(d.range_to + coalesce(c.payment_term_days, 30))::date AS original_due_date,
		coalesce(c.payment_term_days, 30) AS payment_term_days_applied,
		c.payment_date_policy AS payment_date_policy_applied
	FROM billing_documents d
	JOIN customers c ON c.id = d.entity_id
	WHERE d.type = 'DEBIT_NOTE' AND d.entity_type = 'CUSTOMER'
), document_due_dates AS (
	SELECT
		t.*,
		CASE
			WHEN t.payment_date_policy_applied = 'CALENDAR_DAY' THEN t.original_due_date
			ELSE resolved.processing_due_date
		END AS processing_due_date
	FROM document_terms t
	LEFT JOIN LATERAL (
		SELECT candidate::date AS processing_due_date
		FROM generate_series(t.original_due_date, t.original_due_date + 370, interval '1 day') candidate
		LEFT JOIN business_calendar_days bcd ON bcd.calendar_date = candidate::date
		WHERE coalesce(bcd.is_working_day, extract(isodow FROM candidate) BETWEEN 1 AND 5)
		ORDER BY candidate
		LIMIT 1
	) resolved ON true
)
UPDATE billing_documents d
SET
	original_due_date = due.original_due_date,
	processing_due_date = due.processing_due_date,
	payment_term_days_applied = due.payment_term_days_applied,
	payment_date_policy_applied = due.payment_date_policy_applied
FROM document_due_dates due
WHERE d.id = due.id;--> statement-breakpoint
WITH trip_obligations AS (
	SELECT
		l.id,
		(t.departure_date + coalesce(c.payment_term_days, 30))::date AS original_due_date,
		coalesce(c.payment_term_days, 30) AS payment_term_days_applied,
		c.payment_date_policy AS payment_date_policy_applied
	FROM ledger l
	JOIN trips t ON t.id = l.txn_id
	JOIN customers c ON c.id = l.entity_id
	WHERE l.entity_type = 'CUSTOMER' AND l.txn_type = 'TRIP_REVENUE'
), trip_due_dates AS (
	SELECT
		t.*,
		CASE
			WHEN t.payment_date_policy_applied = 'CALENDAR_DAY' THEN t.original_due_date
			ELSE resolved.processing_due_date
		END AS processing_due_date
	FROM trip_obligations t
	LEFT JOIN LATERAL (
		SELECT candidate::date AS processing_due_date
		FROM generate_series(t.original_due_date, t.original_due_date + 370, interval '1 day') candidate
		LEFT JOIN business_calendar_days bcd ON bcd.calendar_date = candidate::date
		WHERE coalesce(bcd.is_working_day, extract(isodow FROM candidate) BETWEEN 1 AND 5)
		ORDER BY candidate
		LIMIT 1
	) resolved ON true
)
UPDATE ledger l
SET
	original_due_date = due.original_due_date,
	processing_due_date = due.processing_due_date,
	payment_term_days_applied = due.payment_term_days_applied,
	payment_date_policy_applied = due.payment_date_policy_applied
FROM trip_due_dates due
WHERE l.id = due.id;--> statement-breakpoint
WITH fee_obligations AS (
	SELECT
		l.id,
		(t.departure_date + coalesce(c.payment_term_days, 30))::date AS original_due_date,
		coalesce(c.payment_term_days, 30) AS payment_term_days_applied,
		c.payment_date_policy AS payment_date_policy_applied
	FROM ledger l
	JOIN trip_expenses e ON e.id = l.txn_id
	JOIN trips t ON t.id = e.trip_id
	JOIN customers c ON c.id = l.entity_id
	WHERE l.entity_type = 'CUSTOMER' AND l.txn_type = 'SERVICE_FEE'
), fee_due_dates AS (
	SELECT
		t.*,
		CASE
			WHEN t.payment_date_policy_applied = 'CALENDAR_DAY' THEN t.original_due_date
			ELSE resolved.processing_due_date
		END AS processing_due_date
	FROM fee_obligations t
	LEFT JOIN LATERAL (
		SELECT candidate::date AS processing_due_date
		FROM generate_series(t.original_due_date, t.original_due_date + 370, interval '1 day') candidate
		LEFT JOIN business_calendar_days bcd ON bcd.calendar_date = candidate::date
		WHERE coalesce(bcd.is_working_day, extract(isodow FROM candidate) BETWEEN 1 AND 5)
		ORDER BY candidate
		LIMIT 1
	) resolved ON true
)
UPDATE ledger l
SET
	original_due_date = due.original_due_date,
	processing_due_date = due.processing_due_date,
	payment_term_days_applied = due.payment_term_days_applied,
	payment_date_policy_applied = due.payment_date_policy_applied
FROM fee_due_dates due
WHERE l.id = due.id;--> statement-breakpoint
UPDATE ledger l
SET
	original_due_date = d.original_due_date,
	processing_due_date = d.processing_due_date,
	payment_term_days_applied = d.payment_term_days_applied,
	payment_date_policy_applied = d.payment_date_policy_applied
FROM billing_documents d
WHERE
	l.entity_type = 'CUSTOMER'
	AND l.txn_type = 'ADJUSTMENT'
	AND l.receipt_id = 'GBN:' || d.id::text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_payment_date_policy_applied_check" CHECK ("billing_documents"."payment_date_policy_applied" is null or "billing_documents"."payment_date_policy_applied" in ('NEXT_BUSINESS_DAY', 'CALENDAR_DAY'));--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_payment_term_days_applied_check" CHECK ("billing_documents"."payment_term_days_applied" is null or "billing_documents"."payment_term_days_applied" >= 0);--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_date_policy_check" CHECK ("customers"."payment_date_policy" in ('NEXT_BUSINESS_DAY', 'CALENDAR_DAY'));--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_payment_date_policy_applied_check" CHECK ("ledger"."payment_date_policy_applied" is null or "ledger"."payment_date_policy_applied" in ('NEXT_BUSINESS_DAY', 'CALENDAR_DAY'));--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_payment_term_days_applied_check" CHECK ("ledger"."payment_term_days_applied" is null or "ledger"."payment_term_days_applied" >= 0);
