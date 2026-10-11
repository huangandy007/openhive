# 右栏「/」命令面板 ＋ 底栏模型选择器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右键栏 AI 会话框的两处能力补到与原生一样——① 打 `/` 弹出的池子是**服务端命令全集（真 skill）＋ 上游内建斜杠命令、选中即执行**（今天只有 2 条本机开发工具 skill）；② 底栏有一个**管这场会话、且记住**的模型选择器（今天没有）。

**Architecture:** 两处都**不新写 UI**，只把原生件已经留出来的空位填上：① 的浮层/模糊匹配/插入语义全在 `packages/session-ui/src/v2/components/prompt-input/` 里，唯一的空位是 controller 的 `commands` 入参；② 原生 `PromptInputV2` 的 `modelControl` 有 fallback——`view.model`（`PromptInputV2SelectControl`）在没传 `modelControl` 时会渲染**上游自己的** `PromptInputV2ConfiguredSelect`。数据与接线由 `ai-session/ai-session-slot.tsx`（唯一够得着 `useCommand()` / `useProviders()` 的那一层）供料，`session-panel.tsx` 只接 prop、保持**受控**（它今天在测试里只裹 `DialogProvider` / `FileComponentProvider`，一取 context 整个测试文件每一处挂载都会抛，`LEARNINGS #005-27`）。

**Tech Stack:** Bun 1.3.14 monorepo / SolidJS 1.9.10 / `@opencode-ai/session-ui` 的 v2 `prompt-input` / happy-dom 20.12.0（组件层）＋ Playwright 真栈（几何与端到端）。

**Spec:** `docs/superpowers/specs/2026-10-11-right-pane-slash-and-model-design.md`（本轮已提交 `f6589b7ce6`，Task 0 会按开工后新读到的证据修订 §3.2 / §3.3）

---

## Global Constraints

以下每一条都是**每一步的隐含前提**，逐字来自 `CLAUDE.md` / `LEARNINGS` / 本设计文档，不重复论证：

1. **上游文件一个字都不改**：`packages/session-ui/**`、`packages/app/src/components/prompt-input/**`、`packages/app/src/components/prompt-input-v2.tsx`、`packages/app/src/components/dialog-select-model.tsx`、`packages/app/src/context/**` 全是**高频上游文件**（改它 = 每次同步 `upstream/dev` 都冲突）。本轮所有改动落在 `packages/app/src/ai-session/**` ＋ `docs/**` ＋ 一个新增的 e2e spec。
2. **品牌化/缺省走配置**，不硬编码进核心源码。
3. **每次改动单独提交**，提交信息末行带【保留的定制 · 同步上游时不要丢】。
4. **六步轨道**：每条改动 ① 实测定根因 → ② 先写会红的用例 → ③ 改到绿 → ④ 变异验证（拆掉修复 ⇒ 那条用例必须红，红成什么样按 `LEARNINGS #003-03` 三类据实记）→ ⑤ 门禁在**仓库根串行**跑（`#003-01`：并行跑多道门禁会造假红）→ ⑥ `grep` 全部同类落点逐个打勾。
5. **红线**：不谎称改了（只写跑过的命令与它实际的输出）；不做表面修改（找不到根因就不动代码）；不把测不了的写成已覆盖（本机验不了的写进缺口表）。
6. **变异/还原纪律**：本仓工作区常有**未提交**的改动 ⇒ 变异一律 `cp` 备份 ＋ 按**字节**还原，**禁用 `git checkout -- <文件>`**（`LEARNINGS #005-40`：那条命令会把未提交的实现和变异一起擦掉）。
7. **`bun install` 之后必查 `git diff --stat bun.lock` 应为空**；被镜像污染就还原（本项目刻意不落仓库级 `.npmrc`）。
8. **测试命令**（都从 `packages/app/` 起，串行跑）：
   - 组件：`bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts <文件>`
   - 单元：`bun test --conditions=solid --preload ./happydom.ts <文件>`
   - ⚠️ 单文件验证**不要**用 `bun run test:unit`（它带 `--only-failures`）；门禁那一步才用仓库脚本。
9. **happy-dom 没有 CSS 引擎**（`LEARNINGS #005-07`）：几何 / 颜色 / 溢出只能在真栈量；组件层只能断 `className` 串与结构。
10. **不碰并行会话的文件**：`packages/app/src/project/file-tree.tsx`、`packages/app/src/project/file-tree.test.tsx`、`packages/app/e2e/real-stack/file-tree-search-appearance-real.spec.ts`、`docs/superpowers/specs/005-project-management/state.md`（本会话开始时它们已是 dirty 状态）。
11. **本轮明确不做**（设计文档 §6）：右栏「＋ 新会话」与首页的统一、agent / Effort 选择器、拉 `upstream/dev`、删 `projection.all` 这个字段。
12. 工作位置：就地在本检出（`multi-tenant`）实施，不另开 worktree——与本次的设计文档、探针在同一处。

---

## 文件结构（先定边界，再拆任务）

| 文件 | 责任 | 动作 |
|---|---|---|
| `docs/superpowers/specs/2026-10-11-right-pane-slash-and-model-design.md` | 本轮的设计文档（唯一规格来源） | **改** §3.2 / §3.3 / 缺口表 |
| `packages/app/src/ai-session/command-palette.ts` | `/` 面板的**数据源**（纯函数：两源合并 ＋ 映射 ＋ 选中处理器）。**没有 UI** | 改（三函数替换 `skillCommands`） |
| `packages/app/src/ai-session/command-palette.test.ts` | 上面那三个纯函数的单测（**纯 TS ⇒ 从 `.test.tsx` 改成 `.test.ts`，进 unit 套件**） | 重命名 ＋ 重写 |
| `packages/app/src/ai-session/model-selection.ts` | 模型选择的**判断**（纯函数：键 / 拆键 / 候选 / 当前值优先级） | **新建** |
| `packages/app/src/ai-session/model-selection.test.ts` | 上面那四个纯函数的单测 | **新建** |
| `packages/app/src/ai-session/session-panel.tsx` | 右栏面板（受控）。本轮：把两个空位填上——`commands` / `onSuggestionSelect` / `view.model` | 改 |
| `packages/app/src/ai-session/session-panel.test.tsx` | 组件层判据（13 处 `SessionPanel` 挂载点要补新 prop） | 改 |
| `packages/app/src/ai-session/session-panel.stories.tsx` | storybook 那一处挂载点 | 改 |
| `packages/app/src/ai-session/ai-session-slot.tsx` | 生产组装层：`useCommand()` / `useProviders()` 取数、`选过的` 状态、三处新 prop 的接线 | 改 |
| `packages/app/src/ai-session/submit-prompt.ts` | 提交边界。本轮：`model` 由**调用方解好**传进来 ＋ 无模型不发（F3/F4 收口） | 改 |
| `packages/app/src/ai-session/submit-prompt.test.ts` | 提交边界判据（哨兵 → 收口判据） | 改 |
| `packages/app/src/ai-session/session-actions.ts` | `建会话` 带上模型（新会话继承本栏现在认的那一支） | 改 |
| `packages/app/src/ai-session/session-actions.test.ts` | 同上的单测 | 改 |
| `packages/app/e2e/real-stack/right-pane-slash-and-model-real.spec.ts` | 真栈验收（池子条数 / 插入语义 / 底栏控件的存在与几何） | **新建** |
| `docs/superpowers/specs/006-ai-session/state.md` | 缺口表 F3/F4 两行改为「已修」＋ 新增 G7/G8 | 改 |
| `docs/superpowers/specs/006-ai-session/tasks.md` | 追加本轮条目 | 改 |

**为什么数据源与判断要抽成两个纯函数文件**：`ai-session-slot.tsx` 是**挂不起来测**的一层（要活着的服务器连接才建得起 `ServerSyncProvider`，见该文件头），而本轮新增的判断（哪些命令进池子谁执行、模型取哪个）全都有对错 —— 照 `session-actions.ts` 的既有分工，判断抽出去、接线层只剩「取数 → 调纯函数 → 传 prop」。

---

## 开工前先声明完成判据（用户认可再动手）

每条任务的「完成判据」写在任务内。**总判据**（全部完成才算本轮完成）：

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/ai-session/session-panel.test.tsx` → 全绿
- `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/` → 全绿
- 真栈：`bunx playwright test e2e/real-stack/right-pane-slash-and-model-real.spec.ts --config=e2e/real-stack/playwright.config.ts --reporter=list` → **3 passed**
- 仓库根：`bun run typecheck` → 31/31；`bun test`（在 `packages/app` 内按脚本跑）→ 0 fail；改动文件 scoped oxlint → 0 error / 0 warning；`git diff --stat bun.lock` → 空

---

### Task 0: 设计文档按开工后新读到的证据修订

**为什么先做这个**：`writing-plans` 期间读到了设计文档 §3.2 当时**不知道**的一件事——原生 `PromptInputV2` 的 `modelControl` 有一条 **fallback**，而它需要的输入比原以为的少得多。设计文档是唯一规格来源，先改它、再照它写代码（文档与代码不一致时，代码是对的而文档在撒谎）。

**依据（已按字节读到，不是推断）**：

- `packages/session-ui/src/v2/components/prompt-input/index.tsx:229-245`：

  ```tsx
  <Show
    when={props.modelControl}
    fallback={
      <Show when={view.model} keyed>
        {(control) => (
          <PromptInputV2ConfiguredSelect title={i18n.t("ui.promptInput.chooseModel")} keybind={["Mod", "M"]} control={control} model />
        )}
      </Show>
    }
  >
    {props.modelControl}
  </Show>
  ```

- `packages/session-ui/src/v2/components/prompt-input/interaction.ts:22-27` 的 `PromptInputV2SelectControl` 只要四项：`{ options: Accessor<PromptInputV2Option[]>; current: Accessor<string>; onSelect: (id: string) => void; keybind?: Accessor<string[]> }`。
- 上游传的是 `modelControl`（富件 `ModelSelectorPopoverV2`，要一整套 `ModelState` —— `dialog-select-model.tsx:280` 的 `input.model ?? useLocal().model` 就是它不可复用的原因）；**我们走 fallback 那一条**，拿到的是原生自己的 `PromptInputV2ConfiguredSelect`（`index.tsx:527-549`，一个扁平单选：触发器 = 当前模型名 ＋ provider 图标 ＋ chevron，菜单 = 全部候选的 radio 列表）。

⇒ 结论：② 从「自建一个薄的控件」改成「**给 `view.model` 供数据**」——**零新 UI**，与 §4.7.4 的硬指令「能换数据源就不新写」同源。

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-right-pane-slash-and-model-design.md`

- [ ] **Step 1: 改 §3.2（② 模型控件）**

把「复用 `ModelSelectorPopoverV2` 已实测否决 ⇒ 改为自建薄的」这一段的结论改成三条：① `ModelSelectorPopoverV2` 仍然否决（理由不变：要整套 `ModelState` ⇒ 等于抄 `local.model`，`#002-06`）；② **不新建任何控件**，走原生 `view.model` 这条 fallback（引用上面那段 `index.tsx:229-245` 的读码证据）；③ 代价如实写：拿到的是**扁平单选**（`PromptInputV2ConfiguredSelect`），不是原生 `modelControl` 那颗带分组的富弹层。同时把 §1 实测读数里「hero 里没有模型控件」那一条旁边加一句「落点已定位到 `view.model` 这道空位」。

- [ ] **Step 2: 改 §3.3（F3）——补上同根因的**第二处**落点 F4**

按已读到的代码逐字写：

- `packages/app/src/session/prompt.ts`（核过的真身）无关；**两处落点都在客户端上游文件 `packages/app/src/components/prompt-input/submit.ts`**：
  - normal 分支（`:136`）`model: { ...input.draft.model, variant }` —— `draft.model` 是 `undefined` 时展开得 `{}`，**真值** ⇒ 服务端 `input.model ?? ag.model ?? currentModel(...)` 的回退链被顶掉 ⇒ 拿空对象去 `provider.getModel(undefined, undefined)` ⇒ 报错。这是 `state.md` 缺口表里已登记的 **F4**，与 F3 同根因（「右栏不传 model」），已登记为「类型谎言」。
  - 命令分支（`:94`）直接读 `input.draft.model.modelID` ⇒ 当场抛（**F3**）。
