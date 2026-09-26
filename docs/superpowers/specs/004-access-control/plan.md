# Implementation Plan: 权限控制

**Branch**: `004-access-control` | **Date**: 2026-09-26 | **Spec**: `spec.md`

**Input**: Feature specification from `docs/superpowers/specs/004-access-control/spec.md`

## Summary

落地「授权下沉执行层」的 capability 模型与三层拦截：会话启动签发 scope 限定 capability，工具清单过滤 + 工具执行鉴权 + MCP 账号兜底（含 PG 行级 RLS），统一 RBAC，数据轴/工作空间轴两套权限解耦。这是 constitution 三处必改边界的第三处（工具执行守卫）。

## Technical Context

**Language/Version**: TypeScript（Bun monorepo，核心 `packages/opencode`）

**Primary Dependencies**: opencode 工具执行器（tool executor）、MCP、业务 PostgreSQL（RLS）

**Storage**: RBAC 表（`role` / `user_role` / `role_resource`）；业务数据 PG 行级 RLS

**Testing**: oxlint + turbo typecheck + bun test + 安全测试（越权读、SQL 注入、路径穿越、未授权直连）

**Target Platform**: 公安内网（服务端 + 网关）

**Project Type**: web-service（opencode core 改造 + MCP 层）

**Performance Goals**: capability 校验与 RLS 过滤无额外可感知延迟

**Constraints**: 权限下沉执行层、数据明文（合规靠 RBAC/RLS 不靠脱敏）

**Scale/Scope**: 1600 用户（并发活跃 320~480）

## Constitution Check

*GATE: 逐条对照 constitution.md，违反 MUST 级原则 = CRITICAL 阻断。*

| 宪法原则 | 本 feature 的符合情况 | 结论 |
|---|---|---|
| I. 最小化上游合并冲突（NON-NEGOTIABLE） | 工具执行守卫是第三处必改边界，用「加」的方式（新增守卫中间件），不碰 `sql.ts` | ✅ 无冲突 |
| II. 品牌化走配置（NON-NEGOTIABLE） | F4 不涉及品牌 | ✅ 不适用 |
| III. 物理隔离优先 | F4 在 F3 物理隔离之上加执行层鉴权；RLS 是数据库原生强制，不靠应用层 `if` | ✅ 无冲突 |
| IV. 权限下沉执行层 | 本 feature 即该原则的正面落地（清单过滤 + 执行鉴权 + MCP 账号兜底三层） | ✅ 完全符合 |
| V. 侵入是「加」不是「改」 | 新增 capability 签发 + 工具守卫模块，不改 core 既有逻辑 | ✅ 无冲突 |

**结论**: 无 MUST 级原则违规。本 feature 是 constitution 原则 IV（权限下沉执行层）的正面落地。

## 项目文件结构（要素①）

```text
packages/opencode/src/
├── authz/
│   ├── capability.ts          # capability 签发（会话启动，按用户 + 项目 + 数据范围）
│   ├── tool-filter.ts         # 工具清单过滤（组装 tools 前，只放有权工具）
│   └── tool-guard.ts          # 工具执行守卫（执行前验 capability，AccessDenied + 审计）
├── rbac/
│   ├── role.ts                # role / user_role / role_resource 表
│   └── policy.ts              # 权限判定（读 / 写 / 审 / 管）
├── mcp/
│   └── data-scope.ts          # 数据范围：join「数据项目 ↔ 用户」实时算出
```

> 三层拦截（design-v2 §14.1）：① 工具清单过滤（组装 tools 前）；② 工具执行鉴权（执行器入口）；③ MCP 端账号兜底（带 user 身份 + 受限账号 + GRANT/RLS）。

**Structure Decision**: 新增 `authz/`、`rbac/`、`mcp/data-scope.ts` 模块，全部用「加」的方式挂到 opencode 既有工具执行链路上。

## 数据流向（要素②）

```mermaid
flowchart LR
    SUB[会话启动] --> CAP[签发 capability]
    CAP --> FILT["① 工具清单过滤"]
    CAP --> GUARD["② 工具执行鉴权"]
    FILT --> GUARD
    GUARD --> MCP["③ MCP 账号兜底"]
    MCP -->|带 user 身份| RLS[业务 PG 行级 RLS]
    RLS -->|数据轴授权| DA[业务数据行]
```

- **三层拦截**：清单过滤（AI 看不到无权工具）→ 执行鉴权（调用时再验）→ MCP 账号兜底（数据库层 GRANT/RLS 最终拦截）。
- **两轴解耦**：数据轴权限（数据项目成员表，决定「能查哪些数据行」）与工作空间轴权限（`project_member`，决定「产物落哪个工作空间」）两套独立，不互相绑定。

## 依赖清单（要素③）

| 依赖 | 用途 | 说明 |
|---|---|---|
| Bun（monorepo） | 构建 / 运行 | opencode 既有工程 |
| opencode 工具执行器 | 改造基座 | 在 tools 组装 + 执行处挂守卫 |
| PostgreSQL（业务数据） | 行级 RLS | 数据轴最终兜底（F6/F7 的数据项目成员表驱动） |

> 具体版本实现时对照 opencode 现有依赖锁定。

## 与现有系统集成点（要素④）

- **三处必改边界的第三处「工具执行守卫」**：本 feature 落地，与 F3（用户中间件 + db 路由）构成完整三处边界。
- **依赖 F2 / F3**：消费 F2 的身份注入（X-User-ID）与 F3 的每用户 db 路由；capability 以 userId 为签发主体。
- **RBAC 表**：`role` / `user_role` / `role_resource`，供 F9（AI 资产授权）复用同一套授权底座。
- **数据轴成员表**：`fund_project_member` 等由 F6/F7 落地，本 feature 定义数据范围的实时 join 机制。

## 风险点清单（要素⑤）

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | capability 校验若未覆盖所有工具入口，存在漏网 | 守卫挂在执行器统一入口，逐工具入口审计，安全测试覆盖 |
| R2 | 数据范围运行时实时 join 关联表，数据量大时性能下降 | 关联表建索引，必要时缓存数据范围，压测验证 |
| R3 | RLS 策略配置过松（越权）或过紧（自己查不到） | 用最小权限原则，安全测试双向验证（A 读不到 B、A 能读自己） |
| R4 | 三层拦截的审计日志若遗漏，无法追溯越权 | AccessDenied 统一记审计，接入审计检索（F10） |
