# 015-ai-explore-mcp-tools · 运行报告（TDD 实施)

> 生成时间：2026-11-17 · 工作区：`.claude/worktrees/015-ai-explore-mcp-tools`（分支 `015-ai-explore-mcp-tools`）
> base：`3677068021`（multi-tenant HEAD）· 19 个提交 · 16 个计划任务 + 1 次终审修复
> 本报告只写**实际跑过**的命令与**实得**输出；没跑 / 跑不动的逐条写进 §六 缺口表。

## 一、交付了什么

| 能力 | 落点 | 行为 |
|---|---|---|
| 工具卡七字段/出处/上限断言补强（US1–US3） | `packages/opencode/test/server/openhive-case-*.test.ts`（6 文件） | 补 19+16+16 条断言；发现并修掉 1 条永真断言（T003） |
| 收尾行（US4） | `session-ui/src/components/closing-stats.ts`（纯函数）、`closing-line.tsx`（组件 + story） | 回答末尾显示 `本轮回答查询 N 次 · 覆盖材料 M 份`、缺口摘要、12 次上限提示 |
| 起手入口（US6） | `app/src/center/case-views/entity-profile.tsx`、`ask-ai.ts` | 「人」给「查个人」、「账户」给「查个账户」，以**替换**方式预填整句，不自动发送；`发到会话` 增可选 `方式` 参数 |
| 工具错误引导（US7） | `session-ui/src/components/envelope-parse.ts`、`envelope-tool.tsx`、`ui/src/i18n/{zh,en}.ts` | 9 个错误码各一句人话引导（逐字取 `09` §8.3），未知码不渲染引导行 |

## 二、TDD 与审查簿

每个任务都走「红 → 绿 → 变异 → 门禁」；每个任务都有独立评审（Spec 合规 + 代码质量），发现问题走限定修复轮 + 限定范围复评。

| 任务 | 结论 | 关键证据 / 缺陷 |
|---|---|---|
| T001 基线 | 15/15 文件绿 | 320 pass / 0 fail |
| T002 FR 映射 | 45 行表（覆盖/部分/缺口） | 15 条缺口逐条写明原因 |
| T003 四原语断言 | 绿 | 修掉 1 条**无 matcher 的永真断言**（`expect(a && typeof b === "object")`） |
| T004 16 个空原因 | 16/16 字面值 | 评审 C1/I2 经复核为**假阳**（读到了主仓库同名旧报告） |
| T005 出处 / get_citation | 19 断言 + 3 项变异 | — |
| T006 收尾行用例（红） | 4 组夹具 | 发现图工具真实 part 键 `openhive-case_graph_add` 会通过前缀判定；材料数与调用数原为巧合相等，已拆开 |
| T007 收尾行纯函数 | 绿 | Ruling 8：工具错误调用也计入「查询次数」（按 key 计数，与服务端预算口径一致） |
| T008 ClosingLine 组件 | 三态 story + typecheck 绿 | 评审无缺陷 |
| T009 接线 | `message-part.tsx` +2 行 | 类型收窄 `.filter(type === "tool")` 被判为正确且必要 |
| T010 9 码映射（红） | `SyntaxError: Export named '错误码引导键' not found` | 断言级红成立 |
| T011 映射 + 9 条文案 | 17 pass | 评审抓出**真缺陷**：`错误码引导键("toString")` 返回函数（原型链键）⇒ 补 `Object.hasOwn` 守卫 + `toBeUndefined()` 用例 |
| T012 错误卡引导行 | 四态 story | 评审发现服务端还有第 10 码 `identity_required`（见 §六） |
| T013 入口按钮用例（红） | 57 pass / 4 断言级红 | 整句逐字 `toBe`；「不自动发送」用「写入次数恒为 1」 |
| T014 入口按钮实现 | 61 pass / 0 fail | 变异拆 `type` 条件 ⇒ 3 条红 |
| T015 仓库根门禁 | 见 §三 | 无本轮新增失败 |
| T016 真栈验收 | 首轮 4/6 | 第 3/4 步失败，根因与终审 C1 一致（见 §四） |
| 终审修复 | 见 §四 | F1–F4 全过，变异各恰红 |

