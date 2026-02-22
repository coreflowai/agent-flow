CREATE TABLE `sandbox_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`agent_flow_session_id` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`config` text DEFAULT '{}',
	`label` text,
	`snapshot_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`metadata` text DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX `idx_sandbox_afs` ON `sandbox_sessions` (`agent_flow_session_id`);