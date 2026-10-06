# Implementation Plan: 项目管理（工作空间轴）

**Branch**: `005-project-management` | **Date**: 2026-09-26 | **Spec**: `spec.md`

**Input**: Feature specification from `docs/superpowers/specs/005-project-management/spec.md`

## Summary

落地工作空间轴的项目管理：左栏项目锚点 + 项目列表（新建/切换）、文件树操作、共享项目成员管理（微信群模型）、文件↔MinIO 备份拖拽、项目归档/找回。项目是唯一隔离边界 + git 仓库（复用 opencode 原生 project + F3 沙箱），全部用「加」的方式落地。

## Technical Context

**Language/Version**: TypeScript（Bun monorepo）

**Primary Dependencies**: opencode 原生文件树（SolidJS）、MinIO（对象存储）、git（版本留痕）

**Storage**: project 表（opencode 原生，**一字不动**）＋ openhive 自有 `project_ext` 表（六个生命周期字段）、project_member 表（业务 PG）、MinIO（`/minio/{userId}/{projectId}/`）、沙箱文件（F3 已落地）

**Testing**: oxlint + turbo typecheck + bun test

**Target Platform**: 桌面浏览器 + MinIO 服务端（公安内网）

**Project Type**: web-app（opencode fork 前端 + 后端）

**Performance Goals**: 文件树操作流畅；归档/找回不阻塞其他操作

**Constraints**: 复用 opencode 原生、最小化合并冲突、项目是唯一隔离边界

**Scale/Scope**: 1600 用户（并发活跃 320~480）

## Constitution Check

*GATE: 逐条对照 constitution.md，违反 MUST 级原则 = CRITICAL 阻断。*

| 宪法原则 | 本 feature 的符合情况 | 结论 |
|---|---|---|
| I. 最小化上游合并冲突（NON-NEGOTIABLE） | 六个字段改走 openhive 自有 `project_ext` 表（U4 裁定，宪法行 57 的处方原话「新增独立文件/表」）⇒ **不碰上游 `project/sql.ts`、也不往上游 `database/migration/` 加文件**；文件树复用原生 + 补能力；MinIO 是「加」的能力 | ✅ 无冲突 |
| II. 品牌化走配置（NON-NEGOTIABLE） | 文件树换皮走视觉规范（配置/样式层），不硬编码品牌 | ✅ 无冲突 |
| III. 物理隔离优先 | 项目是 F3 沙箱内的隔离边界 + git 仓库，本 feature 在物理隔离之上组织，不破坏隔离 | ✅ 无冲突 |
| IV. 权限下沉执行层 | `project_member` 是工作空间轴权限，判定写 core 纯函数、接线在 `opencode/src/server/openhive/` 执行层网关（U5 裁定）；**不接 `core/access` capability**（004 裁定 ④：契约零消费者，留给 F6/F7）；文件操作权限靠 F3 沙箱锚定 | ✅ 无冲突 |
| V. 侵入是「加」不是「改」 | `project_ext` 表新增、`project_member` 表新增、MinIO 备份新增；上游 `project` 表与 `sql.ts` 一字不动 | ✅ 无冲突 |

**结论**: 无 MUST 级原则违规。

## 项目文件结构（要素①）

```text
packages/app/src/
├── project/
│   ├── project-anchor.tsx        # 项目锚点行（项目名 + 成员数 + ▾ + ＋）
│   ├── project-panel.tsx         # 项目面板（＋新建 + 最近/全部/已归档三 tab）
│   ├── member-panel.tsx          # 成员面板（👥 侧滑：邀请/移除/退群）
│   ├── file-tree.tsx             # 文件树外包层（底座取 v2 model；上游 components/file-tree.tsx 一字不动）
│   └── minio-dual-tree.tsx       # 文件 ↔ MinIO 上下双树拖拽

packages/opencode/src/
├── project/
│   ├── project-ext.ts            # openhive 自有 project_ext 表落点（type/project_type/shared_directory/last_accessed_at/archived/archived_at）
│   ├── member.ts                 # 成员判定接线层（判定纯函数在 core/project/membership.ts，表在业务 PG）
│   └── archive.ts                # 项目归档/找回（MinIO 上传/下载 + archived 状态流转）
└── minio/
    └── backup.ts                 # MinIO 客户端（文件级备份/拉回）

packages/core/src/
└── project/
    └── membership.ts             # 微信群模型判定（纯函数；U5 裁定不接 capability）

packages/auth/src/migrations/
└── 0005_project_member.sql       # project_member 表（业务 PG；U5 裁定）
```

