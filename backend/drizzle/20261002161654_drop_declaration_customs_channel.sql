-- Card 20261002_262 (user ruling 2026-10-02): the customs channel
-- (luồng đỏ/vàng/xanh) was scope added beyond the requirement — the feature
-- is only multiple tờ khai per lot. The column is text-backed
-- (applicationEnum house pattern), so there is no pg TYPE to drop.
ALTER TABLE "shipment_declarations" DROP COLUMN "channel";
