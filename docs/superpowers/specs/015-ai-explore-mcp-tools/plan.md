# Implementation Plan: AI 探索与 MCP 工具

**Branch**: `015-ai-explore-mcp-tools` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: `docs/superpowers/specs/015-ai-explore-mcp-tools/spec.md`（依据 `09-AI探索与MCP工具-设计.md` 2026-11-17 复核版）

## Summary

本 feature 的**主体已经落地**（七字段信封、服务端硬校验、4 个探索原语、3 个数据源档案工具、12 次预算、工具卡渲染、20 题夹具）。本计划把工作切成两段：**① 对已落地部分做验收（不改生产代码）**；**② 只补三处缺失的「薄界面 + 话术」行为**（§7 入口起手、§8.2 收尾行、§8.3 错误话术映射），且每一处都复用源码里已有的接缝，不新建通道、不新建状态、不新建取数函数。

**不重复造轮子**是硬约束（用户 2026-11-17 明确要求）：本计划对每个待做项都先回答「现有哪个符号能干这件事」，答不出来就不做。

### MVP 边界（本计划按此执行）

上一轮澄清提问未收到答复（用户直接进入 plan），本计划采用我给出的推荐裁法，并把替代裁法列在 `research.md` D1，便于一句话改回。

| 项 | 本期（MVP） | 理由 |
|---|---|---|
| 已落地的信封 / 原语 / 预算 / 工具卡 / 20 题夹具 | **验收**（不新增代码） | 规格要求「已落地 ≠ 已验收」；重复实现没有意义 |
| 收尾行（§8.2 / FR-033） | **做** | 纯前端派生数据，复用消息 parts 与解析层 |
| 错误话术映射（§8.3 / FR-034） | **做** | 复用 `信封错误卡` + i18n 通道，只加一张 9 行映射 |
| 入口层：查个人 / 查个账户（§7.1 / FR-029 的前两个） | **做** | 复用 `发到会话` + 实体档案已有的实体上下文 |
| 入口层：查一段时间 | **后置** | 全仓没有「案件时间窗」数据源（`grep 案件时间窗` 无生产命中），做它要新增一个项目级接口——违背「不为一个按钮新开接口」 |
| 按地点取事件的查询实现（§4.3） | **后置** | 现状是 `能力未就绪` 的既定契约；实现它属于数据侧新能力，`09` §12 #5 已单列 |
| `资金研判` skill 资产 + A/B（§6） | **后置** | A/B 需真栈 + 真模型凭据，本机不可验；强行塞进 MVP 会让「完成」不可判定 |
| 20 题真模型回放（§13.2） | **后置** | 夹具回放（23 条）已绿；真模型回放需 provider 凭据 |

## Technical Context

**Language/Version**: TypeScript 5.8.2（Bun 1.4.2 workspace monorepo）

**Primary Dependencies**: SolidJS 1.9.10（`packages/app`、`packages/session-ui`）、Hono 4.10.7 + Effect（`packages/opencode` 服务端）、Drizzle ORM（PG）

**Storage**: 本 feature **不新增表、不新增列**；仅读取既有 `case_event` / `case_entity` / `case_event_participant` / `case_fact_row`

**Testing**: `bun test`（受影响 package 内）；**`packages/app` 有 happy-dom 可写组件用例，`packages/session-ui` 没有组件测试基建**（无 `.test.tsx` / happy-dom；实测 2026-11-17），故 session-ui 只写纯函数用例、组件走 storybook + 真浏览器；门禁在仓库根（turbo typecheck + oxlint）

**Target Platform**: 公安内网 Docker 私有部署；桌面浏览器，仅浅色主题

**Project Type**: Bun monorepo（web application + 后端服务器 + 共享 UI 包）

**Performance Goals**: 工具层单次 p95 ≤ 2s（既有实测：明细 100 行 138ms，`01 §7.1`）；单次回答 p95 ≤ 30s（真栈人工量，无硬闸）

**Constraints**: 30 KB 确定性截断；12 次 / 10 分钟窗口预算；所有改动 MUST 可持续 `git merge upstream/dev`

