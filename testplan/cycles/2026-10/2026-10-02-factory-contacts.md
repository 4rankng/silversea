# QA-FACTORY-CONTACTS-01

1. ADMIN, CUS (formerly CLERK), DISPATCHER open factory list: address and named numbers visible directly with no disclosure. Other unauthorized roles denied.
2. Create local factory with two named phone contacts; exactly one default. Reload and edit both name/number, switch default, remove nondefault; legacy scalar pair follows default. Duplicate/invalid phone, multiple/no defaults reject atomically; stale version409.
3. DRIVER open assigned factory trip: multiple contacts call action opens name+phone chooser; default first; select tel link; cancel restores focus. One legacy number retains direct call. No telephone action executed by automation.
4. Empty list clears both legacy default fields; omitted contacts preserves existing list in partial updates and intake upserts. Existing issued snapshot unchanged; driver uses current factory contacts.
5. Controls<=40px, inline compact fields, complete readable contact values at390/768/1440. Targeted browser only; all-screen sweep excluded.

QA-FACTORY-CONTACTS-02: existing legacy factory with null route permits contact/name-only updates; unchanged route is omitted by the form. Explicit routeId=null remains409 and newFACTORYcreationstillrequiresroute. No route inferred or shipment history rewritten.

QA-FACTORY-CONTACTS-03 (master-data workbook import): an imported site row with "người liên hệ: …, sđt: …" in the address lands the pair AND the single-default structured `contacts` entry in lockstep; a site row without contact labels stores `contacts = []`. Re-import stays idempotent and the structured list never masks the imported pair.
Regression: `backend/src/tests/master-data-import.test.ts` apply test asserts both rows' `contacts` against the imported pair.
