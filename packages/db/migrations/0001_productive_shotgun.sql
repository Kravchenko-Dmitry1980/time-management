CREATE INDEX "project_members_role_idx" ON "project_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "project_members_project_user_status_idx" ON "project_members" USING btree ("project_id","user_id","status");--> statement-breakpoint
CREATE INDEX "space_members_role_idx" ON "space_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "space_members_space_user_status_idx" ON "space_members" USING btree ("space_id","user_id","status");--> statement-breakpoint
CREATE INDEX "spaces_type_idx" ON "spaces" USING btree ("type");--> statement-breakpoint
CREATE INDEX "workspace_members_role_idx" ON "workspace_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_user_status_idx" ON "workspace_members" USING btree ("workspace_id","user_id","status");