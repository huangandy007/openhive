# Feature Specification: 治理后台

**Feature Branch**: `010-governance-console`

**Created**: 2026-09-26

**Status**: Draft

**Input**: PRD §6 F10 治理后台 + design-v2 §4.2（治理后台八大类）/§12.2（数据源）/§14.5（审计）

---

## User Scenarios & Testing

### User Story 1 - 治理后台入口与两类管理员分权（Priority: P1）

治理后台是「一个系统的两个视图」——与民警三栏工作台同系统，复用同一套登录 + is_admin + RBAC，不单独部署。仅管理员可见，入口在顶栏用户下拉「用户管理」。系统管理员（科信 IT）与业务专家（法制骨干）分权。

**Why this priority**: 治理后台是「配置 + 审核 + 查看」的统一承载，分权是管理安全的前提，缺了它管理员无法管控系统。

**Independent Test**: 管理员从用户下拉进入治理后台，系统管理员与业务专家看到各自权限范围的功能，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 管理员登录，**When** 点顶栏用户下拉「用户管理」，**Then** 进入治理后台（独立全屏视图，与三栏工作台同系统）
2. **Given** 系统管理员进入治理后台，**When** 查看，**Then** 可见账号/组织/运维/技术合规类功能
3. **Given** 业务专家进入治理后台，**When** 查看，**Then** 可见 skill 内容审核/模板口径/数据项目授权，不可见运维类功能

---

### User Story 2 - 账号管理 + 组织架构（Priority: P1）

账号管理：用户列表（按警号/姓名/部门搜索 + 顶部统计注册总数与启用数）、录入 8 字段、重置密码、停用/启用、僵尸账户清理。组织架构：org/dept/section 三级组织树。

**Why this priority**: 账号与组织是系统运行的底座，账号管理是 F2 认证机制的管理承载。

**Independent Test**: 管理员录入/重置/停用账号、维护组织树，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 管理员进入账号管理，**When** 查看用户列表，**Then** 支持按警号/姓名/部门搜索，顶部统计注册总数与启用数
2. **Given** 管理员录入账号，**When** 填 8 字段提交，**Then** 账号创建成功（复用 F2 机制）
3. **Given** 存在 90 天未活跃僵尸账户，**When** 管理员清理，**Then** 可筛选并一键批量停用
4. **Given** 管理员维护组织架构，**When** 操作，**Then** org/dept/section 三级组织树可增删改

---

### User Story 3 - AI 资产治理（Priority: P1）

治理后台承载 AI 资产治理：Skill 审核/发布/上下架、MCP 配置/授权、知识库管理。业务专家审内容，系统管理员做技术发布。

**Why this priority**: 资产治理是 F9 生命周期的管理承载——审核、发布、上下架动作在治理后台完成。

**Independent Test**: 业务专家审核待审 skill、系统管理员发布，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 有 skill 待审核，**When** 业务专家打开治理后台待审区，**Then** 查看内容、试跑、评可泛化性，通过/驳回
2. **Given** 业务审核通过，**When** 系统管理员技术发布，**Then** skill 上架资产中心
3. **Given** 管理员配置 MCP，**When** 操作，**Then** MCP 授权（复用 F9 三层：授权/下发/身份）

---

### User Story 4 - 数据项目权限（管理员兜底）（Priority: P1）

资金/话单项目的成员与归档管理：owner 自主拉人，管理员兜底撤销/归档（如 owner 调离时的权限回收）。

**Why this priority**: 数据项目权限的自主授权在 F6/F7，管理员兜底是权限回收的最终保障（僵尸 owner 场景）。

**Independent Test**: 管理员对某资金项目兜底撤销成员/归档，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 某资金项目 owner 调离（僵尸账户），**When** 管理员介入，**Then** 兜底撤销/归档该项目
2. **Given** 管理员查看数据项目，**When** 浏览，**Then** 可见全部数据项目（含已归档），普通用户只可见有权项目

---

### User Story 5 - 用量/成本 + 审计（Priority: P2）

用量/成本：谁调了多少模型、token 数、各单位成本分摊。审计：审计日志完整记录「谁、何时、调了什么」，支持检索。

**Why this priority**: 用量/成本是成本管控，审计是安全追溯，都重要但非上线阻断项。

