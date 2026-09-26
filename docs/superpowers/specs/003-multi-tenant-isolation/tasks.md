# Tasks: 多用户隔离

**Input**: `docs/superpowers/specs/003-multi-tenant-isolation/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F2 已落地 X-User-ID 注入

**Tests**: 核心是「隔离测试」——用户 A 访问用户 B 的目录 / db 必须被拒（constitution §五质量门禁）。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位现状 + 方案锁定）

- [ ] T001 [P] 定位 `database.ts` 现状（`makeGlobalNode` 单例 / `path()` 固定落 db）与 `Location` 的 `LayerNode.unbound` 模式，产出改造落点 [FR-001] [无依赖] [出参：单例现状 + 可仿模式清单]
- [ ] T002 [P] 确定 `/data/{userId}/` 与 `/workspaces/{userId}/` 的目录挂载 + 受限用户权限方案 [FR-001][FR-005] [无依赖] [出参：目录/权限方案记录在案]

## Phase 2: Foundational（用户上下文 + db 路由）

- [ ] T003 实现 per-request User 上下文（仿 Location 的 LayerNode.unbound，中间件填 X-User-ID）[FR-002][FR-003] [T001] [出参：请求内可读到可信 userId]
- [ ] T004 实现 Database `Map<userId, 连接>`（惰性打开 + 复用 + 各自 PRAGMA）[FR-001][FR-003] [T001] [出参：多 userId 各自连接独立]
- [ ] T005 实现 db 查询从 User 上下文取 userId 路由到对应连接 [FR-003] [T003][T004] [出参：A/B 查询落各自 db 文件]

## Phase 3: US2 沙箱目录（P1）

- [ ] T006 实现工作目录强制锚定中间件（忽略客户端传入 directory）[FR-005] [T003] [出参：伪造 directory 被忽略，落沙箱根]
- [ ] T007 配置 opencode 容器以受限系统用户运行 + 文件权限（只放行自己名下目录）[FR-006] [T002] [出参：OS 层拒绝跨用户读写]

## Phase 4: US3 项目 / 会话隔离（P1）

- [ ] T008 验证项目 = 唯一隔离边界 + 独立 git 仓库（复用 opencode 原生 project）[FR-007] [T006] [出参：沙箱内项目各自独立 git]
- [ ] T009 验证 session.project_id 逻辑隔离 + 确认零表结构改动 [FR-007][FR-004] [T005] [出参：session 表无 user_id 列，逻辑隔离生效]

## Phase 5: US4 资源配额（P2）

- [ ] T010 实现每用户并发 Session 计数 + 限流（中间件 + SessionExecution）[FR-008] [T003] [出参：超限新会话被拒]
- [ ] T011 实现沙箱磁盘配额（Linux quota / docker volume）[FR-009] [T002] [出参：超配额写入被限制]

## Phase 6: 隔离测试（验收，P1）

- [ ] T012 写隔离测试：用户 A 访问用户 B 的 db 必须被拒 [FR-010][SC-001] [T005] [出参：测试通过，A 读不到 B 的会话/项目]
- [ ] T013 写隔离测试：用户 A 访问用户 B 的目录必须被拒（含伪造 directory 场景）[FR-010][SC-003] [T006][T007] [出参：测试通过，A 读写不到 /workspaces/B/]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T001）；T004（依赖 T001）；T005（依赖 T003+T004）
- **Phase 3**：T006（依赖 T003）；T007（依赖 T002，可与 T006 并行）
- **Phase 4**：T008（依赖 T006）；T009（依赖 T005）
- **Phase 5**：T010（依赖 T003）∥ T011（依赖 T002）
- **Phase 6**：T012（依赖 T005）∥ T013（依赖 T006+T007）

共 13 条任务（T001–T013），符合 12–18 条范围。
