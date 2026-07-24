CREATE TABLE "route_distance_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin_cleaned" varchar(255) NOT NULL,
	"destination_cleaned" varchar(255) NOT NULL,
	"distance_km" numeric(10, 2) NOT NULL,
	"duration_seconds" integer,
	"polyline_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX idx_route_cache_uniq ON route_distance_cache (origin_cleaned, destination_cleaned);
