-- SIL-805 — bảng Kiểm soát lô hàng (/accounting/chot-debit): kế toán sửa
-- trực tiếp 8 ô giá/chi phí (cước thu, Lạch Huyện thu, phụ PS, phát sinh
-- CUS, cước trả ĐV, Lạch Huyện ĐV, phát sinh ĐV, phí RU) khi lô chưa khóa
-- chi phí / khóa sổ. Giá trị override thay giá trị tự động của đúng ô đó
-- trên bảng (Tổng thu/Tổng trả/Lợi nhuận đọc cùng override); NULL cột =
-- không override (vẫn đọc giá trị tự động). Schema-only, không backfill.
CREATE TABLE "shipment_debit_rate_overrides" (
	"shipment_id" integer PRIMARY KEY,
	"cuoc_thu" numeric(15, 0),
	"lach_huyen_thu" numeric(15, 0),
	"phu_ps" numeric(15, 0),
	"phat_sinh_cus" numeric(15, 0),
	"cuoc_tra_dv" numeric(15, 0),
	"lach_huyen_dv" numeric(15, 0),
	"phat_sinh_dv" numeric(15, 0),
	"phi_ru" numeric(15, 0),
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
