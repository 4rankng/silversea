# Dispatcher assignment identity and draft safety

Manual browser checks only; no automated suite requested for this follow-up.

## DSP-DRIVER-01 — Driver visible beside assigned vehicle
1. Open Kế hoạch chi tiết as điều vận and locate an OWN planned row with an assigned truck and driver (customer screenshot: CMAU3740819 / 15C-167.31).
2. Read the Điều phối column without opening its editor.
3. Change its vehicle to another assigned truck and save, then reload.
Expected: carrier, plate, driver name and issue status appear as compact separate lines. The saved vehicle's actual driver updates immediately and survives reload. An assigned truck without a driver shows “Chưa có tài xế”; a row without a truck does not add that warning. Issued trips show the driver assigned to that trip, even when the truck's current roster changes. On an external-carrier row, fill the external driver name while issuing; it must appear immediately and after reload. Check desktop, tablet and phone wrapping.

## DSP-DRAFT-01 — Release preserves edited notes and costs
1. Open an assigned, unissued row.
2. Change only a task/note, only expected revenue, then only expected carrier cost (separate attempts).
3. Inspect Phát lệnh, save, reopen, and issue the order.
Expected: each unsaved change disables Phát lệnh and explains that the plan must first be saved. Reverting to the stored value restores release. Saving persists each field; issuing uses the saved plan. Equivalent numeric formatting does not create a false unsaved state.

## DSP-FILTER-01 — Clear all removes every facet selection
1. On detail plan, select at least two values for Điểm nâng; click Bỏ chọn tất cả. Repeat for Điểm hạ and Điểm trả.
2. On master plan, select at least two ports in one zone; clear them. Repeat with at least two Nhà xe.
Expected: one click clears the entire selection, chip/count and rows update coherently, no previous option remains. Other filter groups remain unchanged.

Status: implementation pending visual verification by the root agent in Chrome.

## DSP-DRIVER-02 — Detail loading with issued trip driver metadata
1. Open Kế hoạch chi tiết with issued and planned rows after backend restart.
Expected: the list loads without HTTP 500; driver metadata reads the current composite trip read model.
Observed before correction: Drizzle orderSelectedFields failed because carrierType/externalDriverName live in the trip commercial extension, not the base trips table.
