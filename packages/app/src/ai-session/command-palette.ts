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
 * ⚠️ **本函数不保证新鲜性**：它读的是**调用时传进来的那个数组**（`源`），不现读任何 store。
 * 新鲜性由**调用侧**负责——Task 2 必须传 memo accessor 的结果、在**选中时刻**取，不要提前把
 * 数组快照进来（服务端命令是异步到达的，见 `server-sync.tsx` 的 `void loadCommands(...)`；
 * `LEARNINGS #006-13` 的同族：同一个数据两个时间点的写法）。
 */
export function 右栏选中命令(
  源: readonly 斜杠源条[],
  执行: (id: string) => void,
): (item: PromptInputV2Suggestion) => (() => void) | void {
  return (item) => {
    if (item.kind !== "command") return undefined
    const 选中的 = 源.find((条) => 条.id === item.id)
    if (!选中的 || 选中的.type === "custom") return undefined
    return () => 执行(选中的.id)
  }
}
