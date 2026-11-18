# 015-ai-explore-mcp-tools · 运行报告（TDD 实施)

> 生成时间：2026-11-17 · 工作区：`.claude/worktrees/015-ai-explore-mcp-tools`（分支 `015-ai-explore-mcp-tools`）
> base：`3677068021`（multi-tenant HEAD）· 25 个提交 + 1 个交付说明提交 = 26 · 16 个计划任务 + 1 次终审修复 + 1 轮审查修复
> 本报告只写**实际跑过**的命令与**实得**输出；没跑 / 跑不动的逐条写进 §六 缺口表。

## 一、交付了什么

| 能力 | 落点 | 行为 |
|---|---|---|
| 工具卡七字段/出处/上限断言补强（US1–US3） | `packages/opencode/test/server/openhive-case-*.test.ts`（6 文件） | 补 19+16+16 条断言；发现并修掉 1 条永真断言（T003） |
| 收尾行（US4） | `session-ui/src/components/closing-stats.ts`（纯函数）、`closing-line.tsx`（组件 + story） | 回答末尾显示 `本轮回答查询 N 次 · 覆盖材料 M 份`、缺口摘要、12 次上限提示 |
| 起手入口（US6） | `app/src/center/case-views/entity-profile.tsx`、`ask-ai.ts` | 「人」给「查个人」、「账户」给「查个账户」，以**替换**方式预填整句，不自动发送；`发到会话` 增可选 `方式` 参数 |
| 工具错误引导（US7） | `session-ui/src/components/envelope-parse.ts`、`envelope-tool.tsx`、`ui/src/i18n/{zh,en}.ts` | 9 个错误码各一句人话引导（逐字取 `09` §8.3），未知码不渲染引导行 |
| 工具描述可用性（FR-050） | `opencode/src/server/openhive/case-mcp-server.ts` | 14 个信封工具 description 补「什么时候用 / 什么时候别用 / 返回后照抄」三段；4 个探索原语共用固定开头 |

### 实现详情（合并前定稿，2026-11-18）

**1. 收尾行（前端新增，纯函数 + 组件 + 接线）**

- `session-ui/src/components/closing-stats.ts`——`统计收尾` 从 part 数组算 `查询次数 / 覆盖材料数 / 缺口总项 / 首条缺口`；`收尾行文本` 生成文案；`收尾部件(消息们, 取部件)` 把「本轮全部 assistant 消息」的 parts 合并成一维。
  - `查询次数` = `是信封工具键(part.tool)` 为真的 tool part 数（图工具不计，工具错误调用计入）。
  - `覆盖材料数` = `出处[].代表` 中**含 `#`** 的去重前缀集合大小（实体 id / 账户号不是材料，`材料键` 无 `#` 返回 null）。
  - `缺口总项` / `首条缺口` 排除以服务端 `预算上限缺口` 开头的条目（否则同一句话在收尾行与工具卡各出现一次）。
  - `已达上限` = 任一信封 `缺口` 条目以服务端文案开头（前端**不**自数 12）。
- `session-ui/src/components/closing-line.tsx`——组件 + 三态 story；i18n 键 `ui.closingLine.summary` / `.gaps` / `.budget`。
- `session-ui/src/components/message-part.tsx:747`——在 `AssistantParts` 内以 `收尾部件(props.messages, (消息id) => …)` 取值；`:839` 挂 `<ClosingLine parts={收尾行部件()} />`。**不**在单条 `TextPartDisplay` 里统计（每步 LLM 调用各建一条消息，单条统计恒 0，终审 F1 根因）。

**2. 起手入口（前端新增，两枚按钮）**

- `app/src/center/case-views/entity-profile.tsx:505-527`——「查个人」/「查个账户」，按 `档().type` 显隐；点击走 `发到会话(整句, "替换")`，**只预填输入框不发送**；地点 / 号码 / 公司 / 其他类型两枚都不渲染。
- `app/src/ai-session/send-to-session.ts:115`——`发送到会话(文本, 方式 = "追加")` 增可选参数，默认追加，保住会话输入唯一出口。