**Structure Decision**: 前端 `app/project/` 承载左栏交互，后端 `opencode/project/` 承载数据模型与归档逻辑；六个生命周期字段落 openhive 自有 `project_ext` 表、`project_member` 落业务 PG 并新增，**上游 `project` 表一字不动**——全部「加」的方式。

## 前端换皮区（左栏项目 / 文件树 / MinIO 双树）

> 视觉真理来源：`../openhive-DESIGN.md` + opencode `theme.css`。本 feature 前后端混合，前端集中在左栏交互。

### ① opencode 原生组件 → openhive 改造

| opencode 组件 | openhive 改造 | 类型 |
|---|---|---|
| 原生文件树（SolidJS） | **包一层，不碰本体**：`components/file-tree.tsx` 一字不动，在 `app/src/project/` 新建；**底座取 v2**（`file-tree-v2-model.ts` 是纯函数、可单测） | 新增（外包 ＋ token） |
| opencode 无项目锚点 / 面板 | 项目锚点行 + 项目面板（新建 / 最近 / 全部 / 已归档） | 新增 |
| opencode 无成员面板 | 成员面板（👥 侧滑：邀请 / 移除 / 退群） | 新增 |
| opencode 无 MinIO 双树 | 文件 ↔ MinIO 上下双树拖拽（已备份标 ✓） | 新增 |

### ② 语义 token（左栏 / 文件树，DESIGN.md §1/§2/§3）

| 用途 | openhive 值 |
|---|---|
| 左栏底色 / 文件树 | 暖白 `#FCFCFC` 底、14px 小字（§2.2） |
| 选中态 | 浅金 `#FEF3C7`（≈ `#F59E0B` 低透明度） |
| 高亮 / 链接 | 蜂蜜金 `#D97706` |
| 项目图标 | 六边形轮廓包裹（§5.3） |
| 圆角 | 面板 / 卡片 12~16px，按钮 8~10px |

### ③ 视觉参考样本

- `../design-reference/figma-export/`
- front 组件：`LeftSidebar`（左栏文件树 / 项目列表 / MinIO 双树）

### ④ 换皮 vs 新增

| 类型 | 本 feature 具体 |
|---|---|
| 换皮 | 左栏样式（token） |
| 新增 | 文件树外包层（D0-2 裁定：上游组件一字不动，缺的六项能力〔工具栏 / 右键菜单 / 新建 / 重命名 / 删除 / 上传下载〕全部新增）、项目锚点 / 面板、成员面板、MinIO 双树拖拽 |

## 数据流向（要素②）

```mermaid
flowchart LR
    USER[民警操作] --> TREE[文件树]
    TREE -->|读写文件| WS["沙箱 /workspaces/{userId}/{project}/"]
    WS --> GIT[git 版本留痕]
    TREE -->|备份 / 拉回| MINIO["MinIO /minio/{userId}/{projectId}/"]
    WS -->|归档: 上传 + 删除| MINIO
    MINIO -->|找回: 下载| WS
```

- **工作空间轴**：项目是沙箱内的唯一隔离边界 + git 仓库，产物/文件在该目录内，git 留痕。
- **MinIO 备份**：文件级备份/拉回与项目级归档/找回两条链路，均落在 `/minio/{userId}/{projectId}/` 镜像沙箱路径。
- **数据轴不涉及**：本 feature 只碰工作空间轴（project/project_member），业务数据（资金/话单项目）在 F6/F7。

## 依赖清单（要素③）

