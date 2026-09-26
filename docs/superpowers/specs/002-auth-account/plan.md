# Implementation Plan: 认证与账号

**Branch**: `002-auth-account` | **Date**: 2026-09-26 | **Spec**: `spec.md`

**Input**: Feature specification from `docs/superpowers/specs/002-auth-account/spec.md`

## Summary

新增独立 Auth 服务承载账号与认证：用户表（全新，不复用 opencode 的 `account` 表）、管理员录入、警号登录、首次强制改密、密码重置、账号停用与僵尸账户识别。opencode 内核关闭自身 Basic Auth，只信任网关注入的 `X-User-ID`。

## Technical Context

**Language/Version**: TypeScript（Bun monorepo）

**Primary Dependencies**: JWT（短期凭证）、argon2id（密码哈希）、httpOnly Cookie（凭证下发）

**Storage**: 用户表存于 Auth 服务自有存储（第三种数据——账号数据，独立于 opencode 每用户 SQLite 与业务 PG）；每用户沙箱目录 `/workspaces/{userId}/`

**Testing**: oxlint（lint）+ turbo typecheck + 受影响 package 的 bun test

**Target Platform**: 公安内网（网关 + 服务端）

**Project Type**: web-service（opencode fork 新增 Auth 服务）

**Performance Goals**: 登录校验秒级完成

**Constraints**: 复用 opencode、最小化合并冲突、敏感字段明文（合规靠 RBAC 不靠脱敏）

**Scale/Scope**: 1600 用户（并发活跃 320~480）

## Constitution Check

*GATE: 逐条对照 constitution.md，违反 MUST 级原则 = CRITICAL 阻断。*

| 宪法原则 | 本 feature 的符合情况 | 结论 |
|---|---|---|
| I. 最小化上游合并冲突（NON-NEGOTIABLE） | 用户表全新（Auth 服务内部），不改 opencode `account` 表 / `sql.ts`；关闭 Basic Auth 走配置（不设 `OPENCODE_SERVER_PASSWORD`） | ✅ 无冲突 |
| II. 品牌化走配置（NON-NEGOTIABLE） | 关闭 Basic Auth、登录页品牌均由配置 / 环境变量控制，不硬编码 | ✅ 无冲突 |
| III. 物理隔离优先 | F2 触发每用户沙箱目录创建（物理隔离起点）；用户表独立，不混入 core 数据 | ✅ 无冲突 |
| IV. 权限下沉执行层 | F2 签发身份（userId），作为下游 capability/RBAC 的用户主体；本 feature 不涉及工具鉴权（在 F4） | ✅ 无冲突 |
| V. 侵入是「加」不是「改」 | 新增 Auth 服务 + 用户表；opencode 侧仅「关闭 Basic Auth」的配置改动，不改 core 逻辑 | ✅ 无冲突 |

**结论**: 无 MUST 级原则违规，无需 Complexity Tracking 记录。

## 项目文件结构（要素①）

```text
auth/                          # 新增 Auth 服务（独立于 opencode core）
├── src/
│   ├── user.ts                # 用户表模型 + 迁移（8 业务字段 + 系统字段）
│   ├── login.ts               # 登录：校验密码 → 签发短期凭证
│   ├── password.ts            # 改密 / 重置（must_change_pw 状态流转）
│   ├── zombie.ts              # 僵尸账户识别（90 天未活跃筛选 + 批量停用 + 保留 30 天）
│   ├── register.ts            # 管理员录入账号 + 创建沙箱目录
│   └── middleware.ts          # 网关注入 X-User-ID（opencode 边界）
```

> 用户表字段模型见 design-v2 §4.1（`police_no` / `name` / `id_card` / `phone` / `org` / `dept` / `section` / `status` + `password_hash` / `is_admin` / `must_change_pw` / `last_login_at` / `last_active_at` / `created_at`）。

**Structure Decision**: Auth 服务作为独立服务（新增模块），用户表存 Auth 服务自有存储；opencode 侧零表结构改动。

## 数据流向（要素②）

认证流 + 两轴起点：

```mermaid
flowchart LR
    ADMIN[管理员录入账号] --> USER[用户表 Auth 服务]
    USER --> LOGIN[登录校验密码]
    LOGIN --> TOKEN[签发短期凭证]
    TOKEN --> GW[网关下发 Cookie]
    GW -->|注入 X-User-ID| OC[opencode 内核]
    ADMIN -->|创建沙箱目录| WS[工作空间轴: /workspaces/{userId}/]
    USER -->|用户主体标识| DA[数据轴: 业务 PG + RLS 授权依据]
```

- **工作空间轴**：账号录入即创建沙箱目录（F2 触发起点），完整隔离机制（每用户 db 路由、OS 权限）在 F3 展开。
- **数据轴**：用户表是业务 PG + RLS 的「用户主体」来源（数据项目 ↔ 用户授权），F2 只提供身份标识，授权逻辑在 F4/F6/F7。
- **opencode 边界**：opencode 不碰密码逻辑，只认网关注入的 `X-User-ID`。

## 依赖清单（要素③）

| 依赖 | 用途 | 说明 |
|---|---|---|
| Bun（monorepo） | 构建 / 运行 | opencode 既有工程，复用 |
| JWT 库 | 短期登录凭证 | 载荷 `{ sub: userId, police_no, name, is_admin, exp }`，约 2h 有效 |
| argon2id | 密码哈希 | 密码不落明文 |
| httpOnly Cookie | 凭证下发 | 网关下发，前端不读 |

> 具体库版本实现时对照 opencode 现有依赖锁定；全部内网可自建。

## 与现有系统集成点（要素④）

- **opencode 内核三处必改边界之一（用户中间件）**：本 feature 落地「用户身份注入」——opencode 关闭自身 Basic Auth（不设 `OPENCODE_SERVER_PASSWORD`），新增中间件读取 `X-User-ID` 填入 per-request 用户上下文（F3 用此上下文路由 db）。
- **不复用 opencode `account` 表**：用户表是 Auth 服务内部的全新表，与 opencode 原生账号体系解耦。
- **复用 F1 三栏**：登录成功进入 F1 的三栏主界面；首次改密弹窗挂载在三栏之上。
- **复用前端 spec 002-openhive-frontend-ui**：登录页视觉（浅色专业风、深色背景图 + 白色卡片）。

## 风险点清单（要素⑤）

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | 关闭 Basic Auth 后，`X-User-ID` 注入链路若不可靠，会致全站无法访问或身份错乱 | 网关注入 + 中间件校验双层兜底，注入缺失即拒绝请求 |
| R2 | 僵尸账户「保留 30 天再删除」窗口期内的数据恢复与归档策略 | 明确保留期状态机，30 天内可恢复、逾期归档，纳入 F3 隔离测试 |
| R3 | Auth 服务的部署边界（独立服务 vs 网关模块）影响架构与合并冲突面 | 优先「网关模块内嵌 + 独立用户表」，避免新增独立部署单元 |
| R4 | 用户表存储选型（Auth 自有 SQLite 还是并入某 PG）未定 | 实现时按「1600 用户、单写者、无跨用户聚合」评估，倾向独立轻量存储 |
