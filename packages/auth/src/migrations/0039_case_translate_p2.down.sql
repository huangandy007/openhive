-- 0039_case_translate_p2（回滚）：先删列再删表，与 up 反向。
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS currency;
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS template_id;
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS attrs;
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS amount;
ALTER TABLE auth.case_event DROP COLUMN IF EXISTS occurred_end;
DROP TABLE IF EXISTS auth.case_card_template;
DROP TABLE IF EXISTS auth.case_event_participant;
DROP TABLE IF EXISTS auth.case_entity_alias;
