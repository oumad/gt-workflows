ALTER TABLE "workflows" ADD COLUMN "uuid" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_uuid_unique" UNIQUE("uuid");