---
okf_version: "0.2"
---

# Files

- [Architecture and Codebase Map](architecture.md) - System-level map of SilverSea's backend, frontend, shared contracts, persistence, QA, and operational boundaries. Traces dispatch planning (multi-day allocation, external-trip staff close), the CUS workspace, shipment settlement and debit notes (Chi phí – Quyết toán) including the shared business-key display layer, and fuel-surcharge pricing through validated APIs and transactional services. Reflects the 2026-09-20 post-cut-14 state of origin/prod (7aedcfed): billing-issue readiness gate, fuel-preview MANUAL reasons, the zero-vs-missing display contract, the two-row 12-column filter grid, icon-only action columns, in-dropdown row creation, three-role workboard quick-edit (CUS/ADMIN/DISPATCHER), and both note fields editable under the accounting lock.
- [SilverSea System Overview](overview.md) - System-level overview of SilverSea's product scope, runtime stack, O2C workflow, current dispatch/shipment/pricing behavior after the 2026-09-20 pricing-and-billing wave, and removed features.
- [Quickstart](quickstart.md) - Shortest safe path to install, run, validate, and understand the current SilverSea checkout.

# Directories

- [domain](domain/)
