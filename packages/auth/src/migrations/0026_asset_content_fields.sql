-- 0026_asset_content_fields：资产内容两列（2026-10-31）。
--
-- `summary`（功能描述）专供左栏技能卡片的悬停浮层：一句话，中文，200 字以内。
-- `precautions`（注意事项）存资产专属注意事项；产品级「AI 结论需人工复核」那条不在这里，
-- 它是界面硬编码的（FR-003），不随资产改变。
--
-- 两列都 NOT NULL DEFAULT ''：空串与「没填」在这两列上语义相同，多一种 null 态只会让
-- 前端多一个分支，没有收益。
--
-- 回填：把现有「介绍」整段复制进「功能描述」。现网 9 条资产的介绍本来就是一句话中文
-- （26–60 字），搬过去之后上线当天悬停即为中文，不必人工补录。作者之后再把介绍写长。

ALTER TABLE auth.asset ADD COLUMN summary text NOT NULL DEFAULT '';

--> statement-breakpoint

ALTER TABLE auth.asset ADD COLUMN precautions text NOT NULL DEFAULT '';

--> statement-breakpoint

UPDATE auth.asset SET summary = description WHERE summary = '';
