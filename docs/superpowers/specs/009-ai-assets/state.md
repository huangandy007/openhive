# 实施进度 · AI 资产（Skill / MCP / 知识库）

## 当前任务
T006 已交付（中栏卡片网格 + 全局搜索），等待用户审阅。下一任务 T007（资产详情抽屉，依赖 T006）。

## 已完成
- **T006** 中栏卡片网格（虚拟滚动）+ 全局搜索（FR-003 / DESIGN §4.9）
  - `ai-assets/grid-model.ts`：`AssetQuery` 三组筛选 ∧ 搜索的**纯函数**交集；搜索口径
    名称 / 描述 / 标签，子串 + 忽略大小写 + 去首尾空格；`网格列数`（240px 最小卡宽 + 12px
    列距，至少 1 列）；常量 `卡片高 132` / `卡片行距 12`（8 用例）
  - `ai-assets/asset-search.tsx`：36px 高、`aria-label="搜索资产"`、清除按钮
    `aria-label="清除搜索"`（点后焦点留在输入框）；受控，值由中栏持有（3 用例）
  - `ai-assets/asset-card.tsx`：**精简四件**——六边形图标（`clip-path`，图标集无 hexagon，
    按类型取 `brain` / `mcp` / `folder`）、单行名称、两行描述、空间/状态徽章（文案取字典）；
    静态条目（`role="listitem"`，无按钮语义 / 无 tabindex，点击留 T007）
  - `ai-assets/asset-grid.tsx`：**按行虚拟滚动**（`@tanstack/solid-virtual`，行高 144、
    overscan 2，单一滚动容器 `#006-30`）；列数按容器宽实时算（`ResizeObserver`）；
    行容器 `role="presentation"`，`listitem` 直挂 `role="list"`；空态「没有符合条件的资产」
  - `ai-assets/asset-center.tsx`：搜索词落在这层（不属于左栏筛选、也不进接入缝），
    `filter` 与左栏共享同一份
  - `workspace-entry.tsx`：中栏占位换成 `AssetCenter`；新增注入缝
    `assets?: () => readonly AssetMetadata[]`（省略 = 空态，**不造假数据**）
  - DESIGN.md 新增 §4.9「AI 资产 · 中栏卡片网格与全局搜索」
  - 门禁实测：`test:components` 1341 pass / 0 fail（T005 后 +17：组件 12 + 集成 5）；
    `test:unit` 1186 pass / 27 fail / 19 errors（+8 = 新增 `grid-model` 用例，红集与 T005
    记录的旧红相同：`jsxDEV` 与 T020 上传下载）；`tsgo -b --force` 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）；`bun.lock` 无 diff
  - 变异验证：拆搜索谓词 ⇒ 红 4（纯逻辑 1 + 组件 2 + 集成 1）；拆类型筛选 ⇒ 红 5（3 + 1 + 1）；
    拆虚拟化（`overscan: 9999`）⇒ 红 2；拆 `assets` 注入接线 ⇒ 集成红 4；均拆完即还原

- **T005** 左栏纯导航（空间筛选 + 三 Tab + 业务分类折叠）+ 模块级页面接线（FR-002 / D0-3 / D0-6）
  - `ai-assets/filter.ts`：空间多选（默认全选）、类型 Tab（默认 Skill）、分类单开手风琴；
    分类行来自 `asset-service/categories` 的 seed，按 `order` 排序，前端不硬编码（5 用例）
  - `ai-assets/asset-nav.tsx`：`role="group"` 空间筛选、`role="tablist"` 类型 Tab、分类按钮
    `aria-expanded` + chevron-right/down；**永不渲染资产行**（7 用例）
  - `workspace/workspace-view.ts`：「模块 → 视图」纯函数，`ai-assets` 走模块级页面（3 用例）
  - `workspace-entry.tsx`：左栏内容按视图分派（项目侧栏 / `AssetNav`），中栏在 AI 资产下换成
    占位 `[data-slot="asset-center"]`（文件 tab 状态保留、仅不渲染）；「项目管理」图标在 AI 资产下
    不亮（`projectOpen` 仍代表项目左栏）
  - `ai-session/projection-module.tsx` + `ai-session-slot.tsx`：右栏投影改读 **最近一个业务模块**
    （进入 AI 资产不换投影，离开后继续跟随）；无 Provider 时退回当前模块，与改动前逐字相同
    （4 用例）
  - DESIGN.md 新增 §4.8「AI 资产 · 左栏纯导航」；D0-14 三处目录清单同步加 `ai-assets`
  - 门禁实测：`test:components` 1324 pass / 0 fail；`test:unit` 1178 pass / 27 fail / 19 errors，
    **与 HEAD 基线逐条相同**（1170 pass / 27 fail / 19 errors，均 `jsxDEV` 与 T020 上传下载旧红）；
    `typecheck` 136 errors，**与 HEAD 基线错误集合逐一相同**（`diff` 为空），T005 文件 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）
  - 变异验证：拆掉 AI 资产左栏分支 ⇒ 集成用例红 2 条（左栏换导航、三组齐备）；
    去掉投影「`ai-assets` 不覆盖记忆」守卫 ⇒ 红 2 条（`projection-module` 停在业务模块、
    集成投影探针），拆完即还原

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
- **D0-6（已裁定，投影部分已落地）**：006 `capabilities.ts` 字段扩充与「资产服务 → 右栏清单」
  供数方式仍未定——T005 只按裁定做了**投影模块记忆**的最小修复；`listAssets` 作投影数据源、
  `GET /assets/capabilities`、`SkillCapability` 扩充留待 T007 / T017。
- **资产列表数据源（T006 已留缝、未接真源）**：中栏网格吃
  `WorkspaceEntry.assets?: () => readonly AssetMetadata[]`，省略即空态。`/assets` 的列表 HTTP
  接口尚未落，`pages/layout-new.tsx` 也还没注入 ⇒ **真栈上资产页今天只有空态**；
  接线在 T008 / T017 与后端列表接口一并做。`AssetGrid` 的列数 / 行高按真容器量，接口接上后无需改。
- **部门 id 化**：发布目录当前用部门名；部门表与稳定 id 待 010，届时迁移 `/assets/dept/*`。

## 最后更新
2026-10-25（T006 完成）
