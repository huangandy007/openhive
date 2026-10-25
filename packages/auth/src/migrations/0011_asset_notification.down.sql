-- 0011_asset_notification 的回滚：删掉站内信通知表。
--
-- ⚠️ 会丢掉全部资产通知历史。通知是派生信息，不是审计记录：
--    真正的「谁在什么时候把资产改成了什么」应由 010 的审计日志承载。
--    资产元数据与 `/assets` 下的文件都不受本脚本影响。

DROP TABLE auth.asset_notification;
