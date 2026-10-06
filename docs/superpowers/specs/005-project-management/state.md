# 实施进度 · 项目管理（工作空间轴）

## 当前任务
开工前裁定已定（U1 / U4 / U5，2026-10-06）——见下方「开工前裁定」块。T001（定位）可开工。

## 已完成
（无）

## 阻塞项
（无）

## 开工前裁定（2026-10-06，用户裁定 · 主检出会话执行）

来源：`docs/workspace/dev_tdd.005.md` 文末「未定项清单」。三条已裁定，并已同步到 plan.md / tasks.md / 两份 design 文档。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| U1 | 自动归档形态（spec 与 plan R4 自相矛盾） | **按 spec 收口**：先提醒 → owner 确认后归档。plan R4 原写「待决策」，与 spec 四处（AC4 / US5 注记 / FR-008 / Assumptions）打架，改的是 plan | plan.md R4 |
| U4 | `project` 表加列 vs 另起表 | **另起 openhive 自有 `project_ext` 表**（六字段）。建表钩子挂 fork 自有的 `packages/core/src/database/router.ts`（每用户库那一层）；上游 `project/sql.ts` 与 `database/migration/` **一字不动**（宪法行 57 处方原话「新增独立文件/表」）。**代价**：项目列表查询多一次 LEFT JOIN ＋ `project` 行与 `project_ext` 行须同步创建 ⇒ 收成一个写入模块 | plan.md / tasks.md T003 / 两份 design |
| U5 | `project_member` 判定走哪条线 | **自成一条线，不接 `core/access` capability**（004 裁定 ④：契约零消费者，留给 F6/F7）。存储落业务 PG（auth 包迁移体系）、判定写 core 纯函数、接线在 `packages/opencode/src/server/openhive/` 执行层 | plan.md / tasks.md T004 |

**尚未裁定**：

- **共享项目的 `archived` 语义**（每成员各存一份 vs 全局共见）——留待 **T001 定位**时钉；若为后者，六字段可能要拆开落（个人态进每用户库、共享态跟 `project_member` 进 PG）。见 `2026-09-11-项目管理-design.md` §9 的落点修正注。
- **U2 / U3 / U6 / U7 / U8** 未裁（案件实体无 task / 超期提醒触发者 / FR-012 并发靠 git / T004 半条判据 / deploy-todo 接收方）——按 `dev_tdd.005.md` 的节奏在对应 task 开工前裁定。

**门禁基线**：**未测**。按 `dev_tdd.005.md` Step 4：开工时自己跑一次 `bun run lint:openhive`，把当时的 warnings / errors / 文件数落进本文件再引用——**不要抄 001 的数**（`LEARNINGS #001-02` / `#002-06`）。

## 跨 feature 备注（2026-10-06，本次实测发现 · 未处理）

`006-ai-session` / `007-fund-analysis` / `009-ai-assets` / `010-governance-console` 四份 plan/spec 里写有「**capability 三层拦截已由 F4 落地**」「复用 F4 权限」之类表述。这与 004 自己的交班对不上：004 明说 `AccessCapability` / `AccessIssue` **契约零生产调用点、留给 F6/F7**；本次实测复核为真（`grep` 命中全部落在 `packages/core/src/access/` 定义处与 `packages/core/test/`，`src` 下 access 目录之外**零调用点**）。

**用户裁定（2026-10-06）：本次不动那四份文档，只在此记一笔。** 理由：它们是各自 feature 的开工依据，应由那些 feature 开工时像本部 U5 一样**自己实测**再钉（这正是 U5 被抓出来的方式）。**005 不受影响**——U5 已裁定 `project_member` 不接 capability。

## 最后更新
2026-10-06（U1 / U4 / U5 开工前裁定落文档）