**Scale/Scope**: 14 个信封工具 + 5 个图工具；本期新增 2 个纯前端纯函数 + 1 个组件 + 2 个按钮

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 本计划如何满足 |
|---|---|
| **I. 最小化上游合并冲突** | 新代码全部落 fork 自有文件（`closing-stats.ts` / `closing-line.tsx` / `envelope-parse.ts` 既有 fork 文件）；**只有 `message-part.tsx` 是上游高频文件**，且只改既有定制块（copy/meta 包装）内 2–3 行，见 Complexity Tracking |
| **II. 品牌化走配置** | 不涉及；无品牌字符串硬编码 |
| **III. 物理隔离优先** | 不新增数据存储，不改变隔离模型 |
| **IV. 权限下沉到执行层** | 不新增权限维度；沿用既有「身份 → 成员 → 写工具属主 → 预算计次 → 分发」链（`case-mcp-server.ts:827-876`） |
| **V. 侵入是「加」不是「改」** | 前端只加按钮/组件/纯函数；服务端零改动（本期不碰 `case-mcp-tools.ts` / `case-mcp-server.ts`） |
| **质量门禁** | 仓库根 `bun run typecheck` + 受影响包 `bun test` + `oxlint`；根目录 `bun test` 禁止（`#004-10`） |
| **九、TDD 纪律** | 每个新行为先写会红的用例（详见 TDD 顺序）；只验收的部分不写「假装新写」的用例 |

**Gate 结论**：通过。唯一需要记录的风险是 `message-part.tsx` 的 2–3 行改动，见下。

**Post-design 复核**（Phase 1 产出后）：data-model / contracts / quickstart 均未引入新存储、新权限维度、新上游高频文件；`message-part.tsx` 仍是唯一上游触点。**结论不变：通过。**

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/015-ai-explore-mcp-tools/
├── spec.md
├── plan.md            # 本文件
├── research.md        # Phase 0：7 个决策（含 MVP 边界与复用判定）
├── data-model.md      # Phase 1：信封/空原因/预算/收尾行统计/错误码表
├── contracts/
│   ├── mcp-envelope-contract.md
│   ├── error-budget-contract.md
│   └── ui-card-contract.md
├── quickstart.md      # 可复跑的验收命令
├── checklists/requirements.md
└── tasks.md           # 下一阶段（/speckit-tasks）生成，不在本计划内
```

### Source Code (repository root)

```text
packages/session-ui/src/components/
├── envelope-parse.ts          # 【改】加 错误码→i18n 键 的纯映射（复用解析层唯一出处）
├── envelope-tool.tsx          # 【改】错误卡在 code/message 下渲染一句人话引导
├── closing-stats.ts           # 【新】纯函数：从 message parts 统计查询数/缺口/材料数
├── closing-line.tsx           # 【新】收尾行组件（只做展示）
└── message-part.tsx           # 【改】在既有 copy/meta 块内挂 <ClosingLine/>（2–3 行）

packages/ui/src/i18n/
├── zh.ts                      # 【改】9 个错误码引导 + 收尾行文案
└── en.ts                      # 【改】同上（en 是从属，zh 是主）

packages/app/src/center/case-views/
└── entity-profile.tsx         # 【改】头部加「查个人 / 查个账户」两个按钮（复用 `发到会话`）