- ⇒ 修法收敛成一句话：**本栏恒有模型**（模型控件给出的「本栏选的 → 会话记的 → 应用默认」），**解析不出来就不发**（`submitRightPanePrompt` 在 `draft` 之前 `return false`）。F3 与 F4 同时消失，且 `submit-prompt.ts` 里那两个 `as` 少掉一个（`model` 那处不再需要：`FollowupDraft.model` 是必填，而守卫之后 `input.model` 已被收窄）。

- [ ] **Step 3: 缺口表补四行（G7/G8/G9/G10）**

```
| G7 | 内建命令的键位提示没搬过来（原生弹层每项右侧显示 `Mod+M` 这类键位，右栏不显示）——`右栏斜杠命令` 没给 `keybind` 字段。纯外观，真栈 spec 会读到实况 |
| G8 | 无任何已接入 provider 时，模型控件的候选为空、触发器文字为空串，且提交会被守卫挡下（返回 false、正文留在框里、**没有提示**）。本机没有可复现的环境（不配 provider 连原生的底栏也是空的）⇒ 据实挂账，不写「已覆盖」 |
| G9 | 「内建命令选中即执行」的**真执行**只在单元层钉（`右栏选中命令` 返回动作）＋ 组件层钉（spy 被调用）；真栈只钉到「池子里有内建」与「服务端命令选中后 token 留在框里」。真执行会在沙箱里跑 `/init` 这类有副作用的命令 ⇒ 真栈不跑 |
| G10 | **唯一与原生不同字的一处**：`title`。能对上号的 skill 用中文显示名（用户裁定 2026-10-11，为保住「民警打中文搜得到」），其余用命令名。`id`/`label`/`trigger`/次序与原生逐条一致 |
```

- [ ] **Step 4: 提交**

```bash
cd D:/project/study/openhive/openhive
git add docs/superpowers/specs/2026-10-11-right-pane-slash-and-model-design.md
git commit -m "docs(006): 设计文档修订 —— ② 复用点收紧到原生 view.model（零新 UI）、F3 与 F4 同根因一并收口 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：设计文档 §3.2 不再出现「自建薄的控件」这一说法；§3.3 同时点到 `submit.ts:94` 与 `:136` 两处；缺口表有 G7/G8/G9/G10。

---

### Task 1: `/` 面板的池子（纯函数，两源合并）

**Files:**
- Modify: `packages/app/src/ai-session/command-palette.ts`
- Rename+Rewrite: `packages/app/src/ai-session/command-palette.test.tsx` → `command-palette.test.ts`

**Interfaces:**
- Consumes: `PromptInputV2Suggestion`（`@opencode-ai/session-ui/v2/prompt-input/types`）
- Produces（后面所有任务都用这三个名字/形状）：
  - `斜杠源条 = { id: string; trigger: string; title: string; description?: string; type: "custom" | "builtin" }`
  - `中文名条 = { skill: string; name: string }`（`projection.all` 的元素里本文件真读的两项）
  - `右栏斜杠源(input: { 服务端: readonly 服务端命令条[]; 内建: readonly 内建命令条[]; 已知中文名: readonly 中文名条[] }): 斜杠源条[]`
  - `右栏斜杠命令(源: readonly 斜杠源条[]): PromptInputV2Suggestion[]`
  - `右栏选中命令(源: readonly 斜杠源条[], 执行: (id: string) => void): (item: PromptInputV2Suggestion) => (() => void) | void`

**本任务的裁定（2026-10-11，开工前用户拍板）**：`title` **原生为底、已知 skill 叠中文名**。即池子、次序、`id`、`label`、`trigger` 与原生**逐条一致**，只把「能对上号的 skill」那一行的 `title` 从命令名换成中文显示名。动机见下面测试里那段注释（`filterKeys` 只认英文标识符 ⇒ 照抄原生会让民警**打中文搜不到**）。代价如实记：`title` 与原生不同字（已进设计文档缺口表 G10）。

- [ ] **Step 1: 先把测试文件改名并写红（`git mv` ＋ 重写）**

```bash
cd D:/project/study/openhive/openhive
git mv packages/app/src/ai-session/command-palette.test.tsx packages/app/src/ai-session/command-palette.test.ts
```

新内容（整份替换）：

```ts
import { describe, expect, test } from "bun:test"
import type { PromptInputV2Suggestion } from "@opencode-ai/session-ui/v2/prompt-input/types"
import { 右栏选中命令, 右栏斜杠命令, 右栏斜杠源, type 内建命令条 } from "./command-palette"

/**
 * `/` 面板的数据源（FR-005 / US3 场景 2）。
 *
 * ## 本组测的是「池子对不对」，不是「浮层好不好看」
 *
 * 浮层 / 模糊匹配 / 插入语义全在**上游**（`session-ui/v2/components/prompt-input`），本文件
 * 只钉三件自己写的判断：**哪些进池子**、**进去是什么形状**、**选中之后谁被执行**。
 *
 * ## 为什么池子从 skill 清单换成了服务端命令表（2026-10-11 真栈实测）
 *
 * 旧写法（`skillCommands(投影.all)`）的池子 = 本机 `MANIFESTS` 那 2 条开发工具 skill；而原生
 * 输入框那条 `sync().data.command` 实测 **118 条**（真 skill 全集，`source:"skill"` 的命令就在里面）。
 * 2 vs 118 就是「打 `/` 弹不出对应的命令」这个现象的**根因**，不是浮层没弹
 * （真栈读数：弹层在视口内、几何正常）。
 *
 * ## 两源的形状照抄原生
 *
 * 蓝本 `packages/app/src/components/prompt-input-v2.tsx` 的 `slashCommands()`
 * （`:292-320`）与它下面那个 `commands` memo（`:321-332`）：custom 在前、builtin 在后，
 * `id` 分别是 `custom.${name}` 与命令自己的 id。
 */

const 服务端 = (…条: string[]) => 条.map((name) => ({ name }))

const 内建 = (…条: Array<Partial<内建命令条> & { id: string }>): 内建命令条[] =>
  条.map((条) => ({ title: 条.id, ...条 }))

describe("`/` 面板的池子", () => {
  test("服务端命令进池子，形状照原生（`custom.` 前缀 ＋ label 带斜杠）", () => {
    const 源 = 右栏斜杠源({ 服务端: 服务端("write-as-huzhou-gongan"), 内建: [], 已知中文名: [] })

    expect(源).toEqual([
      {
        id: "custom.write-as-huzhou-gongan",
        trigger: "write-as-huzhou-gongan",
        title: "write-as-huzhou-gongan",
        description: undefined,
        type: "custom",
      },
    ])
  })

  /**
   * 「原生为底、已知 skill 叠中文名」（2026-10-11 用户裁定）——**唯一**与原生不同字的一处。
   *
   * 动机：模糊匹配的 `filterKeys` 是 `["trigger","title"]`，两个都是英文标识符 ⇒ 只照抄原生的话
   * **民警打中文筛不到 skill**（对不懂代码的用户是真实的可用性损失）。而 `title` 在浮层里主要
   * 当**搜索字段**用（行上画的是 `label` ＋ `description`）⇒ 叠一层是**加法**：不动 id / 次序 / label。
   */
  test("能对上号的 skill ⇒ `title` 是中文显示名（打中文搜得到），身份与插入语义都不变", () => {
    const 源 = 右栏斜杠源({
      服务端: 服务端("write-as-huzhou-gongan"),
      内建: [],
      已知中文名: [{ skill: "write-as-huzhou-gongan", name: "写湖州公安材料" }],
    })

    expect(源[0].title).toBe("写湖州公安材料")
    expect(源[0].id).toBe("custom.write-as-huzhou-gongan") // 身份不变
    expect(源[0].trigger).toBe("write-as-huzhou-gongan") // 选中后插进正文的那一段不变
  })

  test("对不上号的服务端命令（118 条里只有 2 条是本机 skill，绝大多数的这支）⇒ `title` 退回命令名", () => {
    const 源 = 右栏斜杠源({
      服务端: 服务端("some-other-command"),
      内建: [],
      已知中文名: [{ skill: "write-as-huzhou-gongan", name: "写湖州公安材料" }],
    })

    expect(源[0].title).toBe("some-other-command")
  })

  test("带 `slash` 的内建命令进池子，`id` 用它自己的 id（不加前缀）", () => {
    const 源 = 右栏斜杠命令(
      右栏斜杠源({ 服务端: [], 内建: 内建({ id: "session.new", slash: "new", title: "New session" }), 已知中文名: [] }),
    )

    expect(源).toEqual([
      { id: "session.new", kind: "command", label: "/new", trigger: "new", title: "New session", description: undefined },
    ])
  })

  test("没有 `slash` 的内建不进池子（原生那条 `&& item.slash`）", () => {
    expect(右栏斜杠源({ 服务端: [], 内建: 内建({ id: "session.new", title: "New" }), 已知中文名: [] })).toEqual([])
  })

  test("`disabled` 的内建不进池子", () => {
    expect(右栏斜杠源({ 服务端: [], 内建: 内建({ id: "session.new", slash: "new", disabled: true }), 已知中文名: [] })).toEqual([])
  })

  /**
   * `suggested` 的那一批是**上游 `options` memo 自己复制出来的一份**（`context/command.tsx:331-350`：
   * `[...suggested.map(x => ({...x, id: 前缀 + x.id, category})), ...resolved]` —— 原件同时在数组里）。
   * 而且 `{...x}` 展开让**两件的 `suggested` 字段都是 `true`** ⇒ 只能按 **id 前缀**分辨哪份是复制件；
   * 按字段筛会连原件一起删（原生 `prompt-input-v2.tsx:301` 就是按前缀筛）。
   */
  test("`suggested` 的原件（id 无前缀、`suggested: true`、有 `slash`）进池子", () => {
    const 源 = 右栏斜杠源({ 服务端: [], 内建: 内建({ id: "session.new", slash: "new", suggested: true }), 已知中文名: [] })
    expect(源.map((条) => 条.id)).toEqual(["session.new"])
  })

  test("`suggested` 的复制件（id 带 `suggested.` 前缀）不进池子", () => {
    const 源 = 右栏斜杠源({ 服务端: [], 内建: 内建({ id: "suggested.session.new", slash: "new", suggested: true }), 已知中文名: [] })
    expect(源).toEqual([])
  })

  test("原件与复制件一起喂进去 ⇒ 恰好 1 条，且是原件（不是前缀件）", () => {
    const 源 = 右栏斜杠源({
      服务端: [],
      内建: 内建(
        { id: "session.new", slash: "new", suggested: true },
        { id: "suggested.session.new", slash: "new", suggested: true },
      ),
      已知中文名: [],
    })
    expect(源.map((条) => 条.id)).toEqual(["session.new"])
  })

  test("两源的次序：服务端在前、内建在后（原生就是 `[...custom, ...builtin]`）", () => {
    const 源 = 右栏斜杠源({
      服务端: 服务端("a"),
      内建: 内建({ id: "b", slash: "b" }),
      已知中文名: [],
    })

    expect(源.map((条) => 条.type)).toEqual(["custom", "builtin"])
  })
})

