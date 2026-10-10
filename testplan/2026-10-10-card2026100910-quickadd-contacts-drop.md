# Case: card 20261009_10 (rework) — quick-add "Thêm nhà máy" drops its contact fields

- Case ID: 2026-10-10-card2026100910-contacts
- Reported: 10/10/2026 ~10:2x (LEAD staging rung, a20ab94b)
- Status: OPEN (fixing in this card)

## Reproduction (live staging, rung 3)

`/shipments/new` → FCL → 'Thêm nhà máy' → quick-add 6-field dialog → fill
'Tên liên hệ' = Nguyễn Văn QA, 'SĐT liên hệ' = 0901234567 (real typing) →
'Thêm nhà máy' → dialog closes, site created (`operational_sites` id 33
'QA Nhà máy 472270', code derived, FACTORY, route linked) — **but
`contact_name`/`contact_phone` are NULL**. Evidence:
`testplan/qa/evidence/2026-10-10_card2026100910/` +
`qa/2026-10-10_card2026100910_leadqa_rung.log` (DB query appended).

Expected: the two contact fields the owner ruling includes in the six-field
quick-add persist with the site.

## Root cause (contract seam, not a UI bug)

FE `OperationalSiteCreateDialog.submit()` always sends
`contacts: form.contacts` = `[]` (quick mode has no structured-contact
editor; `EMPTY_FORM.contacts = []`). BE `siteContactValues`
(`backend/src/services/shipment-intake.service.ts:22-34`) treats a DEFINED
`contacts` array as authoritative and rewrites the flat pair from its
default entry — `[]` has none → `contactName/contactPhone` become NULL.
The flat pair the dialog collected was silently discarded.

## Fix + pins

Quick-add submits as a flat-contact client: omit the `contacts` key when
`quickAdd` (undefined → BE keeps the flat pair — the "old client" branch of
`siteContactValues`). Full-form keeps sending the structured list.

- FE: `OperationalSiteCreateDialog.quick-add.test.tsx` — the factory-create
  payload must NOT carry `contacts` (observed RED pre-fix: it carried `[]`).
- BE: `shipment-intake-submit.test.ts` — pin both directions of the seam
  law: flat pair + no `contacts` persists; a provided `contacts` list stays
  authoritative over flat fields (guards the invariant in the other
  direction so nobody "fixes" it backwards).
