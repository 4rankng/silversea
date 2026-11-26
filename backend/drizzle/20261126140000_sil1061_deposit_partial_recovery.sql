-- SIL-1061 (K2.118 / K2.150) — ghi số đã hoàn từng phần + ngày nhận thực tế
-- trên bảng theo dõi hoàn cược. drizzle/meta đã hỏng từ trước; re-run an toàn
-- nhờ IF NOT EXISTS (house convention của 20261109110000).
ALTER TABLE "deposit_refund_trackers" ADD COLUMN IF NOT EXISTS "recovered_amount" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "deposit_refund_trackers" ADD COLUMN IF NOT EXISTS "refund_received_date" date;
