CREATE TABLE `aegis_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`user_email` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`area` text NOT NULL,
	`why` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`progress_count` integer DEFAULT 0 NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_label` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aegis_actions_owner_plan_idx` ON `aegis_actions` (`user_email`,`plan_id`);--> statement-breakpoint
CREATE TABLE `aegis_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`undone_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aegis_audit_owner_created_idx` ON `aegis_audit_events` (`user_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `aegis_audit_entity_idx` ON `aegis_audit_events` (`user_email`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `aegis_daily_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`plan_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aegis_daily_plans_user_day_unique` ON `aegis_daily_plans` (`user_email`,`plan_date`);--> statement-breakpoint
CREATE INDEX `aegis_daily_plans_owner_idx` ON `aegis_daily_plans` (`user_email`);--> statement-breakpoint
CREATE TABLE `aegis_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`heart_json` text DEFAULT '[]' NOT NULL,
	`compass_json` text DEFAULT '[]' NOT NULL,
	`areas_json` text DEFAULT '[]' NOT NULL,
	`people_json` text DEFAULT '[]' NOT NULL,
	`roles_json` text DEFAULT '[]' NOT NULL,
	`activities_json` text DEFAULT '[]' NOT NULL,
	`current_pressure` text DEFAULT '' NOT NULL,
	`seven_day_commitments` text DEFAULT '' NOT NULL,
	`fear_of_forgetting` text DEFAULT '' NOT NULL,
	`permissions_json` text DEFAULT '{}' NOT NULL,
	`onboarding_step` integer DEFAULT 0 NOT NULL,
	`onboarding_completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aegis_profiles_user_email_unique` ON `aegis_profiles` (`user_email`);