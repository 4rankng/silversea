ALTER TABLE "tires"
  ALTER COLUMN "position" SET DATA TYPE varchar(64)
  USING CASE "position"::text
    WHEN 'FRONT_LEFT' THEN 'Trước trái'
    WHEN 'FRONT_RIGHT' THEN 'Trước phải'
    WHEN 'REAR_OUTER_LEFT' THEN 'Sau ngoài trái'
    WHEN 'REAR_OUTER_RIGHT' THEN 'Sau ngoài phải'
    WHEN 'REAR_INNER_LEFT' THEN 'Sau trong trái'
    WHEN 'REAR_INNER_RIGHT' THEN 'Sau trong phải'
    WHEN 'SPARE' THEN 'Lốp dự phòng'
    WHEN 'OTHER' THEN 'Khác'
    ELSE "position"::text
  END;--> statement-breakpoint
ALTER TABLE "tires" DROP COLUMN IF EXISTS "position_label";--> statement-breakpoint
DROP TYPE "public"."tire_position";
