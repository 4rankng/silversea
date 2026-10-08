# QA-AUDIT-UI-24 — one control size contract

Run frontend pnpm check:ui. The verifier must demand the canonical touch token
for phone workflow links/buttons and driver penalty month selection, and derive
its numeric inline floor from styles/tokens.css. An absent/invalid touch token
must fail the gate. Actual DRIVER penalty month picker at390/768 must retain a
40px target, readable text, keyboard focus and month switching. Desktop styling
stays compact. Save exact gate output and actual screenshot/DOM/API parity.

The checker must reject an invalid canonical token above40px and inline numeric
interactive minHeight above the canonical ceiling, as well as below its floor.
Existing container/site/wage-day/search controls and checkbox labels inherit
the same token. Multiline content regions are not treated as controls.
