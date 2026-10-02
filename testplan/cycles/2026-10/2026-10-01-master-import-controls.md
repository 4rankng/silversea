# QA-AUDIT-UI-10 — master import density and confirmation

1. As ADMIN local dev, open /config/master-data-import at390/768/1440. Open legacy file section and inspect the three file controls and summary geometry.
2. Upload the existing docs/customer-data/4.9 - Import data form.xlsx and click Kiểm tra dữ liệu. Read the real batch summary; its10 blocked rows keep Áp dụng dữ liệu hợp lệ disabled.
3. Click rejection without a reason: validation remains visible and no confirmation/write occurs.
4. Enter a reason and click rejection. Require the house Xác nhận thao tác dialog, no browser-native dialog. Click Hủy/Escape and require batch remains ANALYZED with no reject write.
5. Reopen and confirm Từ chối. Require persisted REJECTED, same row classifications and zero applied rows. Repeat responsive checks on the analyzed/confirmation surfaces at all three widths before the final write.

Expected: single-line controls follow house compact/touch tokens with no inline44/48 floors or hardcoded brand colors; readable filenames/messages, no document overflow. Cancel/Confirm preserve current reason/busy/version/idempotency behavior and the blocked apply gate.
