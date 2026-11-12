# 事实卡片 · 工具层七字段信封与 `query_rows` 挂载 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `09` 的七字段信封落到 MCP 工具层，并把已验收的内核读函数 `查明细行` 挂成模型可调用的 `query_rows`；顺带把追查纪律写进 `instructions`、把 12 次预算做成服务端硬约束。

**Architecture:** 七字段（`摘要 / 数据 / 口径 / 缺口 / 空原因 / 出处 / 下一步`）由**每个工具自己产出**，`case-mcp-server.ts` 只做三件事：七字段齐全校验、`空原因` ↔ `数据` 双向镜像校验、30 KB 确定性截断。工具层不新增数据表、不做 SQL 语义变更——`query_rows` 只是把 `01` P1 已验收的 `查明细行`（`case-row-query.ts`）包一层入参校验与七字段映射。

**Tech Stack:** Bun 1.4.x · TypeScript 5.8 · `@modelcontextprotocol/sdk`（`Server` / `CallToolRequestSchema`）· Drizzle/`Queryable` · PGlite（测试）· bun:test

**Spec:** `docs/superpowers/specs/2026-11-09-事实卡片抽象/09-AI探索与MCP工具-设计.md`（§3 信封、§4.4 `query_rows` 契约、§5 纪律与预算、§8.3 错误映射、§12 落点清单 P1 行）

**前置：** `01` P1（`2026-11-12-事实卡片-P1-明细行索引与查询.md`）已完成，`case-row-query.ts` 导出 `查明细行` / `明细入参错误` / `明细查询结果` / `明细行视图`。

---

## 本期范围裁定（2026-11-12，用户拍板）

| 做 | 不做（留下一期） |
|---|---|
| 七字段类型 + 7 个现有工具逐个补 `摘要/空原因/出处/下一步` | 前端工具卡（`session-ui/.../envelope-tool.tsx`，§12 #9） |
| `query_rows` 挂载（描述 + 分发 + 七字段映射） | 20 条问题期望表 fixture（§12 #12） |
| server 硬校验：齐全 / 双向镜像 / 30 KB 截断（§3.4） | `explore_entity` / `money_flow` / `query_timeline` 三个原语（P2 / P3） |
| `instructions` 纪律正文 + 12 次预算硬约束（§5.3 / §5.4） | 30 秒计时（v1 明确不做，§5.4） |
| 三份现有 MCP 用例对齐 + 新建信封用例 + `query_rows` 用例 | 工具授权闸（§10，沿用现状缺口） |
| `09` §3.5 归属列回写 | 图写入工具（走「改文件」通道，不套信封，§3.1） |

**`空原因` 归属的裁定**：`无匹配行` 的归属由「`query_rows`」扩为「原子工具 + `query_rows` 通用的『条件无命中』」。不新增枚举值、不动枚举顺序（顺序即优先级，动了就影响「多原因取第一个」）。

---

## Global Constraints

- **R1 明文**：工具返回不掩码、不脱敏；账号 / 证件号 / 手机号 / 姓名 / 金额原样返回（`09` §10）。
- **R2 七字段由工具写**：`case-mcp-server.ts` **不许**按工具名拼摘要、不许补字段。它只校验与截断（`09` §3.2）。
- **R3 `口径` / `缺口` 必填**：`缺口` 无缺口给 `[]`，不给 `undefined`；`口径` 必是字符串。
- **R4 空原因只报一个**：多个同时成立按 `09` §3.5 表序取第一个，其余进 `缺口`。
- **R5 「空」的定义（本期新定，实现依据）**：`数据` 为 `null` ⇔ 空；长度为 0 的数组也算空。**对象型数据永不返回空对象**——`aggregate_money` / `find_crossings` 在无命中时返回 `数据: null`。镜像校验按这一条判，别各写一套。
- **R6 上限与截断**：`限制` 默认 50、上限 200，超出按 200 截断并写 `缺口`；`Buffer.byteLength(JSON.stringify(数据))` > 30720 时，`数据` 为数组则**从尾部**截到 ≤ 30720 且至少留 1 条，截掉条数写 `缺口`。
- **R7 参数白名单**：任何新入参必须同时进 `收参数` 的白名单数组（`case-mcp-server.ts:233`）；未列出的键 ⇒ `bad_input`，不静默忽略。
- **R8 `下一步` 只写本期已注册的工具名**：`explore_entity` / `money_flow` / `query_timeline` 尚未落地，`下一步` 里**不许**出现它们，否则模型会调不存在的工具。
- **R9 不新增数据表、不改既有 SQL 语义**：本期只改返回形状与校验层。
- **R10 测试纪律**：只跑受影响 package 内的具名文件；仓库根 `bun test` 禁止（脚本 `exit 1`）。所有命令带 `timeout 300`，退出码 124 = BLOCKED，不自动重跑。
- **R11 不谎称**：变异没跑或跑不动就写「没跑」；lint 的既有基线 error（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`）不算本计划失败，判据是改动文件上无新增 error。

---

## 文件结构

| 文件 | 本期职责 |
|---|---|
| `packages/opencode/src/server/openhive/case-envelope.ts` | 信封公共件：`默认限制` / `最大限制` / `空原因枚举` / `空原因值` / `出处项` / **新增** `下一步项` / **新增** `数据为空()` |
| `packages/opencode/src/server/openhive/case-mcp-tools.ts` | `工具结果` 扩七字段；7 个现有工具补字段；**新增** `query_rows` |
| `packages/opencode/src/server/openhive/case-mcp-server.ts` | `工具名` + 描述 + 分发表加 `query_rows`；七字段齐全校验；双向镜像；30 KB 截断；`instructions`；预算计数 |
| `packages/opencode/test/server/openhive-case-mcp-tools.test.ts` | 现有 44 条对齐七字段 |
| `packages/opencode/test/server/openhive-case-mcp-server.test.ts` | 现有 11 条对齐 |
| `packages/opencode/test/server/openhive-case-mcp-http.test.ts` | 现有 4 条对齐 |
| `packages/opencode/test/server/openhive-case-mcp-envelope.test.ts` | **新建**：齐全 / 双向镜像 / 30 KB 截断 / 上限 |
| `packages/opencode/test/server/openhive-case-mcp-rows.test.ts` | **新建**：`query_rows` 端到端（含 `明细入参错误` → `bad_input`） |

---

### Task 1: 七字段类型 + 7 个现有工具补字段

**Files:**
- Modify: `packages/opencode/src/server/openhive/case-envelope.ts`
- Modify: `packages/opencode/src/server/openhive/case-mcp-tools.ts`
- Test: `packages/opencode/test/server/openhive-case-mcp-tools.test.ts`

**Interfaces:**
- Consumes: `08`/`09` 的信封契约；既有 7 个工具的 `数据` 形状（不动）。
- Produces: `工具结果` 七字段（后续 Task 2/3 都依赖）；`下一步项`；`OpenhiveCaseEnvelope.数据为空`。

- [ ] **Step 1: 先在 `case-envelope.ts` 加两个公共件**

```ts
/** 一条「下一步」建议：给工具、给参数、给一句人话理由。**不自动执行**（`09` §3.2）。 */
export interface 下一步项 {
  readonly 工具: string
  readonly 参数: Record<string, unknown>
  readonly 为什么: string
}

