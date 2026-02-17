CREATE TABLE `integration_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`context` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`channel_id` text,
	`message_ts` text,
	`thread_ts` text,
	`answer` text,
	`answered_by` text,
	`answered_by_name` text,
	`answered_at` integer,
	`answer_source` text,
	`options` text,
	`selected_option` text,
	`insight_id` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`meta` text DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX `idx_slack_questions_status` ON `slack_questions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_slack_questions_channel_msg` ON `slack_questions` (`channel_id`,`message_ts`);