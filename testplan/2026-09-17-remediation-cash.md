# Cash remediation regression plan — 17 September 2026

Reassessed on prod0df231ab after external reset; previous edits were absent. Existing ledger/treasury remain authorities; no new schema, historical cash backfill, approval, or automatic cross-batch offsets.

| Case | Action | Expected |
|---|---|---|
|FIX17-CASH-01|OPS request1m, reloadwallet; accountant funds exactrequest; retry|Request adds no cash/ledger; one request/credit/movement after funding; no duplicate funding.|
|FIX17-CASH-02|Old RECORDED request has ledger but no treasury; listwallet/outstanding/settlement|No cash/eligibleamount untilactualfunding; funding reuseslegacyledger once.|
|FIX17-CASH-03|Recover oldDRAFT thenfund|Recordingrequest createsno cash; fundingcreatesmoney once, auditeddirectaction.|
|FIX17-CASH-04|Accountant proxyOPS333k on realtrip|One nativeOPSsource withcorrectpaidBy/recordedBy; ownerhistory+wallet333k once; billingprojectiononly.|
|FIX17-CASH-05|Unrelatedadvances exist; reconcileexplicit1.2mexpense/1mfundedadvance; pay100k; reverse|Batchremaining200k payable; pay leaves100k; reversalrestores200k; unrelatedcash never silentlyallocated, per-source excess/concurrencyguards preserved.|
|FIX17-CASH-06|100k receipt10Sep reversed20Sep; charge300k; reportasof9/10/15/20/21, export|Received0/100k/100k/0/0, debts300k/200k/200k/300k/300k. SameOUTboundary.|
|FIX17-CASH-07|Fundedadvance treasuryreversal|Netfundedamount used forwallet/eligibility, neverrequestedamount.|

Scoped regression gates and fresh UI/browser persistedproof local7175/3001, uniqueFIX17fixtures, artifactsqa/2026-09-17-remediation/cash. Root integratesfullgates. All applicationchangesuncommitted.

- FIX17-CASH-08: Phải trả chốt trước ngày phân bổ ứng phải giữ số đã thanh toán bằng 0; đợt được hoàn tác sau ngày chốt vẫn giữ đúng ứng đã phân bổ tại thời điểm đó. Đọc chứng từ giao tiền theo ngày hiệu lực. Nếu chứng từ không đủ để xác định ứng cho từng dòng, hiển thị chưa xác định, không đoán tỷ lệ. Ngày chốt chỉ áp dụng thanh toán; phạm vi chi phí là hồ sơ hiện hành, không phải ảnh chụp toàn bộ chi phí lịch sử.
- FIX17-CASH-09: Phiếu quyết toán cũ ghi số cần hoàn nhưng chưa có giao dịch quỹ không làm giảm ví. Chỉ tiền hoàn có chứng từ quỹ làm giảm ví; đảo tiền hoàn phục hồi số dư đúng một lần.

- FIX17-CATALOG-01: Customer/supplier create and update reject tax codes longer than the existing 20-character storage limit with HTTP 400 and a field-specific message. Exactly 20 characters remain valid; optional blank values remain valid; surrounding spaces are trimmed before validation. All customer/supplier form entry points enforce the same limit. No database schema expansion.