describe("`/` 面板选中之后谁被执行", () => {
  const 源 = 右栏斜杠源({
    服务端: 服务端("effect"),
    内建: 内建({ id: "session.new", slash: "new" }),
    已知中文名: [],
  })
  const 命令集 = 右栏斜杠命令(源)

  test("选中**服务端命令** ⇒ 什么也不返回（token 留在正文里，回车时才走命令分支）", () => {
    const 动手 = 右栏选中命令(源, () => {})
    const 那一条 = 命令集.find((条) => 条.id === "custom.effect")!

    expect(动手(那一条)).toBeUndefined()
  })

  test("选中**内建命令** ⇒ 返回一个动作，调用它 ⇒ `执行` 收到那条的 id", () => {
    const 收到: string[] = []
    const 动手 = 右栏选中命令(源, (id) => void 收到.push(id))
    const 那一条 = 命令集.find((条) => 条.id === "session.new")!

    const 动作 = 动手(那一条)
    expect(typeof 动作).toBe("function")
    expect(收到).toEqual([]) // 返回动作 ≠ 已经执行（原生也是调用方随后才调它）
    动作!()
    expect(收到).toEqual(["session.new"])
  })

  test("选中一个池子里没有的 id ⇒ 什么也不返回（表可能是旧的）", () => {
    const 动手 = 右栏选中命令(源, () => {
      throw new Error("不该执行")
    })

    expect(动手({ id: "custom.没有这条", kind: "command", label: "/没有这条" })).toBeUndefined()
  })

  test("选中的不是命令（`@` 文件那条池子）⇒ 什么也不返回", () => {
    const 动手 = 右栏选中命令(源, () => {
      throw new Error("不该执行")
    })

    expect(动手({ id: "file:src/a.ts", kind: "file", label: "src/a.ts" })).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑一遍，确认它是红的**

Run: `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/command-palette.test.ts`
Expected: FAIL —— `右栏选中命令` / `右栏斜杠命令` / `右栏斜杠源` 三个名字从 `./command-palette` **导出失败**（`SyntaxError`/`undefined is not a function`，逐条红在调用处）。记下**实得输出**（② 步要的就是这条红）。

**先量一句再往下写**（叠中文名这一层挂在一条前提上，`LEARNINGS #003-04`：写进代码的前提必须当场验）：
服务端命令表里的 skill 条目，名字是否与 `projection.all[].skill` **逐字相同**？探针跑过的那份清单里带 `source` 标记，直接看：

```bash
cd packages/app
export TEMP="C:/Users/Administrator/AppData/Local/Temp/oh-diag" TMP="$TEMP" TMPDIR="$TEMP"
# 真栈起着的时候（Task 6 Step 2 会起；若此刻没起，用下面这条只读内核的那一路）：
curl -s "http://127.0.0.1:$REAL_STACK_KERNEL_PORT/api/command?directory=$DIR" -H "Cookie: openhive_session=$TOKEN" | head -c 2000
```

判：清单里有没有 `name:"<某个 skill 名>"` 且 `source:"skill"` 的条目，且那个 `name` 与本机 `projection.all` 的 `.skill` 对得上。**对不上 ⇒ 叠名这一层落空**，此时**不改实现**、按「title 退回命令名」走并据实记（`#003-04`：宁可记成缺口，不要叠一层永远命不中的映射）。

- [ ] **Step 3: 改 `command-palette.ts`**

整份替换成（保留文件头那张表与 §4.7.4 的论证，只改「数据源」那一行与三个函数）：

```ts
import type { PromptInputV2Suggestion } from "@opencode-ai/session-ui/v2/prompt-input/types"

/**
 * `/` 命令面板（FR-005 / US3 场景 2 / DESIGN §4.7.4）——**本文件只有三个纯函数，没有浮层**。
 *
 * ## 为什么这里没有 UI
 *
 * §4.7.4 的硬指令是「**能换数据源就不新写**」（第一号约束：与上游的冲突面越小越好）。开工时
 * 逐环核过了，原生 `v2/prompt-input` 自带的那个弹层**本来就挂在 `/` 上**：
 *
 * | 环节 | 原件（`packages/session-ui/src/v2/components/prompt-input/`） |
 * |---|---|
 * | 打 `/` 唤起 | `machine.ts` 的 `inputChanged`：正文匹配 `/^\/(\S*)$/` ⇒ `popover = { type: "command-inline" }` |
 * | 浮层形态 | `index.tsx` 的 `PromptInputV2Popover`——§4.7.4 那张表就是它 class 串的**逐字实况** |
 * | 模糊匹配 | `interaction.ts` 的 `commandList = useFilteredList({ filterKeys: ["trigger", "title"] })`（`fuzzysort`） |
 * | 数据源 | **唯一的空位**：controller 入参 `commands: Accessor<PromptInputV2Suggestion[]>` |
 *
 * ## 池子的两源 = 原生那两源（2026-10-11 用户裁定「和原生完全一样」）
 *
 * 蓝本 `packages/app/src/components/prompt-input-v2.tsx` 的 `slashCommands()`（`:292-320`）：
 * ① `sync().data.command`（**服务端命令全集**，真 skill 就在里面：`command/index.ts` 把
 * `skill.all()` 每一条注册成 `source:"skill"` 的命令）；② `useCommand().options` 里带 `slash`
 * 的内建。旧写法（只取本机 `MANIFESTS` 投影的 skill 清单）实测只有 **2 条**，而第 ① 源在
 * 真栈里是 **118 条** —— 这就是「打 `/` 弹不出对应的命令」的根因。
 *
 * ⚠️ `title` 是**唯一**与原生不同字的一处（2026-10-11 用户裁定「原生为底、已知 skill 叠中文名」）：
 * 能对上号的 skill 用**中文显示名**，其余一律用命令名 —— 原生就是 `title: item.name`，而模糊匹配的
 * `filterKeys` 是 `["trigger","title"]`、两个都是英文标识符 ⇒ 只照抄原生会让**民警打中文筛不到
 * skill**。`id` / `label` / `trigger` / 次序一律不动，所以「池子和原生完全一样」这条裁定仍然成立；
 * 偏离只有 `title` 这一个搜索字段，已记进设计文档缺口表 G10。
 *
 * ## 授权过滤
 *
 * **不做**（2026-10-07 裁定 U2 / 宪法 §四）：服务端命令表是「本机扫到的全集」，不是「该用户有权的」。
 * 前端隐藏既不阻止调用也不阻止越权——授权在执行层强制。
 */

/** 服务端命令表里的一行（`sync().data.command` 的元素里本文件真读的两项）。 */
export interface 服务端命令条 {
  readonly name: string
  readonly description?: string
}

/**
 * 一条 skill 的**中文显示名**（`projection.all` 的元素里本文件真读的两项）。
 *
 * 收窄到两项、不从 `./projection` import 它的类型：本文件是纯函数、要被 `bun test` 直接跑，
 * 收窄到真读的字段才看得出依赖（`LEARNINGS #004-07`）。`SkillCapability` 结构上满足这个形状
 * ⇒ 调用方直接把它那支数组传进来即可。
 */
export interface 中文名条 {
  readonly skill: string
  readonly name: string
}

/**
 * 上游内建命令的候选（`useCommand().options` 的元素里本文件真读的六项）。
 *
 * 形状照着 `CommandOption`（`packages/app/src/context/command.tsx:78`）**收窄**、不从那边 import：
 * 本文件是纯函数、要被 `bun test` 直接跑，收窄到真读的字段才看得出依赖
 * （`LEARNINGS #004-07`：按被调方真读的项打勾，不按调用方的直觉）。
 */
export interface 内建命令条 {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly slash?: string
  readonly suggested?: boolean
  readonly disabled?: boolean
}

/** 一支候选——与原生 `slashCommands()` 的元素同形（`type` 是「谁去执行它」的判据）。 */
export interface 斜杠源条 {
  readonly id: string
  readonly trigger: string
  readonly title: string
  readonly description?: string
  readonly type: "custom" | "builtin"
}

/**
 * 两个源合成一份候选表。
 *
 * `suggested` 那一批按 **id 前缀**筛（对齐原生 `prompt-input-v2.tsx:301`）：上游
 * `context/command.tsx:331-350` 的 `options` memo 对 suggested 命令既留**原件**又加一份**前缀复制件**
 * （`{...x, id: SUGGESTED_PREFIX + x.id}`），而 `{...x}` 展开让**两件的 `suggested` 字段都是 `true`**
 * ⇒ 只能按 **id 前缀**分辨哪份是复制件；按字段筛会连原件一起删。
 *
 * ⚠️ **第三源是本机 skill 的中文名**（用户裁定 2026-10-11，理由见文件头）：只做 `title` 的覆盖，
 * **不改 `id` / `trigger`**（那两样是身份与插入语义）。对不上号就有多少算多少——118 条里绝大多数
 * 是上游内建与外机命令，本机只有那两条 skill 有中文名。
 */
export function 右栏斜杠源(input: {
  服务端: readonly 服务端命令条[]
  内建: readonly 内建命令条[]
  已知中文名: readonly 中文名条[]
}): 斜杠源条[] {
  // 服务端命令名 ⇒ 中文显示名。这里**按 `skill` 字段**对号（`projection.all` 的 `.skill` 就是
  // skill 名，而服务端把它注册成同名的命令——实现前已用真栈 `GET /command` 的清单核过这一条）。
  const 中文名 = new Map(input.已知中文名.map((条) => [条.skill, 条.name]))
  return [
    ...input.服务端.map((item) => ({
      id: `custom.${item.name}`,
      trigger: item.name,
      title: 中文名.get(item.name) ?? item.name,
      description: item.description,
      type: "custom" as const,
    })),
    ...input.内建
      .filter((item): item is 内建命令条 & { slash: string } => !item.disabled && !item.id.startsWith("suggested.") && !!item.slash)
      .map((item) => ({
        id: item.id,
        trigger: item.slash,
        title: item.title,
        description: item.description,
        type: "builtin" as const,
      })),
  ]
}

/**
 * 候选表 → 原生浮层吃的 `PromptInputV2Suggestion`。
 *
 * 形状一字不改（`{ id, kind: "command", label: \`/${trigger}\`, trigger, title, description }`）：
 * 一改，`useFilteredList` 的 `filterKeys` 与 `machine.ts` 的 `suggestionSelected` 就对不上了。
 *
 * ⚠️ **不给 `keybind`**：原生每项右侧会画键位提示，右栏不画（设计文档缺口表 G7）。
 */
export function 右栏斜杠命令(源: readonly 斜杠源条[]): PromptInputV2Suggestion[] {
  return 源.map((item) => ({
    id: item.id,
    kind: "command",
    label: `/${item.trigger}`,
    trigger: item.trigger,
    title: item.title,
    description: item.description,
  }))
}

/**
 * 选中一条之后「要不要立刻执行、执行谁」——蓝本是原生 `prompt-input-v2.tsx:359-364` 的
 * `onSuggestionSelect`：**custom 只插字**（回车时才走命令分支），**builtin 选中即执行**
 * （`command.trigger(id, "slash")`，且上游 `interaction.ts:165-173` 会把刚插进去的那段正文清掉）。
 *
 * ⚠️ **必须在选中那一刻现读**「源」与「执行」，不能在建 controller 时算好：`commands` 是异步
 * 填的（`server-sync.tsx` 的 `void loadCommands(...)`），建 controller 时那份候选还是空的
 * ⇒ 冻住的闭包会让「先建会话、命令表后到」的现场永远选不动（`LEARNINGS #006-13` 的同族：
 * 同一个数据两个时间点的写法）。
 */
export function 右栏选中命令(
  源: readonly 斜杠源条[],
  执行: (id: string) => void,
): (item: PromptInputV2Suggestion) => (() => void) | void {
  return (item) => {
    if (item.kind !== "command") return
    const 选中的 = 源.find((条) => 条.id === item.id)
    if (!选中的 || 选中的.type === "custom") return
    return () => 执行(选中的.id)
  }
}
```

- [ ] **Step 4: 跑测试到绿**

Run: `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/command-palette.test.ts`
Expected: PASS（11 pass / 0 fail）

- [ ] **Step 5: ⑥ 步 —— 找 `skillCommands` 的全部落点**

```bash
cd D:/project/study/openhive/openhive
grep -rn "skillCommands" --include=*.ts --include=*.tsx packages docs
grep -rn "projection.all\|\.all\b" --include=*.tsx packages/app/src/ai-session/session-panel.tsx | head
```

预期：`skillCommands` 只剩 `session-panel.tsx:284` 一处调用 ＋ 已删的定义。Task 2 会把那处调用换成新函数 ⇒ 本步**只记录清单**，不在这里改（调用点与 `commands` 的接线是 Task 2 的活）。
若有测试文件 import 了已删的 `skillCommands`（除 `command-palette.test.tsx` 外），把它一并改到新函数名上。

- [ ] **Step 6: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/src/ai-session/command-palette.ts packages/app/src/ai-session/command-palette.test.ts
git commit -m "feat(006): 右栏 \`/\` 池子换成两源（服务端命令全集 ＋ 上游内建）—— 纯函数先落地，接线下一提交 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：`command-palette.test.ts` 9 pass / 0 fail；`command-palette.test.tsx` 已不在工作区（`git status` 里显示为 rename）；`skillCommands` 的落点清单已落在本任务的记录里（供 Task 2 逐个打勾）。

---

### Task 2: 接线 —— slot 供料 ＋ panel 把两个空位填上

**Files:**
- Modify: `packages/app/src/ai-session/session-panel.tsx`（新增 1 个必填 prop ＋ 改 controller 的 `commands` / `onSuggestionSelect`）
- Modify: `packages/app/src/ai-session/ai-session-slot.tsx`（`useCommand()` ＋ 供料）
- Modify: `packages/app/src/ai-session/session-panel.test.tsx`（13 处挂载点 ＋ 新判据）
- Modify: `packages/app/src/ai-session/session-panel.stories.tsx`（1 处挂载点）

**Interfaces:**
- Consumes（Task 1 产出）：`右栏斜杠源` / `右栏斜杠命令` / `右栏选中命令` / `内建命令条`
- Produces：`SessionPanelProps.斜杠内建命令: { 选项: () => readonly 内建命令条[]; 执行: (id: string) => void }`

- [ ] **Step 1: 先写会红的组件用例**

在 `session-panel.test.tsx` 里，把 `摆右栏` 上面加两个夹具与一个**带 prop 的**摆法（放在 `空投影` 定义之后）：

```tsx
/** 内建命令的夹具（形状照 `CommandOption` 里真读的那六项）。 */
const 内建夹具: 内建命令条[] = [
  { id: "session.new", title: "New session", slash: "new" },
  { id: "session.hidden", title: "没有 slash 的", slash: undefined },
]

/**
 * 带「内建命令」那一半的摆法。
 *
 * 本组件**取不到** `useCommand()`（测试里只裹 `DialogProvider` / `FileComponentProvider`），
 * 所以这两件由调用方供料——`执行` 传 spy，好让「选中内建 ⇒ 它被调用」这条判据有牙。
 */
const 摆右栏带命令 = (收到的: string[]) =>
  挂(() =>
    原语环境(() => (
      <SessionPanel
        data={夹具数据()}
        directory="/tmp/openhive-test"
        sessionID="ses_1"
        projection={空投影}
        斜杠内建命令={{ 选项: () => 内建夹具, 执行: (id) => void 收到的.push(id) }}
      />
    )),
  )
```

在新的一组 `describe` 里写判据（追加到文件末尾）：

```tsx
/**
 * `/` 面板的池子（2026-10-11）——旧的池子是 `projection.all`（本机 2 条开发工具 skill），
 * 新的池子是「服务端命令 **＋** 上游内建」，两源都由外面喂进来（本组件取不到 context）。
 *
 * ⚠️ 本组**只钉「池子里有什么」**：浮层几何、滚动、模糊匹配归真栈
 * （`e2e/real-stack/right-pane-slash-and-model-real.spec.ts`；`LEARNINGS #005-07`：
 * happy-dom 没有 CSS 引擎）。
 */
describe("`/` 面板的池子（两源）", () => {
  test("服务端命令进池子：`data.command` 的每一条都画出来了，`label` 带斜杠", () => {
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel
          data={{
            ...夹具数据(),
            // ⚠️ 形状按被调方真读的两项（`name` / `description`）——`Data` 是巨型类型，
            // 这里用收窄不是 `as`（同本文件既有口径）。
            command: [{ name: "write-as-huzhou-gongan", description: "写湖州公安材料" }],
          }}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={空投影}
          斜杠内建命令={{ 选项: () => [], 执行: () => {} }}
        />
      )),
    )

    打字(宿主, "/")
    const 项 = [...宿主.querySelectorAll("[data-suggestion-id]")]

    expect(项.map((el) => el.getAttribute("data-suggestion-id"))).toEqual(["custom.write-as-huzhou-gongan"])
    expect(项[0].textContent).toContain("/write-as-huzhou-gongan")
  })

  test("上游内建命令也进池子（这是旧的 skill 池子从来没有的那一半）", () => {
    const 宿主 = 摆右栏带命令([])

    打字(宿主, "/")
    const id们 = [...宿主.querySelectorAll("[data-suggestion-id]")].map((el) => el.getAttribute("data-suggestion-id"))

    // 没有 slash 的那条不进（`session.hidden`），带 slash 的进。
    expect(id们).toEqual(["session.new"])
  })

  test("选中内建 ⇒ 调执行（选中即执行那一半）", () => {
    const 收到: string[] = []
    const 宿主 = 摆右栏带命令(收到)

    打字(宿主, "/")
    const 项 = 宿主.querySelector<HTMLElement>('[data-suggestion-id="session.new"]')
    expect(项, "内建那条没画出来").not.toBeNull()
    // Kobalte 的菜单项在 `pointerup` 上选中、`.click()` 不够（`session-list.test.tsx:84` 实测）。
    项!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))

    expect(收到).toEqual(["session.new"])
  })
})
```

⚠️ `打字` / `夹具数据` 是本文件既有夹具（`打字(宿主, 串)` 往 Hero 编辑器里打字、`夹具数据(条数)` 造数据）。`command` 那条要按 `SessionPanelData["command"]` 的真实元素形状补齐必填项——**先读** `packages/session-ui/src/v2/gen/types.gen.ts` 里 `Command` 的定义，只补真必填的那些（别用 `as`）。

- [ ] **Step 2: 跑一遍，确认它是红的**

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/ai-session/session-panel.test.tsx`
Expected: FAIL —— 13 处 `SessionPanel` 挂载点报 `斜杠内建命令` 缺失（typecheck 层）＋ 新 3 条红。记实得输出。

