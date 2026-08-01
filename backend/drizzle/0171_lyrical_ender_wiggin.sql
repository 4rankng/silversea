CREATE UNIQUE INDEX "trip_pod_submissions_trip_id_id_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id","id");--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_trip_supersedes_fk" FOREIGN KEY ("trip_id","supersedes_submission_id") REFERENCES "public"."trip_pod_submissions"("trip_id","id") ON DELETE no action ON UPDATE no action;
