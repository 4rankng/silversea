-- FAQ knowledge base for the chatbot agent's pre-LLM fast lane.
--
-- The fast lane (services/agent/faq-fast-lane.ts) answers seeded domain
-- questions with ZERO LLM calls via a 4-stage cascade: exact → rule (required/
-- forbidden terms) → cosine similarity (pgvector) → score/margin gate.
--
-- PREREQUISITE: the postgres container must be the pgvector/pgvector:pg16 image
-- (not stock postgres:16-alpine). Dev: `docker compose down -v` once after the
-- image switch to recreate the volume with the extension available. Prod: the
-- image change is the only requirement — this migration is additive.
--
-- Embeddings (vector(1536)) are NULL after this migration and populated by the
-- backfill script (db/backfill-faq-embeddings.ts) which calls OpenRouter's
-- text-embedding-3-small. Until backfill runs, only the exact + rule stages
-- match; the semantic stage abstains (NULL embeddings are filtered out).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE faq_entries (
  id                SERIAL PRIMARY KEY,
  question          TEXT NOT NULL,                  -- canonical question (Vietnamese)
  answer            TEXT NOT NULL,                  -- prebuilt answer (Vietnamese)
  question_variants TEXT[] NOT NULL DEFAULT '{}',   -- paraphrases for exact-match stage
  required_terms    TEXT[] NOT NULL DEFAULT '{}',   -- all must be present (rule gate)
  forbidden_terms   TEXT[] NOT NULL DEFAULT '{}',   -- any present → reject (rule gate)
  search_text       TEXT NOT NULL DEFAULT '',       -- normalized concat (reserved for trigram)
  embedding         vector(1536),                   -- NULL until backfill embeds it
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for cosine similarity (text-embedding-3-small = 1536 dims, within
-- the native HNSW 2000-dim cap so no halfvec cast needed). Partial: only active,
-- embedded rows are indexed.
CREATE INDEX faq_entries_embedding_idx
  ON faq_entries USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND is_active = TRUE;

-- Seed comprehensive NEPO domain FAQs sourced from CONTEXT.md business rules.
-- ~30 entries covering: penalties, trip lifecycle, fuel, road allowance, ledger,
-- financials (AR/AP/expenses/revenue/profit), fleet/personnel, audit, corrections.
-- Tuned so exact + rule stages catch obvious phrasings; semantic stage (after
-- backfill) catches paraphrases. required_terms/forbidden_terms disambiguate
-- similar questions (e.g. "tiền đi đường" vs "phí đường bộ").
--
-- IMPORTANT — diacritic rule for term arrays: question_variants MAY keep
-- Vietnamese diacritics (they're normalized at match time), but required_terms
-- and forbidden_terms MUST be stored TONE-STRIPPED (e.g. 'phat' not 'phạt'),
-- because the matcher compares them against tone-stripped query tokens (see
-- faq-fast-lane.ts normalizeForFaq + the rule-gate SQL). Storing diacritics
-- here makes the rule gate silently reject every match.
INSERT INTO faq_entries (question, answer, question_variants, required_terms, forbidden_terms, sort_order) VALUES

-- ═══════════════════════════ KỶ LUẬT / PHẠT ════════════════════════════════
-- 1. Penalty for missing fuel invoice
(
  'Thiếu hóa đơn dầu bị phạt bao nhiêu?',
  'Thiếu hóa đơn dầu bị phạt 100.000đ (khoản phạt phổ biến nhất). Vi phạm an toàn giao thông nặng hơn phạt 500.000đ hoặc sa thải tùy mức độ. Tiền phạt là khoản TRỪ vào lương tài xế, KHÔNG phải chi phí công ty, và được ghi nhận là "Thu nhập khác". Kế toán nhập thủ công trong mục Kỷ luật; hệ thống có sẵn danh sách lý do phổ biến nhưng cho phép nhập tùy chỉnh với kiểm tra trùng lặp.',
  ARRAY['thiếu hóa đơn dầu bị phạt bao nhiêu', 'phạt thiếu hóa đơn dầu', 'thieu hoa don dau bi phat', 'phat hoa don dau'],
  ARRAY['phat', 'dau'],
  ARRAY[]::text[],
  1
),
-- 2. Penalty is not a company expense
(
  'Tiền phạt là chi phí của công ty không?',
  'KHÔNG. Tiền phạt (Kỷ luật) là khoản TRỪ vào lương tài xế, không phải chi phí của công ty. Công ty ghi nhận tiền phạt là "Thu nhập khác" (Other Income). Lương tài xế được ghi nhận ĐẦY ĐỦ как chi phí nhân công — tiền phạt KHÔNG được trừ khỏi chi phí đó. Lợi nhuận ròng = Tổng lợi nhuận gộp − Phí quản lý − chi phí vận hành + Thu nhập khác (trong đó có tiền phạt).',
  ARRAY['tiền phạt là chi phí công ty không', 'phạt có phải chi phí không', 'tien phat la chi phi khong', 'phat chi phi'],
  ARRAY['phat'],
  ARRAY['duong'],
  2
),

-- ═══════════════════════════ VÒNG ĐỜI CHUYẾN ═══════════════════════════════
-- 3. Trip lifecycle statuses
(
  'Chuyến xe có những trạng thái nào?',
  'Một chuyến xe có 5 trạng thái: (1) Mới tạo — quản lý nhập thông tin cơ bản (xe, tuyến, khách hàng); (2) Đang chạy — tài xế đã khởi hành; (3) Hoàn thành — tài xế về, kế toán chốt số thực tế; (4) Đã chốt — dữ liệu khóa vĩnh viễn và ghi vào Sổ cái, không chỉnh sửa được nữa; (5) Đã hủy — giữ lại để lưu trữ lịch sử. Cả MANAGER và ACCOUNTANT đều có thể thực hiện các chuyển trạng thái. Việc chốt diễn ra theo TỪNG chuyến (không phải chốt cả tháng).',
  ARRAY['chuyến xe có những trạng thái nào', 'trạng thái chuyến xe', 'vòng đời chuyến xe', 'cac trang thai chuyen xe'],
  ARRAY['trang thai'],
  ARRAY['phat', 'nhien lieu'],
  3
),
-- 4. What happens when a trip is locked
(
  'Khi chốt chuyến thì điều gì xảy ra?',
  'Khi chuyển chuyến sang "Đã chốt", dữ liệu được khóa vĩnh viễn và ghi chính thức vào Sổ cái: doanh thu chuyến tạo dòng TRIP_REVENUE vào nợ phải thu của khách hàng (entity_type="CLIENT"), lương tài xế và các khoản ghi nhận tương ứng. KHÔNG thể chỉnh sửa dữ liệu chuyến sau khi chốt — mọi sai sót phải xử lý qua Điều chỉnh (Hóa đơn điều chỉnh theo Nghị định 123/2020). Việc chốt theo từng chuyến, không phải chốt cả tháng. Mọi chuyến đều cần ít nhất 1 ảnh tải bằng chứng trước khi chốt.',
  ARRAY['khi chốt chuyến thì điều gì xảy ra', 'chốt chuyến xe', 'khi chot chuyen', 'chuyen da chot'],
  ARRAY['chot'],
  ARRAY['huy'],
  4
),
-- 5. Cargo photo requirement
(
  'Chuyến xe có cần ảnh bằng chứng không?',
  'CÓ. Tất cả chuyến đều cần ít nhất một ảnh tải bằng chứng (cargo photo) tải lên TRƯỚC khi có thể chốt ("Đã chốt"). Đây là quy tắc chung bắt buộc cho mọi loại hàng. Trường hợp CargoType.requires_photos là trường cấu hình dự phòng cho việc áp dụng theo loại hàng trong tương lai, hiện KHÔNG ảnh hưởng đến luồng chốt. Chuyến chè không có yêu cầu ảnh đặc biệt ngoài quy tắc chung này.',
  ARRAY['chuyến xe có cần ảnh bằng chứng không', 'ảnh tải bằng chứng', 'cargo photo', 'anh bang chung', 'anh tai'],
  ARRAY['anh'],
  ARRAY[]::text[],
  5
),
-- 6. Single trip single driver
(
  'Một chuyến có nhiều tài xế không?',
  'KHÔNG. Một chuyến luôn gán cho ĐÚNG MỘT tài xế (1:1), ngay cả khi một xe có thể có nhiều tài xế luân phiên theo thời gian. Lương sản lượng được tính theo chuyến cho tài xế được gán, kết hợp với lương cơ bản để ra tổng lương tháng. Tài xế có quyền truy cập chỉ-đọc trên điện thoại để xem phân bổ nhiên liệu, thu nhập và lịch sử chuyến.',
  ARRAY['một chuyến có nhiều tài xế không', 'một chuyến bao nhiêu tài xế', 'mot chuyen nhieu tai xe', 'chuyen mot tai xe'],
  ARRAY['chuyen', 'tai xe'],
  ARRAY[]::text[],
  6
),
-- 7. Trailer swap per trip
(
  'Một xe có thể kéo nhiều loại rơ-mooc không?',
  'CÓ. Rơ-mooc (trailer) có thể thay đổi theo từng chuyến — cùng một xe đầu kéo có thể kéo rơ-mooc 20ft trong chuyến này và 40ft trong chuyến tiếp theo. Đây là lý do chi phí gán cho rơ-mooc KHÔNG tính vào lợi nhuận gộp của một xe cụ thể (vì rơ-mooc luân phiên giữa các xe sẽ bóp méo chi phí xe đó) — chi phí rơ-mooc rơi vào lợi nhuận ròng ở cấp công ty.',
  ARRAY['một xe có thể kéo nhiều loại rơ-mooc không', 'đổi rơ-mooc mỗi chuyến', 'romooc', 'rơ mooc'],
  ARRAY['romooc'],
  ARRAY[]::text[],
  7
),

-- ═══════════════════════════ NHIÊN LIỆU ════════════════════════════════════
-- 8. Fuel calculation modes
(
  'Có mấy cách nhập nhiên liệu?',
  'Có 2 chế độ chính: (1) AUTO — nhập số km mỗi chặng + loại tải (hàng/vỏ), hệ thống tự tính số lít từ định mức (43L/100km có tải, 25L/100km vỏ, +3L/chặng bổ sung cho tuyến chuẩn). (2) KHOÁN (FLAT_RATE) — kế toán nhập trực tiếp tổng số lít, ghi đè mọi tính toán. Cả hai chế độ đều có thể cộng thêm "Bổ sung" (lít thêm cho hỏng hóc/sửa chữa). Chỉ có MỘT bộ trường nhiên liệu duy nhất, được cập nhật liên tục (không tách "dự kiến" vs "thực tế").',
  ARRAY['có mấy cách nhập nhiên liệu', 'chế độ nhập nhiên liệu', 'cach nhap nhien lieu', 'cach tinh nhien lieu'],
  ARRAY['nhien lieu'],
  ARRAY[]::text[],
  8
),
-- 9. Fuel norms
(
  'Định mức nhiên liệu hiện hành là bao nhiêu?',
  'Định mức hiện hành: 43L/100km (có tải/hàng), 25L/100km (xe vỏ/chạy không), +3L bổ sung mỗi chuyến cho tuyến chuẩn. Đơn giá nhiên liệu cấu hình được snapshot vào mỗi chuyến lúc tạo (fuelPriceApplied). Khi kế toán nhập giá thực tế (fuelActualUnitPrice), tổng chi phí nhiên liệu = số lít × giá thực tế thay vì giá cấu hình. Bảng fuel_price_history lưu vết mọi lần đổi đơn giá (append-only).',
  ARRAY['định mức nhiên liệu hiện hành là bao nhiêu', 'định mức tiêu hao nhiên liệu', 'dinh muc nhien lieu', 'dinh muc dau'],
  ARRAY['dinh muc', 'nhien lieu'],
  ARRAY[]::text[],
  9
),
-- 10. TTBQ calculation
(
  'TTBQ (Tiêu thụ bình quân) tính thế nào?',
  'TTBQ = Tiêu thụ bình quân = số lít nhiên liệu trên 100km, tính theo công thức: (tổng số lít / tổng số km) × 100. Đây là chỉ số tham chiếu hiển thị trên chi tiết chuyến để theo dõi hiệu quả nhiên liệu. KHÔNG phải là định mức — định mức (43L/100km có tải, 25L/100km vỏ) là giá trị cấu hình dùng để TÍNH số lít; TTBQ là kết quả THỰC TẾ đo lường sau chuyến.',
  ARRAY['TTBQ tính thế nào', 'tiêu thụ bình quân', 'tieu thu binh quan', 'tinh ttbq'],
  ARRAY['ttbq'],
  ARRAY[]::text[],
  10
),
-- 11. Mountain route fuel
(
  'Tuyến núi tính nhiên liệu thế nào?',
  'Tuyến núi dùng định mức cố định (fixed total fuel allowance) lưu trong record tuyến đường, bao phủ cả chiều đi và về. Ví dụ: Mộc Châu 240L, Sơn La 320L, Lai Châu 365L. Hệ thống tự tra theo tuyến. Khoản định mức cố định này GHI ĐÈ mọi tính toán theo số km. Mô hình nhiều chặng (multi-leg) vẫn áp dụng để theo dõi chi tiết, nhưng tổng lít giữ nguyên giá trị cố định.',
  ARRAY['tuyến núi tính nhiên liệu thế nào', 'nhiên liệu tuyến núi', 'tuyen nui nhien lieu', 'dinh muc nui'],
  ARRAY['nui', 'nhien lieu'],
  ARRAY[]::text[],
  11
),
-- 12. Trip legs
(
  'Một chuyến gồm những chặng nào?',
  'Một chuyến (trip) gồm nhiều chặng (legs), mỗi chặng có điểm đi, điểm đến, số km, và loại tải (hàng hoặc vỏ). Hệ thống tính nhiên liệu theo từng chặng dựa trên định mức áp dụng (có tải dùng định mức hàng, vỏ dùng định mức vỏ). Mô hình nhiều chặng áp dụng cho cả tuyến núi (dù tổng lít núi là cố định, vẫn phân rã chặng để theo dõi chi tiết).',
  ARRAY['một chuyến gồm những chặng nào', 'chặng chuyến xe', 'trip legs', 'cac chang chuyen'],
  ARRAY['chang'],
  ARRAY[]::text[],
  12
),
-- 13. Fuel price actual vs config
(
  'Giá nhiên liệu thực tế khác giá cấu hình thế nào?',
  'Có hai mức giá: (1) Đơn giá cấu hình (fuel_config.unitPrice) — được snapshot vào mỗi chuyến lúc tạo thành fuelPriceApplied. (2) Giá thực tế (fuelActualUnitPrice) — kế toán nhập giá mua thực tế (giá trạm) cho từng chuyến. Khi có giá thực tế, tổng chi phí nhiên liệu = số lít × giá thực tế (thay vì giá cấu hình). Chênh lệch (fuelPriceVariance = chi phí thực − chi phí cấu hình) được theo dõi cho báo cáo. Giá thực tế chỉ chỉnh sửa được trước khi chốt chuyến.',
  ARRAY['giá nhiên liệu thực tế khác giá cấu hình thế nào', 'giá dầu thực tế', 'fuelActualUnitPrice', 'gia nhien lieu thuc te'],
  ARRAY['gia', 'nhien lieu'],
  ARRAY[]::text[],
  13
),

-- ═══════════════════════════ TIỀN ĐI ĐƯỜNG ════════════════════════════════
-- 14. Road allowance vs road-use fee disambiguation
(
  'Tiền đi đường khác phí đường bộ thế nào?',
  'Đây là hai khoản RIÊNG BIỆT, dễ nhầm: "Tiền đi đường" là tiền mặt trả cho tài xế TRƯỚC mỗi chuyến để chi trả phí trạm BOT thực tế — KHÔNG tính là thu nhập của tài xế. "Phí đường bộ" là phí bảo trì đường bộ HÀNG NĂM nộp cho nhà nước cho mỗi xe — đây là một hạng mục Chi phí phát sinh (Expense Item) ĐỊNH KỲ, KHÔNG thuộc chi phí mỗi chuyến. Công thức tiền đi đường: Tiền chuẩn − (Số trạm × 55.000đ) + 300.000đ nếu có hàng về.',
  ARRAY['tiền đi đường khác phí đường bộ thế nào', 'khác nhau tiền đi đường phí đường bộ', 'tien di duong phi duong bo'],
  ARRAY['duong'],
  ARRAY[]::text[],
  14
),
-- 15. Road allowance formula
(
  'Công thức tính tiền đi đường?',
  'Tổng tiền đi đường = Tiền chuẩn − (Số trạm × 55.000đ) + [300.000đ nếu có hàng về (return cargo)]. Tiền chuẩn là bảng tra cố định theo Tuyến × Loại rơ-mooc (~38 tuyến × 2 loại). Nếu kế toán nhập "Tổng tiền đi đường" (> 0) thì dùng trực tiếp giá trị đó, còn không hệ thống tự tính theo công thức. Lái xe thực lĩnh = Tổng tiền đi đường + Tiền kết hợp + Tiền lưu ca xe + Tiền trả hàng 2 điểm − Tiền vé (công ty) đã thanh toán.',
  ARRAY['công thức tính tiền đi đường', 'tính tiền đi đường', 'cong thuc tien di duong', 'tinh tien di duong'],
  ARRAY['tien', 'duong'],
  ARRAY['phi duong bo'],
  15
),

-- ═══════════════════════════ SỔ CÁI / LEDGER ═══════════════════════════════
-- 16. Ledger immutability
(
  'Sổ cái có thể chỉnh sửa không?',
  'KHÔNG. Sổ cái (Ledger) là BẤT BIẾN — không có endpoint UPDATE/DELETE. Mọi điều chỉnh phải tạo dòng MỚI qua POST /api/ledger/adjustments. Cán cân nợ hiện tại của một thực thể là giá trị "balance" của dòng mới nhất cho thực thể đó. entity_type/entity_id liên kết lỏng (VARCHAR + Integer, KHÔNG có FK) — entity_type là chuỗi như "DRIVER", "CLIENT", "VENDOR".',
  ARRAY['sổ cái có thể chỉnh sửa không', 'chỉnh sửa sổ cái', 'ledger bất biến', 'so ca co the chinh sua khong'],
  ARRAY['so ca'],
  ARRAY[]::text[],
  16
),
-- 17. Adjustment invoices (Nghị định 123)
(
  'Sai sót số liệu đã khóa xử lý thế nào?',
  'Theo chuẩn kế toán Việt Nam (Nghị định 123/2020/NĐ-CP), sửa sai sót số liệu đã khóa cần Hóa đơn điều chỉnh (Adjustment E-Invoice) phát hành trong kỳ hiện tại. Điều chỉnh giảm (Credit Note) dùng giá trị ÂM, điều chỉnh tăng (Debit Note) dùng giá trị DƯƠNG. Cả hai đều cần biên bản thỏa thuận hai bên ký (bilateral signed agreement). Trong hệ thống, điều chỉnh tạo dòng MỚI trong Ledger — không bao giờ sửa dòng đã khóa.',
  ARRAY['sai sót số liệu đã khóa xử lý thế nào', 'hóa đơn điều chỉnh', 'điều chỉnh sổ cái', 'hoa don dieu chinh', 'nghị định 123'],
  ARRAY['dieu chinh'],
  ARRAY[]::text[],
  17
),

-- ═══════════════════════════ CÔNG NỢ ══════════════════════════════════════
-- 18. Accounts receivable / payment matching
(
  'Khách hàng thanh toán ghép thế nào?',
  'Ghép thanh toán (payment matching) là THỦ CÔNG: kế toán chọn những chuyến cụ thể đang được thanh toán và nhập số tiền cho từng chuyến (cho phép thanh toán một phần). Hệ thống gợi ý thứ tự FIFO mặc định (chuyến chưa thanh toán cũ nhất trước), nhưng kế toán có thể ghi đè — cần thiết vì khách hàng đôi khi chỉ định chuyến cụ thể qua sao kê hoặc tranh chấp chuyến cũ. Một lần chuyển khoản ngân hàng tạo nhiều dòng PAYMENT_RECEIVED (mỗi chuyến một dòng), cùng nhóm bởi receipt_id.',
  ARRAY['khách hàng thanh toán ghép thế nào', 'ghép thanh toán', 'công nợ phải thu', 'payment matching', 'cong no phai thu'],
  ARRAY['thanh toan'],
  ARRAY['tra'],
  18
),
-- 19. Accounts payable (vendor)
(
  'Công nợ phải trả tính thế nào?',
  'Công nợ phải trả (Accounts Payable) là tiền công ty nợi Nhà cung cấp (Vendor). Cấu trúc đối xứng với công nợ phải thu trên entity_type="VENDOR". Dấu: balance = prev + Credit − Debit (chi phí = Credit, thanh toán = Debit). Aging ĐẢO NGƯỢC so với phải thu: tính tuổi các Credit đang mở, áp dụng Debit theo FIFO. Một lần thanh toán giảm cán cân chạy — KHÔNG ghép theo từng chi phí như phải thu.',
  ARRAY['công nợ phải trả tính thế nào', 'nợ nhà cung cấp', 'cong no phai tra', 'no nha cung cap'],
  ARRAY['cong no', 'tra'],
  ARRAY['thu'],
  19
),
-- 20. Vendor definition
(
  'Nhà cung cấp là gì?',
  'Nhà cung cấp (Vendor) là bất kỳ bên nào công ty thanh toán — garage, tiệm lốp, cửa hàng phụ tùng/vật liệu, công ty bảo hiểm, trung tâm đăng kiểm, cơ quan thu phí đường bộ. Theo dõi trong Sổ cái dưới entity_type="VENDOR". TRÁNH dùng từ: Supplier, đối tác, nhà thầu. Mọi chi phí phát sinh gán cho Vendor sẽ tạo dòng nợ phải trả (nếu UNPAID) hoặc chỉ ghi nhận P&L (nếu PAID).',
  ARRAY['nhà cung cấp là gì', 'vendor là gì', 'nha cung cap', 'dinh nghia nha cung cap'],
  ARRAY['nha cung cap'],
  ARRAY[]::text[],
  20
),

-- ═══════════════════════════ CHI PHÍ ═══════════════════════════════════════
-- 21. Expense PAID vs UNPAID
(
  'Chi phí phát sinh PAID và UNPAID khác nhau thế nào?',
  'Một chi phí phát sinh (Expense) gắn với Vendor và tùy chọn với một xe (truck HOẶC trailer, hoặc không). PAID = đã thanh toán, chỉ ghi nhận vào P&L (KHÔNG tạo dòng ledger). UNPAID = chưa thanh toán, tạo dòng VENDOR payable trong Sổ cái (entity_type="VENDOR", tăng Credit/balance). Khi sau đó thanh toán, tạo dòng Debit giảm balance.',
  ARRAY['chi phí phát sinh PAID và UNPAID khác nhau thế nào', 'chi phí paid unpaid', 'chi phi phat sinh', 'trang thai chi phi'],
  ARRAY['chi phi'],
  ARRAY['duong'],
  21
),
-- 22. Expense items (renewable)
(
  'Hạng mục chi phí định kỳ là gì?',
  'Hạng mục chi phí (Expense Item) có thuộc tính is_renewable (một lần vs định kỳ) và reminder_lead_days (mặc định 30). Hạng mục định kỳ — bảo hiểm, đăng kiểm, phí đường bộ — thúc đẩy nhắc nhở gia hạn qua trường valid_to của chi phí. Hệ thống KHÔNG hardcode loại chi phí thành enum — kế toán tự cấu hình hạng mục theo nhu cầu. _Tránh_ hardcoding.',
  ARRAY['hạng mục chi phí định kỳ là gì', 'expense item', 'hang muc chi phi', 'chi phi dinh ky'],
  ARRAY['hang muc', 'chi phi'],
  ARRAY['duong'],
  22
),

-- ═══════════════════════════ DOANH THU / LỢI NHUẬN ══════════════════════════
-- 23. Revenue auto-population
(
  'Doanh thu chuyến được tính thế nào?',
  'Doanh thu (Revenue) auto-populate lúc tạo chuyến từ bảng giá (Pricing Table: Khách hàng × Tuyến). Kế toán có thể ghi đè với audit trail (giá gốc, giá ghi đè, ai sửa, khi nào). Hiện dùng cước cố định (fixed rates); giá biến theo nhu cầu có thể xem xét sau. Doanh thu ghi nhận vào Sổ cái khi chuyến hoàn thành, tạo dòng TRIP_REVENUE vào nợ phải thu của khách hàng.',
  ARRAY['doanh thu chuyến được tính thế nào', 'doanh thu tính sao', 'tinh doanh thu', 'revenue'],
  ARRAY['doanh thu'],
  ARRAY['chi phi'],
  23
),
-- 24. Gross vs net profit
(
  'Lợi nhuận gộp khác lợi nhuận ròng thế nào?',
  'Lợi nhuận gộp (Gross Profit) tính cho TỪNG xe đầu kéo hàng tháng = Doanh thu − Tổng chi phí của xe đó (chi phí chuyến + chi phí bảo dưỡng gán cho xe đó). Chi phí gán cho rơ-mooc hoặc chưa gán KHÔNG tính vào gộp. Lợi nhuận ròng (Net Profit) = Tổng lợi nhuận gộp tất cả xe − Phí quản lý − chi phí vận hành cấp công ty (rơ-mooc + chưa gán) + Thu nhập khác.',
  ARRAY['lợi nhuận gộp khác lợi nhuận ròng thế nào', 'khác nhau lợi nhuận gộp ròng', 'loi nhuan gop loi nhuan rong', 'gop rong'],
  ARRAY['loi nhuan'],
  ARRAY[]::text[],
  24
),
-- 25. Total cost composition
(
  'Tổng chi phí mỗi chuyến gồm những gì?',
  'Tổng chi phí mỗi chuyến = Chi phí nhiên liệu (số lít × đơn giá cấu hình, hoặc × giá thực tế khi có) + Tiền đi đường + Lương sản lượng tài xế. TIỀN PHẠT KHÔNG bao gồm — phạt là khoản trừ lương tài xế, không phải chi phí công ty. Ở cấp P&L tháng, Tổng chi phí CŨNG bao gồm chi phí vận hành/bảo dưỡng mỗi xe (sửa chữa, phụ tùng, bảo hiểm, đăng kiểm, phí đường bộ); số liệu mỗi chuyến không đổi. Hai cấp không bao giờ tính kép.',
  ARRAY['tổng chi phí mỗi chuyến gồm những gì', 'thành phần chi phí chuyến', 'tong chi phi chuyen', 'chi phi bao gom'],
  ARRAY['chi phi'],
  ARRAY['loi nhuan'],
  25
),
-- 26. Management fee
(
  'Phí quản lý hàng tháng là bao nhiêu?',
  'Phí quản lý là khoản cố định hàng tháng cho toàn công ty, hiện là 24.000.000 VNĐ, kế toán nhập thủ công. Đây là chi phí chung được trừ khỏi Tổng lợi nhuận gộp khi tính Lợi nhuận ròng: Lợi nhuận ròng = Tổng lợi nhuận gộp − Phí quản lý − chi phí vận hành cấp công ty (rơ-mooc + chưa gán) + Thu nhập khác.',
  ARRAY['phí quản lý hàng tháng là bao nhiêu', 'phí quản lý', 'phi quan ly', 'phi quan ly hang thang'],
  ARRAY['phi', 'quan ly'],
  ARRAY['duong'],
  26
),
-- 27. Cap table / profit distribution
(
  'Phân chia lợi nhuận cho đối tác thế nào?',
  'Phân chia lợi nhuận dùng tiếp cận lai (Hybrid Approach). Đầu vào: hệ thống theo dõi lịch sử tỷ lệ sở hữu (CapTableHistory) — VD: Q1 50/50, Q2 40/40/20. Đầu ra: khi kế toán thực hiện phân chia (quý/năm), hệ thống tính tiền chia theo tỷ lệ lịch sử áp dụng và ĐÓNG BĂNG kết quả thành bản ghi phân phối bất biến (Distribution Snapshot). Báo cáo cuối năm chỉ SUM các bản ghi snapshot — không tính lại tỷ lệ.',
  ARRAY['phân chia lợi nhuận cho đối tác thế nào', 'cap table', 'phân chia lợi nhuận', 'phan chia loi nhuan', 'von gop'],
  ARRAY['phan chia'],
  ARRAY[]::text[],
  27
),

-- ═══════════════════════════ TÀI XẾ ═══════════════════════════════════════
-- 28. Driver salary structure
(
  'Lương tài xế tính thế nào?',
  'Lương tài xế = Lương cơ bản (cố định) + Lương sản lượng (Trip Income, nhập theo từng chuyến) − Tiền phạt (Kỷ luật). Lương sản lượng được tính cho tài xế được gán chuyến đó (1:1). Lương cơ bản và lương sản lượng cộng lại thành tổng lương tháng; tiền phạt trừ ra. Lương được ghi nhận đầy đủ как chi phí nhân công; tiền phạt KHÔNG trừ khỏi chi phí mà ghi nhận riêng là "Thu nhập khác" của công ty.',
  ARRAY['lương tài xế tính thế nào', 'lương lái xe', 'luong tai xe', 'luong lai xe', 'tinh luong tai xe'],
  ARRAY['luong', 'tai xe'],
  ARRAY[]::text[],
  28
),

-- ═══════════════════════════ GIAO NHẬN / FORWARDER ═════════════════════════
-- 29. Forwarder settlement flow
(
  'Luồng hoàn ứng giao nhận thế nào?',
  'Nhân viên giao nhận (Forwarder) nhập chi phí phát sinh riêng cho từng container của chuyến; chi phí cấp chuyến chưa gán dùng phạm vi "Chi phí chung". Chỉ chi phí trong phạm vi đã hoàn thành mới được nộp thanh toán (settlement). Chi phí do Forwarder sở hữu KHÔNG được duyệt từng dòng — được chấp nhận nguyên tử (atomic) khi Kế toán duyệt settlement. Kế toán có thể sửa một dòng hiện có với lý do tiếng Việt bắt buộc; tổng settlement được tính lại và số tiền sửa là chính thức. Từ chối settlement: chi phí trở thành eligible cho settlement mới.',
  ARRAY['luồng hoàn ứng giao nhận thế nào', 'forwarder settlement', 'hoan ung giao nhan', 'settlement giao nhan'],
  ARRAY['giao nhan'],
  ARRAY[]::text[],
  29
),

-- ═══════════════════════════ AUDIT ════════════════════════════════════════
-- 30. Audit log definition
(
  'Nhật ký hoạt động ghi lại điều gì?',
  'Trong nhật ký hoạt động (audit log), một "Sự kiện/Hành động" (Intention) được định nghĩa là MỘT lệnh gọi API mutation (POST, PUT, DELETE, PATCH). Ngay cả khi một lệnh sửa nhiều bảng (VD: chốt chuyến cập nhật bảng Trips VÀ chèn vào Ledger), nó được ghi là ĐÚNG MỘT sự kiện thống nhất. Điều này đảm bảo nhật ký phản ánh hành động kinh doanh thực tế của người dùng thay vì truy vấn DB thô ồn ào. Mọi thông điệp audit bằng TIẾNG VIỆT — không có tiếng Anh trong audit trail.',
  ARRAY['nhật ký hoạt động ghi lại điều gì', 'audit log ghi gì', 'nhat ky hoat dong', 'audit trail'],
  ARRAY['nhat ky'],
  ARRAY[]::text[],
  30
);