- [ ] **Step 3: 改 `session-panel.tsx`**

① props 接口里追加（放在 `projection` 之后、`onSubmitPrompt` 之前）：

```tsx
  /**
   * `/` 面板里属于**上游内建命令**的那一半（`useCommand()` 的 `slash` 命令）。
   *
   * 另一半（服务端命令表）本组件自己就有——就在 `props.data.command` 里。
   *
   * **必填**。理由同 `projection`：可选就等于「忘了传也没人红」，而忘传的表现是
   * 「`/` 面板里一条内建都没有」——那正是本栏 2026-10-11 之前的缺陷形状（池子里只有
   * 本机 2 条开发工具 skill，而原生那条池子实测 118 条）。
   *
   * ⚠️ **`选项` 是 accessor 不是数组**：`useCommand().options` 是 memo（命令注册表随时可能变），
   * 传值就会把「命令表后到」那一刻的现场冻住。
   *
   * ⚠️ **不在本组件里 `useCommand()`**：测试里只裹 `DialogProvider` / `FileComponentProvider`
   * （见 `session-panel.test.tsx` 的 `原语环境`），在这里取 context 会让那一整个文件的**每一处**
   * 挂载当场抛（`LEARNINGS #005-27`：给组件新加挂载前提时，要找的是「谁把它挂起来」）。
   */
  斜杠内建命令: { 选项: () => readonly 内建命令条[]; 执行: (id: string) => void }
```

② import 区追加（与既有的 `import { projectCapabilities } from "./projection"` 同一处）：

```tsx
import { 右栏选中命令, 右栏斜杠命令, 右栏斜杠源, type 内建命令条 } from "./command-palette"
```

③ 换掉 `命令集` 那一段（原 `const 命令集 = createMemo<PromptInputV2Suggestion[]>(() => skillCommands(props.projection.all))`）：

```tsx
  /**
   * `/` 面板的两个源（T007 📤 的那根线，2026-10-11 由「投影的 `all`」换成「服务端命令表 ＋ 上游内建」）：
   *
   * | 源 | 从哪来 | 为什么 |
   * |---|---|---|
   * | 服务端命令 | `props.data.command` | 真 skill 全集就在这里（`GET /command` 全量装进 `sync.data.command`） |
   * | 上游内建 | `props.斜杠内建命令` | `command.options` 只有 `useCommand()` 拿得到，而那是本组件的**外面** |
   *
   * 用 `createMemo` 而不是裸箭头：两个函数每次会**新造一个数组**，而 controller 底下是
   * `useFilteredList`（`createResource`）——每次读都换新引用会把它的依赖搅乱。
   */
  const 斜杠源 = createMemo(() =>
    右栏斜杠源({
      服务端: props.data.command,
      内建: props.斜杠内建命令.选项(),
      // 本机 skill 的中文显示名（只覆盖 `title`，见 `command-palette.ts` 文件头）。
      // `projection` 这个 prop 因此**继续有活干**——不再只是「有没有传」的证据。
      已知中文名: props.projection.all,
    }),
  )
  const 命令集 = createMemo<PromptInputV2Suggestion[]>(() => 右栏斜杠命令(斜杠源()))
```

④ controller 入参里 `commands: 命令集,` 下面追加一行：

```tsx
    // ⚠️ 这里**必须再包一层箭头**（不能写成 `右栏选中命令(斜杠源(), 执行)`）：那样 `斜杠源()`
    // 在建 controller 那一刻就被读成了一份**值**，而命令表是异步填的 ⇒ 冻住的候选会让
    // 「先建会话、命令表后到」的现场永远选不动内建命令。包一层之后，每次选中都现读。
    onSuggestionSelect: (item) => 右栏选中命令(斜杠源(), props.斜杠内建命令.执行)(item),
```

- [ ] **Step 4: 改 `ai-session-slot.tsx`**

① import 区追加 `useCommand`：

```tsx
import { useCommand } from "@/context/command"
```

（`useCommand` 的存在性与 import 路径先核一遍：`grep -n "export function useCommand" packages/app/src/context/command.tsx`。它的 provider 挂在 `app.tsx` 的 `SharedProviders`（路由根），右栏在它下面 ⇒ 够得着。）

② 组件顶部（`const permission = usePermission()` 附近）加：

```tsx
  // `/` 面板里属于上游内建命令的那一半。`CommandProvider` 挂在 `app.tsx` 的 `SharedProviders`
  // （路由根），右栏在它下面 ⇒ 与 `usePermission()` 同一层拿得到。
  const command = useCommand()
```

③ JSX 里 `projection={投影()}` 下面加：

```tsx
          斜杠内建命令={{
            选项: () => command.options,
            执行: (id) => command.trigger(id, "slash"),
          }}
```

- [ ] **Step 5: 改 `session-panel.stories.tsx` 那一处挂载点**

story 里补 `斜杠内建命令={{ 选项: () => [], 执行: () => {} }}`，并在 story 的注释里写一句：storybook 不接 `useCommand()`（它没有那个 provider），要看真池子去真栈 spec。

- [ ] **Step 6: 补齐 `session-panel.test.tsx` 其余 12 处挂载点**

```bash
cd D:/project/study/openhive/openhive
grep -n "<SessionPanel" packages/app/src/ai-session/session-panel.test.tsx
```

逐个补 `斜杠内建命令={{ 选项: () => [], 执行: () => {} }}`（本文件里大多走 `挂会话` / `挂对话` / `摆右栏` 三个局部辅助，能收进辅助的就收进去——**同一个「右栏怎么摆」两处各写一遍就会静默分家**，`LEARNINGS #002-06`）。

- [ ] **Step 7: 跑测试到绿**

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/ai-session/session-panel.test.tsx`
Expected: PASS（原 88 条 ＋ 新 3 条）

- [ ] **Step 8: 变异验证（④ 步）**

用 `cp` 备份 ＋ **按字节还原**（禁用 `git checkout --`，`LEARNINGS #005-40`）：

- M1：`session-panel.tsx` 的 `内建: props.斜杠内建命令.选项()` 改成 `内建: []` ⇒ 期望「上游内建命令也进池子」那条红（`id们` 实得 `[]`）。
- M2：`onSuggestionSelect` 那一行整行删掉 ⇒ 期望「选中内建 ⇒ 调执行」那条红（`收到` 实得 `[]`）。
- M3：`右栏斜杠源` 里把服务端那一支的 `id: \`custom.${item.name}\`` 改成 `id: item.name` ⇒ 期望「服务端命令进池子」那条红（实得 `["write-as-huzhou-gongan"]`）。

三次都记：拆哪一行 → 红哪几条 → 实得值。若出现「本该红却是绿」，按 `LEARNINGS #005-18` 四问分诊后**据实记**（`#003-03` 三类不能只记恰红那一类）。