**Independent Test**: 管理员查看用量看板、检索审计日志，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 管理员进入用量/成本，**When** 查看，**Then** 看到谁调了多少模型、token 数、各单位成本分摊
2. **Given** 管理员检索审计日志，**When** 查询，**Then** 完整记录「谁、何时、调了什么」（含越权 AccessDenied 记录）

---

### User Story 6 - 模板库 + 数据源配置（Priority: P2）

模板库：报告模板、图谱样式、报表口径配置。数据源配置：数据源注册（类型/连接信息/更新频率）+ connector 配置 + 血缘追踪。

**Why this priority**: 模板保证全单位文书格式统一，数据源是自动接入的预留，MVP 手动上传，均非上线阻断项。

**Independent Test**: 管理员配置报告模板、注册数据源，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 业务管理员配置报告模板，**When** 操作，**Then** 报告模板/图谱样式/报表口径可配置
2. **Given** 系统管理员注册数据源，**When** 操作，**Then** 数据源（类型/连接信息/更新频率）注册成功，connector 可配置

---

### Edge Cases

- 治理后台只承载「配置 + 审核 + 查看」，不承载民警的日常分析（那是三栏工作台）。
- 数据源自动接入（connector）是 P2 后手，MVP 手动上传。
- 审计日志完整记录越权 AccessDenied（F4 已埋审计点），治理后台检索呈现。

---

## Requirements

### Functional Requirements

- **FR-001**: 治理后台 MUST 是「一个系统的两个视图」——复用同一套登录 + is_admin + RBAC，不单独部署；仅管理员可见，入口在顶栏用户下拉「用户管理」。
- **FR-002**: 治理后台 MUST 承载八大类管理：账号管理 / 组织架构 / 用量成本 / 审计 / AI 资产治理 / 模板库 / 数据源配置 / 数据项目权限。
- **FR-003**: 两类管理员 MUST 分权——系统管理员管账号/组织/运维/技术合规，业务专家管内容审核/模板口径/数据项目授权。
- **FR-004**: 账号管理 MUST 支持用户列表（按警号/姓名/部门搜索 + 注册总数/启用数统计）、录入、重置密码、停用/启用、僵尸账户清理（复用 F2 机制）。
- **FR-005**: 组织架构 MUST 支持 org/dept/section 三级组织树增删改。
- **FR-006**: AI 资产治理 MUST 承载 Skill 审核/发布/上下架、MCP 配置/授权、知识库管理（复用 F9 机制）。
- **FR-007**: 数据项目权限 MUST 承载管理员兜底——owner 自主拉人，管理员兜底撤销/归档（owner 调离时权限回收）。
- **FR-008**: 用量/成本 MUST 统计谁调了多少模型、token 数、各单位成本分摊。
- **FR-009**: 审计 MUST 完整记录「谁、何时、调了什么」，支持检索（含越权 AccessDenied 记录）。
- **FR-010**: 模板库 MUST 配置报告模板、图谱样式、报表口径。
- **FR-011**: 数据源配置 MUST 支持数据源注册（类型/连接信息/更新频率）+ connector 配置 + 血缘追踪。
- **FR-012**: 治理后台 MUST 只承载「配置 + 审核 + 查看」，不承载民警的日常分析。

### Key Entities

- **组织树**：org / dept / section 三级。
- **审计日志**：谁、何时、调了什么（含越权记录）。
- **数据源**：类型、连接信息、更新频率 + connector + 血缘。
- **模板**：报告模板、图谱样式、报表口径。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 管理员能完成八大类管理动作，入口仅管理员可见。
- **SC-002**: 两类管理员分权正确——系统管理员与业务专家各见各的功能，互不越界。
- **SC-003**: 审计日志完整记录「谁、何时、调了什么」，越权 AccessDenied 可检索。
- **SC-004**: 治理后台不承载民警日常分析，与三栏工作台职责分离。

---

## Assumptions

- 治理后台复用 F2 的账号机制、F9 的资产治理机制、F6/F7 的数据项目权限机制，本 feature 承载「统一视图 + 管理员兜底动作」。
- 用量/成本数据来自独立「分析库」（design-v2 §5.4，复用 opencode event 表增量抽取），本 feature 承载看板。
- 数据源自动接入（connector）是 P2 后手，MVP 手动上传（design-v2 §12.2）。
- 审计日志埋点由 F4（AccessDenied 审计）等 feature 已埋，本 feature 承载检索界面。
- 治理后台独立全屏视图，但复用 F1 三栏的视觉规范（蜂蜜金品牌色等）。
