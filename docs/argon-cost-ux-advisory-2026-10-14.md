# Argon 4 UX advisory — cost modules (2026-10-14)
Source: Gemini 4 Argon via web-API lane. For the morning merge review of cost-doc waves A-D.

### 1. Accountant 'Add Expense' Form
* **Recommended Pattern:** **Editable Data Grid with a Pinned "Ghost Row"** (Excel-like table-with-add-row). Vietnamese logistics accountants work heavily in Excel; side panels require too much mouse travel, and chained forms clutter the viewport.
* **Keyboard-First Flow:** `Tab` moves horizontally across cells: *Nhóm chi phí* (Segmented toggle or `T`/`C` hotkeys) → *Tên khoản chi* (Typeahead dropdown) → *Bên thực chi* → *Nhà cung cấp* → *Số HĐ + Ngày*. Pressing `Enter` on the last cell commits the row locally and auto-focuses the first cell of a new blank row below.
* **Smart Conditional Logic:** If *Nhóm chi phí* = `Tiền đường`, auto-default *Bên thực chi* to `Tài xế` and dim/skip *Nhà cung cấp* & *Số HĐ* (unless overridden) to save keystrokes.
* **Batch Commit:** Hold entries in a local "dirty" state (highlighted with a subtle amber left-border) with a sticky bottom bar: `Lưu tất cả (Ctrl+S)` + live running total of the batch.

---

### 2. Driver-Facing Cost View (Mobile-First)
* **Recommended Pattern:** **Single Unified Feed with Locked/Auto Rows** (avoid tabs). Drivers on the road have low tech literacy and high cognitive load; hidden tabs cause them to miss pre-allocated allowances or re-enter duplicate costs.
* **Top Section (Khoản cố định / Hệ thống tính):** Read-only cards with a subtle gray background (`#F4F5F7`) and a lock icon (`🔒 Đã cấp`). Clearly lists *Tiền đường* and *Nâng/hạ Lạch Huyện* so the driver sees their baseline trip allowance immediately.
* **Bottom Section (Chi phí phát sinh):** Active input zone with a prominent `+ Thêm chi phí` button. Uses a bottom-sheet picker with large tap targets for common incidentals (*Vé cược, Làm luật, Vá lốp, Cân xe*) + numeric keypad for amount + 1-tap photo upload for receipts.
* **Sticky Footer:** Shows `Tổng chi phí chuyến` (Auto + Driver-entered) so they know exact cash-on-hand math.

---

### 3. 'Chốt Debit' (Reconciliation) Screen Redesign
Structure as a **3-Zone Vertical Workspace** (Top Summary → Split/Filtered Action Table → Sticky Settlement Bar):

* **Zone A: Top Financial Equation Bar (4-Card Strip):**
  * Displays the exact formula horizontally: **[1. Tổng tạm ứng]** − **[2. Chi phí hợp lệ]** − **[3. Chờ duyệt]** = **[4. Còn lại hoàn ứng / Phải thu]**.
  * **Negative-Warning State:** If Card 4 is negative (Company owes Driver: *Công ty bù*), style with a **Blue/Teal** badge (`Cần chi thêm`). If positive (Driver owes Company: *Tài xế hoàn ứng*), style with a **High-Contrast Amber/Red** callout (`Phải thu lại từ TX`) and an overdue counter if uncollected.
* **Zone B: Split-State Reconciliation Workspace:**
  * **Top Priority Block (Chờ duyệt - Needs Action):** Highlighted container at the top of the table for driver-submitted incidental expenses. Includes inline receipt thumbnail preview (hover/click to zoom) and 1-click `Duyệt (A)` / `Từ chối (R)` buttons.
  * **Below (Đã chốt / Hệ thống):** Collapsible or muted rows for auto-calculated system fees (*Tiền đường, Lạch Huyện*) that require zero review.
* **Zone C: Sticky Action Footer:**
  * `Chốt Debit` primary CTA remains **disabled** until *Chờ duyệt* count = `0`. Includes a secondary `Xuất phiếu đối chiếu (PDF/Zalo)` button to send directly to the driver's Zalo.

---

### 4. Dispatcher Timesheet Grid & Month-End Rollup
* **Grid Structure:** **Frozen Left Columns** (*Tài xế*, *Biển số*, *Chế độ lương* badge: `Khoán chuyến` vs `Lương cứng`) + **31-Day Horizontal Matrix** + **Frozen Right Summary Columns**.
* **Fast Dispatcher Interaction:**
  * **Direct Hotkey Entry:** Clicking a cell or navigating via arrow keys lets dispatchers type `K`, `Q`, `D`, `L`, `N`, `P` directly (auto-capitalized, auto-advances right on keypress).
  * **Color-Coded Pills:** Render `Q` (2 trips) in **Bold Emerald**, `K`/`Đ` (1 trip) in **Standard Blue**, `P` (Paid leave) in **Purple**, and `L`/`N` (0) in **Muted Gray** so dispatchers can visually scan workload density.
  * **Paintbrush / Drag-to-Fill:** Allow dragging a cell corner across multiple days (e.g., filling `N` or `P` across 3 days).
* **Inline Salary Progress & Tier Trigger:**
  * Freeze a `Tổng chuyến` column right after Day 31. For `Khoán chuyến` drivers, show a progress pill (e.g., `19/20`). The moment trips hit **21+**, highlight the badge in **Gold/Green** (`22 chuyến • +200k thưởng vượt mốc`) and auto-calculate: $\text{Base} + (20 \times 300\text{k}) + ((N - 20) \times 400\text{k})$.
* **Month-End Efficiency Rollup:**
  * **Expandable Drawer / Popover on Driver Row Click:** Keep the 31-day grid clean by putting the operational breakdown in a slide-over or expandable sub-row.
  * **3-Column Rollup Inside Drawer:**
    1. **Cơ cấu chuyến (Trip Mix):** Stacked bar showing **Đơn** (Single) vs **Kẹp** (Double 20') vs **Ghép** (Combined) count & percentage.
    2. **Hiệu quả (P&L):** `Doanh thu tuyến` vs `Tổng chi phí` (Lương + Dầu + Tiền đường + Vé) = **Lợi nhuận gộp (Margin %)**.
    3. **Lương tạm tính:** Exact breakdown of Base + Trip pay + Tier bonus (`>20 trips`) + Leave days (`P`).

<ElicitationsGroup message="To translate these UX patterns into build-ready specs:">
  <Elicitation label="Build an interactive prototype of the Chốt Debit screen" query="Build an interactive web prototype of the Chốt Debit reconciliation screen and Accountant expense grid."/>
  <Elicitation label="Spec out exact keyboard shortcuts and validation rules" query="Create a detailed specification table for keyboard shortcuts, edge cases, and validation rules across all 4 modules."/>
  <Elicitation label="Design the database schema for the trip & salary logic" query="Write the database schema and calculation logic for the K/Q/Đ/L/N/P driver timesheet and tiered trip bonuses."/>
</ElicitationsGroup>