/**
 * 「空」的唯一定义（`09` §3.4 双向镜像的依据）。
 *
 * `null` 与「长度为 0 的数组」算空；**对象不算空**——所以对象型结果（`aggregate_money`
 * / `find_crossings`）在无命中时**必须返回 `null`**，不许返回一个全是空数组的对象。
 * 这条写在一处，server 校验与工具实现都引用它（`#002-06`：同一判据别开第二个出处）。
 */
export function 数据为空(数据: unknown): boolean {
  if (数据 === null || 数据 === undefined) return true
  return Array.isArray(数据) && 数据.length === 0
}
```

- [ ] **Step 2: 把 `工具结果` 改成七字段（`case-mcp-tools.ts:24-30`）**

```ts
export interface 工具结果 {
  /** 人话，不是数据复述。民警在会话里看到的是这一行（`09` §3.2）。 */
  readonly 摘要: string
  readonly 数据: unknown
  /** 这次取数用了哪些列、按什么过滤。必填。 */
  readonly 口径: string
  /** 这次没覆盖到的（如实说）。无缺口给 `[]`。必填。 */
  readonly 缺口: readonly string[]
  /** 有数据时为 `null`；无数据时必须是 `空原因枚举` 里的值。 */
  readonly 空原因: 空原因值 | null
  /** 只放能支撑 `摘要` 里那些数字的代表行。 */
  readonly 出处: readonly 出处项[]
  /** 建议，不自动执行。 */
  readonly 下一步: readonly 下一步项[]
}
```

`case-mcp-tools.ts` 顶部 import 补 `type 空原因值, type 出处项, type 下一步项, 数据为空`（从 `./case-envelope`）。

> 这一步之后 `bun run typecheck` 会红 7 处（7 个工具的 `return` 缺字段）——**这是预期的红**，Step 3–9 逐个补齐。

> **关于下面代码块里的局部变量名**：`材料们` / `实体们` / `关系们` / `事件们` / `共同关联` / `共同时空` 是**占位名**——按你文件里该函数 `return` 前的**实际变量名**替换，`数据` 一项仍然返回原来那个值，语义不许变。改之前先看一遍该函数的 return 上下文，别把占位名抄进代码。

- [ ] **Step 3: `search_materials`（`:119`，return `:147`）**

```ts
  const 空 = 数据为空(材料们)
  return {
    摘要: 空
      ? `没有材料命中${args.关键词 ? `「${args.关键词}」` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `命中 ${材料们.length} 份材料${args.关键词 ? `（关键词「${args.关键词}」）` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`,
    数据: 材料们,
    口径: /* 原字面量不动 */,
    缺口: 原缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 材料们.slice(0, 3).map((行) => ({
      事实: `命中材料「${String(行.file_name)}」`,
      代表: String(行.id),
      可下钻: "query_rows",
    })),
    下一步: 空
      ? [{ 工具: "query_entities", 参数: {}, 为什么: "换个说法或按实体名再找；材料名搜不到时实体往往还在" }]
      : [{ 工具: "query_rows", 参数: { 材料: String(材料们[0]!.id) }, 为什么: "看这份材料里的明细行" }],
  }
```

- [ ] **Step 4: `query_entities`（`:154`，return `:186`）**

```ts
  const 空 = 数据为空(实体们)
  return {
    摘要: 空
      ? `没有实体匹配${args.关键词 ? `「${args.关键词}」` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `找到 ${实体们.length} 个实体${args.类型 ? `（类型=${args.类型}）` : ""}，首个是「${String(实体们[0]!.canonical_value)}」`,
    数据: 实体们,
    口径: /* 原字面量不动 */,
    缺口: 原缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 实体们.slice(0, 3).map((行) => ({
      事实: `实体「${String(行.canonical_value)}」`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    下一步: 空
      ? [{ 工具: "search_materials", 参数: {}, 为什么: "按材料名或正文片段找；实体可能还没从材料里抽出来" }]
      : [{ 工具: "query_relations", 参数: { 实体: String(实体们[0]!.canonical_value) }, 为什么: "看它与谁有关系" }],
  }
```

- [ ] **Step 5: `query_relations`（`:274`，return `:324`）**

```ts
  const 空 = 数据为空(关系们)
  const 对方数 = new Set(关系们.flatMap((行) => [String(行.from_id), String(行.to_id)])).size
  return {
    摘要: 空
      ? `没有关系命中${args.实体 ? `（实体「${args.实体}」）` : ""}`
      : `${关系们.length} 条关系${args.实体 ? `（实体「${args.实体}」）` : ""}，涉及 ${对方数} 个端点`,
    数据: 关系们,
    口径: /* 原字面量不动 */,
    缺口: 原缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 关系们.slice(0, 3).map((行) => ({
      // `times` 可为 null：照 `String(null)` 会渲染成「null 次」，模型会照抄进回答（2026-11-12 复审更正）
      事实: `关系 ${String(行.from_value)}→${String(行.to_value)}，${行.times == null ? "次数未知" : `${String(行.times)} 次`}`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    // 目标工具有必填参数 ⇒ `参数` 必须给齐，否则模型照抄必失败（2026-11-12 复审更正）
    下一步: 空
      ? []
      : [{ 工具: "aggregate_money", 参数: { 账户: String(关系们[0]!.from_value) }, 为什么: "转账关系可进一步按账户汇总进出金额" }],
  }
```

- [ ] **Step 6: `query_events`（`:336`，return `:385`）**

```ts
  const 空 = 数据为空(事件们)
  return {
    摘要: 空
      ? `时间窗内没有事件${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `${事件们.length} 个事件${args.类型 ? `（类型=${args.类型}）` : ""}，最近一个是「${String(事件们[0]!.summary ?? 事件们[0]!.type)}」`,
    // ↑ 取 `[0]` 不是 `[length-1]`：SQL 是 `occurred_at desc`，末条是最早的（2026-11-12 实测更正）。
    数据: 事件们,
    口径: /* 原字面量不动 */,
    缺口: 原缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 事件们.slice(0, 3).map((行) => ({
      事实: `事件「${String(行.type)}」@${String(行.occurred_raw ?? 行.occurred_at ?? "时间缺失")}`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    // 空数据时没有事件可抽验 ⇒ 不给建议；给了就是逼模型调一个必失败的工具
    下一步: 空
      ? []
      : [{ 工具: "get_citation", 参数: { 事实类型: "event", 事实id: String(事件们[0]!.id) }, 为什么: "抽验一条事件的原文与出处" }],
  }
```

- [ ] **Step 7: `get_citation`（两个 return：`:445` row 分支、`:483` 其它分支）**

```ts
// row 分支（`:445`）——`数据` 永不为空（查不到抛 not_found），故 空原因 恒 null
  return {
    摘要: `明细行原文：${材料}#${工作表}#${行号}`,
    数据: { 明细行: 行, 引用: 引用们 },
    口径: /* 原字面量不动 */,
    缺口: 原有条件缺口,
    空原因: null,
    出处: [{ 事实: `明细行定位 ${材料}#${工作表}#${行号}`, 代表: `${材料}#${工作表}#${行号}`, 可下钻: null }],
    下一步: [{ 工具: "query_rows", 参数: { 材料 }, 为什么: "在同一份材料里按时间或账户继续翻明细" }],
  }

// 其它分支（`:483`）
  return {
    摘要: `${args.事实类型} 引用详情：${args.事实id}`,
    数据: { 事实, 引用, 变更历史 },
    口径: /* 原字面量不动；本分支原本没有 缺口，补 [] */,
    缺口: [],
    空原因: null,
    出处: [{ 事实: `${args.事实类型} ${args.事实id}`, 代表: args.事实id, 可下钻: null }],
    下一步: [],
  }
```

> 非 row 分支原本**没有** `缺口`：本期补 `[]`（R3）。若该分支确实存在「引用为 0 条」的情形，`缺口` 写「该事实暂无引用记录」，**不写** `空原因`（`数据` 非空，镜像校验不允许）。

- [ ] **Step 8: `aggregate_money`（`:507`，return `:639`）**

```ts
  // R5：对象不算空 ⇒ 无命中时返回 `数据: null`
  const 空 = 汇总.length === 0 && 对手方.length === 0 && 余额走势 === null
  // `对手方` 按「对手方 + 方向」分组 ⇒ 行数不是对手数，同名会重复（2026-11-12 复审更正）
  const 对手个数 = new Set(对手方.map((行) => String(行.对手方))).size
  return {
    摘要: 空
      ? `「${args.账户}」在给定条件下没有任何转账关系或明细流水`
      : `「${args.账户}」${汇总.map((行) => `${行.方向} ${行.笔数} 笔 / ${行.合计} 元`).join("，") || "无转账关系"}；${对手个数} 个对手${余额走势 ? `；明细 ${余额走势.行数} 行` : "；无明细流水"}`,
    数据: 空 ? null : { 汇总, 对手方, 余额走势 },
    口径: /* 原字面量不动 */,
    缺口: 空 ? [...缺口, "汇总、对手方、余额走势三者都为空：该账户在时间窗内既无转账关系也无明细流水"] : 缺口,
    空原因: 空 ? "无匹配行" : null,
    // `代表` 这里是**下钻入参**（账户规范值），不是事实 id——`aggregate_money` 的结果没有单一事实可指
    出处: 空
      ? []
      : [{ 事实: `账户「${账户.value}」的转账汇总`, 代表: 账户.value, 可下钻: "query_rows" }],
    下一步: 空
      ? [{ 工具: "query_entities", 参数: { 关键词: args.账户 }, 为什么: "确认这个账户在实体里到底叫什么规范值" }]
      : [{ 工具: "query_rows", 参数: { 账户: 账户.value }, 为什么: "看构成汇总的逐笔明细" }],
  }
```

- [ ] **Step 9: `find_crossings`（`:660`，return `:750`）**

```ts
  const 空 = 共同关联.length === 0 && 共同时空.length === 0
  return {
    摘要: 空
      ? `「${args.甲}」与「${args.乙}」没有共同关联，也没有共同时空`
      : `「${args.甲}」与「${args.乙}」共同关联 ${共同关联.length} 个、共同时空 ${共同时空.length} 条`,
    数据: 空 ? null : { 共同关联, 共同时空 },
    口径: /* 原字面量不动 */,
    缺口: 空 ? [...缺口, "共同关联与共同时空都为空：两侧在时间窗内没有可求交的边或事件"] : 缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 空
      ? []
      : [{ 事实: `「${args.甲}」与「${args.乙}」的交叉`, 代表: String(甲的id), 可下钻: "get_citation" }],
    下一步: 空
      ? [{ 工具: "query_relations", 参数: { 实体: args.甲 }, 为什么: "先看这一侧自己的关系，确认边是否已抽出来" }]
      : [{ 工具: "query_events", 参数: {}, 为什么: "共同时空往往是通话或同行，可按时间窗查事件" }],
  }
```

- [ ] **Step 10: 补用例（`openhive-case-mcp-tools.test.ts`）**

每个工具两条：**有数据**一条、**空数据**一条。断言至少包含（防止被默认值满足，`#005-47`）：

```ts
  // 有数据：摘要里出现具体数字，空原因必须为 null
  expect(结果.摘要).toContain("命中")
  expect(结果.空原因).toBeNull()
  expect(结果.出处.length).toBeGreaterThan(0)
  // `下一步` 只断言 length > 0 抓不住「参数给空」——必须断言工具名，目标工具有必填项时还要断言参数键
  expect(结果.下一步[0]?.工具).toBe("query_entities")
  expect(结果.下一步[0]?.参数).toHaveProperty("关键词")

  // 空数据：空原因必须落在枚举里且为「无匹配行」，数据为空，出处为空
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toBeNull()            // 对象型工具；数组型用 toEqual([])
  expect(结果.出处).toEqual([])
  // 缺口：对象型两工具（aggregate_money / find_crossings）必须追加一句「三者都为空」⇒ 非空；
  // 4 个列表型原子工具的缺口只有截断提示，空结果时就是合法空数组——**不要**给它们也断言非空。
  // （2026-11-12 更正：原计划一律要求缺口非空，列表型工具没有可写的内容，写满就是编造。）
```

- [ ] **Step 11: 跑**

```bash
cd packages/opencode && timeout 300 bun test test/server/openhive-case-mcp-tools.test.ts
```

预期：全绿。既有 44 条里凡断言 `缺口?.join()` 的地方，`缺口` 现在必填，`?.` 可删可留（留着不报错，但**不许**为了绿而改断言口径）。

- [ ] **Step 12: 提交**

```bash
git add packages/opencode/src/server/openhive/case-envelope.ts \
        packages/opencode/src/server/openhive/case-mcp-tools.ts \
        packages/opencode/test/server/openhive-case-mcp-tools.test.ts
git commit -F <消息文件>
```

消息：`feat(事实卡片): 工具层七字段信封落地，7 个原子工具补摘要/空原因/出处/下一步（09 §3.2-3.5，参考 #002-06 #005-47）`

---

### Task 2: `query_rows` 挂载

**Files:**
- Modify: `packages/opencode/src/server/openhive/case-mcp-tools.ts`
- Modify: `packages/opencode/src/server/openhive/case-mcp-server.ts`（`工具名`、`TOOLS`、`分发表`）
- Test: `packages/opencode/test/server/openhive-case-mcp-rows.test.ts`（新建）

**Interfaces:**
- Consumes: `查明细行(db, { projectId, 材料?, 账户?, 方向?, 金额起?, 金额止?, 时间起?, 时间止?, 游标?, 限制? })`、`明细入参错误`、`明细查询结果`（`01` P1）。
- Produces: 工具名 `"query_rows"`；入参九项（无「备注关键词」）。

- [ ] **Step 1: 写用例（先红）**

新建文件，复用 `openhive-case-mcp-tools.test.ts` 的夹具搭法（PGlite + `migrate()` + 直接 `ctx.db`）。至少 8 条：

```ts
test("query_rows 按材料 + 时间窗取明细，七字段齐全", async () => { /* 断言 摘要/数据.行们/口径/缺口/空原因=null/出处/下一步 */ })
test("query_rows 不传材料、项目有明细 ⇒ 跨材料取，口径写清", async () => {})
test("query_rows 指定不存在的材料 ⇒ 空原因=材料未入库，数据为空，缺口非空", async () => {})
test("query_rows 材料未解析 ⇒ 空原因=该材料未解析", async () => {})
test("query_rows 条件无命中 ⇒ 空原因=无匹配行", async () => {})
test("query_rows 传「备注关键词」⇒ bad_input（白名单 fail-closed）", async () => {})
test("query_rows 反向金额区间 ⇒ bad_input（不是空结果）", async () => {})
test("query_rows 游标翻页 ⇒ 第二页接上、无重复无遗漏", async () => {})
```

- [ ] **Step 2: 跑，确认红**

```bash
cd packages/opencode && timeout 300 bun test test/server/openhive-case-mcp-rows.test.ts
```

预期红：`工具名` 里没有 `query_rows`，调用返回 `bad_input`。

- [ ] **Step 3: 工具函数**

```ts
/**
 * 明细回溯（`09` §4.4）。只读 `case_fact_row`，不写 `case_citation`。
 *
 * 契约唯一来源是 `09` §4.4；入参校验与分页语义**全部**在内核 `查明细行`（`01` P1），
 * 这里只做两件事：把 `明细入参错误` 折成工具的 `bad_input`，把五个字段映射成七字段。
 * 不在这里重写一遍条件判断（`#002-06`：同一判据别开第二个出处）。
 */
export async function query_rows(
  ctx: 工具上下文,
  args: {
    材料?: string
    账户?: string
    方向?: "收" | "付"
    金额起?: string
    金额止?: string
    时间起?: number
    时间止?: number
    游标?: string
    限制?: number
  },
): Promise<工具结果> {
  let 结果: 明细查询结果
  try {
    结果 = await 查明细行(ctx.db, { projectId: ctx.身份.projectId, ...args })
  } catch (错) {
    if (错 instanceof 明细入参错误) throw new 工具错误("bad_input", 错.message)
    throw 错
  }

  const 行们 = 结果.数据.行们
  const 空 = 结果.空原因 !== null
  return {
    摘要: 空
      ? `没取到明细：${结果.空原因}${结果.缺口.length > 0 ? `（${结果.缺口[0]}）` : ""}`
      : `取到 ${行们.length} 行明细${args.材料 ? `（材料 ${args.材料}）` : ""}${args.账户 ? `（账户 ${args.账户}）` : ""}${结果.数据.下一页游标 ? "，还有下一页" : ""}`,
    数据: 结果.数据,
    口径: 结果.口径,
    缺口: 结果.缺口,
    空原因: 结果.空原因,
    出处: 行们.slice(0, 5).map((行) => ({
      事实: `明细行 ${行.时间原文 ?? 行.时间 ?? "时间缺失"} ${行.金额 ?? ""} ${行.方向 ?? ""}`.trim(),
      代表: `${行.材料id}#${行.工作表}#${行.行号}`,
      可下钻: "get_citation",
    })),
    下一步: 空
      ? [{ 工具: "search_materials", 参数: {}, 为什么: "确认材料名与解析状态；未解析的材料要先解析入库" }]
      : [
          { 工具: "get_citation", 参数: { 事实类型: "row", 事实id: `${行们[0]!.材料id}#${行们[0]!.工作表}#${行们[0]!.行号}` }, 为什么: "抽验一行的原文与备注" },
          ...(结果.数据.下一页游标
            ? [{ 工具: "query_rows", 参数: { ...args, 游标: 结果.数据.下一页游标 }, 为什么: "还有下一页明细" }]
            : []),
        ],
  }
}
```

> 字段名以 `明细行视图` 的**实际键名**为准（`case-row-query.ts` 里 `行视图()` 的映射）；写这一步前先 `grep -n "interface 明细行视图" -A 20` 对一遍，别照抄本计划的占位名。
>
> `出处` 的 `代表` 必须是 `材料#表#行`——`get_citation` 的 `row` 分支就是按这个定位；表名里可能含 `#`，所以内核已改为按主键取，这里只负责拼串（`09` §4.4 末段）。

- [ ] **Step 4: 注册到 server**

```ts
// case-mcp-server.ts:48-56
export const 工具名 = [
  "search_materials",
  "query_entities",
  "query_relations",
  "query_events",
  "aggregate_money",
  "find_crossings",
  "get_citation",
  "query_rows",
] as const

// TOOLS 里加一项（描述照 §4.5 第 3 条：把「不支持按备注检索」写进描述）
{
  name: "query_rows",
  description:
    "按材料 / 账户 / 方向 / 金额区间 / 时间窗翻案件明细行，返回时间、金额、方向、对方账号与户名、本方账号、备注原文，以及行级定位（材料#表#行，可直接喂 get_citation）。" +
    "明细太多时按游标翻页：把返回里的「下一页游标」原样传回 `游标`，不要自己造。" +
    "不支持按备注关键词检索——要按备注找，只能按账户 + 时间翻明细，备注随行回显；传了 `备注关键词` 会报参数错误。",
  inputSchema: {
    type: "object",
    properties: {
      材料: { type: "string", description: "材料 id；不传则跨本项目全部已解析材料" },
      账户: { type: "string", description: "账号或户名，命中本方账号或对方账号之一" },
      方向: { type: "string", enum: ["收", "付"], description: "收 = 本方收入，付 = 本方支出" },
      金额起: { type: "string", description: "金额下限（含），numeric 字符串，如 \"1000.00\"" },
      金额止: { type: "string", description: "金额上限（含），numeric 字符串" },
      时间起: { type: "integer", description: "起始时间（含），Unix 秒" },
      时间止: { type: "integer", description: "截止时间（含），Unix 秒" },
      游标: { type: "string", description: "上一页返回的「下一页游标」，原样回传" },
      限制: { type: "integer", description: "条数上限，默认 50、最大 200" },
    },
  },
}

// 分发表
query_rows: (ctx, args) =>
  query_rows(ctx, 收参数<Parameters<typeof query_rows>[1]>(args,
    ["材料", "账户", "方向", "金额起", "金额止", "游标"],
    ["时间起", "时间止", "限制"],
    [])),
```

> `收参数` 第二个数组是**字符串**形参、第三个是**整数**形参、第四个是布尔形参（`case-mcp-server.ts:233`）。`金额起/止` 是 numeric 字符串 ⇒ 进第二个数组；`时间起/止`、`限制` 是整数 ⇒ 进第三个。

- [ ] **Step 5: 跑**

```bash
cd packages/opencode && timeout 300 bun test test/server/openhive-case-mcp-rows.test.ts test/server/openhive-case-mcp-tools.test.ts test/server/openhive-case-mcp-server.test.ts
```

预期：新 8 条绿；旧的全绿（`工具名` 加了值，`case-mcp-server.test.ts` 里若有「未知工具名」的用例，请确认它用的是 `工具名` 之外的字符串，不是硬编码的 `query_rows`）。

- [ ] **Step 6: 提交**

消息：`feat(事实卡片): query_rows 挂成 MCP 工具，复用内核查明细行（09 §4.4，参考 #002-06 #004-03）`

---

### Task 3: server 硬校验与 30 KB 截断

**Files:**
- Modify: `packages/opencode/src/server/openhive/case-mcp-server.ts`（`成功结果` 之前）
- Test: `packages/opencode/test/server/openhive-case-mcp-envelope.test.ts`（新建）

**Interfaces:**
- Consumes: `数据为空()`、`空原因枚举`（Task 1）。
- Produces: `校验信封(结果) → 结果 | 抛 工具错误("bad_input")`？——**不是**。校验失败回给模型的是固定文案 `tool_failed`，不是 `bad_input`（`09` §3.4）。所以产出是一个内部函数，失败时抛一个**服务端错误**，`成功结果` 那条分支折成 `失败结果("tool_failed", 工具失败文案)`。

- [ ] **Step 1: 写用例（先红）**

```ts
test("缺 摘要 ⇒ tool_failed，不回显原文", async () => {})
test("缺口 为 undefined ⇒ tool_failed", async () => {})
test("空原因 非 null 但 数据 非空 ⇒ tool_failed（正向镜像）", async () => {})
test("数据 为空但 空原因 为 null ⇒ tool_failed（反向镜像）", async () => {})
test("数据 是 31 KB 数组 ⇒ 从尾部截断到 ≤ 30 KB、至少留 1 条、缺口写明截掉几条", async () => {})
test("30 KB 截断按 Buffer.byteLength(JSON.stringify(数据)) 算，不按字符数", async () => {})
```

> 用「假工具」注入：`case-mcp-server.ts` 的分发表是模块内常量。**不要**为了测试改生产代码加后门；改成把校验函数导出（`export function 校验信封(结果: 工具结果): void`）并让用例直接调它，截断函数同样导出（`export function 截断数据(数据: unknown, 缺口: readonly string[]): { 数据: unknown; 缺口: string[] }`）。这是**测试可见性**，不是后门——两者都是纯函数。

- [ ] **Step 2: 跑，确认红**（函数不存在 ⇒ 编译/导入失败即红）

- [ ] **Step 3: 实现**

```ts
/**
 * `09` §3.4 的服务端硬校验。**只校验，不改写**——补字段是工具的事（§3.2）。
 * 失败一律 `tool_failed`：这是实现错误，不是模型可以自纠的参数错误。
 */
export function 校验信封(结果: 工具结果): void {
  const 缺: string[] = []
  for (const 键 of ["摘要", "数据", "口径", "缺口", "空原因", "出处", "下一步"] as const)
    if (!(键 in 结果)) 缺.push(键)
  if (缺.length > 0) throw new 信封违约(`缺字段：${缺.join("、")}`)

  if (typeof 结果.摘要 !== "string" || 结果.摘要.length === 0) throw new 信封违约("摘要必须是字符串")
  if (typeof 结果.口径 !== "string" || 结果.口径.length === 0) throw new 信封违约("口径必须是字符串")
  if (!Array.isArray(结果.缺口)) throw new 信封违约("缺口必须是数组")
  if (!Array.isArray(结果.出处) || !Array.isArray(结果.下一步)) throw new 信封违约("出处 / 下一步 必须是数组")
  if (结果.空原因 !== null && !(空原因枚举 as readonly string[]).includes(结果.空原因))
    throw new 信封违约(`空原因不在枚举里：${String(结果.空原因)}`)

  const 空 = 数据为空(结果.数据)
  if (结果.空原因 !== null && !空) throw new 信封违约("空原因非 null 时数据必须为空")
  if (结果.空原因 === null && 空) throw new 信封违约("数据为空时空原因必须非 null")
}

/** 30 KB 确定性截断（§3.4）：按 `Buffer.byteLength(JSON.stringify(数据))` 算，从尾部截。 */
export function 截断数据(数据: unknown, 缺口: readonly string[]): { 数据: unknown; 缺口: string[] } {
  if (!Array.isArray(数据)) return { 数据, 缺口: [...缺口] }
  const 字节 = (值: unknown) => Buffer.byteLength(JSON.stringify(值))
  if (字节(数据) <= 30 * 1024) return { 数据, 缺口: [...缺口] }
  let 留 = 数据.length
  while (留 > 1 && 字节(数据.slice(0, 留)) > 30 * 1024) 留--
  return {
    数据: 数据.slice(0, 留),
    缺口: [...缺口, `返回数据超过 30 KB，已从尾部截掉 ${数据.length - 留} 条`],
  }
}
```

接进 `成功结果` 之前：

```ts
  校验信封(结果)
  const 截 = 截断数据(结果.数据, 结果.缺口)
  // 截断后镜像仍须成立：数组被截到 0 条不会发生（至少留 1 条）；截断本身不改 空原因
  成功结果({ ...结果, 数据: 截.数据, 缺口: 截.缺口 })
```

- [ ] **Step 4: 跑**，新 6 条绿 + 三份旧用例绿

- [ ] **Step 5: 变异**（据实记录，`#003-03`）
  - 删掉反向镜像那一行 ⇒ 「数据为空但空原因 null」那条必须红；
  - 把 `Buffer.byteLength` 换成 `JSON.stringify(数据).length` ⇒ 「按字节算」那条必须红（构造含中文的数据：中文 1 字符 3 字节）。

- [ ] **Step 6: 提交**

消息：`feat(事实卡片): MCP server 七字段硬校验与 30KB 确定性截断（09 §3.4，参考 #004-03 #005-18）`

---

### Task 4: `instructions` 纪律正文 + 12 次预算

**Files:**
- Modify: `packages/opencode/src/server/openhive/case-mcp-server.ts`
- Test: `packages/opencode/test/server/openhive-case-mcp-server.test.ts`

- [ ] **Step 1: 先确认 `Server` 构造参数支持 `instructions`**

```bash
grep -rn "instructions" node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts | head
```

若该版本不支持，**停下报告**——不要自己造一个 `instructions` 字段塞进 `capabilities`。备选（需报告后再定）：把纪律写进 4 个原语 `description` 的开头（§5.3 的「摘要」那一半），并把它记成缺口。

- [ ] **Step 2: 写用例（先红）**

```ts
test("server 初始化带 instructions，含八条纪律的可检索关键词", async () => {
  // 至少要能搜到：空原因照抄 / 12 次 / 停 / 出处
})
test("第 12 次工具调用起，返回的 缺口 里出现「已达本次探索上限（12 次）」", async () => {})
test("第 11 次调用不注入上限缺口", async () => {})
```

- [ ] **Step 3: 写正文**

按 §5.2 八条逐条落成中文（照抄语义，不要发明第 9 条）：

```ts
const 纪律正文 = `你是公安案件研判助手。查库纪律如下，任一条都不能违反：
1. 先解析再查询：实体名先交给 query_entities / 工具内部解析，拿名字直接当 id 用算调用错误。
2. 空结果照抄：工具的「空原因」与它给的引导动作要原样转述，禁止改写成「没有 / 查不到」。
3. 数字只认本次返回：结论里每个数必须来自本次工具返回；不许拿上一轮的数字凑。
4. 时间窗必须进结论：说「近 30 天」就要写清实际起止；没给就写「全时段」。
5. 四类限定显式标注：户名匹配（未核实身份）/ 推断（非事实）/ 跨源未合并（候选）/ 材料未解析。
6. 三种停：目标已达成 / 预算用尽（12 次，服务端计数）/ 需要人裁决（同名多人、合并候选、推断升事实）——每种都要停下来讲清楚。
7. 同参不重调：一次回答里相同工具 + 相同参数只调一次。
8. 不跨问题：答完即停；工具返回的「下一步」是给人点的建议，不是你继续查的理由。`
```

- [ ] **Step 4: 预算计数**

在 `记(...)` 或分发处加 `let 调用次数 = 0`，每次工具调用 `调用次数++`；`调用次数 >= 12` 时在**成功返回**的 `缺口` 末尾追加 `"已达本次探索上限（12 次），必须收尾并列出未覆盖项"`。

> 计数作用域：`case-mcp-server.ts` 的 server 实例若是「每连接一个」（`case-mcp-http.ts` 里按请求/连接新建），则在实例闭包内计数即等价「每会话」。**先读 `case-mcp-http.ts` 确认**，并在提交信息里写下你确认到的结论；若一个实例跨会话复用，改按 `(userId, projectId)` 计数并写进缺口表。

- [ ] **Step 5: 跑 + 提交**

消息：`feat(事实卡片): MCP instructions 写入追查纪律，12 次预算服务端计数（09 §5.2-5.4）`

---

### Task 5: 用例对齐、门禁、文档回写

- [ ] **Step 1: 全量受影响用例一次跑完**

```bash
cd packages/opencode && timeout 300 bun test \
  test/server/openhive-case-mcp-envelope.test.ts \
  test/server/openhive-case-mcp-rows.test.ts \
  test/server/openhive-case-mcp-tools.test.ts \
  test/server/openhive-case-mcp-server.test.ts \
  test/server/openhive-case-mcp-http.test.ts
```

- [ ] **Step 2: 门禁（在仓库根）**

```bash
cd packages/opencode && timeout 300 bun run typecheck
cd ../.. && timeout 300 bun run lint
```

- [ ] **Step 3: 加一条「`下一步` 不许指向未注册工具」的运行时断言**

Task 1 的阶段里 `query_rows` 还没注册，`下一步` 却已经指向它——靠人工核对挡不住以后任何一次漂移。在 `openhive-case-mcp-tools.test.ts` 末尾加一条：

```ts
test("所有工具返回的 下一步 / 出处.可下钻 都指向已注册的工具名", async () => {
  // 直接遍历各工具的真实返回值（沿用本文件既有夹具），逐条断言：
  //   结果.下一步.every((条) => 工具名.includes(条.工具))
  //   结果.出处.every((条) => 条.可下钻 === null || 工具名.includes(条.可下钻))
  // 断言用 `toEqual([])` 收集违规项再比较空数组——失败时能一眼看出是谁指向了什么。
})
```

- [ ] **Step 4: grep 同类落点（`#002-06`）**

```bash
grep -rn "口径:" packages/opencode/src/server/openhive/case-mcp-tools.ts | wc -l   # 应为 11（7 原子 + query_rows + 3 处 get_citation 分支? 以实际为准，逐个数清并写进报告）
grep -rn "工具结果" packages/opencode/src packages/opencode/test
```

逐个落点回答「它是不是按同一个七字段前提在写返回」：`case-mcp-server.ts`（校验，不产字段，**不动**）、`case-mcp-http.ts`（传输，**不动**）、任何测试夹具里的假 `工具结果`（**要补字段**）。

- [ ] **Step 5: 回写 `09`**

- §3.5 表格里 `无匹配行` 那一行：归属列从「`query_rows`」改为「原子工具 + `query_rows`（通用的『条件无命中』）」，触发条件改为「条件无命中；原子工具查不到任何行时也用它」。
- §12 落点清单：把本期做掉的行打勾并注明提交哈希；未做的行（#9 工具卡、#12 fixture）保留未勾，注明「留下一期」。
- 文首修订清单加一条：`2026-11-12 工具层落地：七字段信封 + query_rows 挂载 + 硬校验；前端工具卡与 20 题 fixture 留下一期`。

- [ ] **Step 6: 提交**

消息：`docs(事实卡片): 09 §3.5 空原因归属回写，工具层计划收尾（参考 #002-06 #004-03）`

---

## 计划的诚实缺口（实现前就该知道）

1. **前端工具卡不在本期**：模型能拿到七字段，但会话里仍显示 `GenericTool`（只显示调用名与入参）。「过程可见」只兑现到 API 层，民警侧不可见——这是本期最大的已知缺口，`09` §12 #9 留下一期。
2. **20 条问题期望表不在本期**：没有 fixture 就没有「AI 回答是否照抄空原因」的回归网；真模型行为（§13.1）本期一条都验不了。
3. **30 秒不计时**（§5.4 用户裁定）：预算只做了次数，没做时间。
4. **三个原语没有**：`下一步` 只写本期存在的工具（R8），所以建议的丰富度受限；P2/P3 原语落地后要回头补 `下一步`。
5. **`instructions` 是否被客户端透传**：规格已实证（`session/system.ts:142-158`），但**当前没有前端**，无法在本期真栈里看到「纪律进了 system prompt」的效果——只能验 server 侧确实带上了。
6. **工具授权闸**仍是缺口（§10）：本期只沿用成员校验。
7. **`空原因` 对原子工具的统一值**是本期裁定（扩 `无匹配行` 归属），不是 `09` 原文；已回写 §3.5，评审时按新表述核。

---

## 自检（写完后的对照结果）

**1. 规格覆盖**

| `09` 要求 | 落在哪个任务 |
|---|---|
| §3.1 七字段形状 | Task 1 |
| §3.2 谁写（工具写、server 只校验） | Task 1（工具）+ Task 3（server） |
| §3.3 空原因由服务端填 | Task 1（工具实现产出） |
| §3.4 齐全 / 双向镜像 / 30 KB / 上限 | Task 3 |
| §3.5 枚举与表序 | Task 1（值）+ Task 5（归属回写） |
| §4.4 `query_rows` 入参/数据/空原因 | Task 2 |
| §4.5 备注关键词不支持 | Task 2（描述 + `收参数` 白名单） |
| §5.2 / §5.3 纪律进 instructions | Task 4 |
| §5.4 12 次预算 | Task 4 |
| §8.3 错误映射 | 沿用现状（`bad_input` / `not_found` / `not_a_member` / `tool_failed` 已实现），Task 2 只把 `明细入参错误` 折成 `bad_input` |
| §12 #1/#2/#3/#6/#8/#10 | Task 1/3/2/2/4/5 |
| §12 #7 实体先解析 | `query_rows` 的 `账户` 走的是明细行匹配、不是实体 id（§4.4 补白），**不调** `解析实体`；其余工具维持现状 |
| §12 #9/#12 | 明确不做（本期范围裁定） |

**2. 占位符扫描**：无 TBD；唯一「以实际为准」的两处（`明细行视图` 键名、`口径:` 出现次数）都写明了当场 `grep` 的命令与目的，不是留给实现者自由发挥。

**3. 类型一致性**

| 名字 | 定义处 | 使用处 | 一致 |
|---|---|---|---|
| `工具结果`（七字段） | Task 1 | Task 2 / 3 / 4 | ✅ |
| `下一步项` / `出处项` | Task 1 / `case-envelope.ts:45` | Task 1 / 2 | ✅ |
| `数据为空()` | Task 1 | Task 3 | ✅ |
| `查明细行` / `明细入参错误` / `明细查询结果` / `明细行视图` | `01` P1 | Task 2 | ✅ |
| 工具名 `"query_rows"` | Task 2 `工具名` | Task 2 `TOOLS` / `分发表` | ✅ |
| `校验信封` / `截断数据` | Task 3 | Task 3 测试 | ✅ |
