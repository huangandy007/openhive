# Quickstart · 验收可复跑步骤

**Feature**: `015-ai-explore-mcp-tools` · **Date**: 2026-11-17

> 所有命令在**仓库根** `D:\project\study\openhive\openhive` 下执行；`bun test` 必须在受影响 package 内跑（根目录 `test` 脚本强制 `exit 1`）。同步跑测试一律加 `timeout`——bun 拦不住同步死循环，退出码 124 不要自动重跑。

## 0. 前置

- `bun --version` ≥ 1.4.2。
- 后端用例默认不依赖远端 PG；真栈手工验收需要 `REAL_STACK_DB=remote`（2026-10-26 起本机默认），连接参数见 `CONFIG.md` 与 `packages/opencode/.env`。
- `packages/app` 的组件用例跑 happy-dom，无需浏览器。
- **`packages/session-ui` 没有组件测试基建**（实测无 `.test.tsx`、无 happy-dom）：它的新行为只跑 `.test.ts` 纯函数用例；渲染验收用 storybook（`bun run dev:storybook` → http://localhost:6006）＋ 真栈。

## 1. 验收已落地主体（阶段 0，零生产代码）

```bash
cd packages/opencode
timeout 600 bun test \
  test/server/openhive-case-mcp-envelope.test.ts \
  test/server/openhive-case-mcp-server.test.ts \
  test/server/openhive-case-mcp-tools.test.ts \
  test/server/openhive-case-mcp-rows.test.ts \
  test/server/openhive-case-mcp-http.test.ts \
  test/server/openhive-case-mcp-identity.test.ts \
  test/server/openhive-case-mcp-template-filter.test.ts \
  test/server/openhive-case-mcp-supervisor.test.ts \
  test/server/openhive-case-explore.test.ts \
  test/server/openhive-case-explore-replay.test.ts \
  test/server/openhive-case-empty-reason.test.ts \
  test/server/openhive-case-money-flow.test.ts \
  test/server/openhive-case-timeline.test.ts \
  test/server/openhive-case-source-profile.test.ts \
  test/server/openhive-case-graph.test.ts
```

**期望**：全绿。若有红，先判定「实现与规格不符」还是「用例缺失」，**不要**顺手改实现（铁律：找不到根因不动代码）。

同时产出 **FR → 用例** 映射表（放 `tasks.md` 或报告里）：FR-001～FR-028、FR-035～FR-048 每条至少一个用例句；缺的只补断言。

## 2. 新行为的红 → 绿

### 收尾行

```bash
cd packages/session-ui
timeout 300 bun test src/components/closing-stats.test.ts
```

**红的样子（必须先看到）**：`closing-stats` 模块不存在 ⇒ 导入失败。
**绿的样子**：四个统计字段在三个口径（0 次 / 2 次带 2 条缺口 / 图工具不计数）下取到具体值；`收尾行文本` 在 0 次为 `null`、`>=12` 含上限提示。

**渲染验收**（session-ui 无组件测试基建）：

```bash
cd D:/project/study/openhive/openhive
bun run dev:storybook   # http://localhost:6006
```

打开 `ClosingLine` 三态（0 次不渲染 / 2 缺口 / 12 次上限），在浏览器里核对文案；「不存在」按 `=== null` 判（`#013-12`）。

### 错误话术

```bash
cd packages/session-ui
timeout 300 bun test src/components/envelope-parse.test.ts
```

**红**：9 个码的 `错误码引导键` 返回 `undefined`（函数尚不存在或未映射）。
**绿**：9 码逐字映射到 i18n 键；未知码返回 `undefined`。

**渲染验收**：storybook 打开 `EnvelopeTool` 的 `write_failed` / `bad_input` / 未知码三态，浏览器核对「码 + 原因 + 引导」三段；未知码只两行。

### 入口起手

```bash
cd packages/app
timeout 300 bun test src/center/case-views/entity-profile.test.tsx
```

**红**：找不到「查个人」/「查个账户」按钮。
**绿**：类型=人 显示「查个人」、类型=账户 显示「查个账户」、其他类型都不显示；点击后预填句逐字正确且**不自动发送**。

## 3. 门禁（仓库根）

```bash
cd D:/project/study/openhive/openhive
timeout 900 bun run typecheck
timeout 300 bun run lint
```

**期望**：`typecheck` 全绿。`lint` 若报**与本轮改动无关**的既有错误，贴 `file:line` + 规则名并注明「既有」；若报在我改的行上，修到绿。

**变异验证**（每条新行为做完必做，`#003-03`）：

| 拆掉什么 | 必须红的用例 |
|---|---|
| 收尾行的 `是信封工具键` 过滤 | 「图工具不计数」用例 |
| 错误码映射中的一条 | 对应用例（成对拆，`#005-37`） |
| 按钮的 `type` 条件 | 「其他类型不显示按钮」用例 |

## 4. 真栈手工验收（不重启在跑的旧栈）

```bash
# 起栈：端口传 0 由系统挑；首次会打印 READY {...}
REAL_STACK_DB=remote bun packages/opencode/test/real-stack/serve.ts
```

> 端口被残留栈占住时改 `REAL_STACK_*_PORT`，不要杀进程。内核配置目录是 `D:\openhive-stack-state\config\opencode\opencode.jsonc`（不是 `~/.config`），改完必须重启内核。真栈**不热重载**：源码改动后不重启，跑的还是改前那版。

手工走一遍：

1. 登录 → 进入一个已有实体的案件 → 打开「人」类型实体档案。
2. 点「查个人」 → 会话输入框出现预填句（含实体规范值），**没有**自动发送。
3. 手动发送 → AI 调工具 → 工具卡出现 → 回复末尾出现收尾行（`本轮回答查询 N 次 · 覆盖材料 M 份 …`）。
4. 连续追问到第 12 次 → 工具卡 `缺口` 出现「近 10 分钟内查询已达 12 次…」，收尾行出现「已达 12 次上限，未覆盖项见工具卡缺口」。
5. 制造一次失败（如查询不存在的实体或让写工具被非属主调用）→ 错误卡显示「错误码 + 原因 + 人话引导」。
6. 打开「地点」类型实体 → 两枚按钮都不出现。

## 5. 本机验不了 / 明确不验

| 项 | 原因 |
|---|---|
| 20 题真模型回放 | 需 provider 凭据；本期只验夹具回放（`openhive-case-explore-replay.test.ts`） |
| `资金研判` skill A/B | 后置（D1），不在本期 |
| 「查一段时间」入口 | 无案件级时间窗数据源（D5），后置 |
| 按地点取事件 | 维持 `能力未就绪` 契约（D6），后置 |
| 并发 / p95 压测 | 无硬闸；真栈只手工走单流程 |

这些必须写进报告缺口表，**不许**写成「已覆盖」。
