-- Port-facet visibility belongs to zone configuration. Preserve the previous
-- rendered-label policy once as data; subsequent renames leave the flag intact.
ALTER TABLE "dispatch_zones" ADD COLUMN "show_port_facet" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "dispatch_zones"
SET "show_port_facet" = false
WHERE normalize("label", NFC) IN ('Lạch Huyện', 'Cảng Lạch Huyện', 'Hải Phòng', 'Cảng Hải Phòng');