## 三、门禁与测试（修复后复跑）

| 命令 | 实得 |
|---|---|
| `timeout 900 bun run typecheck`（仓库根） | `Tasks: 32 successful, 32 total`，`TYPECHECK_EXIT=0` |
| `timeout 300 bun run lint`（仓库根） | `Found 7036 warnings and 1 error.`，`LINT_EXIT=1` —— 唯一 error = `packages/session-ui/src/v2/components/prompt-input/index.tsx:163:19` `no-octal-escape`，**既有**（`git diff --name-only 3677068021..HEAD -- packages/session-ui/src/v2/` 为空；该文件末次改动为上游 `edc8d1d91e 2026-08-04`）。warnings 数与 T015 完全一致（7036），无新增 |
| `cd packages/session-ui && timeout 300 bun test src/components/closing-stats.test.ts src/components/envelope-parse.test.ts` | 30 pass / 0 fail / 99 expect |
| `cd packages/app && timeout 600 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/case-views/entity-profile.test.tsx` | 61 pass / 0 fail / 222 expect |
| `cd packages/opencode && timeout 600 bun test test/server/openhive-case-{citation,explore-replay,explore,mcp-rows,mcp-tools,timeline}.test.ts` | 191 pass / 0 fail |
| `git status --porcelain` / `git diff --stat bun.lock` | 均空（`bun.lock` 无镜像污染） |

> 组件用例必须带 `--conditions=browser` 与两个 preload（该包 `test:components` 口径）。计划里写的字面命令会报 `jsxDEV not found`，属跑法问题（Ruling 10）。

## 四、真栈验收（关键结论）

栈：`REAL_STACK_KERNEL_PORT/FRONT_PORT` 换端口起新栈，`REAL_STACK_DB=remote`，`STACK_READY {"db":"8.136.21.218:35432/openhive_dev"}`（远端 PG）；栈进程启动时间均**晚于**对应 HEAD 提交（真栈不热重载，见 `#` 内存条目）。本机 4711/3010 上的旧栈（12:23 启动）全程未触碰。

**首轮（修复前，HEAD `0e75d6cd`）：6 步 4 过 2 未过**

| 步 | 结果 | 证据 |
|---|---|---|
| 1 人档案 | 通过 | 「计划7验收-1107」张三档案（人、已确认） |
| 2 查个人预填 | 通过 | 输入框原文 `查一下「张三」名下有哪些账户、与谁有资金往来，按时间窗给出结论和出处。`，未自动发送 |
| 3 收尾行 | **未通过** | 12 张工具卡正常，`[data-slot="closing-line"]` 恒 0 |
| 4 12 次上限 | **未通过** | 工具卡缺口已含服务端文案，但收尾行不出现 |
| 5 错误卡引导 | 通过 | `错误码：not_found` + 原因 + 「没找到这个实体」 |
| 6 地点无入口 | 通过 | 两枚按钮元素数均为 0 |

根因（终审与实测一致）：每条 assistant 消息只挂当步 tool part，最终回答是另一条无 tool 的消息，而旧接线只统计**单条**消息的 parts ⇒ 查询次数恒 0。

**修复后（HEAD `5172cba4`）复验第 3/4 步：均转为通过**

- 收尾行实测原文（两轮各一条）：
  - `本轮回答查询 10 次 · 覆盖材料 0 份 · 缺口 14 项（如：关系圈按对方聚合、最多 10 组（按金额降序））`
  - `本轮回答查询 2 次 · 覆盖材料 0 份 · 缺口 2 项（…） · 已达 12 次上限，未覆盖项见工具卡缺口`
- 工具卡缺口原文含 `近 10 分钟内查询已达 12 次，必须收尾并列出未覆盖项`。
- `覆盖材料 0 份` 是**正确**的：本轮 `出处.代表` 全是实体 id / 账户号，没有 `材料#工作表#行号`（F2 修复后不再把它们当材料）。