- [ ] **Step 9: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/src/ai-session/session-panel.tsx packages/app/src/ai-session/session-panel.test.tsx packages/app/src/ai-session/session-panel.stories.tsx packages/app/src/ai-session/ai-session-slot.tsx
git commit -m "feat(006): 右栏 \`/\` 面板接上两源（服务端命令全集 ＋ 上游内建），选中即执行照原生 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：`session-panel.test.tsx` 全绿；M1/M2/M3 三次变异的红与实得值都记下；`skillCommands` 在 `packages/` 里 **grep 不到**（`#004-01`：数落点要数底层函数被调用的地方）。

---

### Task 3: 模型选择的判断（纯函数）

**Files:**
- Create: `packages/app/src/ai-session/model-selection.ts`
- Create: `packages/app/src/ai-session/model-selection.test.ts`

**Interfaces:**
- Produces（Task 4 / Task 5 都用）：
  - `模型键(providerID: string, modelID: string): string`
  - `从键(键: string): { providerID: string; modelID: string } | undefined`
  - `模型选项(providers: readonly Provider[]): PromptInputV2Option[]`
  - `当前模型键(input: { 本栏选的?: string; 会话记的?: { providerID: string; id: string }; 应用默认?: { providerID: string; modelID: string } }): string | undefined`

- [ ] **Step 1: 写红**

```ts
// packages/app/src/ai-session/model-selection.test.ts
import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { 从键, 模型键, 模型选项, 当前模型键 } from "./model-selection"

/**
 * 右栏底栏模型选择器的**判断**那一半（纯函数；接线在 `ai-session-slot.tsx`，那层挂不起来测）。
 *
 * ## 三个来源的优先级不是随手排的
 *
 * `本栏选的 → 这场会话记的 → 应用默认`：
 * - **本栏选的**优先，因为用户的最后一次点击是最终意愿；
 * - 其次是**会话记的**（服务端 `session.model`）——它由服务端在每次发消息时写
 *   （`packages/opencode/src/session/prompt.ts` 的 `createUserMessage`：模型与库里那条不一致就
 *   `sessions.setAgentModel`）⇒ 切回一场旧会话时，底栏显示的就是那场会话自己的模型；
 * - 最后是**应用默认**——`useProviders().defaultModel()`，服务端归一化后的那一份
 *   （**不**自己跑 `local.tsx` 那套 `configuredModel ?? recent ?? default`：那是同一件事的
 *   第二处写法，`LEARNINGS #002-06`）。
 *
 * ## 为什么恒要有值
 *
 * 上游 `submit.ts` 那两条出口都假设 `draft.model` 必有值：命令分支直接读 `.modelID`（F3，
 * 当场抛），normal 分支 `{...undefined, variant}` 得 `{}`（F4，在服务端是**真值** ⇒ 把
 * `input.model ?? ag.model ?? currentModel()` 的回退链顶掉 ⇒ 报错）。⇒ 本栏恒给一个具体模型，
 * 是 F3/F4 一起收口的**前提**。
 */

const 供应商 = (id: string, 模型: Array<{ id: string; name: string }>): Provider =>
  ({
    id,
    name: id,
    models: Object.fromEntries(模型.map((m) => [m.id, { ...m, providerID: id }])),
  }) as unknown as Provider

describe("模型键：两截拼一个字符串（`PromptInputV2SelectControl.current` 只收一个字符串）", () => {
  test("拼出来是 `providerID/modelID`", () => {
    expect(模型键("anthropic", "claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5")
  })

  test("拆得回来（往返）", () => {
    expect(从键(模型键("anthropic", "claude-sonnet-5-5"))).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-5-5",
    })
  })

  test("模型名自己带斜杠也拆得对（按**第一个**斜杠切：providerID 不含斜杠，modelID 可能含）", () => {
    expect(从键("openrouter/meta-llama/llama-3-70b")).toEqual({
      providerID: "openrouter",
      modelID: "meta-llama/llama-3-70b",
    })
  })

  test("没有斜杠 / 斜杠在头上 / 斜杠在尾上 ⇒ `undefined`（不是一个合法的键）", () => {
    expect(从键("没有斜杠")).toBeUndefined()
    expect(从键("/gpt")).toBeUndefined()
    expect(从键("openai/")).toBeUndefined()
  })
})

describe("候选：已接入的 provider × 它的模型", () => {
  test("每个模型一项，`id` 是键、`label` 是显示名、`providerID` 带上（原生画图标用）", () => {
    expect(模型选项([供应商("openai", [{ id: "gpt", name: "GPT" }])])).toEqual([
      { id: "openai/gpt", label: "GPT", providerID: "openai" },
    ])
  })

  test("两个 provider 的模型全在（不筛 popular、不截断）", () => {
    const 选项 = 模型选项([
      供应商("openai", [{ id: "gpt", name: "GPT" }]),
      供应商("anthropic", [{ id: "sonnet", name: "Sonnet" }]),
    ])

    expect(选项.map((项) => 项.id)).toEqual(["openai/gpt", "anthropic/sonnet"])
  })

  test("显示名是空串时退回模型 id（按钮上就会写「空」）", () => {
    expect(模型选项([供应商("openai", [{ id: "gpt", name: "" }])])[0].label).toBe("gpt")
  })
})

