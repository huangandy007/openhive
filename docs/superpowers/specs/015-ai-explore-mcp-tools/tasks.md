# Tasks: AI 探索与 MCP 工具

**Input**: `docs/superpowers/specs/015-ai-explore-mcp-tools/`（plan.md / spec.md / research.md / data-model.md / contracts/ / quickstart.md）

**Tests**: **必须**——本 feature 采用 TDD（spec「TDD Requirements」TR-001～TR-009）。纯逻辑先写会红的用例；渲染层按本仓既有做法用 **storybook 三态 + 真栈** 验收。

**测试基建事实（2026-11-17 实测，决定任务边界）**：
- `packages/session-ui` **没有组件测试基建**：无 `.test.tsx`、devDependencies 无 happy-dom / testing-library；`envelope-parse.ts` 头注释也写明「渲染层的验收走 storybook + 真浏览器」。
- 因此 session-ui 的新行为只写 **`.test.ts` 纯函数用例**；组件渲染用 `*.stories.tsx`（`packages/session-ui/src/**/*.stories.tsx` 已被 `packages/storybook/.storybook/main.ts` 扫描）+ storybook 浏览器核对。
- `packages/app` **有** happy-dom，`entity-profile.test.tsx` 可写组件用例。

**组织方式**：按用户故事分阶段。US1–US3 已落地、只验收；US4/US6/US7 是本期要写的薄行为；US5（skill）、地点查询、时间窗起手**后置，不生成任务**。

## 格式

`- [ ] [ID] [P?] [Story?] 描述（入：… · 出：… · 文件路径 · 判据）`

---

## Phase 1: Setup（验收基线）

- [ ] T001 跑验收基线并记录实得输出（入：`packages/opencode` 下 15 个点名测试文件 · 出：每个文件的通过/失败计数与失败清单，粘贴进实现记录 · 判据：`cd packages/opencode && timeout 600 bun test test/server/openhive-case-mcp-envelope.test.ts test/server/openhive-case-mcp-server.test.ts test/server/openhive-case-mcp-tools.test.ts test/server/openhive-case-mcp-rows.test.ts test/server/openhive-case-mcp-http.test.ts test/server/openhive-case-mcp-identity.test.ts test/server/openhive-case-mcp-template-filter.test.ts test/server/openhive-case-mcp-supervisor.test.ts test/server/openhive-case-explore.test.ts test/server/openhive-case-explore-replay.test.ts test/server/openhive-case-empty-reason.test.ts test/server/openhive-case-money-flow.test.ts test/server/openhive-case-timeline.test.ts test/server/openhive-case-source-profile.test.ts test/server/openhive-case-graph.test.ts`）

- [ ] T002 生成 FR→用例映射表（入：`docs/superpowers/specs/015-ai-explore-mcp-tools/spec.md` 的 FR-001～FR-028、FR-035～FR-048 与 T001 结果 · 出：追加到 `docs/superpowers/specs/015-ai-explore-mcp-tools/tasks.md` 末尾的映射表，每条 FR 至少一个用例句，无覆盖的标「缺口」 · 判据：表里没有空白格）

---

## Phase 2: 验收已落地主体（US1–US3，不改生产代码）

**纪律**：只补断言、不补实现。若断言暴露实现与规格不符 ⇒ **停**，报根因与证据。

### User Story 1 - 民警问一句，AI 自己往下追（P1）

**Independent Test**：四个原语各跑一次，返回体都是七字段信封且 `数据` 不超 30 KB / 条数不超上限。

- [ ] T003 [P] [US1] 核对四原语的「七字段 + 上限」断言（入：`packages/opencode/test/server/openhive-case-explore.test.ts`、`.../openhive-case-mcp-rows.test.ts`、`.../openhive-case-explore-replay.test.ts` · 出：缺失的断言补进对应文件，实得红→绿 · 判据：`timeout 300 bun test <该文件>` 绿，且每个原语至少一条 `数据` 上限断言）

### User Story 2 - 查不到时，AI 必须说清「为什么没有」（P1）

**Independent Test**：16 个 `空原因` 逐值各至少一条**字面值**断言；非枚举值被服务端拒。

- [ ] T004 [P] [US2] 盘点并补齐 16 个空原因逐值断言（入：`packages/opencode/test/server/openhive-case-empty-reason.test.ts`、`.../openhive-case-money-flow.test.ts`、`.../openhive-case-timeline.test.ts` · 出：16 值覆盖清单；缺的断言补上（只加断言） · 判据：清单 16/16，且补齐后的用例跑绿）

### User Story 3 - 每个数字都能翻回原文（P1）

**Independent Test**：`get_citation` 与各工具 `出处` 项都能下钻或明确标 `可下钻: null`。

- [ ] T005 [P] [US3] 核对出处与 `get_citation` 断言（入：`packages/opencode/test/server/openhive-case-citation.test.ts`、`.../openhive-case-mcp-tools.test.ts` · 出：`出处` 三项结构与 `可下钻` 的断言补洞 · 判据：`timeout 300 bun test <该文件>` 绿）