**3. 工具错误引导（前端新增）**

- `session-ui/src/components/envelope-parse.ts:57/73`——`错误码引导键` 表 + `Object.hasOwn` 守卫（`toString` 等原型链键返回 `undefined`）。
- `session-ui/src/components/envelope-tool.tsx`——错误卡在消息下渲染一行引导；未知码不渲染。
- `packages/ui/src/i18n/{zh,en}.ts`——9 条 `ui.envelopeTool.errorHint.<码>`，zh 逐字取 `09` §8.3。

**4. 服务端（仅文案与描述，工具逻辑零改动）**

- `opencode/src/server/openhive/case-mcp-server.ts:196`——新增导出常量 `探索原语摘要`；`:349/:376/:405/:431` 四个探索原语 description 以它开头。
- 14 个信封工具 description 补三段式（「什么时候用 / 什么时候别用 / 返回后照抄」），`FR-050` 原先是 MUST 未实现，本轮补做。
- 预算上限缺口常量 `预算上限缺口`（`:142`）与注入点（`:872` 图工具显式字段、`:882` 成功信封追加）**未改**。

**5. 测试与文档**

- 新增/加强用例落点：`opencode/test/server/openhive-case-{citation,explore-replay,explore,mcp-rows,mcp-tools,timeline,mcp-server}.test.ts`、`session-ui/src/components/{closing-stats,envelope-parse}.test.ts`、`app/src/center/case-views/entity-profile.test.tsx`。
- 文档：`tasks.md`（FR→用例映射表 50 行：覆盖 30 / 缺口 17 / 部分 3）、`contracts/ui-card-contract.md` §3、`data-model.md` §5 已按最终行为改写；本报告 §六 为缺口表，§八 为 code review 复核记录。

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
| FR-025/026/027/028/038/039/042/044/046/047/048 等 FR | T002 表内逐条写明「why 是缺口」，本报告不重复 |
| 只用图工具的一轮**完全没有收尾行** | `查询次数 === 0 ⇒ 整行不渲染`（`closing-stats.ts:93`），而图工具被排除在计数外 ⇒ 模型若整轮只 `graph_add/graph_query`，FR-033 的「回答末尾 MUST 有一行收尾」不成立。另：第 12 次恰为失败调用或图调用时，上限段也不显示（服务端 `case-mcp-server.ts:790/872` 的注入条件） |
| 渲染层（`ClosingLine`、错误引导行）无任何可执行断言 | 两个 story 是 `// @ts-nocheck`，且 `session-ui/tsconfig.json:18` 把 `**/*.stories.*` 排除出 typecheck ⇒ T008/T012 的「story + typecheck 绿」没有渲染证据。收尾行接线层只有 `closing-stats.test.ts` 的**结构性源码钉子**（`1485e5879c`），不是行为测试 |
| `packages/app` 包级测试门禁不可用 | `bun run test` 因 `test:unit` 既有失败（31 fail / 21 error，BASE 同因）`&&` 中断，到不了 `test:components`；单独 `test:components` 400 秒跑不完（`timeout 400` 退出码 143）。新组件用例只能靠点名命令执行，无 CI 守护 |
| 「查个人 / 查个账户」以「替换」覆盖用户已写草稿 | `session-panel.tsx:627` 直接 `setText`，无确认、无撤销。与 009 T015「指令语义用替换」一致，属产品已定行为，本轮不改 |
| FR-005「其余成立项进缺口」未实现 | `case-mcp-tools.ts:596-627` 是单值早退，没有把其它成立原因追加进 `缺口`；映射表原写「无用例」，实为**实现缺口** |
| FR-022「9 项纪律」靠 `2b` 挂靠，测试反向锁死「无第 9 条」 | `case-mcp-server.ts:170-180` 只有 1..8 + `2b`；`openhive-case-mcp-server.test.ts:496-523` 断言 `not.toMatch(/^[9９]\./m)`；`09` §5.2 设计表仍 8 行。改编号需产品裁定 |
| FR-050 的常量复用只能靠 grep 守 | 4 个原语都写 `探索原语摘要 +`（`case-mcp-server.ts:349/376/405/431`），但若有人把常量**逐字**复制成字面量，行为用例仍是绿（只有漂字才红） |
| spec 自身措辞不一致 | `spec.md:82` 写「已达 12 次上限，以下未覆盖：…」，`spec.md:206`（FR-025）写「已达查询上限，以下未覆盖：…」。2026-11-17 裁定：文案取「已达 12 次上限，以下未覆盖项见工具卡缺口」（不逐条列出，指向工具卡），两条 spec 原文待产品统一措辞 |

