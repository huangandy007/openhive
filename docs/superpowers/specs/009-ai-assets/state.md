# 实施进度 · AI 资产（Skill / MCP / 知识库）

## 当前任务
T005 待开工（Phase 3 三条前端任务 T005 ∥ T006 ∥ T007，依赖 T003）。开工前**先裁定 D0-6**
（006 `capabilities.ts` 字段扩充、异步供数、右栏投影的 `projectionModule`）——它阻塞 T005，
不阻塞已完成的后端任务。

## 已完成
- **T004** RBAC 授权 + 三级空间 + 授权组（FR-006 / FR-007）
  - 迁移 `0010_role_type.sql`（＋配对的 `.down.sql`）：`auth.role.role_type`
    （闭集 `normal` / `group`，默认 `normal`，CHECK 名 `role_type_check`），带中文 `COMMENT`
  - 模型 `auth/rbac.ts`：`role.roleType` + `ROLE_TYPES`；`grantsFor()` **未改**（它不读这一列）
  - 判定 `asset-service/authorization.ts`：`effectivePermissions()` / `canReadAsset()`；
    三级空间只授读、四类权限各自只蕴含读（`admin` 不蕴含 `review`，两道关靠它）；
    非共享状态对非作者 / 非被授权者不可见
  - 授权组写入路径：`createAuthorizationGroup` / `addGroupMember` / `grantAssetToGroup`
    （组必须是 `group`；`resource_type` 由资产类型决定；资产必须存在；未知 perm 碰库前拒绝）
  - 26 个新用例（asset-service）＋ 4 个 role_type 用例（auth）＋ 真 PG 8 条断言；
    四轮变异验证均恰红；详见 `authorization.md` §4
  - 已知残差：`listAssets` 尚未接收 viewer（可见性过滤在 T005 投影 / T017 接）；
    撤销授权 / 移出组 / 删组的 API 未做（T010 治理后台再补）；部门仍自由文本

- **T003** 资产服务（metadata + storage：复制 / 删除 / rename）（FR-001）
  - 迁移 `0009_asset.sql`（＋配对的 `.down.sql`）：`auth.asset` 22 列，每表每列中文 `COMMENT`；
    闭集 CHECK 与 `metadata.ts` 常量由用例双向比对；`owner_id` 外键不级联
  - 仓储 `asset.ts`：`insertAsset` / `assetById` / `listAssets`（类型 / 状态 / 分类 / 可见范围 /
    搜索，`updated_at desc, id asc`）/ `deleteAsset`（`returning` 判命中）
  - 存储原语 `storage.ts`：`assertWithinRoot`、暂存 → 提交（旧版备份 / 回滚）、
    `copyDirectory`、`moveDirectory`（同卷 rename，`EXDEV` 退化复制）、`removeDirectory`（根内 + 幂等）
  - 服务编排 `service.ts`：`assetLocation`（7 状态 → 目录）、`storeAsset`（校验 → 复制 → 写库 →
    失败补偿）、`discardAsset`（先删元数据 → 再删文件；个人资产不碰共享根）
  - 62 个用例（asset-service）＋ 真 PG 迁移 2 条；三轮变异验证均恰红；详见 `storage.md` §7
  - 已知残差：跨存储无事务（复制成功、写库前崩溃 ⇒ 孤儿目录，T005 后接对账）；
    删元数据成功但删文件失败会抛错，重试返回 `false`（孤儿目录需人工/对账清理）
  - 遗留子任务：`tasks.md` T003 描述里的「rename」已由 `moveDirectory` 覆盖；
    `storeAsset` 的 `targetDirectory` 由调用方按 `assetLocation` 算，T008 接线时复核

- **T002** `/assets` 物理存放约定 + 部署方案（D0-2）
  - 新变量 `OPENHIVE_ASSETS_ROOT`，生产默认 `/assets`；开发机显式 `D:/openhive-stack-state/assets`
  - helper：`assetsRoot` / `assetDirectory` / `pendingDirectory` / `publishDirectory` / `archiveDirectory` / `ensureDir` / `assertSafeSegment`
  - 布局覆盖 pending / global / dept / archive，三类资产目录 `skills` / `mcp` / `knowledge-base`；个人资产不进共享卷
  - 约定同卷临时目录 → rename → 删旧；跨卷 `EXDEV` 退化复制；迭代先备份旧版再替换（T003 实现）
  - 文档：`docs/superpowers/specs/009-ai-assets/storage.md`；`.env.example`、`CONFIG.md`、`plan.md` 已同步
  - 28 个用例通过；两轮变异验证（错误默认根、整体拆掉路径校验）均恰红

- **T001** 统一元数据 + 7 状态机定义（`packages/asset-service`）
  - 元数据 15 项 + `category`；7 状态 = draft / in_review / pending_tech / published / iterating / offline / archived
  - 转移表覆盖提交、业务审核、技术发布、迭代、下线、重新上线、归档；驳回是 `in_review → draft` 且必须带理由
  - 业务分类 seed 9 条（D0-15，待业务管理员审阅）
  - 23 个用例通过（含「7 个状态都从草稿正向可达」）；两轮变异验证均按预期变红

## 阻塞项
- **D0-15（内容）**：分类 seed 是可审阅初稿，正式词条仍需业务管理员确认。
- **D0-6**：006 `capabilities.ts` 的字段扩充与「资产服务 → 右栏清单」供数方式未定，**T005 前**需裁定
  （T003 只提供 `listAssets` 作投影数据源，未提供 `GET /assets/capabilities`、未扩 `SkillCapability`、
  未改 `projectionModule`）。
- **部门 id 化**：发布目录当前用部门名；部门表与稳定 id 待 010，届时迁移 `/assets/dept/*`。

## 最后更新
2026-10-25（T004 完成）
