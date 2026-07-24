ALTER TABLE "road_config" ADD COLUMN "default_driver_salary" numeric(15, 0) DEFAULT '400000';--> statement-breakpoint
ALTER TABLE "road_config" ADD COLUMN "two_point_delivery_bonus" numeric(15, 0) DEFAULT '200000';--> statement-breakpoint
ALTER TABLE "road_config" ADD COLUMN "vehicle_shift_default" numeric(15, 0) DEFAULT '200000';--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "two_point_delivery_bonus" numeric(15, 0) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "vehicle_shift_allowance" numeric(15, 0) DEFAULT '0';