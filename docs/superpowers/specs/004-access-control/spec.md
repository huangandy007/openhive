# Feature Specification: 权限控制

**Feature Branch**: `004-access-control`

**Created**: 2026-09-26

**Status**: Draft

**Input**: PRD §5.1 F4 权限控制 + design-v2 §14（安全：capability 模型 / 数据权限 RLS / 统一 RBAC）

---

## User Scenarios & Testing

### User Story 1 - 会话启动签发 capability（Priority: P1）

会话启动时，系统按「用户 + 项目 + 数据范围」签发 scope 限定的 capability，作为该会话执行层唯一认的凭证。工具执行器只认 capability，不认角色表、不靠提示词。

**Why this priority**: capability 是「授权下沉执行层」的核心载体，是 AI 越权拦截的第一道总闸；没有它，后续任何鉴权都无从挂载。

**Independent Test**: 会话启动后，capability 明确限定了该用户可用的工具清单与数据范围，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户 A 启动一个会话，**When** 系统签发 capability，**Then** 该 capability 的 scope 按 A 的「用户 + 项目 + 数据范围」限定
2. **Given** 两个不同权限的用户各自启动会话，**When** 系统签发 capability，**Then** 两者 capability 的工具与数据范围不同

---

### User Story 2 - 工具清单过滤 + 执行鉴权（Priority: P1）

组装工具清单传给模型前，按 capability 过滤，只把有权工具放进 tools（AI 看不到就调不了）；工具执行器入口再验一次 capability，无权限返回 AccessDenied 并记审计。

**Why this priority**: 这是「AI 不能越权调工具」的两层硬拦。前端「只展示有权用的」只是 UX，不是安全——AI 会自己挑工具、可能被诱导，必须在执行链路上拦。

**Independent Test**: AI 看不到无权工具，且尝试调用无权工具被拒并留审计，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 某工具不在用户 A 的授权范围内，**When** 组装 tools 传给模型，**Then** 该工具不出现在 A 的 tools 清单中
2. **Given** AI 尝试调用不在 A 授权范围内的工具，**When** 执行器入口校验，**Then** 返回 AccessDenied 并记录审计
3. **Given** 提示词被注入诱导 AI 调用越权工具，**When** 执行，**Then** 被执行鉴权硬拦，AI 拿不到无权数据

---

### User Story 3 - MCP 端账号兜底（数据权限 RLS）（Priority: P1）

业务数据（话单 / 资金）的访问走「带用户身份 + 受限数据库账号 + 行级 RLS」兜底：连接级、账号级、行级、结果量级四级控制，即使上层被绕过，数据库层也拦得住越权查询。

**Why this priority**: AI 会生成任意 SQL，前两层（清单过滤 / 执行鉴权）可能被绕过，数据库层的 GRANT/RLS 是最后一道物理兜底。

**Independent Test**: 越权 SQL 查询被 RLS 拦截，拿不到无权数据行，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户 A 无权访问某数据项目，**When** 查询语句触及该项目数据，**Then** 行级 RLS 拦截，返回空或拒绝
2. **Given** 查询结果量超出上限，**When** 执行，**Then** MCP 层强制 LIMIT 拦截，导出需更高权限

---

### User Story 4 - 统一 RBAC（Priority: P1）

角色、用户-角色、角色-资源三级统一管理权限，资源类型涵盖 skill / MCP / 知识库，权限动作分读 / 写 / 审 / 管。角色为主 + 用户例外。

**Why this priority**: RBAC 是 AI 资产（F9）与数据权限的统一授权底座，没有它资产权限无法规模化管理。

**Independent Test**: 给角色授某资源权限，该角色下用户即获得该权限，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 角色 R 被授予对某 skill 的「读」权限，**When** R 下的用户访问该 skill，**Then** 可读
2. **Given** 某用户是某资源的「用户例外」，**When** 该用户访问该资源，**Then** 按例外授予/拒绝

---

### User Story 5 - 数据范围（数据轴）（Priority: P2）

「数据范围」= 用户有权访问的全部业务数据，运行时由 MCP 查询 join「数据项目 ↔ 用户」关联表实时算出，不提前落库、非手动勾选。数据轴权限与工作空间轴权限两套独立，不互相绑定。

**Why this priority**: 数据范围是数据轴授权的落地方式，但依赖 F6/F7 的数据项目成员表就绪，故列 P2。

