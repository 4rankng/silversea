# Glossary — NEPO Logistics

Complete decoder ring for Vietnamese logistics domain terms, code abbreviations, and internal language.
Hot cache (most common): `CLAUDE.md` · Full domain rules: `CONTEXT.md`

## Vietnamese Business Terms

### Trips
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Chuyến xe | Trip | `Trip` | Core operational unit — single truck journey |
| Mới tạo | Created | `TripStatus.CREATED` | Basic info entered, awaiting pre-departure figures |
| Đang chạy | In Transit | `TripStatus.IN_TRANSIT` | Driver departed, accountant can update figures |
| Hoàn thành | Completed | `TripStatus.COMPLETED` | Driver returned, final figures entered |
| Đã chốt | Locked/Finalized | `TripStatus.LOCKED` | Permanently locked, immutable ledger entries created |
| Đã hủy | Canceled | `TripStatus.CANCELED` | Canceled mid-way, retained for history |
| Chặng | Trip Leg | `TripLeg` | One segment of a trip (origin → destination) |
| Hàng | Loaded (cargo) | `LoadingType.HANG` | Truck carrying cargo — higher fuel norm |
| Vỏ | Empty | `LoadingType.VO` | Truck running empty — lower fuel norm |
| Chốt chuyến | Lock Trip | — | Triggers immutable ledger entries, no further edits |
| Mã chuyến | Trip Code | `tripCode` | Format: `TRP-{YYYYMM}-{0000}`, auto-generated atomically |

### Fuel
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Nhiên liệu | Fuel | — | Diesel fuel for trucks |
| TTBQ (Tiêu thụ bình quân) | Average Consumption | — | Liters per 100km: `(total liters / total km) × 100` |
| Định mức nhiên liệu | Fuel Norm | `fuelLoadedNormApplied`, etc. | 43L/100km loaded, 25L/100km empty, +3L/trip supplement |
| Tự động | AUTO mode | `FuelMode.AUTO` | System calculates from km × norms |
| Khoán | FLAT_RATE mode | `FuelMode.FLAT_RATE` | Accountant manually enters total liters |
| Bổ sung | Supplement | `fuelSupplementLiters` | Extra fuel for breakdowns/repairs, additive on top |
| Chuyến núi | Mountain route | — | Fixed fuel allowance from route record (e.g. Mộc Châu 240L) |
| Giá nhiên liệu | Fuel unit price | `fuelPriceApplied` | Configurable, snapshotted at trip creation, used to calculate fuel cost |
| Giá nhiên liệu thực tế | Actual fuel price | `fuelActualUnitPrice` | Price actually paid at pump, entered per trip by accountant |
| Chênh lệch giá dầu | Fuel price variance | `fuelPriceVariance` | (L × actual price) − (L × config price). Only when `fuelActualUnitPrice` is set |
| Lịch sử giá nhiên liệu | Fuel price history | `fuel_price_history` table | Append-only audit trail of unit price changes with effective dates |
| Đề xuất giá | Price suggestion | — | System looks up effective price from history by trip departure date |
| Lít | Liters | — | Fuel quantity unit |

### Road & Allowances
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Tiền đi đường | Road Allowance | — | Cash for driver to cover tolls, etc. Not income. |
| Tiền chuẩn | Base allowance | `roadAllowanceBaseApplied` | Lookup: Route × Trailer Type (~38 routes × 2 types) |
| Tiền thực tế | Actual allowance | — | `Tiền chuẩn - Giảm vé + Tăng vé - (Số trạm × 55,000) + [300k if return cargo]` |
| Giảm vé | Toll discount | `tollDiscount` | Deduction from base allowance |
| Tăng vé | Toll increase | `tollAddition` | Addition to base allowance |
| Số trạm | Station count | `stationCount` | Number of toll stations, each deducts 55,000 VNĐ |
| Vé đường 5 (QL5) | Highway 5 toll | — | Common toll deduction reference |
| Hàng về | Return cargo | `hasReturnCargo` | Adds 300,000 VNĐ to road allowance |

### Financial
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Sổ cái | Ledger | `Ledger` table | Centralized immutable financial record |
| Doanh thu | Revenue | `revenue` | Amount earned from trip, auto-populated from pricing |
| Tổng chi phí | Total Cost | `totalCost` | Fuel + Road Allowance + Driver Income. Penalties NOT included. |
| Lợi nhuận gộp | Gross Profit | `grossProfit` | Revenue - Total Cost per truck, calculated monthly |
| Lợi nhuận ròng | Net Profit | `netProfit` | Total Gross Profit - Management Fee + Other Income |
| Phí quản lý | Management Fee | `TxnType.MANAGEMENT_FEE` | Fixed monthly overhead (24,000,000 VNĐ) |
| Thu nhập khác | Other Income | — | Includes penalty revenue. Penalties = salary deductions, not company expenses. |
| Công nợ phải thu | Accounts Receivable | — | Customer debt tracking |
| Công nợ | Debt/Receivable | — | General term for outstanding balances |
| Thanh toán | Payment | `TxnType.PAYMENT_RECEIVED` | Customer payment against trips |
| Phân bổ FIFO | FIFO Allocation | — | Oldest unpaid trips suggested first for payment matching |
| Điều chỉnh | Adjustment | `TxnType.ADJUSTMENT` | Correction via new ledger row (Decree 123/2020/ND-CP) |
| Hóa đơn điều chỉnh | Adjustment E-Invoice | — | Required for corrections per Vietnamese accounting standards |
| Biên bản thỏa thuận | Bilateral agreement | — | Signed document required for adjustments |
| Chốt sổ | Monthly close | — | NOT used — trips locked individually, not monthly |
| Phân bổ lợi nhuận | Profit Distribution | — | Quarterly/yearly based on cap table history percentages |
| Lương sản lượng | Trip Income (driver) | `driverTripIncome` | Per-trip income, entered by accountant |
| Lương cơ bản | Base Salary | — | Fixed monthly driver salary |
| Tiền phạt / Kỷ luật | Penalty/Discipline | `TxnType.PENALTY` | Salary deduction, NOT company expense. Recorded as Other Income. |

