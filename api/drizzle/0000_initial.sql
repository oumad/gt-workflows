CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"server_id" text,
	"server_name" text,
	"server_url" text,
	"downtime_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"owner" text,
	"location" text,
	"servers" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"notes" text,
	"reminder_sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_servers" (
	"credential_id" uuid NOT NULL,
	"server_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_servers_credential_id_server_id_pk" PRIMARY KEY("credential_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"username" text NOT NULL,
	"password_enc" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gt_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "gt_users_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "personal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"color" text,
	"description" text,
	"type" text DEFAULT 'workflow' NOT NULL,
	"gpu" text,
	"last_ping_at" timestamp with time zone,
	"last_ping_ok" boolean,
	"last_ping_ms" integer,
	"last_comfy_at" timestamp with time zone,
	"last_comfy_ok" boolean,
	"is_monitored" boolean DEFAULT true NOT NULL,
	"is_maintenance" boolean DEFAULT false NOT NULL,
	"max_concurrent" integer,
	"down_since" timestamp with time zone,
	"last_alert_at" timestamp with time zone,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "seto_config" (
	"id" text PRIMARY KEY NOT NULL,
	"max_user_jobs" integer DEFAULT 3 NOT NULL,
	"max_service_jobs" integer DEFAULT 3 NOT NULL,
	"max_server_jobs" integer DEFAULT 3 NOT NULL,
	"max_wait_time_sec" integer DEFAULT 600 NOT NULL,
	"max_linked_wf" integer DEFAULT 3 NOT NULL,
	"max_server_latency_ms" integer DEFAULT 100 NOT NULL,
	"max_server_services" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" text NOT NULL,
	"output_name" text NOT NULL,
	"base_model" text NOT NULL,
	"trigger_word" text,
	"lora_type" text,
	"total_steps" integer,
	"learning_rate" text,
	"network_dim" integer,
	"network_alpha" text,
	"save_every_n_steps" integer,
	"dataset_name" text,
	"image_count" integer,
	"output_options" text,
	"server_id" text,
	"server_url" text,
	"remote_job_name" text,
	"session_id" text,
	"client_id" uuid,
	"client_external_id" text NOT NULL,
	"project_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer GENERATED ALWAYS AS (CASE
            WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - started_at))::INTEGER * 1000
            ELSE NULL
          END) STORED,
	"failed_reason" text,
	"parameters" jsonb,
	CONSTRAINT "training_jobs_process_id_unique" UNIQUE("process_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"roles" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text,
	"workflow_name" text NOT NULL,
	"server_id" text,
	"server_url" text NOT NULL,
	"client_id" uuid,
	"status" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer GENERATED ALWAYS AS (CASE
            WHEN processed_at IS NOT NULL AND finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - processed_at))::INTEGER * 1000
            ELSE NULL
          END) STORED,
	"failed_reason" text,
	"data" jsonb,
	"comfy_started_at" timestamp with time zone,
	"cm_audit_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wait_ms" bigint GENERATED ALWAYS AS (CASE WHEN processed_at IS NOT NULL AND processed_at >= created_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (processed_at - created_at))::BIGINT * 1000)
          ELSE NULL END) STORED,
	"comfy_queue_ms" bigint GENERATED ALWAYS AS (CASE WHEN comfy_started_at IS NOT NULL AND processed_at IS NOT NULL
               AND comfy_started_at >= processed_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (comfy_started_at - processed_at))::BIGINT * 1000)
          ELSE NULL END) STORED,
	"comfy_run_ms" bigint GENERATED ALWAYS AS (CASE WHEN finished_at IS NOT NULL AND comfy_started_at IS NOT NULL
               AND finished_at >= comfy_started_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (finished_at - comfy_started_at))::BIGINT * 1000)
          ELSE NULL END) STORED
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"server_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_servers" ADD CONSTRAINT "credential_servers_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_servers" ADD CONSTRAINT "credential_servers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_tokens" ADD CONSTRAINT "personal_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_jobs" ADD CONSTRAINT "training_jobs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_jobs" ADD CONSTRAINT "training_jobs_client_id_gt_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."gt_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_client_id_gt_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."gt_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_created_at_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alerts_server_id_idx" ON "alerts" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "calendar_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "calendar_events_category_idx" ON "calendar_events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "credential_servers_server_idx" ON "credential_servers" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "credentials_name_idx" ON "credentials" USING btree ("name");--> statement-breakpoint
CREATE INDEX "gt_users_email_idx" ON "gt_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "gt_users_external_id_idx" ON "gt_users" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "personal_tokens_user_id_idx" ON "personal_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_tokens_prefix_idx" ON "personal_tokens" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_tokens_hash_idx" ON "personal_tokens" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "servers_is_monitored_idx" ON "servers" USING btree ("is_monitored");--> statement-breakpoint
CREATE INDEX "training_jobs_client_id_idx" ON "training_jobs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "training_jobs_client_external_id_idx" ON "training_jobs" USING btree ("client_external_id");--> statement-breakpoint
CREATE INDEX "training_jobs_status_idx" ON "training_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "training_jobs_base_model_idx" ON "training_jobs" USING btree ("base_model");--> statement-breakpoint
CREATE INDEX "training_jobs_cursor_idx" ON "training_jobs" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "workflow_jobs_workflow_id_idx" ON "workflow_jobs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_server_id_idx" ON "workflow_jobs" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_client_id_idx" ON "workflow_jobs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_status_idx" ON "workflow_jobs" USING btree ("status");