| 依赖 | 用途 | 说明 |
|---|---|---|
| Bun（monorepo） | 构建 / 运行 | opencode 既有工程 |
| opencode 原生文件树（SolidJS） | 只读参考基座 | **D0-2 裁定（2026-10-06）**：`components/file-tree.tsx` **一字不动**；底座逻辑取 v2 的纯函数 model（`file-tree-v2-model.ts`，可单测），在 `app/src/project/` 包一层。原写「复用 + 换皮」，实测该组件缺工具栏/右键菜单/新建/重命名/删除/上传下载六项 ⇒ 实为新增 |
| **`@aws-sdk/client-s3`** | 对象存储 | 文件备份 / 归档。**D0-4 裁定（2026-10-06）**：复用既有 `@aws-sdk/credential-providers`（Bedrock 认证）的同一 SDK 家族，`bun.lock` 增量最小；MinIO 是 S3 兼容 ⇒ 直连。原写「MinIO SDK」指同一能力，具体包名以此为准 |
| git | 版本留痕 | 文件并发靠 git，不做实时协同 |

> 具体版本实现时对照 opencode 现有依赖锁定。

## 与现有系统集成点（要素④）

- **复用 F1 三栏**：图标栏「项目管理」入口呼出左栏（F1 已落地五入口）。
- **复用 F3 沙箱**：项目是 `/workspaces/{userId}/{project}/` 内的隔离边界 + git 仓库。
- **「当前项目」身份由服务端算（D0-1 裁定，2026-10-06）**：客户端只报 `projectId`（业务标识），建会话时服务端查 `project_ext` 拼出 `join(sandbox, dir)` 写进 `session.directory`。**`anchor-workspace.ts` 一字不动**——它今天钉死两段 `join(config.root, user.value.id)`，客户端给的 `?directory=` / 头 / 请求体三条入参**全部被改写成沙箱根**；把「哪一段是项目」交给服务端算，003 的「客户端报的目录一律无效」不变量原样保留（沙箱**仍需**由 F3 兜底，本 feature 不加第二道门）。
- **成员判定自成一条线（U5 裁定，2026-10-06）**：`project_member` 是工作空间轴权限，**不接 `core/access` capability**（那是数据轴，004 裁定 ④ 留给 F6/F7 钉契约）——存储落业务 PG、判定写 core 纯函数、接线在执行层；不绑定数据轴权限。
- **六个字段落 openhive 自有表（U4 裁定，2026-10-06）**：新增 `project_ext` 表（`type` / `project_type` / `shared_directory` / `last_accessed_at` / `archived` / `archived_at`），建表钩子挂在 fork 自有的 `packages/core/src/database/router.ts`（每用户库那一层）；上游 `packages/core/src/project/sql.ts` 与 `database/migration/` 一字不动。

## 风险点清单（要素⑤）

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | ~~`project` 表加字段与上游合并冲突~~ **已由 U4 裁定消除** | 改走 openhive 自有 `project_ext` 表 ⇒ 上游 `project/sql.ts` 不动，无冲突面。**代价（新）**：项目列表查询多一次 LEFT JOIN；`project` 行与 `project_ext` 行须同步创建 ⇒ 收成**一个写入模块**，别两处各写一份（`LEARNINGS #002-06`） |
| R2 | MinIO 备份/归档的大文件传输性能 | 分片上传、归档异步执行、进度反馈 |
| R3 | 归档/找回的文件一致性（上传失败/中断） | 上传校验 + 幂等重试，归档前确认完整性 |
| R4 | ~~自动归档形态待决策~~ **已定（U1 裁定，2026-10-06）** | **先提醒、owner 确认后归档**——与 spec.md 的 AC4 / US5 注记 / FR-008 / Assumptions 四处一致。本条原写「待决策」，与 spec 自相矛盾，已按 spec 收口 |
| R5 | 「当前项目」身份由服务端算（D0-1 裁定）⇒ **建会话这条热路径上多一次库读**（查 `project_ext` 拼目录） | 该读在**建会话时**发生、不在每次请求上；查不到就落沙箱根（**不做隐式建项目**，与 U4 的「写入收成一个模块」一致）。判据：查库失败不改变「客户端给的目录无效」这条不变量 |
