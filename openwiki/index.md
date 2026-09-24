---
okf_version: "0.2"
---

# Files

- [Architecture and Codebase Map](architecture.md) - System-level map of SilverSea's backend, frontend, shared contracts, persistence, QA, and operational boundaries. Traces dispatch planning, the CUS workspace, shipment settlement and debit notes (Chi phí – Quyết toán) including the shared business-key display layer, and fuel-surcharge pricing through validated APIs and transactional services. Reflects the 2026-09-24 state of origin/prod (c41c5e74): the accounting chot-debit board now settles per-đợt through debit_settlement_rounds (Lần/Tháng/THU-TRA/VAT) with the TỔNG HỢP CÔNG NỢ read model; quotation import-commit shares the preview's row validator, is idempotency-registered, and inherits the prior frame's fee catalog; phoi-phieu vouchers pay only approved chi-hộ/OPS sources (payer split per ADR); L1 debit totals exclude fulfillment-less trips behind a shadow line; the material-write registry carries 276 endpoint entries under completeness+exhaustive sweep tests; and the migration trio coherence gate plus the post-deploy migration gate close the silent-skip class.
- [SilverSea System Overview](overview.md) - System-level overview of SilverSea's product scope, runtime stack, O2C workflow, current dispatch/shipment/pricing behavior after the 2026-09-20 pricing-and-billing wave, and removed features.
- [Quickstart](quickstart.md) - Shortest safe path to install, run, validate, and understand the current SilverSea checkout.

# Directories

- [domain](domain/)
