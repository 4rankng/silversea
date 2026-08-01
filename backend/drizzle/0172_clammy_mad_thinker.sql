ALTER TABLE "shipment_containers" ADD COLUMN "shipping_line_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "pickup_port_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "dropoff_port_id" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "route_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_pickup_port_id_ports_id_fk" FOREIGN KEY ("pickup_port_id") REFERENCES "public"."ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_dropoff_port_id_ports_id_fk" FOREIGN KEY ("dropoff_port_id") REFERENCES "public"."ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_containers_pickup_port_idx" ON "shipment_containers" USING btree ("pickup_port_id");--> statement-breakpoint
CREATE INDEX "shipment_containers_dropoff_port_idx" ON "shipment_containers" USING btree ("dropoff_port_id");--> statement-breakpoint
CREATE INDEX "shipments_route_idx" ON "shipments" USING btree ("route_id");