**检查点**：US1–US3 的验收证据齐了；后续三块新行为独立开工。

---

## Phase 3: User Story 4 - 追问有上限，到限就收尾（P1）

**Goal**：助手消息末尾出现收尾行（查询次数 / 覆盖材料 / 缺口 / 达 12 次提示）。

**Independent Test**：纯函数三夹具（0 次 / 2 次带 2 缺口 / 图写工具不计）结果正确；storybook 三态渲染正确；真栈消息尾部可见。

### 测试先行（必红）

- [ ] T006 [US4] 写统计与文案纯函数用例（红）（入：`统计输入[]` 三夹具——0 次、2 次信封调用带 2 条缺口、1 个 `graph_add` + 1 次信封调用；测试传入假 `t：(键, 参数?) => string`，返回键名以便断言 · 出：`统计收尾(parts) → { 查询次数, 覆盖材料数, 缺口总项, 首条缺口 }` 与 `收尾行文本(统计, t) → string | null`（0 次为 null、≥12 含 `.budget` 键）的失败断言与实得值 · 文件 `packages/session-ui/src/components/closing-stats.test.ts` · 判据：`timeout 300 bun test src/components/closing-stats.test.ts` 红）

### 实现

- [ ] T007 [US4] 实现 `统计收尾` + `收尾行文本`（绿）（入：`readonly { tool: string; state: { status: string; output?: unknown } }[]`，文案函数由调用方注入 `t`（保持纯函数可测）· 出：两个纯函数；只用 `是信封工具键` + `解析工具输出`，不 `JSON.parse`；文案 `本轮回答查询 N 次 · 覆盖材料 M 份`、`已达 12 次上限，未覆盖项见工具卡缺口` 走 `ui.closingLine.*` · 文件 `packages/session-ui/src/components/closing-stats.ts` + `packages/ui/src/i18n/{zh,en}.ts` · 判据：T006 绿；拆掉 `是信封工具键` 过滤 ⇒ 图工具用例必须红并记录）

- [ ] T008 [US4] 实现 `ClosingLine` 组件 + 三态 story（入：`parts` prop，内部只渲染 `收尾行文本` · 出：组件与 `closing-line.stories.tsx`（0 次不渲染 / 2 缺口 / 12 次上限）· 文件 `packages/session-ui/src/components/closing-line.tsx` + `.../closing-line.stories.tsx` · 判据：`bun run dev:storybook` 打开三态，浏览器核对文案与可见性；DOM「不存在」按 `=== null` 判（`#013-12`））

- [ ] T009 [US4] 接线到助手消息尾部（入：`data.store.part?.[props.message.id]`（与 `message-part.tsx:1727` 同一取法）· 出：在既有 copy/meta 块内加 2–3 行 · 文件 `packages/session-ui/src/components/message-part.tsx` · 判据：`bun --cwd packages/session-ui run typecheck` 绿；`grep -n "ClosingLine" packages/session-ui/src/components/message-part.tsx` 只一处；渲染正确性由 T008 story 与 T016 真栈验）

**检查点**：US4 独立可验：真栈发一句带工具调用的问句，消息尾部出现收尾行。

---

## Phase 4: User Story 7 - 出错时，人能分清是参数错还是写盘失败（P2）

**Goal**：错误卡 = 错误码 + 原消息 + 一句逐字来自 `09` §8.3 的人话引导；未知码不伪造引导。

**Independent Test**：纯函数 9 码映射正确；storybook 里 `bad_input` / `write_failed` / 未知码三态文案不同且引导可见。

- [ ] T010 [US7] 写 9 码映射用例（红）（入：9 个字面码 + 1 个未知码 `"boom"` · 出：`错误码引导键("bad_input") === "ui.envelopeTool.errorHint.bad_input"` 等；未知码 `undefined` · 文件 `packages/session-ui/src/components/envelope-parse.test.ts`（追加）· 判据：新用例红）

- [ ] T011 [US7] 实现 `错误码引导键(码): string | undefined` + 9 条文案（绿）（入：`09` §8.3 逐字文案（`write_failed`=「写进去了但读不回来」）· 出：函数返回 i18n 键；`ui.envelopeTool.errorHint.*` zh/en 各 9 键 · 文件 `packages/session-ui/src/components/envelope-parse.ts` + `packages/ui/src/i18n/{zh,en}.ts` · 判据：T010 绿；`write_failed` 与 `bad_input` 的 zh 文案不同）

- [ ] T012 [US7] 在错误卡渲染引导行 + 扩 story（入：`错误 = 解析工具输出(文本)`；`write_failed` / `bad_input` / 未知码 / 非 JSON 文本四态 · 出：`错误码：X` + 消息 + 引导三行；未知码只两行；非 JSON 原样显示；`envelope-tool.stories.tsx` 增两态 · 文件 `packages/session-ui/src/components/envelope-tool.tsx` + `.../envelope-tool.stories.tsx` · 判据：`bun run dev:storybook` 浏览器核对；拆掉引导行 ⇒ story 里缺行，记入变异记录）

