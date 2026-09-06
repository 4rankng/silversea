DROP TABLE "route_polylines" CASCADE;--> statement-breakpoint
DROP TABLE "trip_gps_capture_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "trip_gps_tracks" CASCADE;--> statement-breakpoint
DROP TABLE "vehicle_last_positions" CASCADE;--> statement-breakpoint
DELETE FROM app_settings WHERE setting_key LIKE 'gps.bach_khoa_%' OR setting_key = 'app.gps_enabled';
