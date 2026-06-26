CREATE TYPE "public"."auth_audit_event_type" AS ENUM('login_success', 'login_failed', 'logout', 'session_validated', 'session_revoked');--> statement-breakpoint
CREATE TABLE "auth_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email_normalized" text,
	"event_type" "auth_audit_event_type" NOT NULL,
	"success" boolean NOT NULL,
	"reason" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_not_empty_check" CHECK (length(trim("auth_sessions"."token_hash")) > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "auth_audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_audit_events_user_id_idx" ON "auth_audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_audit_events_email_normalized_idx" ON "auth_audit_events" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "auth_audit_events_event_type_idx" ON "auth_audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "auth_audit_events_created_at_idx" ON "auth_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_audit_events_retention_until_idx" ON "auth_audit_events" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique_idx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions" USING btree ("user_id","revoked_at","expires_at");