**修复内容（F1–F4）**：收尾行改到本轮全部 assistant 消息粒度（`AssistantParts`）；材料数只数含 `#` 的代表；12 次上限改由服务端注入的缺口文案驱动（删掉前端自数 12 的启发式）；补 i18n 文案断言。变异：F1/F2/F4 各恰红 1 条，F3 恰红 2 条（另有 4 条结构性整组红，按 `#003-03` 据实记为「整组红」）。

## 五、Ruling 清单（会话内裁定，均可复核）

1 契约与 tasks 的 `收尾行文本` 签名不一致 → 以 tasks 为准（注入 `t` 保纯函数可测）。
2 T008/T012 的「浏览器核对」子代理做不到 → 降级为 story 齐全 + typecheck，浏览器核对归真栈验收。
3 真栈不可用时 T016 记缺口、不写成已覆盖。
4 T003–T005 只补断言不改实现；发现不符即停并记缺口。
5 `发到会话` 加**可选**第二参数 `方式`（默认「追加」），保住唯一出口与失败文案单一出处。
6 T004 评审 C1/I2 为假阳：主仓库根目录存在同名旧报告，评审读错路径。
7 T004 的两条 `缺口.join()` 子串断言保留（它们断言提示文本，不是 16 个枚举值；枚举值 16/16 已字面 `toBe`）。
8 工具错误调用也计入「查询次数」（按 key 计数，与服务端预算「成功失败都算」一致）。
9 服务端第 10 码 `identity_required` 不在设计 9 码内 → 按 spec 保持 9 码、**不自拟文案**，只把 story 夹具改成真实码让缺口可见。
10 `packages/app` 组件用例必须用 `--conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts`（计划里的字面命令报 `jsxDEV not found`）。
11 FR-031（三种需人裁决情形的按钮）未派任务 → 本期不实现，记缺口交产品排期。

## 六、缺口表（**不许读成已覆盖**）

| 缺口 | 说明 |
|---|---|
| 服务端第 10 码 `identity_required` 无引导文案 | 共享项目成员调案件工具（真实高频失败）时错误卡只有错误码 + 技术消息，没有人话引导（Ruling 9） |
| FR-029「查一段时间」入口 | 后置（D5：无案件级时间窗数据源） |
| FR-030 入口载荷用规范值而非 id/路径 | 名称解析可兜住，同形路径下无法唯一定位（终审 Minor 5） |
| FR-031 三种需人裁决情形的按钮 | 本期未实现（Ruling 11） |
| 12 次上限文案跨包各一份字面量 | 前端 `近 10 分钟内查询已达 12 次` 与服务端 `预算上限缺口` 无编译/测试链接；服务端改文案后前端静默不显示上限段（fail-closed）。另服务端只把上限缺口放进成功信封、图工具走显式字段、失败调用不注入 ⇒ 第 12 次恰为 `graph_*` 或失败时不显示 |
| `errorHint.tool_failed` 与服务端消息重复 | 该码错误卡会把同一句话显示两遍（未修） |
| 20 题真模型回放 / 资金研判 skill A/B / 按地点取事件 / 金额级明细 / 并发 p95 | 真栈验收 §三 全未验（无凭据、后置项、项目无已入库明细、无硬闸） |
| FR-025/026/027/028/038/039/042/044/046/047/048 等 15 条 FR | T002 表内逐条写明「why 是缺口」，本报告不重复 |

## 七、复用与引用

- 借鉴并复用的既有能力：`是信封工具键` / `信封工具名` / `解析工具输出`（解析层单一出处）、`发送到会话(文本, 方式)`（会话输入唯一出口）、`useI18n`（文案单一出处）、storybook（组件唯一可验通道）。
- 本次命中的教训条目：`#003-03`（变异三类结论）、`#002-06`（同一前提单一出处）、`#013-12`（DOM 不存在断言用布尔比较）、`#005-18`（假绿四问）、`#006-21`（props 进重跑表达式）、`#009-02`（一片假红先查 test 跑法 conditions）、`#006-29`（报告≠转述）、`#004-10`（门禁在仓库根跑）、`#005-49`（RED 态假红）。
