# Customer workbook workflow analysis

Source: `Copy of BẢNG DEMO PHẦN MỀM 2026- CUS- ĐIỀU XE.xlsx`,
`Sheet1!A2:S50`. The workbook was inspected as a read-only process
specification; no rows were imported.

## What the workbook is doing today

### 1. Vehicle planning board (`A2:P8`)

The first section is a daily planning register with filters for delivery date,
import/export direction, plan/detail view, and B/L search. Its rows combine:

- customer, factory, B/L or booking, and shipping line;
- total container quantity and weight;
- customs cut-off, lift/drop locations, closing/return time;
- import/export direction, return point, container type, notes, return date,
  and haulier.

### 2. CUS detail board (`A12:Q18`)

The second section expands a shipment into execution rows. It repeats shipment
facts while adding declaration number, route, container number, kg/CBM,
lift/drop, planned running time, transport date, haulier, and truck plate.
The repeated rows show that one shipment/B/L can own multiple containers.

### 3. Shipment entry form (`E27:L50`)

The third section is the intended input workflow. It first captures common
shipment facts, then branches:

- container cargo: repeated container rows, shipping line, lift/drop ports,
  weight, delivery date, and dispatch notes;
- LCL cargo: pickup warehouse, package type, package count, kg, CBM, delivery
  date, and notes.

## How this shaped the app

| Workbook concept | App authority |
|---|---|
| Customer, B/L, booking, delivery/pickup locations | Existing shipment fields |
| Import/export direction and FCL/LCL choice | New shipment header fields |
| Factory/worksite and shipping line | New nullable shipment header fields |
| Customs cut-off, closing, and planned return | New Vietnam-time shipment fields |
| Total weight, LCL volume, package count/type | New bounded shipment planning fields |
| Dispatch/handling notes | New operational notes field |
| Repeated container number/type/seal/weight | Existing shipment-container child records |
| Declaration number and issue time | Existing shipment-declaration child records |
| Route, truck, driver, and actual execution | Existing dispatch/trip authority |

The app now follows the same working sequence without duplicating data:

1. Find or filter the shipment in the office register.
2. Create the shipment header.
3. Complete its FCL or LCL dossier.
4. Add repeated container/declaration records where applicable.
5. Dispatch FCL through the existing governed shipment-to-trip path.
6. Continue execution, cost, billing, and receivable work on the existing trip
   and finance authorities.

## Deliberate boundaries

- The workbook is not imported or used as a parallel system of record.
- LCL planning data is stored, but LCL dispatch is explicitly blocked until a
  truthful non-container execution contract is designed.
- Factory/warehouse, shipping-line, and external-haulier master tables are
  deferred; the current slice uses nullable text where the workbook vocabulary
  is not yet stable.
- Repeating per-container dates or cargo lines remain future child-table work
  rather than being flattened into more shipment columns.
- At larger data volumes, the six-field contains search needs production-like
  query-plan measurement and likely a trigram or maintained search index.