describe("当前模型：本栏选的 → 会话记的 → 应用默认", () => {
  test("三样都有 ⇒ 取**本栏选的**", () => {
    expect(
      当前模型键({
        本栏选的: "openai/gpt",
        会话记的: { providerID: "anthropic", id: "sonnet" },
        应用默认: { providerID: "google", modelID: "gemini" },
      }),
    ).toBe("openai/gpt")
  })

  test("本栏没选过 ⇒ 取**会话记的**（切回旧会话时显示它自己的模型）", () => {
    expect(
      当前模型键({
        会话记的: { providerID: "anthropic", id: "sonnet" },
        应用默认: { providerID: "google", modelID: "gemini" },
      }),
    ).toBe("anthropic/sonnet")
  })

  test("会话也没记过（新建即提交）⇒ 取**应用默认**", () => {
    expect(当前模型键({ 应用默认: { providerID: "google", modelID: "gemini" } })).toBe("google/gemini")
  })

  test("三样都没有 ⇒ `undefined`（此时提交会被守卫挡下，不发出去）", () => {
    expect(当前模型键({})).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/model-selection.test.ts`
Expected: FAIL —— `Cannot find module './model-selection'`。记实得输出。

- [ ] **Step 3: 实现**

```ts
// packages/app/src/ai-session/model-selection.ts
import type { Provider } from "@opencode-ai/sdk/v2"
import type { PromptInputV2Option } from "@opencode-ai/session-ui/v2/prompt-input/types"

/**
 * 底栏模型选择器的**判断**（T0xx / 用户裁定 2026-10-11：「管这场会话，且记住」）。
 *
 * 为什么单独一个文件：真正的接线在 `ai-session-slot.tsx`（纯接线、挂不起来测），
 * 而本文件里全是有对错的判断 —— 与 `session-actions.ts` 同一种分工。
 *
 * ⚠️ 本模块**不做授权过滤**：候选＝「已接入的 provider 的全部模型」，从 `useProviders().connected()`
 * 来。前端隐藏既不阻止调用也不阻止越权（宪法 §四）。
 */

/**
 * 一个模型的两截拼成一个键。
 *
 * `PromptInputV2SelectControl`（`session-ui/v2/components/prompt-input/interaction.ts:22`）的
 * `current` 只收**一个字符串**，`onSelect` 也只回一个 ⇒ 两截得拼。
 */
export function 模型键(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/**
 * 键拆回两截。**按第一个斜杠切**：providerID 不含斜杠（上游 `Provider.id` 是 provider 名），
 * 而 modelID 可能含（`openrouter/meta-llama/llama-3-70b`）。
 *
 * 不是合法形状（没有斜杠 / 斜杠在头或尾）就回 `undefined` —— 调用方据此判「这一支不认」。
 */
export function 从键(键: string): { providerID: string; modelID: string } | undefined {
  const 切 = 键.indexOf("/")
  if (切 <= 0 || 切 === 键.length - 1) return undefined
  return { providerID: 键.slice(0, 切), modelID: 键.slice(切 + 1) }
}

/**
 * 候选清单：`PromptInputV2Option`（原生那两处渲染器吃的形状）。
 *
 * `label` 是**按钮上显示的那一行**（原生 `PromptInputV2Select` 画
 * `options.find(o => o.id === current)?.label ?? current`），空显示名退回模型 id。
 */
export function 模型选项(providers: readonly Provider[]): PromptInputV2Option[] {
  return providers.flatMap((供应商) =>
    Object.values(供应商.models).map((模型) => ({
      id: 模型键(供应商.id, 模型.id),
      label: 模型.name === "" ? 模型.id : 模型.name,
      providerID: 供应商.id,
    })),
  )
}

/**
 * 这一栏现在认的模型键。三个来源，次序即优先级（理由见 `model-selection.test.ts` 文件头）。
 *
 * ⚠️ `会话记的` 的字段名是 **`id`**（服务端 `Session.model` 的形状），
 * `应用默认` 的字段名是 **`modelID`**（`NormalizedProviderListResponse.defaultModel` 的形状）——
 * 两个上游类型就这么长，不是笔误（`LEARNINGS #004-07`：按被调方的字段名逐项打勾）。
 */
export function 当前模型键(input: {
  本栏选的?: string
  会话记的?: { providerID: string; id: string }
  应用默认?: { providerID: string; modelID: string }
}): string | undefined {
  if (input.本栏选的) return input.本栏选的
  if (input.会话记的) return 模型键(input.会话记的.providerID, input.会话记的.id)
  if (input.应用默认?.providerID && input.应用默认.modelID) {
    return 模型键(input.应用默认.providerID, input.应用默认.modelID)
  }
  return undefined
}
```

- [ ] **Step 4: 跑绿**

Run: `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/model-selection.test.ts`
Expected: PASS（11 pass / 0 fail）

- [ ] **Step 5: 变异验证**

- M1：`当前模型键` 里把 `本栏选的` 那一行删掉 ⇒ 「三样都有 ⇒ 取本栏选的」红（实得 `anthropic/sonnet`）。
- M2：`从键` 的 `indexOf` 改成 `lastIndexOf` ⇒ 「模型名自己带斜杠也拆得对」红（实得 `{providerID:"openrouter/meta-llama", modelID:"llama-3-70b"}`）。

- [ ] **Step 6: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/src/ai-session/model-selection.ts packages/app/src/ai-session/model-selection.test.ts
git commit -m "feat(006): 右栏模型选择的判断（键 / 候选 / 当前值优先级）—— 纯函数先落地 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：`model-selection.test.ts` 11 pass / 0 fail；M1/M2 的实得值记下。

---

### Task 4: 底栏模型控件挂进原生 `PromptInputV2`

**Files:**
- Modify: `packages/app/src/ai-session/session-panel.tsx`（新增 1 个必填 prop ＋ `view: { submit, model }`）
- Modify: `packages/app/src/ai-session/ai-session-slot.tsx`（`useProviders()` ＋ `选过的` 状态 ＋ 接线）
- Modify: `packages/app/src/ai-session/session-panel.test.tsx` / `session-panel.stories.tsx`（挂载点）

**Interfaces:**
- Consumes：Task 3 的 `模型选项` / `当前模型键` / `从键`；`PromptInputV2SelectControl`（上游类型）
- Produces：`SessionPanelProps.模型控件: PromptInputV2SelectControl`

- [ ] **Step 1: 写红**

在 `session-panel.test.tsx` 追加一组（**先按真实 DOM 形状写**：原生 `PromptInputV2Select` 的触发器是 `MenuV2.Trigger as ButtonV2`，带 `aria-label`、文字是当前项的 `label`；菜单在 `MenuV2.Portal` 里、落在 `document.body`）：

```tsx
/**
 * 底栏模型控件（2026-10-11）——**没有新写一个字 UI**：走原生 `PromptInputV2` 的
 * `modelControl` fallback（`session-ui/v2/components/prompt-input/index.tsx:229-245`），
 * 那一条渲染的是上游自己的 `PromptInputV2ConfiguredSelect`（`:527-549`）。
 *
 * 本组钉三件：控件**在**、显示的是**当前**那一支、点开能选且**选中会回调**。
 * 几何（坐在底栏哪一行、有没有被裁掉）归真栈（`#005-07`）。
 */
describe("底栏模型控件", () => {
  const 选项 = [
    { id: "openai/gpt", label: "GPT", providerID: "openai" },
    { id: "anthropic/sonnet", label: "Sonnet", providerID: "anthropic" },
  ]
  const 摆 = (当前: string, 收到的: string[]) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={空投影}
          斜杠内建命令={{ 选项: () => [], 执行: () => {} }}
          模型控件={{
            options: () => 选项,
            current: () => 当前,
            onSelect: (id) => void 收到的.push(id),
          }}
        />
      )),
    )

  test("控件在 Hero 输入框里，显示**当前**那一支的名字", () => {
    const 宿主 = 摆("openai/gpt", [])
    const 输入 = 宿主.querySelector('[data-component="prompt-input"]')!

    const 钮 = 输入.querySelector<HTMLElement>('[aria-label="Choose model"]')
    expect(钮, "底栏没有模型控件").not.toBeNull()
    expect(钮!.textContent).toContain("GPT")
  })

  test("当前是另一支 ⇒ 显示的就是那一支（不做自己的默认覆盖）", () => {
    const 宿主 = 摆("anthropic/sonnet", [])

    expect(宿主.querySelector('[aria-label="Choose model"]')!.textContent).toContain("Sonnet")
  })

  /**
   * ⚠️ Kobalte 的菜单：触发器只认 **`pointerdown`**、菜单项只认 **`pointerup`**，`.click()` 不够
   * （`session-list.test.tsx:80-88` / `file-tree.test.tsx:243-262` 两处实测，同一套配方）；
   * 菜单内容在 **Portal** 里 ⇒ `document.body` 上找，不在宿主里（`common-cards.test.tsx:45`）。
   */
  test("点开 ⇒ 候选全在，选中另一支 ⇒ `onSelect` 收到它的 id", () => {
    const 收到: string[] = []
    const 宿主 = 摆("openai/gpt", 收到)

    宿主
      .querySelector('[aria-label="Choose model"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "" }))

    const 项 = [...document.body.querySelectorAll('[role="menuitemradio"]')]
    expect(项.map((el) => el.textContent?.trim())).toEqual(["GPT", "Sonnet"])

    项[1].dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))
    expect(收到).toEqual(["anthropic/sonnet"])
  })
})
```

⚠️ 三个不确定处（实现时**先量、别猜**）：① `aria-label` 的英文串来自 `ui.promptInput.chooseModel`（`packages/ui/src/i18n/en.ts:137` = `"Choose model"`），若 `useI18n()` 的 fallback 不在这个测试里生效，就改断「Hero 里那颗文字是当前模型名的钮」；② 菜单项的 `role` 由 `MenuV2.RadioItem` 决定，先 `document.body.innerHTML` 打一份实况再定；③ 若 happy-dom 下菜单压根开不出来（`#005-29`/`#005-34` 那一族），把这条**降级**为真栈判据（Task 6 的 T3/T4 已覆盖「点开能选」），并在本组文件头据实记「组件层打不开菜单 ⇒ 这一半只有真栈量得到」。

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/ai-session/session-panel.test.tsx`
Expected: FAIL —— 挂载点报 `模型控件` 缺失 ＋ 新 3 条红（实得：`钮` 为 `null`）。记实得输出。

- [ ] **Step 3: 改 `session-panel.tsx`**

① props 追加（紧挨 `斜杠内建命令` 之后）：

```tsx
  /**
   * 底部那一颗模型选择器（用户裁定 2026-10-11：「管这场会话，且记住」）。
   *
   * **没有新控件**：形状就是上游 `PromptInputV2SelectControl`
   * （`session-ui/v2/components/prompt-input/interaction.ts:22`），塞进 controller 的 `view.model`
   * ⇒ 原生 `PromptInputV2` 的 `modelControl` fallback 会渲染**它自己的**
   * `PromptInputV2ConfiguredSelect`（`index.tsx:229-245`）。上游传 `modelControl` 时用的是那颗
   * 富弹层（`ModelSelectorPopoverV2`），那条路要一整套 `ModelState`
   * （`dialog-select-model.tsx:280` 的 `input.model ?? useLocal().model`）⇒ 右栏取不到 `useLocal()`
   * ⇒ 那条**实测否决**（设计文档 §3.2）。
   *
   * **必填**。理由同 `projection`：可选就等于「忘了传也没人红」，而忘传的表现是「底栏空着」。
   *
   * ⚠️ 本组件**不解**「该显示哪个模型」——那是 `model-selection.ts` 的判断（`当前模型键`），
   * 由调用方解好、以「键」的形式喂进来。本组件只把它转给原生件。
   */
  模型控件: PromptInputV2SelectControl
```

② import 区追加类型：

```tsx
import type { PromptInputV2SelectControl } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
```

③ controller 的 `view` 里加 `model`：

```tsx
    view: {
      // ⚠️ 传 `submit` 的**整个对象**（`view.submit` 是上游必填项，见上面那段注释）。
      submit: { … 原样不动 … },
      // 底栏那一颗。原生件在没传 `modelControl` 时会读这个位置（`index.tsx:230`）。
      model: props.模型控件,
    },
```

- [ ] **Step 4: 改 `ai-session-slot.tsx`**

① import 区：

```tsx
import { useProviders } from "@/hooks/use-providers"
import { 从键, 模型选项, 模型键, 当前模型键 } from "./model-selection"
```

② 组件顶部（`const command = useCommand()` 之后）：

```tsx
  /**
   * 已接入的 provider 清单（底栏模型的候选来源）。
   *
   * ⚠️ `useProviders` 内部 `useServerSync()` ＋ `useParams()`，两样右栏都够得着
   * （`useParams` 走的是 `RouterContextObj`，由 `<Router>` 提供、不由 `<Route>` 提供
   * ⇒ 在路由根的这一栏里是安全的）。
   *
   * ⚠️ 目录**跟着当前会话走**（`提交态()?.directory`）：目录作用域的 provider 目录要在
   * 那只目录上有实例时才 ready（`selectProviderCatalog` 的 `explicit: true` 那支）。
   */
  const providers = useProviders(() => 提交态()?.directory)

  /**
   * 本栏「选过」的模型，**按会话记**（用户裁定「管这场会话，且记住」）。
   *
   * 两处记账不是重复（`LEARNINGS #002-06` 讲的不是这种）：这里记的是**界面上这一栏选了什么**
   * （切会话回来立刻显示它），服务端记的是 `session.model`（发出去之后由
   * `prompt.ts` 的 `createUserMessage` 写库，`setAgentModel`）。读的时候前者优先、
   * 后者兜底 —— 唯一处解这个优先级的地方是 `model-selection.ts` 的 `当前模型键`。
   */
  const [选过的, 设置选过的] = createStore<Record<string, string>>({})
  const 现在认的模型 = () => {
    const 现在 = 提交态()
    if (!现在) return undefined
    const 键 = 当前模型键({
      本栏选的: 选过的[现在.sessionID],
      会话记的: 现在.sync.session.get(现在.sessionID)?.model,
      应用默认: providers.defaultModel() ?? undefined,
    })
    return 键 ? 从键(键) : undefined
  }
```

（`createStore` 的 import 与 `createMemo` 同处，`solid-js/store`。）

③ JSX 里 `projection={投影()}` 下面加：

```tsx
          模型控件={{
            options: () => 模型选项(providers.connected()),
            // ⚠️ 空串是**原生件的形状要求**（`current: Accessor<string>`）；候选为空、当前也没有时
            // 触发器上就没有字（设计文档缺口表 G8）。
            current: () => {
              const 现在 = 提交态()
              if (!现在) return ""
              return (
                当前模型键({
                  本栏选的: 选过的[现在.sessionID],
                  会话记的: 现在.sync.session.get(现在.sessionID)?.model,
                  应用默认: providers.defaultModel() ?? undefined,
                }) ?? ""
              )
            },
             // 选中 ⇒ 记在**这一场会话**上（然后 `onSubmitPrompt` 里随提交带出去，
             // 服务端据此写 `session.model`）。
            onSelect: (键) => {
              const 现在 = 提交态()
              if (!现在) return
              设置选过的(现在.sessionID, 键)
            },
          }}
```

⚠️ `模型控件` 那个对象字面量的三个字段都是**闭包**（`options` / `current` 是 accessor，`onSelect` 是回调）⇒ 每次读都现取，不会冻住（与 Task 2 的 `斜杠内建命令.选项` 同一条理由）。

- [ ] **Step 5: 补两处挂载点**

`session-panel.test.tsx` 的 `摆右栏` / `摆右栏带命令` / `挂会话` / `挂对话` / 其余内联处，各补一个最小 `模型控件={{ options: () => [], current: () => "", onSelect: () => {} }}`；`session-panel.stories.tsx` 同（story 里给一份 2 条的假候选，好看得见效果）。

- [ ] **Step 6: 跑绿**

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/ai-session/session-panel.test.tsx`
Expected: PASS（原 91 条 ＋ 新 3 条）

- [ ] **Step 7: 变异验证**

- M1：`session-panel.tsx` 的 `view` 里删掉 `model: props.模型控件,` ⇒ 期望三条全红（第一、二条 `钮` 为 `null`）；**特别注意第三条**：菜单那条会不会**假绿**（`document.body` 里本来就什么都没有 ⇒ `项` 是 `[]` ⇒ `项[1]` 当场 TypeError，是红）。据实记。
- M2：`session-panel.tsx` 的 `current: () => 当前` 改成 `current: () => ""`（在**测试夹具**里改则不算变异；这条改的是**组件**——若组件只是转发就跳过这条，改而拆 `ai-session-slot.tsx` 里 `当前模型键` 的 `会话记的` 那一支，期望真栈那条红、组件层全绿，**据实记这条「组件层盖不住」**）。

- [ ] **Step 8: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/src/ai-session/session-panel.tsx packages/app/src/ai-session/session-panel.test.tsx packages/app/src/ai-session/session-panel.stories.tsx packages/app/src/ai-session/ai-session-slot.tsx
git commit -m "feat(006): 右栏底栏模型选择器 —— 走原生 view.model 空位，零新 UI 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：`session-panel.test.tsx` 全绿；控件那条判据能证明「显示的是当前那一支」（拆掉就红）；若菜单在 happy-dom 下打不开，**据实降级并写进文件头**（不写成已覆盖）。

---

### Task 5: 提交带上模型 ＋ F3/F4 收口 ＋「＋ 新会话」继承

**Files:**
- Modify: `packages/app/src/ai-session/submit-prompt.ts`
- Modify: `packages/app/src/ai-session/submit-prompt.test.ts`
- Modify: `packages/app/src/ai-session/session-actions.ts` / `session-actions.test.ts`
- Modify: `packages/app/src/ai-session/ai-session-slot.tsx`（把模型的**判断**接上 `建会话` 与 `onSubmitPrompt`）

**Interfaces:**
- `submit-prompt.ts` 的 `RightPaneSubmitInput` 增加 `model: { providerID: string; modelID: string } | undefined`（**必填但可为 `undefined`**，与既有的 `session: Session | undefined` 同一个口径）
- `session-actions.ts` 的 `建会话(input: { api; directory; model?: ModelRef })` ⇒ `api.create({ location, model })`

- [ ] **Step 1: 写红（`submit-prompt.test.ts`）**

① 把 `提交` 辅助的默认输入里加上模型（新语义下调用方必须给出判断结果）：

```ts
const 提交 = (
  输入: Partial<Parameters<typeof submitRightPanePrompt>[0]> & { text: string },
  夹具: { api: DirectorySDK["api"]["session"]; sync: DirectorySync },
) =>
  submitRightPanePrompt({
    sessionID: "ses_1",
    sessionDirectory: "/工作区/甲方/项目",
    session: 会话("build", { id: "gpt", providerID: "openai" }),
    // 本栏认的模型（由 `model-selection.ts` 的 `当前模型键` 解出、`从键` 拆开）。
    model: { providerID: "openai", modelID: "gpt" },
    serverSync: 假serverSync,
    ...夹具,
    ...输入,
  })
```

② 把旧的两条改成新语义（**旧的那两条是本次改动的靶子**）：

- 删掉 `test("会话还没记过 model ⇒ 两个字段都**不传**（交给服务端回退，不编空值）")` 与哨兵 `test("⚠️ 已知缺陷：会话没记过 model ＋ 正文命中命令名 ⇒ 当场抛（F3，挂账中）")`，换成：

```ts
  /**
   * **F3 / F4 的收口判据**（2026-10-11 用户裁定「F3 本轮修掉」）。
   *
   * 旧行为：本栏在会话没记过 model 时传 `undefined`，而上游 `submit.ts` 那两条出口都假设它
   * 必有值 —— 命令分支直接读 `.modelID`（F3，当场抛）、normal 分支
   * `{ ...input.draft.model, variant }` 得 `{}`（F4，在服务端是**真值** ⇒ 把
   * `input.model ?? ag.model ?? currentModel()` 的回退链顶掉 ⇒ 拿空对象去解析模型 ⇒ 报错）。
   *
   * 新行为：**本栏认不出任何模型 ⇒ 一个字都不发**（返回 `false`，正文留在框里）。
   * 这条判据同时钉住两端：`false` 的回话（面板据此保留正文）＋ 两个出口都没被碰。
   */
  test("本栏一个模型都认不出 ⇒ **不发**（两个出口都没碰、回话是 `false`）", async () => {
    const { 收到, 命令, api } = 造api()
    const { 乐观, sync } = 造sync(["effect"])

    const 发了 = await 提交({ text: "/effect 帮我看看这段代码", model: undefined }, { api, sync })

    expect(发了).toBe(false)
    expect(收到.length).toBe(0)
    expect(命令.length).toBe(0)
    expect(乐观.length).toBe(0)
  })

  test("本栏认不出模型时，即使正文是普通一句话也不发（不是只挡命令那一条支）", async () => {
    const { 收到, api } = 造api()

    expect(await 提交({ text: "帮我查这个账户的资金流向", model: undefined }, { api, sync: 造sync().sync })).toBe(false)
    expect(收到.length).toBe(0)
  })
```

③ 改那条「model 取会话的」，改成新语义：

```ts
  /**
   * 模型由**调用方**解好传进来（`model-selection.ts` 的 `当前模型键` 一处解、一处测），
   * 本模块只做一件事：把两截换成被调方要的字段名（`FollowupDraft.model = { providerID, modelID }`）。
   *
   * ⚠️ 与旧行为的分工差：旧代码在本模块里从 `session.model` 取（`Session.model.id` ⇒ `modelID`），
   * 于是「本栏选的 vs 会话记的 vs 应用默认」这个判断就散在本模块与界面两处
   * （`LEARNINGS #002-06`）。现在那个判断只在 `model-selection.ts` 里有一份。
   */
  test("本栏给的模型原样交给 draft（字段名按被调方）", async () => {
    const { 收到, api } = 造api()
    // 会话记的是 anthropic —— 本栏给的是 openai，出去的就该是本栏那个（优先级由上游那一处解）。
    await 提交(
      { text: "帮我查这个账户的资金流向", session: 会话("build", { id: "sonnet", providerID: "anthropic" }) },
      { api, sync: 造sync().sync },
    )

    expect(收到[0].model).toEqual({ providerID: "openai", modelID: "gpt" })
  })
```

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/submit-prompt.test.ts`
Expected: FAIL —— ① `model` 参数不存在（typecheck）② 三条新判据红（实得：`发了` 是 `true`、`收到.length` 是 1）。记实得输出。

- [ ] **Step 3: 改 `submit-prompt.ts`**

① `RightPaneSubmitInput` 里把 `session` 那段注释之后的模型说明换成：

```ts
  /**
   * 本栏现在认的模型（**由调用方解好**：`model-selection.ts` 的 `当前模型键` → `从键`）。
   *
   * **必填但可为 `undefined`**（与上面的 `session` 同一个口径）：`undefined` 是「本栏一个都没认出」
   * 这个**事实**，而它不是「忘了传」——忘了传的话 typecheck 会红。
   *
   * ⚠️ 语义变更（2026-10-11 用户裁定「F3 本轮修掉」）：**旧版**本栏在会话没记过 model 时不传，
   * 把缺省交给服务端。那条路是**堵死的**——上游 `submit.ts` 的两条出口都假设 `draft.model` 必有值：
   * 命令分支直接读 `.modelID`（**F3**，当场抛），normal 分支 `{ ...input.draft.model, variant }`
   * 得 `{}`（**F4**，在服务端是**真值** ⇒ 把 `input.model ?? ag.model ?? currentModel()` 顶掉 ⇒
   * 拿空对象去解析模型 ⇒ 报错）。⇒ 本栏改为**恒给**（控件给出的那一支），认不出就不发。
   */
  model: { providerID: string; modelID: string } | undefined
```

② `submitRightPanePrompt` 里，空白正文那一条之后加守卫：

```ts
  // ⚠️ **F3/F4 的收口**：没有模型就一个字都不发（理由见上面 `model` 那段）。
  // 位置在 `draft` 之前：这里返回 `false` ⇒ 面板把正文留在输入框里（`session-panel.tsx` 的
  // `onSubmit`），用户看得见「没发出去」，而不是收到一个 `Cannot read properties of undefined`。
  if (!input.model) return false
```

③ `draft` 里模型那一行换成（**两个 `as` 里的一个就地消失**——守卫之后这里已经是被收窄的非空类型）：

```ts
    // ⚠️ 下面那处 `as` 是**对上游必填类型的唯一让步**（`agent` 那一处）：右栏没有 agent 选择器，
    // 会话也没记过时运行时的值就是 `undefined`，而「不传」是本栏唯一正确的表达。
    // **模型这一处的 `as` 已删**（2026-10-11）：守卫保证到这里它必有值，类型与事实对齐了。
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `FollowupDraft.agent` 必填，而右栏没有 agent 选择器；缺省交给服务端（见上文）。
    agent: input.session?.agent as string,
    model: input.model,
```

④ 文件头那段「⚠️ 已挂账（state.md 缺口表 F3）」整段换成「已修」的记法：写清修法是「本栏恒给模型 ＋ 认不出就不发」，并点名两处落点（`submit.ts:94` / `:136`）与两条判据的位置。

- [ ] **Step 4: 改 `session-actions.ts` / `session-actions.test.ts`**

① 先写红（`session-actions.test.ts` 的 `T015 · 建会话` 组）：

```ts
  test("③ 带模型时，`model` 按被调方的字段名跟在 `location` 后面（`ModelRef` 用 `id`）", async () => {
    const 出口 = 造出口()
    await 建会话({ api: 出口.api, directory: "/proj/甲", model: { providerID: "openai", modelID: "gpt" } })

    expect(出口.建了[0]).toEqual({ location: { directory: "/proj/甲" }, model: { providerID: "openai", id: "gpt" } })
  })
```

（`出口.建了` 是既有夹具里那本账；若不同名，核一遍再写。）

② 跑红：`cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/session-actions.test.ts` ⇒ FAIL（`model` 没被带出去，实得 `{ location: { directory } }`）。

③ 改 `建会话`：

```ts
export async function 建会话(input: {
  api: 会话出口
  directory: string
  /**
   * 新会话用的模型（`ModelRef`：**字段名是 `id`**，不是 `modelID` —— 这是被调方的形状，
   * 与 `FollowupDraft.model.modelID` 不同名，`LEARNINGS #004-07`）。
   *
   * 传它就等于「新会话一出生就记着这个模型」⇒ 底栏那颗控件显示的、以及第一条消息带出去的
   * 都是它（F3/F4 收口的另一半：新会话不再有「没记过 model」的那一段窗口）。
   * 不传 ＝ 这一栏一个模型都认不出（`module-selection.ts` 的 `当前模型键` 回 `undefined`）。
   */
  model?: { providerID: string; modelID: string }
}): Promise<string> {
  const 会话 = await input.api.create({
    location: { directory: input.directory },
    ...(input.model ? { model: { providerID: input.model.providerID, id: input.model.modelID } } : {}),
  })
  return 会话.id
}
```

并把那条注释里「`agent` / `model` 同样可选，本处**不传**：右栏没有选择器」改成新的事实。

- [ ] **Step 5: 接线（`ai-session-slot.tsx`）**

① `onNewSession` 里把 `建会话({ api: 现在.api, directory: 现在.directory })` 改成：

```tsx
              return 建会话({ api: 现在.api, directory: 现在.directory, model: 现在认的模型() })
