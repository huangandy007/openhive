-- 0039_case_translate_p2（回滚）：先删列再删表，与 up 反向。
-- 每条语句之间用分隔符（README §2）：运行器逐条执行，多语句一次性下发在各驱动上不可移植。
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS currency;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS template_id;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS attrs;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS amount;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS occurred_end;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_card_template;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_event_participant;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_entity_alias;
