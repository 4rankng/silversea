-- 0106_faq_operational_expansion.sql
-- FAQ fast-lane content expansion based on production question analysis.
--
-- DIAGNOSIS (2026-07-13): 0/41 production turns hit the FAQ fast lane. Root
-- cause is NOT threshold tuning (0.40 floor / 0.12 margin are correct for
-- paraphrase matching) — it's CONTENT MISMATCH. Users ask operational DATA
-- questions ("how many trucks?", "company name?", "tire count?") while the 30
-- seeded FAQs cover domain RULES (penalties, fuel modes, ledger). These are
-- different intents: data questions need tools; rule questions need knowledge.
--
-- This migration adds knowledge-shaped FAQs for the most common question
-- patterns that ARE answerable without an LLM. Questions requiring live data
-- (fleet count, specific receivables, tire inventory) correctly stay on the
-- LLM+tool path — those are P1 intent-router territory, not FAQ gaps.
--
-- IMPORTANT: required_terms/forbidden_terms MUST be TONE-STRIPPED (see the
-- diacritic rule in 0104_faq_knowledge_base.sql). Embeddings are generated
-- by the backfill script or on next admin edit.

INSERT INTO faq_entries (question, answer, question_variants, required_terms, forbidden_terms, sort_order) VALUES

-- ═══════════════════════════ THÔNG TIN CÔNG TY ══════════════════════════════
-- Users repeatedly ask "Công ty tên là gì" — this is static knowledge.
(
  'Công ty tên là gì?',
  'Tên công ty được cấu hình trong trang Cấu hình hệ thống (Administrative → Cấu hình). Bạn có thể xem và sửa tên công ty, mã số thuế, địa chỉ ở đó. Để mở trang cấu hình, hãy hỏi "mở trang cấu hình" hoặc vào mục Cấu hình từ menu.',
  ARRAY['công ty tên là gì', 'tên công ty', 'ten cong ty la gi', 'cong ty ten gi', 'tên công ty là gì', 'company name'],
  ARRAY['cong ty', 'ten'],
  ARRAY[]::text[],
  100
),
(
  'Công ty có bao nhiêu nhân sự?',
  'Số lượng nhân sự (lái xe, giao nhận, kế toán) thay đổi theo thời gian. Để xem danh sách và thống kê nhân sự hiện tại, hãy mở trang Người dùng từ menu quản trị. Bạn có thể lọc theo vai trò (ADMIN, MANAGER, ACCOUNTANT, DRIVER, FORWARDER) để đếm từng nhóm.',
  ARRAY['công ty có bao nhiêu nhân sự', 'bao nhiêu nhân viên', 'bao nhiêu lái xe', 'bao nhiêu giao nhận', 'cty co bao nhieu nhan su', 'nhân sự công ty'],
  ARRAY['nhan su'],
  ARRAY[]::text[],
  101
),

-- ═══════════════════════════ CHỨNG TỪ / GIẤY BÁO NỢ ═════════════════════════
-- Users ask "dạy tôi cách tạo giấy báo nợ" repeatedly — guide them.
(
  'Làm thế nào để tạo giấy báo nợ?',
  'Để tạo giấy báo nợ (debit note), hãy mở trang Cấu hình → Mẫu giấy báo nợ. Hệ thống hỗ trợ nhiều mẫu (ví dụ: Mặc định và Vietsun). Bạn chọn mẫu, điền thông tin, rồi xuất. Nếu cần hướng dẫn từng bước, hãy hỏi "hướng dẫn tạo giấy báo nợ" để bot mở tour hướng dẫn.',
  ARRAY['cách tạo giấy báo nợ', 'làm thế nào để tạo giấy báo nợ', 'tạo giấy báo nợ', 'dạy tôi cách tạo giấy báo nợ', 'cach tao giay bao no', 'tao giay bao no'],
  ARRAY['giay bao no'],
  ARRAY[]::text[],
  102
),

-- ═══════════════════════════ CÔNG NỢ — ĐỊNH NGHĨA ═══════════════════════════
-- Users type just "Công nợ phải thu" — clarify what it means + where to see it.
(
  'Công nợ phải thu là gì và xem ở đâu?',
  'Công nợ phải thu (Receivables) là số tiền khách hàng còn nợ công ty. Để xem danh sách công nợ phải thu hiện tại, hãy mở trang Công nợ từ menu. Ở đó bạn thấy từng khách hàng, số dư nợ hiện tại, và có thể ghi nhận thanh toán. Số dư chạy (running balance) được tính từ Sổ cái — mỗi lần chốt chuyến, doanh thu chưa thu được tự động ghi vào công nợ.',
  ARRAY['công nợ phải thu', 'công nợ phải thu là gì', 'cong no phai thu', 'xem công nợ phải thu', 'nợ khách hàng'],
  ARRAY['cong no', 'phai thu'],
  ARRAY['tra'],
  103
),

-- ═══════════════════════════ HỖ TRỢ / TỔNG QUAN ═════════════════════════════
-- Users say "hi" / "hôm nay có gì quan trọng không" — the bot should help.
(
  'Bot có thể giúp gì?',
  'Tôi là trợ lý TingTing. Tôi có thể: (1) Trả lời câu hỏi về quy tắc nghiệp vụ (tiền phạt, nhiên liệu, sổ cái, công nợ); (2) Tra cứu dữ liệu trực tiếp (chuyến xe, khách hàng, công nợ, lợi nhuận); (3) Mở trang và điều hướng trong ứng dụng; (4) Hướng dẫn từng bước tạo chuyến, chốt chuyến, cấu hình dầu. Hãy hỏi tôi bằng tiếng Việt hoặc tiếng Anh!',
  ARRAY['bot có thể giúp gì', 'bạn có thể làm gì', 'hôm nay có gì quan trọng không', 'bot giup gi duoc', 'ban co the lam gi', 'chào bạn'],
  ARRAY[]::text[],
  ARRAY[]::text[],
  104
);

-- Backfill embeddings for the new entries. The admin UI does this on edit,
-- but for a migration we run the backfill script manually:
--   cd backend && pnpm tsx src/db/backfill-faq-embeddings.ts
-- Until backfilled, the new entries match via exact/rule stages only (no
-- semantic cosine). The fast lane fails open, so missing embeddings just mean
-- semantic paraphrases won't match — exact matches still work.