## 七、复用与引用

- 借鉴并复用的既有能力：`是信封工具键` / `信封工具名` / `解析工具输出`（解析层单一出处）、`发送到会话(文本, 方式)`（会话输入唯一出口）、`useI18n`（文案单一出处）、storybook（组件唯一可验通道）。
- 本次命中的教训条目：`#003-03`（变异三类结论）、`#002-06`（同一前提单一出处）、`#013-12`（DOM 不存在断言用布尔比较）、`#005-18`（假绿四问）、`#006-21`（props 进重跑表达式）、`#009-02`（一片假红先查 test 跑法 conditions）、`#006-29`（报告≠转述）、`#004-10`（门禁在仓库根跑）、`#005-49`（RED 态假红）。

## 八、2026-11-17 code review 复核与修复

四个独立只读审查员（Spec 一致性 / TDD 真实性 / 功能链路 / 遗漏链路）按用户指定的四个维度并行审查，结论合并去重后：**Critical 3、Important 9、Minor 8**。审查员报的 282 个用例全部实跑通过；**未发现用 mock 蒙混**（9 个测试文件均触达生产代码）。

**本轮已修**（每条先红后绿 + 变异）：

| 问题 | 提交 | 证据 |
|---|---|---|
| FR-050 工具描述三段式 + 4 原语固定开头（MUST 原样未做、且漏进映射表） | `748c31b92f` | `case-mcp-server.ts` 新增导出 `探索原语摘要`，14 个工具三段齐全（grep 各 14 处）；3 条新用例；变异拆标记 ⇒ 红 |
| 收尾行接线无回归网（F1 的真实落点） | `1485e5879c` | 抽 `收尾部件(消息们, 取部件)` + 结构性源码钉子；变异只取最后一条消息 ⇒ 红 |
| 上限文案与 spec 不符 + 服务端上限条目被重复计入缺口数 | `1485e5879c` | `zh.budget` = 「已达 12 次上限，以下未覆盖项见工具卡缺口」；`缺口总项`/`首条缺口` 排除该条目；变异拆排除 ⇒ 2 条红 |
| 9 条错误引导只断言「非空」 | `1485e5879c` | 改为逐字 `toBe`（出处 `09` §8.3）；变异改一个字 ⇒ 红 |
| app 用例「不自动发送」伪装成可观测 | 见本提交 | 删掉 30ms 睡等与错误注释，改名「只写一次」，如实说明该接缝测不到发送 |
| 契约 / data-model 与实现口径相反 | 见本提交 | §3 输入改「本轮全部 assistant 消息」、判定改服务端缺口驱动；§5 同步 |
| 映射表漏 5 条 FR、表头统计过期 | 见本提交 | 补 FR-032/033/034/049/050，重算为 50 行（覆盖 30 / 缺口 17 / 部分 3） |

**记录不修**（理由见 §六）：图工具轮次无收尾行、渲染层无断言、app 包级门禁不可用、替换覆盖草稿、FR-005、FR-022 编号、FR-050 常量复用局限、spec 自身两处措辞不一致。

**未复跑真栈**：改动只涉及文案与描述文本，不改变渲染结构；§四 的实测原文中 budget 句已因文案改动而过期，其余（收尾行出现位置、查询次数、材料数）仍有效。真栈复验需一次真实模型多轮查询，本轮未做。
