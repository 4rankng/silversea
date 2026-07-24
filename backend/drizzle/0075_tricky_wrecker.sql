
-- Merge active duplicate customers before enforcing new unique indexes.
-- Keeper selection is deterministic:
--   1. Prefer rows already flagged as external carriers (`is_carrier = true`)
--   2. Otherwise keep the oldest created row
--   3. Tie-break on the smallest id
--
-- This preserves the "xe ngoài" semantics users care about while folding all
-- references (trips, pricing, ledger, billing docs, offsets, supplier links)
-- onto a single active customer row.
DO $$
DECLARE
  dup_group RECORD;
  keeper customers%ROWTYPE;
  loser customers%ROWTYPE;
BEGIN
  FOR dup_group IN
    SELECT
      lower(btrim(name)) AS norm_name,
      coalesce(nullif(lower(btrim(tax_code)), ''), '') AS norm_tax
    FROM customers
    WHERE deleted_at IS NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT c.*
    INTO keeper
    FROM customers c
    WHERE c.deleted_at IS NULL
      AND lower(btrim(c.name)) = dup_group.norm_name
      AND coalesce(nullif(lower(btrim(c.tax_code)), ''), '') = dup_group.norm_tax
    ORDER BY c.is_carrier DESC, c.created_at ASC, c.id ASC
    LIMIT 1;

    IF keeper.id IS NULL THEN
      CONTINUE;
    END IF;

    FOR loser IN
      SELECT c.*
      FROM customers c
      WHERE c.deleted_at IS NULL
        AND lower(btrim(c.name)) = dup_group.norm_name
        AND coalesce(nullif(lower(btrim(c.tax_code)), ''), '') = dup_group.norm_tax
        AND c.id <> keeper.id
      ORDER BY c.id
    LOOP
      UPDATE customers
      SET
        contact_person = coalesce(customers.contact_person, loser.contact_person),
        phone = coalesce(customers.phone, loser.phone),
        contact_info = coalesce(customers.contact_info, loser.contact_info),
        credit_limit = coalesce(customers.credit_limit, loser.credit_limit),
        linked_supplier_id = coalesce(customers.linked_supplier_id, loser.linked_supplier_id),
        is_carrier = customers.is_carrier OR loser.is_carrier,
        updated_at = now()
      WHERE customers.id = keeper.id;

      -- Avoid unique collisions on existing pricing rows before re-pointing the FK.
      UPDATE pricing_tables p
      SET deleted_at = now(), updated_at = now()
      WHERE p.customer_id = loser.id
        AND p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM pricing_tables k
          WHERE k.customer_id = keeper.id
            AND k.route_id = p.route_id
            AND k.effective_date = p.effective_date
            AND k.deleted_at IS NULL
        );

      UPDATE pricing_tables
      SET customer_id = keeper.id, updated_at = now()
      WHERE customer_id = loser.id
        AND deleted_at IS NULL;

      UPDATE trips
      SET customer_id = keeper.id, updated_at = now()
      WHERE customer_id = loser.id
        AND deleted_at IS NULL;

      UPDATE trips
      SET external_carrier_id = keeper.id, updated_at = now()
      WHERE external_carrier_id = loser.id
        AND deleted_at IS NULL;

      UPDATE debt_offsets
      SET customer_id = keeper.id
      WHERE customer_id = loser.id;

      UPDATE suppliers
      SET linked_customer_id = keeper.id, updated_at = now()
      WHERE linked_customer_id = loser.id
        AND deleted_at IS NULL;

      UPDATE billing_documents
      SET entity_id = keeper.id, updated_at = now()
      WHERE entity_type = 'CUSTOMER'
        AND entity_id = loser.id
        AND deleted_at IS NULL;

      UPDATE ledger
      SET entity_id = keeper.id
      WHERE entity_type = 'CUSTOMER'
        AND entity_id = loser.id;

      UPDATE audit_logs
      SET entity_id = keeper.id
      WHERE entity_type = 'customers'
        AND entity_id = loser.id;

      UPDATE customers
      SET deleted_at = now(), updated_at = now()
      WHERE id = loser.id;
    END LOOP;

    WITH rebalance AS (
      SELECT
        l.id,
        sum((coalesce(l.debit, '0')::numeric - coalesce(l.credit, '0')::numeric))
          OVER (ORDER BY l.id) AS new_balance
      FROM ledger l
      WHERE l.entity_type = 'CUSTOMER'
        AND l.entity_id = keeper.id
    )
    UPDATE ledger l
    SET balance = rebalance.new_balance
    FROM rebalance
    WHERE l.id = rebalance.id;
  END LOOP;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "customers_active_name_tax_code_uniq_idx"
ON "customers" USING btree (
  lower(btrim("name")),
  coalesce(nullif(lower(btrim("tax_code")), ''), '')
)
WHERE "customers"."deleted_at" is null;--> statement-breakpoint

CREATE UNIQUE INDEX "customers_active_tax_code_uniq_idx"
ON "customers" USING btree (lower(btrim("tax_code")))
WHERE "customers"."deleted_at" is null
  and nullif(btrim("customers"."tax_code"), '') is not null;
