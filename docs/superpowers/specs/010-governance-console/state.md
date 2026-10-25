# 实施进度 · 治理后台

## 当前任务
T002 已交付。**下一项 T003**（管理员分权落码：`is_admin` + RBAC 权限矩阵），等用户 `next`。

## 已完成

- **T002** 两类管理员分权权限矩阵（FR-003）
  - 新增 `authorization.md`：八板块 × 四动作（`read`/`write`/`review`/`admin`）× 两类管理员，
    每一格标出处（FR-003 / US2–US6 / 009 `lifecycle.md` 触发者表 / 009 `authorization.md`）
  - 三条裁定：① **不硬互斥**（两张 RBAC 模板，取并集）；② `is_admin` 仍是**进门总开关**
    （沿 009 D0-4）；③ 表示法建议 `resource_type='governance'` + `resource_id`=八板块 id
  - 迁移代价如实记：新迁移 `0013_*` 改 `role_resource_resource_type_check`；core
    `RESOURCE_TYPES` 加值；asset-service 的镜像断言语义改为 `ASSET_TYPES ∪ {"governance"}`
  - 边界写清：页面门 ≠ 资产门（009 的 `review`/`admin` 仍要单独过）、T014 管管理员之间、
    T015 管民警 vs 管理员、004 R4 的「新会话才生效」
  - id 对账实得：`sections.ts` 8 条 ⇔ 主表 8 条，集合相同
  - **不写码**；T003 按本文件落码

- **T001** 治理后台全屏视图骨架 + 顶栏入口（FR-001）
  - 新增 `packages/app/src/governance/{sections,console,console-host}` 与三条测试
    （sections 7 / console 8 / host 4）
  - 顶栏「用户管理」⇒ `onOpenGovernance`；`layout-new` 用 host 包住 `WorkspaceEntry`
    （工作区不卸载、打开时 `inert` + `aria-hidden`、关闭后焦点回顶栏）
  - 三处目录清单同步扩 `governance`（`lint:openhive` / `openhive-module-dirs` / `design-token-refs`）
  - 变异 M1–M5 均实得红并还原（M5 附注：大写 typo 不入 token 扫描器字符集）
  - 门禁：`test:components` 1373 pass / 0 fail；`test:unit` 仅剩未触碰文件的既有失败；
    governance+topbar oxlint 0 warning / 0 error；`bun.lock` 无 diff
  - **缺口**：`typecheck` 仍红 136 条，全在未触碰的上游文件（环境 `effect` store 残缺已
    用 `--frozen-lockfile` 修复）；**真栈未跑**（009 的 `openai@6.39.1` 缺口）

## 📥 接收自 F3 的移交（2026-10-01）
003-multi-tenant-isolation 的 **T016（越权 BOLA / BFLA，P0）**整条落到本 feature 的 **T015**。
**别以为它已经在 F3 做完了**——F3 只交了 BOLA 那半边（跨身份拿不到对方的库 / 目录 / 会话），
**BFLA 那半边一格都没测**，理由是当时**没有可测对象**：管理员能力的三个端点不存在，
`isAdmin` 在 `packages/opencode/src/server/**` 里只被搬进请求上下文、**没有任何授权分支**。

落点（**都在本目录**，不是只在 003 的文档里——`LEARNINGS #002-04`）：
- `tasks.md`：Prerequisites 加了「接收自 F3」段；**新增 T015**；并行组与总数改为 15 条。
- `spec.md`：US2 新增验收场景 5；新增 **FR-013**（服务端 `is_admin` 授权，MUST NOT 只靠前端隐藏）
  与 **SC-005**（越权 100% 被拒 + **正向放行必须一起验**）。
  ⚠️ 这两条是**补写的**——原文只有 FR-001「仅管理员可见」，管的是**入口呈现**，
  不是**能力门禁**。任务得有 spec 撑着，否则就是又一次「欠账没有落点」。

⚠️ **与本 feature T014 的分工别搞混**：T014 = 管理员**之间**分权；T015 = 普通民警**对**管理员。
两条都绿才叫分权矩阵两个方向都闭合。

## 阻塞项
（无）

## 最后更新
2026-10-26（T001 / T002 交付）
