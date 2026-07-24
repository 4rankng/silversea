UPDATE "faq_entries"
SET
  "answer" = replace("answer", 'TingTing', 'TransTing'),
  "updated_at" = now()
WHERE "answer" LIKE '%TingTing%';
