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

> 生成于 2026-11-17（T002）。用例名逐条取自 `packages/opencode/test/server/` 实际文件；
> 标记「缺口」的行写明缺哪条断言。统计：覆盖 27 条 / 缺口 15 条（共 42 条）。
> 备注：`openhive-case-explore-seed.test.ts`、`openhive-case-identity-resolve.test.ts`、
> `openhive-case-row-query.test.ts`、`case-hgraph-tools.test.ts` 用例存在且可跑，但不在 T001 的 15 份点名文件内。

| FR | 用例（文件::用例） | 状态 |
|---|---|---|
| FR-001 | `openhive-case-mcp-server.test.ts::tools/list 返回 19 个工具，名字与设计 §7.1 + T012 的 5 个图工具逐字一致`；`openhive-case-mcp-tools.test.ts::所有工具返回的 下一步 / 出处.可下钻 都指向已注册的工具名`（14 个信封工具真实返回 + 七字段守卫）；`case-hgraph-tools.test.ts::图工具不套七字段信封：graph_list 原样返回 { 图 }（不折成 tool_failed）` | 覆盖 |
| FR-002 | `openhive-case-mcp-envelope.test.ts::缺 摘要 ⇒ tool_failed（非工具错误，且不回显原文）`；`::缺 缺口 ⇒ tool_failed（缺字段）`；`::接线：缺 口径 的工具结果在 ④ 折成 tool_failed，且不回显违约原文` | 覆盖 |
| FR-003 | `openhive-case-mcp-envelope.test.ts::空原因 非 null 但 数据 非空 ⇒ tool_failed（正向镜像）`；`::数据 为空但 空原因 为 null ⇒ tool_failed（反向镜像）`；`openhive-case-mcp-rows.test.ts::query_rows 镜像不变式：数据非空 ⇔ 空原因 null（数组型）` | 覆盖 |
| FR-004 | `openhive-case-mcp-envelope.test.ts::空原因 不在枚举里 ⇒ tool_failed`；16 值字面分布在 `openhive-case-explore.test.ts`（无此实体/实体存在但无任何事实/材料未解析）、`openhive-case-empty-reason.test.ts`（资金四类）、`openhive-case-timeline.test.ts`（无事件/对象未登记/时间全部缺失）、`openhive-case-mcp-rows.test.ts`（材料未入库/该材料未解析/无匹配行）、`openhive-case-mcp-tools.test.ts`（能力未就绪/用途未结构化） | 覆盖 |
| FR-005 | 缺口：无「一次返回只报一个、多个成立按总表取第一个、其余进缺口」的用例。仅有零散归属正反例：`openhive-case-empty-reason.test.ts::账户查关系查不到 ⇒ 兜底无匹配行（不冒充「没有交易」或「未出现」）`、`openhive-case-timeline.test.ts::对象存在但没有任何事件 ⇒ 对象未登记` | 缺口 |
| FR-006 | `openhive-case-mcp-tools.test.ts::超上限截到 200 并在缺口里说清`；`::限制非整数 / 0 / 负数 ⇒ bad_input`；`::实得行数等于限制时缺口说「可能还有更多」` | 覆盖 |
| FR-007 | `openhive-case-mcp-envelope.test.ts::数据 是 31 KB 数组 ⇒ 从尾部截断到 ≤ 30 KB、至少留 1 条、缺口写明截掉几条`；`::30 KB 按 Buffer.byteLength 算，不按字符数（中文 1 字符 3 字节）`；`::两条各约 20 KB（合计 > 30 KB）⇒ 只留 1 条、缺口写明截掉 1 条与摘要口径` | 覆盖 |
| FR-008 | `openhive-case-mcp-envelope.test.ts::单条元素自身 > 30 KB ⇒ 原样留下同一条，但必须追加「无法按条截断」缺口`；`::多条数组里首条自身 > 30 KB ⇒ 原样返回同一引用，缺口说「首条记录自身即超限」`；`::非数组 数据 超预算（find_crossings 形状 ~50 KB）⇒ 不截，但缺口必须写明「数据非数组」` | 覆盖 |
| FR-009 | `openhive-case-mcp-tools.test.ts::query_rows 大页按 30 KB 字节预算自限：摘要行数与数据一致、续页不漏行` | 覆盖 |
| FR-010 | `openhive-case-mcp-server.test.ts::未列出的参数 ⇒ bad_input，message 列出可用参数`；`openhive-case-mcp-rows.test.ts::query_rows 传「备注关键词」⇒ bad_input（白名单 fail-closed，走真 MCP 握手）`；`case-hgraph-tools.test.ts::graph_list 也走 收参数：不认识的参数 ⇒ bad_input` | 覆盖 |
| FR-011 | `openhive-case-explore.test.ts::B：档案 + 关系圈 + 事件 + 全量计数`；`::跳数=2：附 1～2 跳邻域`；`::限制只管事件条数：真截断才写缺口，并写实际交付条数` | 覆盖 |
| FR-012 | `openhive-case-explore.test.ts::无此实体：空原因 + 引导，不抛错`；`::项目里有未解析材料 ⇒ 材料未解析（不是无此实体）`；`::实体存在但无任何事实` | 覆盖 |
| FR-013 | `openhive-case-mcp-tools.test.ts::解析实体：同值「人/组织」两行 ⇒ 取后建的组织行，关系也取得到`；`::query_relations：按值查询合并同值多行的关系（旧/新行各挂一条）`；`openhive-case-identity-resolve.test.ts::aggregate_money 遇到多账户户名 ⇒ 同一 fail-closed（bad_input），不在聚合层挑一个` | 覆盖 |
| FR-014 | `openhive-case-money-flow.test.ts::B：入 3 笔 35000、收支分列、首末、对手排行（含首末）、单笔最大、集中度`；`::人说的笔随方向透传；摘要报笔数；人说的笔不进单笔榜`；`::C2 对手过滤作用于汇总`（「条数」参数无专项用例，由分发层白名单统一拒） | 覆盖 |
| FR-015 | `openhive-case-empty-reason.test.ts::第 1 条：账户有持有证据、窗内 0 笔转账 ⇒ 确实没有交易`；`::第 2/3/4 条` 各一条；`::全外币：空原因=外币行全部未计入、数据 null、缺口写外币行数、摘要不否认流水` | 覆盖 |
| FR-016 | `openhive-case-money-flow.test.ts::与 aggregate_money 逐数相等（汇总 / 首末 / 对手方 / 外币行数同一口径）`；`::人说的笔与 aggregate_money 逐行相等（同一口径，不另算一份）` | 覆盖 |
| FR-017 | 缺口：升序/游标/都不给 bad_input 有断言（`openhive-case-timeline.test.ts::第一页：时间升序、缺时间条数、续页游标`、`::游标翻页：三笔有时间事件，第二页仍有游标、第三页归 null`、`::实体与地点都不给 ⇒ bad_input`），但无「实体+地点双给 ⇒ bad_input」与「拒绝 offset」的用例 | 缺口 |
| FR-018 | `openhive-case-timeline.test.ts::地点分支先拒答：能力未就绪，不返回空`；`::对象存在但事件全无时间 ⇒ 时间全部缺失`；`::对象存在但没有任何事件 ⇒ 对象未登记`；`::窗口内没有事件但对象有历史事件 ⇒ 无事件` | 覆盖 |
| FR-019 | `openhive-case-mcp-rows.test.ts::query_rows 按材料 + 时间窗取明细，七字段齐全`（数据为行数组）；`::query_rows 游标翻页 ⇒ 第二页接上、无重复无遗漏`（游标只在下一步）；`openhive-case-row-query.test.ts::自造游标 ⇒ 明细入参错误` | 覆盖 |
| FR-020 | `openhive-case-mcp-rows.test.ts::query_rows 指定不存在的材料 ⇒ 空原因=材料未入库`；`::query_rows 材料未解析 ⇒ 空原因=该材料未解析`；`::query_rows 条件无命中 ⇒ 空原因=无匹配行`；`::query_rows 不指定材料且项目零明细 ⇒ 无匹配行，缺口写明项目没有任何明细`；`::query_rows 传「备注关键词」⇒ bad_input` | 覆盖 |
| FR-021 | `openhive-case-explore-replay.test.ts::[工具层] query_rows 账户只有外币行 ⇒ 空原因=外币行全部未计入、数据为空`；`::[工具层] query_rows 外币行分页：本页全外币也不算「全部未计入」`；`openhive-case-empty-reason.test.ts::混合币种：外币行数=2、余额走势只数人民币行（5 行）、缺口写明未计入` | 覆盖 |
| FR-022 | 缺口：`openhive-case-mcp-server.test.ts::握手后 getInstructions() 逐条含八条纪律的检索关键词，且 1..8 编号都在` 只断言 8 条编号且显式断言「无第 9 条」；`09` 的「时间线优先」在实现里写成 `2b`（`case-mcp-server.ts:174`），没有任何用例断言它 | 缺口 |
| FR-023 | 缺口：第 12 次注入、分发前计数、窗口重置、身份隔离均有断言（`openhive-case-mcp-server.test.ts::第 12 次工具调用起…`、`::计数在分发前：中间一次 bad_input 也占号…`、`::空闲超过窗口后重新计数…`、`::计数按 (userId, projectId) 隔离…`），但无「未知工具名不计数」的用例 | 缺口 |
| FR-024 | `case-hgraph-tools.test.ts::第 12 次起图工具也带预算上限缺口（与查库工具同一预算出口，不套七字段信封）`（断言 `预算上限缺口` 显式字段） | 覆盖 |
| FR-025 | 缺口：`openhive-case-mcp-server.test.ts::握手后 getInstructions()…` 断言「30 秒」「没有任何服务端闸」，但「已达查询上限，以下未覆盖：…」属回答层收尾行（T008/T009 未落地），`test/server/` 下无对应用例 | 缺口 |
| FR-026 | 缺口：`test/server/` 下无「skill 作为全局资产发布到 `skills.paths`、不在仓库 `.opencode/skills/`」的用例；`grep -rl 资金研判` 仅命中 `packages/app/src/ai-session/capability-pipeline.test.tsx` 的分组名，不验资产位置 | 缺口 |
| FR-027 | 缺口：无 skill 正文用例（只引用工具名、无 SQL、不复制返回结构、不重复全局纪律）；资产本体不在本仓库，`test/server/` 无可断言对象 | 缺口 |
| FR-028 | 缺口：资金 4 条固定问题的 A/B 结果属真栈 + 真模型人工验收，`test/server/` 下无自动用例（tasks.md「明确不做的项」亦已列明） | 缺口 |
| FR-035 | `openhive-case-mcp-tools.test.ts::一级与二级都能过滤，返回里带 purpose 与依据`；`::不认识的用途 fail-closed，并列出可用类`；`::用途传空串也 fail-closed，不能静默返回全量事件`；`::用途为空且全项目都没判过 ⇒ 空原因「用途未结构化」` | 覆盖 |
| FR-036 | `openhive-case-mcp-template-filter.test.ts::query_events：默认隐藏未验证；含未验证=true 放行`；`::query_timeline：默认隐藏；含未验证=true 放行；统计口径一致`；`::query_timeline 统计侧：唯一事件是未验证卡 ⇒ 默认是「对象未登记」而不是「无事件」`；`::用途补判计数也过滤未验证`；`::可见条件每次直读库：转正后可见，清 verified_at 立即隐藏`；`::explore_entity / money_flow` 各一条 | 覆盖 |
| FR-037 | `openhive-case-empty-reason.test.ts::全外币：空原因=外币行全部未计入、数据 null、缺口写外币行数`；`::混合币种：外币行数=2、余额走势只数人民币行（5 行）、缺口写明未计入`；`openhive-case-ingest-translate.test.ts::非人民币卡片单独计数，且币种按行落库`（认不出的币种不当人民币） | 覆盖 |
| FR-038 | 缺口：无「按属性找实体不支持、且回答不把不支持说成没有」的用例；`query_entities` 关键词只匹配规范值/别名的描述与行为均无用例钉住 | 缺口 |
| FR-039 | 缺口：无「回答把去解析/去检查材料放最显眼处、过程卡标明『这是数据没到位』」的用例；工具侧仅有摘要否定句防护（`openhive-case-empty-reason.test.ts::全外币…摘要不否认流水`）与下一步指向 `query_entities`（`openhive-case-explore.test.ts::无此实体：空原因 + 引导`） | 缺口 |
| FR-040 | `openhive-case-mcp-server.test.ts::不带 _meta 调用 ⇒ isError + identity_required`；`::是身份但不是项目成员 ⇒ not_a_member`；`::未知工具名 + 不带 _meta ⇒ identity_required（身份门先于判名字）`；`::未知工具名 + 是身份但非成员 ⇒ not_a_member（成员门先于判名字）`；`::数据源档案写工具：普通成员 ⇒ forbidden` | 覆盖 |
| FR-041 | `openhive-case-mcp-server.test.ts::数据源档案写工具：普通成员 ⇒ forbidden（build / revoke），list 仍允许`；`case-hgraph-tools.test.ts::普通成员带不存在路径调 graph_add ⇒ forbidden（授权先于「图在不在」）`；`::普通成员可以 graph_read（读工具不受属主门影响）` | 覆盖 |
| FR-042 | 缺口：`openhive-case-mcp-server.test.ts::每次调用（成功与失败各一次）都出一条留痕` 只断言 `userId/projectId/工具/ok/错误码/错误原文`，未断言 `耗时毫秒` 与「不落业务值」；明文备注另由 `openhive-case-mcp-tools.test.ts::get_citation 明细行：材料定位取材料的项目内路径，extras 备注原样回显` 覆盖 | 缺口 |
| FR-043 | `openhive-case-explore-replay.test.ts` 的 20 个固定问题用例（5 组 × 4，期望表驱动，含 `案件里叫张三的有几个`）；`openhive-case-explore-seed.test.ts::探索数据集 seed（09 §13.1）` 断言数据集内容；数据集经 `enqueueMaterial → claimNextJob → runJob` 生产出口种下（`test/fixtures/explore/dataset.ts`） | 覆盖 |
| FR-044 | 缺口：无「平均工具调用数 ≤ 8」「p95 ≤ 30 秒」「资金汇总与人工核算完全一致」的用例；replay 只断言固定调用序列长度与字段值，文件头注明这些指标仍在 §13.5 缺口 | 缺口 |
| FR-045 | `test/fixtures/explore/cases.ts` 的「案件里叫张三的有几个」+ `openhive-case-explore-replay.test.ts::[人] 案件里叫张三的有几个`：不断人数，只钉按全名命中的实体（`数据.length` 作漂移守卫） | 覆盖 |
| FR-046 | 缺口：变异验证是过程证据（拆实现看红），`test/server/` 下无对应用例；本仓库的变异记录只在实现报告/LEARNINGS 中，未落成测试 | 缺口 |
| FR-047 | 缺口：三层中只有工具层单测（本表各行）；真栈回放无自动化用例（`test/real-stack/` 仅有 `serve.ts`），数字一致性（复用 `01` 的 A4）未在本 feature 用例中落地 | 缺口 |
| FR-048 | 缺口：缺口表属验收文档，`test/server/` 下无用例；本报告「缺口逐条列表」即为该条要求的人工产物 | 缺口 |
