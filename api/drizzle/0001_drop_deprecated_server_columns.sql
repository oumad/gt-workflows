DROP INDEX "servers_is_monitored_idx";--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN "last_comfy_at";--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN "last_comfy_ok";--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN "is_monitored";