```

② `onSubmitPrompt` 里 `submitRightPanePrompt({...})` 的参数加一行：

```tsx
              // 模型的判断在 `model-selection.ts`（一处解、一处测）；本栏认不出时是 `undefined`，
              // 那时 `submitRightPanePrompt` 一个字都不发（F3/F4 的收口）。
              model: 现在认的模型(),
```

- [ ] **Step 6: 跑绿**

Run:
```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/submit-prompt.test.ts
bun test --conditions=solid --preload ./happydom.ts ./src/ai-session/session-actions.test.ts
```
Expected: 两个文件都 PASS。

- [ ] **Step 7: 变异验证**

- M1：删掉 `if (!input.model) return false` 那一行 ⇒ 期望「本栏一个模型都认不出 ⇒ 不发」红（实得 `发了` 是 `true`、`命令.length` 是 1 —— **那正是 F3 的现场**：`.modelID` 读 `undefined` 抛出去）。**把这条红的样子逐字记下来**，它就是「F3 已修」的反证。
- M2：`建会话` 改成 `model: { providerID: input.model.providerID, modelID: input.model.modelID }`（字段名写错）⇒ 期望「③ 带模型时」红；**并记一笔**：这个错法在类型上活不下来（`ModelRef` 没有 `modelID`），所以红会**先来自 typecheck** ⇒ 据实记「变异由 typecheck 抓住，运行时判据没红」。

- [ ] **Step 8: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/src/ai-session/submit-prompt.ts packages/app/src/ai-session/submit-prompt.test.ts packages/app/src/ai-session/session-actions.ts packages/app/src/ai-session/session-actions.test.ts packages/app/src/ai-session/ai-session-slot.tsx
git commit -m "fix(006): F3 与 F4 同根因收口 —— 右栏恒给模型、认不出就不发；新建会话继承本栏选择 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：两个测试文件全绿；M1 的红是「F3 那一句 `Cannot read properties of undefined (reading 'modelID')`」而不是别的；`submit-prompt.ts` 里 `no-unsafe-type-assertion` 的 disable 注释从 2 处降到 1 处（`grep -c` 记数）。

---

### Task 6: 真栈验收 ＋ 门禁 ＋ 文档回填

**Files:**
- Create: `packages/app/e2e/real-stack/right-pane-slash-and-model-real.spec.ts`
- Modify: `docs/superpowers/specs/006-ai-session/state.md` / `tasks.md`

- [ ] **Step 1: 写真栈 spec（蓝本就是本次那支探针）**

把 `packages/app/e2e/real-stack/slash-probe-real.spec.ts`（已提交 `f6589b7ce6`，**探针留在原地别动**——它是 ① 步的取证记录）里那套 `readStack` / `建真会话` / `setup` 原样搬过来，改成带判据的验收：

```ts
import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 右栏「`/` 命令面板 ＋ 底栏模型选择器」的真栈验收（2026-10-11）。
 *
 * 为什么这一层非有不可（`LEARNINGS #005-07` / `#006-08`）：
 * - **池子的条数**：组件层的 `data.command` 是夹具喂的，真池子有多少条只有真内核答得出
 *   （探针实测 118 条）；
 * - **几何**：弹层在不在视口内、底栏那颗钮坐在哪一行，happy-dom 量不出来；
 * - **接缝**：`ai-session-slot.tsx` 那一层挂不起来测（要活着的服务器连接），
 *   「slot 有没有把 `useCommand()` 供上」只有真栈看得见。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    alice: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`
const directory = () => path.join(readStack().sandbox, "workspaces", readStack().alice)

async function 建真会话(title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
})

async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory: directory(), server: FRONT(), sessionID },
  )
}

/** 打开真栈、落在右栏、把 Hero 输入框里打上 `text`。 */
async function 开右栏并打字(page: Page, text: string) {
  const 会话 = await 建真会话("斜杠与模型验收会话")
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const 输入 = 面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')
  await expect(输入).toBeVisible()
  await 输入.click()
  await 输入.fill(text)
  await page.waitForTimeout(700)
  return { 面板, 输入 }
}

test("T1 · `/` 的池子＝服务端命令全集 ＋ 上游内建（不是本机那 2 条开发工具 skill）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "/")

  const 项 = await 面板.locator("[data-suggestion-id]").evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute("data-suggestion-id") ?? "", 文字: (el.textContent ?? "").trim() })),
  )

  // ① 条数：真内核那边 `GET /command` 实测 118 条。断言「≥100」是为了不把 118 这个数字焊死
  //    （沙箱里装了哪些 skill 会变），同时足以把「只有 2 条」那个旧缺陷钉死。
  expect(项.length, `池子只有 ${项.length} 条：${JSON.stringify(项.slice(0, 5))}`).toBeGreaterThanOrEqual(100)
  // ② 里面有**服务端命令**（`custom.` 前缀是 `右栏斜杠源` 给服务端那一支的 id 形状）。
  expect(项.filter((一条) => 一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ③ 里面有**上游内建**（id 不带 `custom.` 前缀的那一支）——这是旧的 skill 池子从来没有的一半。
  expect(项.filter((一条) => !一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ④ 每一行的 `label` 都带斜杠（原生浮层画的就是 `label`）。
  expect(项.every((一条) => 一条.文字.startsWith("/"))).toBe(true)
})

test("T2 · 选中一条**服务端命令** ⇒ token 留在正文里（不是选中即执行那一半）", async ({ page }) => {
  const { 面板, 输入 } = await 开右栏并打字(page, "/")
  const 服务端那条 = 面板.locator('[data-suggestion-id^="custom."]').first()
  const 名字 = ((await 服务端那条.textContent()) ?? "").trim()

  await 服务端那条.click()
  await page.waitForTimeout(300)

  // 正文里留下 `/<命令名>`（`machine.ts` 的 `replaceTrigger` 干的事），且**没有**发出去任何消息。
  expect(await 输入.innerText()).toContain(名字)
  expect(await 面板.locator('[data-slot="session-turns"] [data-component="session-turn"]').count()).toBe(0)
})

test("T3 · 底栏有模型控件：坐在输入框里、按钮上写着当前模型、点开有候选", async ({ page }) => {
  const { 面板, 输入 } = await 开右栏并打字(page, "")
  const 钮 = 输入.locator('[aria-label="Choose model"]')
  await expect(钮, "底栏没有模型控件").toBeVisible()

  const 盒 = await 钮.boundingBox()
  const 视口 = page.viewportSize()
  expect(盒, "控件没有盒").not.toBeNull()
  expect(盒!.width, "控件宽度为 0").toBeGreaterThan(0)
  expect(盒!.x, "控件跑到视口左边外面").toBeGreaterThanOrEqual(0)
  expect(盒!.x + 盒!.width, "控件跑到视口右边外面").toBeLessThanOrEqual(视口!.width)

  // 点开 ⇒ 菜单里有候选（候选条数 = 沙箱里已接入 provider 的模型数，这里只要求 > 0）。
  const 当前名 = (await 钮.innerText()).trim()
  await 钮.click() // `MenuV2` 的触发器在真栈里认 `click`（真浏览器有完整的指针事件序列）
  await page.waitForTimeout(400)
  const 候选 = page.locator('[role="menuitemradio"]')
  expect(await 候选.count(), `点开只有 0 个候选（当前显示「${当前名}」）`).toBeGreaterThan(0)
  await page.keyboard.press("Escape")
})

test("T4 · 选另一支 ⇒ 按钮上的名字当场变（「管这场会话」的可见那一半）", async ({ page }) => {
  const { 输入 } = await 开右栏并打字(page, "")
  const 钮 = 输入.locator('[aria-label="Choose model"]')
  await 钮.click()
  await page.waitForTimeout(400)

  const 候选 = page.locator('[role="menuitemradio"]')
  const 条数 = await 候选.count()
  test.skip(条数 < 2, "沙箱里只有一个模型可挑（挑不动）")
  const 当前 = (await 钮.innerText()).trim()
  const 目标 = 候选.filter({ hasNotText: 当前 }).first()
  const 目标名 = ((await 目标.textContent()) ?? "").trim() || (await 目标.getAttribute("aria-label")) || ""

  await 目标.click()
  await page.waitForTimeout(300)

  expect((await 钮.innerText()).trim()).not.toBe(当前)
  console.log(`【模型切换】${当前} → ${目标名}`)
})
```