**检查点**：US7 独立可验：storybook 三态 + 真栈制造一次失败。

---

## Phase 5: User Story 6 - 民警从页面上直接开口（P2）

**Goal**：实体档案页出现「查个人 / 查个账户」两枚预填按钮，点击只替换输入框、不自动发送。

**Independent Test**：类型=人 显示「查个人」、类型=账户 显示「查个账户」、类型=地点 两枚都不显示；点击后 `订阅会话输入` 的间谍收到 `("替换", 整句)`。

- [ ] T013 [US6] 写入口按钮用例（红）（入：三态实体（人/账户/地点）· 出：失败用例；用 `订阅会话输入` 注册间谍，断言 `方式 === "替换"` 且整句含规范值；断言**没有**自动发送 · 文件 `packages/app/src/center/case-views/entity-profile.test.tsx`（追加）· 判据：`timeout 300 bun test src/center/case-views/entity-profile.test.tsx` 红）

- [ ] T014 [US6] 实现两枚入口按钮（绿）（入：`档().type`、`档().canonical_value`、`发到会话`（`ask-ai.ts:18`）· 出：按钮显示条件与预填句逐字（见 `contracts/ui-card-contract.md` §4；文案为拟定，评审后定稿） · 文件 `packages/app/src/center/case-views/entity-profile.tsx` · 判据：T013 绿；拆掉 `type` 条件 ⇒「地点不显示」用例红）

**检查点**：US6 独立可验：点按钮 → 输入框出现预填句，不自动发。

---

## Phase 6: Polish & 验收

- [ ] T015 跑仓库根门禁并记录实得输出（入：根目录 `bun run typecheck`、`bun run lint`，受影响包 `packages/opencode` / `packages/session-ui` / `packages/app` 的测试 · 出：命令与原始输出；与本轮无关的既有失败贴 `file:line` 标「既有」，我改的行上的失败必须修绿 · 判据：typecheck 全绿；lint 无本轮新增失败）

- [ ] T016 真栈手工验收并写缺口报告（入：`REAL_STACK_DB=remote bun packages/opencode/test/real-stack/serve.ts`（端口冲突改 `REAL_STACK_*_PORT`，不杀进程；真栈不热重载）· 出：走 `quickstart.md` §4 的 6 步，记录实际结果；缺口表列明真模型回放 / skill A/B / 时间窗起手 / 地点查询 · 判据：6 步全过才可宣称 MVP 完成；未过的写进缺口表）

---

## 明确不做的项（不生成任务）

| 项 | 依据 |
|---|---|
| US5 `资金研判` skill + A/B | plan MVP 边界：需真栈 + 真模型凭据，本机不可验 |
| 按地点取事件（维持 `能力未就绪`） | `09` §12 #5 单列，属数据侧新能力 |
| 「查一段时间」起手 | `grep 案件时间窗 packages/` 零命中，无数据源（research D5） |
| 20 题真模型回放 | 只有夹具回放；真模型需凭据 |

---

## Dependencies & Execution Order

### 阶段依赖

- Phase 1：T001 → T002（T002 依赖 T001 结果）
- Phase 2：依赖 Phase 1 缺口清单；T003/T004/T005 **互相独立**
- Phase 3：T006 → T007 → T008 → T009
- Phase 4：T010 → T011 → T012
- Phase 5：T013 → T014
- Phase 6：T015 → T016，依赖 Phase 3/4/5 完成

```text
T001 → T002 → T003 ┐
              T004 ├→ 验收证据
              T005 ┘

T006 → T007 → T008 → T009 ┐
T010 → T011 → T012        ├→ T015 → T016
T013 → T014               ┘
```

### 并行机会

- T003 / T004 / T005 可并行（不同测试文件）
- Phase 3（T006–T007）与 Phase 4（T010–T011）可并行（不同源文件）
- Phase 5（T013–T014）可与任一 Phase 并行
- T008 与 T012 都动 storybook，建议串行避免 story 文件冲突

---

## Implementation Strategy

### MVP First

1. Phase 1 + Phase 2（验收证据）
2. Phase 3（US4 收尾行——P1 且是唯一未落地的 P1 行为）
3. **STOP & VALIDATE**：US4 独立验收（storybook + 真栈）
4. 增量：Phase 4（US7）→ Phase 5（US6）→ Phase 6

### 纪律

- 纯函数先红后绿，红要贴**实得值**（`#003-03`）
- 每个新行为做一次变异（拆实现 ⇒ 对应用例/story 红），成对拆（`#005-37`）
- session-ui **不要**新建 `.test.tsx`（无基建）；组件验收走 storybook
- 门禁在仓库根；`bun test` 在受影响包内；跑测试加 `timeout`
- Phase 2 只补断言、不改实现；发现不符 ⇒ 停，报根因

---

## 验收映射表（T002 产出）

> 由 T002 填写；每条 FR 一行，用例列写「文件名 + 用例名」，无覆盖写「缺口 + 原因」。

| FR | 用例（文件::用例） | 状态 |
|---|---|---|
| FR-001 | （T002 填） | |
| … | | |