### Fleet
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Xe đầu kéo | Truck (tractor) | `Truck` | Can have multiple drivers over time |
| Rơ-mooc | Trailer | `Trailer` | Swappable per trip — 20FT or 40FT |
| Lái xe | Driver | `Driver` | One driver per trip (1:1), can drive different trucks |
| 20FT / 40FT | Trailer types | `TrailerType.FT20/FT40` | Two trailer sizes |
| Bảng giá | Pricing table | `PricingTable` | Revenue lookup: Customer × Route, with effective dates |

### System
| Vietnamese | English | Code Constant | Context |
|-----------|---------|---------------|---------|
| Kế toán | Accountant | `Role.ACCOUNTANT` | Enters trip figures, manages financials |
| Quản lý / Giám đốc | Manager | `Role.MANAGER` | Creates trips, manages fleet, views reports |
| Quản trị | Admin | `Role.ADMIN` | Dev/support role, not business user |
| Tài xế | Driver | `Role.DRIVER` | Read-only mobile access to own data |
| Nhật ký kiểm tra | Audit Log | `AuditLog` | One entry per mutation API call, Vietnamese messages |
| Nội quy | Penalty reasons | `PenaltyReason` | Configurable list of common violations |
| Cấu hình | Configuration | Config routes | Catalog tables managed via generic CRUD factory |
| Xuất Excel / Xuất báo cáo | Export CSV/Report | `downloadCSV()` | CSV export button pattern across pages |

## Code Abbreviations

| Abbreviation | Full | Where |
|-------------|------|-------|
| TTBQ | Tiêu Thụ Bình Quân | Fuel consumption metric |
| VNĐ | Vietnamese Dong | Currency, no decimals |
| km | Kilometers | Distance unit |
| L | Liters | Fuel unit |
| QL5 | Quốc lộ 5 | Highway 5 (toll reference) |
| FE | Frontend | `packages/frontend/` |
| BE | Backend | `packages/backend/` |
| SHARED | Shared package | `packages/shared/` |
| PK | Primary Key | Database |
| FK | Foreign Key | Database |
| DTO | Data Transfer Object | API response shaping |
| RBAC | Role-Based Access Control | Auth system |
| CRUD | Create/Read/Update/Delete | Config route pattern |
| P&L | Profit & Loss | Financial reporting |
| PNL | Profit & Loss (code) | Backend route/prefix |
| ORM | Object-Relational Mapping | Drizzle |
| SPA | Single Page Application | Frontend architecture |

## UI Patterns (Internal Shorthand)

| Pattern | What | Where |
|---------|------|-------|
| `useConfirm()` | Async confirm dialog hook | `UI.tsx` — replaces `window.confirm()` |
| `useCRUD()` | Generic CRUD hook for config pages | `hooks/useCRUD.ts` |
| `useCatalogs()` | Bootstrap data hook (5min stale) | `hooks/useCatalogs.ts` |
| `downloadCSV()` | CSV export utility | `lib/csv.ts` |
| `InlineForm` | Inline edit form for config | Config page shared component |
| `ActionBtns` | Edit/Delete buttons | Config page shared component |
| `StatusPill` | Colored status badge | `UI.tsx` |
| `Panel` | Card-like container | `UI.tsx` |
| `Drawer` | Side panel | `UI.tsx` |
| `Modal` | Centered overlay dialog | `UI.tsx` |
| `toast` | Inline notification (fixed pos, 4.5s) | Pages (not a library) |

## File Location Shorthand

| Shorthand | Path |
|-----------|------|
| schema | `backend/src/db/schema.ts` |
| trip service | `backend/src/services/trip.service.ts` |
| ledger service | `backend/src/services/ledger.service.ts` |
| reporting service | `backend/src/services/reporting.service.ts` |
| UI components | `frontend/src/components/UI.tsx` |
| TripForm | `frontend/src/components/TripForm/` |
| config routes | `backend/src/routes/config.ts` |
| trip routes | `backend/src/routes/trips.ts` |
| financial routes | `backend/src/routes/financial.ts` |
| driver routes | `backend/src/routes/driver.ts` |
| shared constants | `shared/src/constants/index.ts` |
| shared types | `shared/src/types/` |
| shared schemas | `shared/src/schemas/index.ts` |
| shared math | `shared/src/calculations/` |
