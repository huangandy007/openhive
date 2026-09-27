# CLAUDE.md

## 项目性质（重要）

本仓库是官方 [opencode](https://github.com/anomalyco/opencode) 的**定制化 fork**，目标是改造为私有产品 **openhive**。

- 私有仓库（`origin`）：`huangandy007/openhive`
- 官方上游（`upstream`）：`anomalyco/opencode`（默认分支 `dev`，最新 release v1.18.32）
- 本地主分支：`main`（跟踪 `origin/main`）；当前多租户改造工作在 `multi-tenant` 分支（跟踪 `origin/multi-tenant`）

## 项目是什么（WHAT）

openhive（蜂巢）是**面向公安民警的「公安全流程 AI 工作平台」**——把 opencode 改造成民警能用自然语言驱动 AI 干活、产出有形成果的平台。三层架构：**opencode（能力内核，不动）→ skill（方法，长在 opencode 之上）→ 产物（成品，落回项目）**。首批落地「资金分析 → 话单分析」两个研判环节作示范，再横向铺开。

## 为什么（WHY）

民警**不懂代码**，要的是「分析结论 + 文档」，不是代码编辑器。传统工具门槛高、效率低。用「**薄界面 + 厚 skill**」：界面只做「浏览 + 操作」，分析能力由 skill 承载，实现「个人提效、组织增智」。

## 核心约束：必须能持续同步官方更新

官方 opencode 会持续更新，本项目需要周期性拉取官方改进。因此**每一次改动都要以「最小化与官方合并冲突」为前提**。这是本项目最重要的工程约束。

### 定制化三原则

1. **品牌化优先用配置/环境变量，不要硬编码进核心源码**——能改配置文件（config、env、`package.json` 的 `name` 等）就绝不改核心逻辑。
2. **每次改动单独提交，写清提交信息**，并标注「这是要保留的定制」，冲突时能快速定位该保留哪一侧。
3. **定期同步、别攒太久**——官方更新越频繁、拖得越久，合并冲突越难解。

### 同步官方更新的操作

```bash
git fetch upstream          # 拉官方最新（只下载，不改本地代码）
git merge upstream/dev      # 合并官方 dev 到本地 main（注意：官方分支叫 dev）
# 出现冲突：解决后保留本地定制，然后 git add . && git commit
git push origin main        # 推回私有仓库
```

### 注意事项

- 官方默认分支是 `dev`，本地是 `main`，合并方向永远是 `upstream/dev → main`。
- 若 `git fetch upstream` 后报 `non-fast-forward`，说明官方做过强推/重置，需谨慎处理（先备份本地定制再 rebase），不要盲目 force。

## 工作流（HOW）

1. **启动 feature**：新 feature 用 `/speckit-specify`；实现已就绪 feature 用 `run-feature` skill（worktree 隔离 + TDD）。
2. **每个 task 启动必读**：`@../.specify/memory/constitution.md` + `@docs/superpowers/specs/openhive-DESIGN.md` + 对应 feature 的 `plan.md` / `tasks.md`。
3. **测试纪律**：`bun test` 只跑受影响 package；根目录 `bun test` 被 scripts 强制 `exit 1`，禁止。
4. **同步上游**：见「核心约束」——方向恒为 `upstream/dev → 本地`。
5. **落地原则**：品牌化走配置、侵入是「加」不是「改」（见「核心约束」三原则）。

## 技术栈

- **Bun monorepo**，workspaces `packages/*`（含 `opencode` / `app` / `console/*` / `stats/*` / `sdk/js` / `slack`）。
- 前端：**SolidJS 1.9.10**（非 React）+ Vite 7.1.4 + Tailwind CSS v4（`@tailwindcss/vite` 4.1.11）。
- 后端：Hono 4.10.7 + Effect 4.0.0-beta.83 + Drizzle ORM 1.0.0-rc.2。
- AI：`ai` 6.0.168（Vercel AI SDK）。
- 工具链：oxlint 1.60.0、turbo 2.10.2、TypeScript 5.8.2；包管理器 `bun@1.3.14`。
- 上游通用贡献约定见 `AGENTS.md`（本文件只补充 fork 特有约束，不重复）。
- 注意：根 `package.json` 的 `name` 仍是 `"opencode"`（品牌名尚未落配置，属待处理的品牌化事项）。

## 命令清单

- `bun run dev` — 跑 opencode 核心（`packages/opencode`）
- `bun run dev:web` — 前端（`packages/app`）
- `bun run lint` — oxlint
- `bun run typecheck` — turbo typecheck
- `bun test` — **根目录禁止**（`test` script 明确 `exit 1`），在受影响 package 内跑

## 项目宪法

`@../.specify/memory/constitution.md` —— 9 章架构宪法（边界 / 核心原则 / 架构约束 / 禁止模式 / 质量门禁 / 治理 / 术语 / 前端设计系统 / 版本）。

⚠️ 宪法文件在**外层工作区** `D:\project\study\openhive\.specify\`，不在本仓库（相对本根目录是 `../.specify/memory/constitution.md`）。

## 视觉规范

`@docs/superpowers/specs/openhive-DESIGN.md` —— 视觉系统 6 节（Colors / Typography / Spacing / Components / Brand / Theme）。品牌资产见 `design-reference/figma-export/`（logo + tokens 备份）。

## Anti-Patterns

- 直接改 core 的 `sql.ts` 或高频文件 → 每次同步上游都冲突。
- 把品牌名 / 环境值硬编码进源码 → 用 config / env / `package.json` 的 `name`。
- 用前端「隐藏资源」替代权限校验 → 后端授权 + DB 账号 GRANT/RLS + 工具执行鉴权。
- 把业务数据（话单 / 资金）塞进每用户 SQLite → 业务数据独立 PG + RLS。
- 一个 PR 混合「重构」与「新功能」→ 拆成两个提交。
- 手改 `colors.css` → 它是 `script/tailwind.ts` 生成，改 `theme.css`。
- 把 front 的 React 代码搬成 SolidJS 上线 → 是重写不是换皮，front 仅视觉参考。

## 关键文件导航

| 文件 | 何时读 |
|---|---|
| `docs/superpowers/specs/openhive-PRD.md` | 理解业务需求 / 验收标准（14 章） |
| `docs/superpowers/specs/2026-09-06-openhive-design-v2.md` | 理解架构决策 / 两条轴 / 三处必改边界 / 前端换皮路线 |
| `../.specify/memory/constitution.md` | 每个 feature 开始前必读 |
| `docs/superpowers/specs/openhive-DESIGN.md` | 前端换皮 / 视觉 token |
| `docs/superpowers/specs/001~010-*/` | 各 feature 的 spec / plan / tasks |
| `docs/superpowers/specs/2026-09-*.md`（单模块 design） | 深挖某模块设计背景 / 备选方案时读（已被 spec 吸收） |

## Behavioral Guidelines (Karpathy-Inspired)

以下 4 条原则适用于全项目所有 task 实现期，目的是减少 AI 编码的常见失误。

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