**Independent Test**: 用户只能查到其有权数据项目名下的数据，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 用户有权访问资金项目 P1 但无权 P2，**When** 查询资金数据，**Then** 只能查到 P1 名下数据，P2 被过滤
2. **Given** 某产物落到了某工作空间项目，**When** 判断数据访问权限，**Then** 数据访问仍由数据轴成员表决定，不受工作空间归属影响

---

### Edge Cases

- 前端「只展示有权工具」被绕过（AI 幻觉 / prompt injection）时，执行鉴权与 RLS 仍硬拦。
- 数据范围运行时实时 join 关联表，数据量增大时的性能需在实现时验证。
- capability 过期 / 会话切换项目后，需重新签发或校验 scope。
- **吊销 / 新增授权的生效时点（R4，2026-10-05 定义）**：capability 在**会话创建那一刻**把 ruleset
  焊进 `session.permission`（建会话 / 改会话两条路径都只走 `mergeClientRules`，**不回查**角色表）
  ⇒ 管理员改授权（**增也一样**）**对已存在的会话无效**，要**下一次建会话**才生效。
  **会话生命周期 = 授权的滞后窗口**。这是 FR-002「执行器只认 capability、不回查角色表」的直接代价，
  不是缺陷——回查就等于在执行器里认角色表。今天**不提供会话级吊销**；若将来要「立刻踢掉」，
  落点只能是「**让会话作废 / 重新签发**」（作废那个 `sessionID`），不是把回查塞回执行器。
  缺口登记见 `state.md`。

---

## Requirements

### Functional Requirements

- **FR-001**: 会话启动时，系统 MUST 按「用户 + 项目 + 数据范围」签发 scope 限定的 capability。
- **FR-002**: 工具执行器入口 MUST 只认 capability，不认角色表、不靠提示词。
- **FR-003**: 组装 tools 传给模型前，系统 MUST 按 capability 过滤，只把有权工具放进 tools。
- **FR-004**: 工具执行鉴权：执行前 MUST 再验 capability，无权限返回 AccessDenied 并记录审计。
- **FR-005**: MCP 端账号兜底：MCP server / 数据库账号 MUST 带用户身份，用受限账号执行，GRANT/RLS 最终兜底。
- **FR-006**: 数据权限 MUST 分四级控制——连接级（`user → mcp` 授权表）、账号级（每角色独立受限数据库账号 + GRANT）、行级（PG 原生 RLS）、结果量级（MCP 层强制 LIMIT + 分页 + 导出需更高权限）。
- **FR-007**: 系统 MUST 提供统一 RBAC——角色、用户-角色、角色-资源三级，资源类型含 skill / MCP / 知识库，权限动作含读 / 写 / 审 / 管，角色为主 + 用户例外。
- **FR-008**: 数据范围 MUST = 用户有权访问的全部业务数据（非手动勾选、非随会话项目变化），运行时由 MCP 查询 join「数据项目 ↔ 用户」关联表实时算出。
- **FR-009**: 数据轴权限（谁能看哪些数据项目）与工作空间轴权限（谁是 openhive 项目成员）MUST 两套独立、不互相绑定。
- **FR-010**: 越权调用工具 / 越权查询数据 MUST 100% 被拒并留审计。

### Key Entities

- **capability**：会话启动签发的 scope 限定能力（用户 + 项目 + 数据范围），执行层唯一凭证。
- **角色（role）**：角色名，权限授予的载体。
- **用户-角色（user_role）**：用户与角色的多对多关联。
- **角色-资源（role_resource）**：资源类型（skill / MCP / 知识库）+ 资源 id + 权限动作（读 / 写 / 审 / 管）。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: AI 调用不在授权范围内的工具 100% 被拒并留审计（PRD AC-F4-01）。
- **SC-002**: 越权 SQL 查询被 RLS 拦截，拿不到无权数据行。
- **SC-003**: 用户只能看到有权工具，无权工具在 tools 清单中不可见。

---

## Assumptions

- 依赖 F2 已落地的用户身份注入（X-User-ID）与 F3 已落地的每用户 db 路由。
- 数据范围运行时实时算出、不提前落库（design-v2 §14.1）。
- 业务数据的 RLS 落地依赖 F6/F7 的数据项目成员表（如 `fund_project_member`），本 feature 定义权限机制，具体表结构在 F6/F7 展开。
- 列级脱敏已移除——分析数据始终明文，合规靠 RBAC/RLS 而非脱敏/加密（design-v2 §1.2）。