packages/opencode/            # 【不改】已有服务端实现即验收对象
packages/app/src/ai-session/  # 【不改】复用 `发送到会话` / `发到会话`，不新增接缝
```

**Structure Decision**：沿用现有 Bun workspace 布局，不新增 package、不新增跨包依赖。`closing-line` 放 `session-ui`（与工具卡同层），入口按钮放 `app`（实体上下文只在这里），中间通过既有 `app → ai-session` 方向的 `发送到会话` 接缝通信。

## Reuse Inventory（先回答「现有谁在做」，再决定写不写）

| 待做项 | 复用的既有符号 | 位置 | 新写量 |
|---|---|---|---|
| 把预填问题写进会话输入框 | `发送到会话(文本, "替换")` | `packages/app/src/ai-session/send-to-session.ts:115` | 0 |
| 「问 AI」按钮的既有范式 | `发到会话` + 空态按钮写法 | `packages/app/src/center/ask-ai.ts:18`、`entity-profile.tsx:615-626`（`发到会话` 调用在 :620） | 0（照抄范式） |
| 实体名称 / 类型上下文 | `档().canonical_value` / `档().类型` | `entity-profile.tsx`（既有 `档()` 响应式取数） | 0 |
| 解析工具返回（拿 `缺口`/`空原因`/错误码） | `解析工具输出` / `是信封工具键` | `packages/session-ui/src/components/envelope-parse.ts:90/:39` | 0 |
| 消息里全部 parts | `data.store.part?.[message.id]` | `message-part.tsx` 的 `isLastTextPart` 已这么取（:1727-1732） | 0 |
| 收尾行的渲染位置 | `TextPartDisplay` 的 `meta` 行与 copy 包装 | `message-part.tsx:1760-1770` | 2–3 行接线 |
| 错误卡显示 code + message | `信封错误卡` | `envelope-tool.tsx:193-232` | 加 1 段文案渲染 |
| i18n 文案通道 | `packages/ui/src/i18n/{zh,en}.ts` + `useI18n` | 既有 | 加键 |
| 预算计数 / 信封校验 / 截断 | `新预算计数`（:149）、`校验信封`（:735）、`截断数据`（:762） | `case-mcp-server.ts` | 0（只验收） |
| 空原因枚举 / 30KB 常量 | `空原因枚举`（:37）、`数据预算字节`（:28） | `case-envelope.ts` | 0（只验收） |
| 地点查询（后置） | `事件参与者条件` + `case_event_participant.role` | `case-mcp-tools.ts:945`、`0039:45-56` | 后置，不写 |

**判定规则**：上表任何一行若出现「没有现成符号」→ 该任务退回 research，不准新建通道。

## 实施顺序（TDD）

> 只列本期动作。每步先红后绿；只验收的步骤不写「假装新写」的用例。

### 阶段 0 · 已落地部分的验收（零生产代码）

1. 跑既有用例集（**不是** `openhive-case-*.test.ts` 全量——那有一百多份）：
   `test/server/openhive-case-mcp-{envelope,server,tools,rows,http,identity,template-filter,supervisor}.test.ts`、
   `openhive-case-{explore,explore-replay,empty-reason,money-flow,timeline,source-profile,graph}.test.ts`；
   把 **FR-001～FR-028、FR-035～FR-048** 逐条映射到用例句（产出一张映射表，缺的进缺口表）。
2. 只补**缺失的用例句**（不补实现）：
   - 16 个空原因逐值字面断言（现状分散在 `openhive-case-empty-reason.test.ts` 等，先盘点再补洞）。
   - 第 12 次注入 / 未知工具不计数 / 失败不注入（`openhive-case-mcp-server.test.ts` 已有部分）。
3. 若发现**实现与规格不符**：停下来报根因，不在本计划内顺手改（铁律：找不到根因不动代码）。

**完成判据**：上面点名的 15 份用例全绿；FR 映射表无空行，或空行明确标「缺口」。

### 阶段 1 · 收尾行（§8.2 / FR-033）

1. **先红**：`closing-stats.test.ts` 构造 3 个口径（0 次调用 / 2 次信封调用且有 2 条缺口 / 图写工具不计数），断言 `{查询次数, 覆盖材料数, 缺口总项, 首条缺口}` 的具体值。
2. 写 `closing-stats.ts` 纯函数：输入 `readonly Part[]`，用 `是信封工具键` 过滤，`解析工具输出` 取 `缺口`；覆盖材料 = `出处[].代表` 中 `#` 前段的去重集合。
3. **渲染验收（session-ui 无组件测试基建）**：`closing-line.tsx` 只渲染纯函数 `收尾行文本(统计): string | null`；用 `closing-line.stories.tsx` 三态（0 次不渲染 / 2 缺口 / 12 次上限）+ storybook 真浏览器核对。
4. 接线：`message-part.tsx` 在既有 copy/meta 块内挂 `<ClosingLine parts={...}/>`；**只动这一处**，判据是 typecheck 绿 + `grep` 唯一调用点，渲染正确性由 storybook 与真栈验。

**判据**：`bun test closing-stats.test.ts` 绿；storybook 三态人工核对通过；`grep` 确认全仓只有一处计算收尾统计（`#002-06`）。

### 阶段 2 · 错误话术映射（§8.3 / FR-034）

