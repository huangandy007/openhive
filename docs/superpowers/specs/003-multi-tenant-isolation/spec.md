# Feature Specification: 多用户隔离

**Feature Branch**: `003-multi-tenant-isolation`

**Created**: 2026-09-26

**Status**: Draft

**Input**: PRD §5.1 F3 多用户隔离 + design-v2 §5（数据隔离与工作目录沙箱）/§6（执行并发与资源隔离）

---

## User Scenarios & Testing

### User Story 1 - 每用户独立数据库（Priority: P1）

每个用户的会话、项目、文件等 core 数据落在该用户独立的数据库文件中，互不可见、物理隔离。数据库连接按用户身份显式索引，甲的请求只能取甲的连接，物理上拿不到乙的数据。

**Why this priority**: 数据物理隔离是「多用户互不可见」的第一道硬隔离，靠文件系统/数据库原生强制，应用层出 bug 也拦得住越权。

**Independent Test**: 用户 A 创建的会话/项目只写入 A 的数据库文件，用户 B 的请求读不到 A 的任何数据，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户 A 和用户 B 各自有独立 db 文件，**When** A 创建一条会话，**Then** 该会话写入 A 的 db，B 的 db 无此数据
2. **Given** 用户 B 的请求带的是 B 的身份，**When** B 发起查询，**Then** 只能路由到 B 的 db 连接，拿不到 A 的
3. **Given** 客户端尝试伪造身份（自带 `X-User-ID`），**When** 请求抵达网关，**Then** 网关剥离该头并按会话凭证重新注入真实身份；**When** 请求绕过网关直连内核端口，**Then** 端口不可达（回环绑定 / 网络策略），伪造不成立

---

### User Story 2 - 每用户沙箱目录（Priority: P1）

每个用户在服务器文件系统上有独立的根目录 `/workspaces/{userId}/`，AI 会话干活、创建项目、读写文件全被关在这个目录里，别人的目录看不见也碰不到。靠两道锁保证「出不去」：应用层锚定（忽略客户端传入的目录）+ OS 层兜底（受限用户运行）。

**Why this priority**: 沙箱目录是工作空间轴的用户物理边界，与独立 db 一起构成「数据 + 文件」双隔离。

**Independent Test**: 用户 A 的会话尝试读写 `/workspaces/B/` 被拒，且只能落在 `/workspaces/A/` 内，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户 A 的会话请求指定了一个伪造的工作目录，**When** 中间件处理，**Then** 忽略客户端传入目录，强制锚定到 A 的沙箱根 `/workspaces/A/`
2. **Given** 用户 A 的会话尝试读写 `/workspaces/B/`，**When** 执行，**Then** 被 OS 文件权限拒绝
3. **Given** 用户 A 在沙箱内创建项目，**When** AI 会话读写文件，**Then** 文件全部落在 `/workspaces/A/` 内

---

### User Story 3 - 项目与会话隔离（Priority: P1）

项目是唯一的隔离边界与 git 仓库；同一用户内不同项目之间、不同会话之间数据不串。会话通过 `project_id` 逻辑归属到项目。

**Why this priority**: 项目隔离是「专注正确工作单元、不串案」的组织边界，即使同一用户也要项目间隔离。

**Independent Test**: 同一用户的两个项目 A、B，会话/文件互不混淆，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户在同一沙箱下有项目 A 和项目 B，**When** 在项目 A 下创建会话，**Then** 该会话归属项目 A，不串到项目 B
2. **Given** 项目 A 是独立 git 仓库，**When** 会话在项目内改文件，**Then** git 改动记录在项目 A 仓库内

---

### User Story 4 - 每用户资源配额（Priority: P2）

每用户有并发会话数上限与沙箱磁盘配额，防止单个用户占满资源影响他人。

**Why this priority**: 资源配额是「隔离」在资源维度的补充，防止单点拖垮整机，但非数据隔离的硬底线，故列 P2。

**Independent Test**: 单用户并发会话超限被拒、磁盘超配额被拒，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户 A 的并发会话数达到上限，**When** A 再发起新会话，**Then** 被拒绝并提示
2. **Given** 用户 A 的沙箱磁盘接近配额上限，**When** A 继续写文件，**Then** 被限制或提示清理

---

### Edge Cases

- 应用层锚定有 bug 导致越权时，OS 层文件权限兜底拦截（双层防护）。
- 数据库连接惰性打开、按需复用，避免为每个用户预建连接浪费资源。
- 沙箱内项目目录下的案件子目录不是隔离边界、不是独立 git 仓库（git 粒度 = 项目）。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 为每个用户维护独立数据库文件（`/data/{userId}/opencode.db`），数据库连接按用户身份显式索引（`Map[userId] → 连接`）。
- **FR-002**: 用户身份 MUST 来源唯一可信、用户不可伪造——`X-User-ID` 由网关**剥离客户端传入值后强制覆盖**再注入，且内核端口 MUST 只对网关可达（回环绑定 / 网络策略）。本条的保证来自**链路不可达 + 注入覆盖**，不来自该头本身（它是明文头、不是凭证）。
- **FR-003**: 数据库查询 MUST 从 per-request 用户上下文取用户身份，路由到对应连接，物理上拿不到其他用户的连接。
- **FR-004**: 每用户独立 db MUST 实现为零表结构改动——不碰 `sql.ts`，session 表不加 `user_id` 列。
- **FR-005**: 每个用户 MUST 有独立沙箱根目录 `/workspaces/{userId}/`，中间件强制锚定工作目录（忽略客户端传入的 directory）。
- **FR-006**: opencode 容器 MUST 以受限系统用户运行，OS 文件权限只放行用户自己名下的目录（OS 层兜底）。
- **FR-007**: 项目 MUST 是唯一隔离边界与独立 git 仓库；会话通过 `project_id` 逻辑归属到项目。
- **FR-008**: 系统 MUST 对每用户并发会话数计数并限流，超限拒绝。
- **FR-009**: 系统 MUST 对沙箱磁盘设配额，超限限制写入。
- **FR-010**: 隔离 MUST 通过验收测试——用户 A 访问用户 B 的目录 / 数据库必须被拒绝。

### Key Entities

- **用户沙箱**（`/workspaces/{userId}/`）：用户级物理隔离边界。
- **用户数据库**（`/data/{userId}/opencode.db`）：每用户独立 SQLite，core 数据物理隔离。
- **项目**：唯一隔离边界 + 独立 git 仓库（会话通过 `project_id` 归属）。
- **会话**：通过 `session.project_id` 逻辑隔离，天然按 `session_id` 隔离。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 隔离测试通过——用户 A 访问用户 B 的目录 / 数据库 100% 被拒（失败即阻断合并）。
- **SC-002**: 每用户 db 文件独立，core 表结构零改动（不碰 `sql.ts`）。
- **SC-003**: 客户端伪造工作目录或身份无法越权（应用层锚定 + OS 权限双层拦截）。

---

## Assumptions

- opencode 现状为进程级单例数据库（固定一个 `opencode.db`），本 feature 是对该处「唯一深改 core」的改造（design-v2 §5.2 / §3.1）。
- 每用户独立 db 保持 SQLite（不换 PG），1600 用户仍在「每用户一个文件、无单写者瓶颈」的舒适区（design-v2 §5.1）。
- 跨用户分析读写分离（design-v2 §5.4 独立「分析库」）归 F10 治理后台的用量/成本看板，本 feature 不展开。
- 水平扩展 / 多进程（design-v2 §6.1）为后手，不在本轮。
- 用户身份注入依赖 F2 已落地的「关 Basic Auth + 注入 X-User-ID」，本 feature 消费该身份而非重建。
