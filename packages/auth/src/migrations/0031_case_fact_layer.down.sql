-- 反向：先删子（分区随父表一起走），再删父。
DROP TABLE IF EXISTS auth.case_ai_proposal;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_alert;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_ingest_job;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_fact_row;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_citation;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_event;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_relation;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_entity;
--> statement-breakpoint
DROP TABLE IF EXISTS auth.case_material;