1. **先红**：`envelope-parse.test.ts` 加 9 个码 → 期望 i18n 键；未知码 → `undefined`（不回退成固定话术）。
2. 在 `envelope-parse.ts` 加 `错误码引导键(码)`；`zh.ts` / `en.ts` 各加 9 个键（文案逐字取 `09` §8.3 表）。
3. **渲染验收**：`envelope-tool.stories.tsx` 扩 `write_failed` / `bad_input` / 未知码三态；storybook 真浏览器断言渲染出「码 + 原因 + 人话引导」三段，`write_failed` 与 `bad_input` 文案不同。

**判据**：错误卡三段齐全；未知码只显示原码与原消息，不伪造引导。

### 阶段 3 · 入口起手 ×2（§7.1 前两项）

1. **先红**：`entity-profile` 组件用例断言：类型=人 时出现「查个人」，点击后 `发送到会话` 被调用一次且参数含实体名、**不**含自动发送、不触发路由变化；类型=账户 时出现「查个账户」；类型=地点/号码 时两个都不出现。
2. 在 `entity-profile.tsx` 头部复用现有按钮样式加两枚按钮，`onClick` 调 `发到会话(预填句)`（自动走「替换」语义需显式传 `方式`——见下条决策）。
3. 预填句模板（**本计划拟定，`09` §7.1 未给字面文案，需评审**；逐字钉进用例）：
   - 查个人：`查一下「<规范值>」名下有哪些账户、与谁有资金往来，按时间窗给出结论和出处。`
   - 查个账户：`查一下账户「<规范值>」的资金往来：笔数、合计、对手排行与大额明细，并给出出处。`
4. 「查一段时间」**不做**；在 spec 的缺口表与本文「MVP 边界」各记一条，不进 tasks。

**判据**：两枚按钮的用例绿；全仓 `grep 查一段时间` 只命中文档不命中代码。

### 阶段 4 · 门禁与真栈手工验收

1. 仓库根：`bun run typecheck`、`bun run lint`（oxlint）。若出现**与本轮改动无关的既有失败**，报告里贴 `file:line` + 规则名并注明「既有」，不当作本轮回归、也不顺手改；若失败点落在我改的行上，必须先修到绿。
2. 受影响包：`packages/opencode` 的 15 份 MCP 用例 + `packages/session-ui` 的 `envelope-parse` / `closing-stats` 纯函数用例 + `packages/app` 的 `entity-profile`（命令见 `quickstart.md`）；session-ui 的组件渲染另跑 storybook 三态核对。
3. 真栈手工：起一套栈（不重启在跑的旧栈；`REAL_STACK_*` 换端口），走一条主流程——打开实体档案 → 点「查个人」→ 输入框出现预填句 → 发一句 → 回复末尾出现收尾行 → 制造一次工具失败 → 错误卡显示码 + 引导。跑不通不得宣称 MVP 完成。
4. 验不了的（真模型行为、p95、并发）写进缺口，不写成已覆盖。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 改上游文件 `message-part.tsx`（2–3 行） | 收尾行必须渲染在助手消息尾部；该文件是唯一渲染点 | 新建独立消息渲染器会复制整套消息渲染，冲突面远大于 3 行（违反宪法 I 的「最小面」本意） |
| `entity-profile.tsx` 加两枚按钮 | 实体上下文只在该页可得 | 放会话面板需把「当前实体」从会话面板反查到中栏，等于新建一条跨栏状态通道（违反复用优先） |

## 已知风险

1. **i18n 双份**：zh/en 各加 9 键，漏一份会静默回退成键名——用例必须断言 zh 实际文案。
2. **`.ts` / `.tsx` 同名解析分歧**：`closing-stats.ts` 与 `closing-line.tsx` 名字必须不同，否则 bun 与 vite 各自优先不同扩展名（`#013` 前例）。
3. **收尾行口径**：查询次数按「本消息内的信封工具 part」数，**不含图工具**（图工具不计入「查询」语义，但计入服务端预算）；这是与预算文案的已知差异，写进契约。
4. **组件测试假绿**：DOM「不存在」断言一律布尔比较（`#013-12`）。

## 交付后仍存在的缺口（不伪装成已覆盖）

- 按地点取事件（仍 `能力未就绪`）、「查一段时间」起手、`资金研判` skill A/B、20 题真模型回放。
- 规格 FR-029 只交付 2/3；FR-033 的「覆盖材料数」是出处前缀去重的近似值。
- 真栈视觉验收只走主流程一次，不做全量截图。