⚠️ 实现时**先按实况校**（不许猜）：① `[aria-label="Choose model"]` 的串来自 `ui.promptInput.chooseModel`（`packages/ui/src/i18n/en.ts:137`），若真栈的 i18n 是别的语言，用 `pw: snapshot` 或 `page.locator('button').allTextContents()` 打一份实况再改选择器；② 菜单项的 `role` 与可真栈点击的成败都以实况为准（点不开就记成缺口，别硬编）。

- [ ] **Step 2: 起真栈跑**

```bash
cd packages/app
export TEMP="C:/Users/Administrator/AppData/Local/Temp/oh-diag" TMP="$TEMP" TMPDIR="$TEMP"
export REAL_STACK_FRONT_PORT=… REAL_STACK_KERNEL_PORT=…
export E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
bunx playwright test e2e/real-stack/right-pane-slash-and-model-real.spec.ts --config=e2e/real-stack/playwright.config.ts --reporter=list
```

Expected: 4 passed（单条约 40s）。**把 T1 打印出来的实得条数记下来**（它同时是「池子已经是对的」的读数）。

- [ ] **Step 3: ⑥ 步 —— 同类落点逐个打勾**

```bash
cd D:/project/study/openhive/openhive
# ① 还有谁在给右栏的 `/` 面板供料？
grep -rn "skillCommands\|projection.all\|projection()\.all" --include=*.ts --include=*.tsx packages
# ② 还有谁把「模型」当成「会话没记过就传 undefined」处理？
grep -rn "draft.model\|input.model\|session?.model\|会话记的" --include=*.ts --include=*.tsx packages/app/src
# ③ 还有谁在容器里直接吃 commands / modelControl / view.model？
grep -rn "modelControl\|view: {" --include=*.tsx packages/app/src | grep -v "prompt-input-v2.tsx"
```

逐条判：① 预期 0 处（`projection.all` 只剩 `projection.ts` 的定义与它的单测——**保留字段不删**，设计文档 §6 已写明）；② 预期只剩 `model-selection.ts` 与 `submit-prompt.ts` 两处，且后者只是转发；③ 预期右栏之外没有生产落点。**把实得清单与结论写进提交信息**。

- [ ] **Step 4: 门禁（仓库根，串行）**

```bash
cd D:/project/study/openhive/openhive
bun run typecheck                     # 期望 31/31
cd packages/app && bun run test:unit && bun run test:components
cd D:/project/study/openhive/openhive && bun run lint 2>&1 | tail -5   # 只关心改动文件的 scoped 结果
bunx oxlint packages/app/src/ai-session --deny-warnings                # 期望 0 warning / 0 error
git diff --stat bun.lock                                               # 期望空
cd packages/app && bunx tsgo -p e2e/tsconfig.json                      # 新 spec 的 typecheck
```

⚠️ 根 lint 有 1 个**上游遗留 error**（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`，`LEARNINGS #001-02` 已裁定不私改）⇒ 全局退出码恒为 1，**只报改动文件的那一份结果**，并注明根 lint 那个 error 是老的。
⚠️ 门禁**串行跑**（`#003-01`：并行跑多道会造假红）。

- [ ] **Step 5: 回填文档**

① `docs/superpowers/specs/006-ai-session/state.md`：

- 缺口表里 **F3** 与 **F4** 两行改为「**已修（2026-10-11）**」，并各写一句修法与判据位置（`submit-prompt.test.ts` 的两条新判据 + 变异 M1 的红）。
- 缺口表新增 **F6**（本轮新挂的）：`packages/app/src/ai-session/session-panel.test.tsx` 的模型菜单那一半若在 happy-dom 下打不开 ⇒ 只有真栈量得到（据实写是哪种）。
- 正文里凡「右栏没有选择器 / 不传 model / `/` 面板吃 `projection.all`」的旧说法，逐条改到新事实（`grep -n "projection.all\|没有选择器\|不传 model" docs/superpowers/specs/006-ai-session/*.md`）。

② `tasks.md` 追加本轮条目（编号接在现有最大号之后）：

```
- [x] ⑧-1 `/` 面板的池子换成两源（服务端命令全集 ＋ 上游内建命令），选中即执行照原生
      —— 真栈 T1 实测池子 ___ 条（旧行为 2 条）
- [x] ⑧-2 底栏模型选择器（走原生 `view.model` 空位，零新 UI）：管这场会话、随提交写回 `session.model`
- [x] ⑧-3 F3 / F4 同根因收口：恒给模型 ＋ 认不出就不发；「＋ 新会话」继承本栏选择
```

（`___` 处填 Step 2 的实得条数。）

- [ ] **Step 6: 收尾对账（`superpowers:verification-before-completion`）**

逐条对总判据打勾；对不上的**逐条写实得**，不写「基本完成」。

- [ ] **Step 7: 提交**

```bash
cd D:/project/study/openhive/openhive
git add packages/app/e2e/real-stack/right-pane-slash-and-model-real.spec.ts docs/superpowers/specs/006-ai-session/state.md docs/superpowers/specs/006-ai-session/tasks.md
git commit -m "test(006): 右栏 \`/\` 池子与底栏模型控件的真栈验收（4 passed）＋ 缺口表 F3/F4 收口回填 【保留的定制 · 同步上游时不要丢】"
```

**完成判据**：真栈 4 passed 且 T1 的实得条数已记；门禁四项按实得输出记录（跑不动/没跑的要明说）；缺口表 F3/F4 是「已修」而不是「观察」。

---

## Self-Review（写完之后自查，逐项已过）

1. **规格覆盖**：设计文档 §3.1（`/` 池子）/ §3.2（模型控件）/ §3.3（F3，含新发现的 F4）/ §3.4（接线图）/ §5（验证策略）→ Task 1–6 逐条落点：
   - `/` 池子两源 → Task 1（纯函数）＋ Task 2（接线）＋ Task 6 T1
   - 选中即执行 → Task 1（判据）＋ Task 2（组件层 spy）＋ Task 6 T2（另一半）
   - 模型控件 → Task 3（判断）＋ Task 4（挂载）＋ Task 6 T3/T4
   - F3（＋F4）→ Task 5
   - 「记住」→ Task 3 的优先级 ＋ Task 4 的 `选过的` ＋ Task 5 的「随提交写回 `session.model`」
   - 缺口表 G1–G6（设计文档原有）＋ 本轮新增 G7/G8/G9/G10 → Task 0 Step 3
   - 两条开工前裁定 → `title` 原生为底＋已知 skill 叠中文名（Task 1 的 Produces 段与两条新判据）；执行方式＝Subagent 逐任务驱动（`superpowers:subagent-driven-development`）
2. **占位符扫描**：无 TBD / 「加适当的错误处理」/ 「类似 Task N」。全文代码块都是可直接落盘的实现；三处「实现时先量、别猜」（菜单 role / aria-label 串 / 真栈选择器）都点名了**量什么、怎么量**，不是「待定」。
3. **类型一致性**：
   - `斜杠源条` / `右栏斜杠源` / `右栏斜杠命令` / `右栏选中命令` 在 Task 1 定义，Task 2 用的名字逐字相同；
   - `内建命令条` 六项（`id`/`title`/`description`/`slash`/`suggested`/`disabled`）与 `CommandOption` 对得上；
   - `模型键` / `从键` / `模型选项` / `当前模型键` 在 Task 3 定义，Task 4 / Task 5 用的名字逐字相同；
   - **字段名不一致是事实、不是笔误**：`Session.model` 用 `id`、`NormalizedProviderListResponse.defaultModel` 用 `modelID`、`ModelRef` 用 `id`、`FollowupDraft.model` 用 `modelID` —— 四处各自点名了出处（`LEARNINGS #004-07`）。
