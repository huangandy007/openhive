import type { PromptInputV2Suggestion } from "@opencode-ai/session-ui/v2/prompt-input/types"
import type { SkillCapability } from "./capabilities"

/**
 * `/` 命令面板（FR-005 / US3 场景 2 / DESIGN §4.7.4）——**本文件只有一个映射函数，没有浮层**。
 *
 * ## 为什么这里没有 UI
 *
 * §4.7.4 的硬指令是「**能换数据源就不新写**」（第一号约束：与上游的冲突面越小越好）。开工时
 * 逐环核过了，原生 `v2/prompt-input` 自带的那个弹层**本来就挂在 `/` 上**：
 *
 * | 环节 | 原件（`packages/session-ui/src/v2/components/prompt-input/`） |
 * |---|---|
 * | 打 `/` 唤起 | `machine.ts` 的 `inputChanged`：正文匹配 `/^\/(\S*)$/` ⇒ `popover = { type: "command-inline" }`；正文非空时走 `openCommands()` 的 `command-menu` 支 |
 * | 浮层形态 | `index.tsx` 的 `PromptInputV2Popover`——§4.7.4 那张表就是它 class 串的**逐字实况** |
 * | 模糊匹配 | `interaction.ts` 的 `commandList = useFilteredList({ filterKeys: ["trigger", "title"] })`（`fuzzysort`，真子序列） |
 * | 数据源 | **唯一的空位**：controller 入参 `commands: Accessor<PromptInputV2Suggestion[]>` |
 *
 * 那个空位今天填的是上游自己的东西（`packages/app/src/components/prompt-input-v2.tsx` 里的
 * 「SDK 自定义命令 ＋ 内置斜杠命令」）。上游那个文件是**高频文件**（改它 = 每次同步上游都冲突，
 * 见 CLAUDE.md 的 Anti-Patterns），所以本函数**不碰它**——它是一份**并列的数据源**，接线由
 * T008 的右栏 Hero 输入完成（`session-panel.tsx` 把 `skillCommands(projectCapabilities(...).all)`
 * 传进 controller）。
 *
 * ## 映射的形状取自上游
 *
 * 上游 `prompt-input-v2.tsx` 的 `slashCommands()` 就是这件事的蓝本：
 * `{ id, trigger, title, description }` ⇒ `{ id, kind: "command", label: \`/${trigger}\`, trigger, title, description }`。
 * 本函数只换「数据从哪来」（skill 清单，取代 SDK 命令表），形状一字不改——形状一改，
 * `useFilteredList` 的 `filterKeys` 与 `machine.ts` 的 `suggestionSelected` 就都对不上了。
 *
 * ## 2026-10-07 裁定：`label` / `trigger` 取**连接键**，`title` 取**显示名**
 *
 * 三个候选（连接键 / 中文显示名 / 完全照上游 `title: item.name`）里选了第一个，依据是**实测**：
 *
 * 1. 原生弹层渲染的是 **`item.label`**（`index.tsx` 只画 `label` ＋ `description`，
 *    **`title` 根本不显示**），而选中后插进正文的也是 `label`（`machine.ts` 的
 *    `suggestionSelected` 走 `replaceTrigger`）⇒ `label` **一物二用**，做不出
 *    「显示中文名、插入连接键」；
 * 2. 插进正文的那个 token 会原样成为 **prompt 正文**，下游（T010/T011 的执行层）要能把它对回
 *    一个 skill。skill 的连接键就是它的寻址名（`capabilities.ts` 的 `SkillCapability.skill`，
 *    等于 `SKILL.md` 的 frontmatter `name`）——用显示名寻址等于**另起一套**、且会随 009 的
 *    文案漂；
 * 3. 民警**不必记英文**：`filterKeys` 含 `title`，打中文一样筛得到。列表里显示的是标识符，
 *    右侧跟着的是中文 `description`（原生就画）。
 *
 * ⚠️ `title` 填显示名（而不是照上游自定义命令那样填标识符）是**这条裁定的一部分**：
 * 它正是「打中文能搜到」的来源。`command-palette.test.tsx` 里有一条断言专门钉它，夹具刻意让
 * 连接键与显示名**不同值**（`fund-link-analysis` / 「资金关联分析」），好让这条断言今天就有牙
 * ——生产里两者同值（`MANIFESTS` 两条都是），差别要到 009 才显形（`LEARNINGS #004-13`）。
 *
 * ## 授权过滤
 *
 * **不做**（2026-10-07 裁定 U2 / 宪法 §四）：传进来的就是 `projectCapabilities(...).all`，
 * 「本机扫到的 skill 全集里属于当前模块的那部分」，不是「该用户有权的 skill」。
 * 前端隐藏既不阻止调用也不阻止越权——授权在执行层强制。
 */
export function skillCommands(skills: readonly SkillCapability[]): PromptInputV2Suggestion[] {
  return skills.map((条) => ({
    // 前缀 `skill.` 只为可读——原生的 id 只是列表键（`useFilteredList` 的 `key`），
    // 与 `custom.` / 内置命令的 id 不属于同一个命名空间就不会撞。
    id: `skill.${条.skill}`,
    kind: "command",
    label: `/${条.skill}`,
    trigger: 条.skill,
    title: 条.name,
    description: 条.description,
  }))
}
