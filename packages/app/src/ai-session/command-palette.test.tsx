import { afterEach, describe, expect, test } from "bun:test"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input/types"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { SkillCapability } from "./capabilities"
import { skillCommands } from "./command-palette"

/**
 * `/` 命令面板（FR-005 / US3 场景 2 / DESIGN §4.7.4）。
 *
 * ## 这一条为什么不是「新写一个浮层」
 *
 * §4.7.4 的硬指令：**能换数据源就不新写**。开工时核过了，原生 `v2/prompt-input` 自带的那个
 * 弹层（`PromptInputV2Popover`）**本来就挂在 `/` 上**——
 *
 * | 环节 | 原件（`packages/session-ui/src/v2/components/prompt-input/`） |
 * |---|---|
 * | 打 `/` 唤起 | `machine.ts` 的 `inputChanged`：正文匹配 `/^\/(\S*)$/` ⇒ `popover = { type: "command-inline" }` |
 * | 浮层形态 | `index.tsx` 的 `PromptInputV2Popover`（§4.7.4 那张表就是它的逐字实况） |
 * | 模糊匹配 | `interaction.ts` 的 `commandList = useFilteredList({ filterKeys: ["trigger", "title"] })` |
 * | 数据源（**唯一的空位**） | controller 入参 `commands: Accessor<PromptInputV2Suggestion[]>` |
 *
 * 所以 T007 的产品码就是**那一个空位的填充**：`skillCommands(清单) → PromptInputV2Suggestion[]`。
 * 接线（把它传进右栏 Hero 输入的 controller）是 T008。**本文件里的判据全是端到端的**——
 * 真的 `createPromptInputV2Controller`、真的状态机、真的 `fuzzysort`，只把数据源换成 skill。
 *
 * ## 断言的来源
 *
 * 出参是「**输入 `/` 唤起 + 模糊匹配**」，所以判据压在两条上：① 打 `/` 之后弹层真的开、
 * 列的是 skill 全集；② 继续打字真的会**筛**（中文打显示名、英文打连接键都算）。
 * 长相那一半（浮层的 class）**不在这里钉**——那是原生组件的活，§4.7.4 也已把它写成「照搬」。
 */

/** 挂过的 root，外层 `afterEach` 里统一 dispose（`LEARNINGS #005-03` 的同型：谁建的响应式作用域谁收）。 */
const 建过的: Array<() => void> = []

afterEach(() => {
  while (建过的.length) 建过的.pop()!()
})

/**
 * 夹具：一条 skill。
 *
 * ⚠️ `id`（连接键）与 `显示名` **刻意不同值**，而**生产里今天两者相同**
 * （`capabilities.ts` 的 `MANIFESTS` 两条都是 `skill` 与 `name` 同值）。
 * 目的只有一个：让「显示 / 插入取的是**连接键**、`title` 取的是**显示名**」这两条断言
 * **今天就有牙**——把适配里那两处对调（`label` 换成显示名、或 `title` 换成连接键），
 * 下面的断言**当场红**；若夹具让两者同值，那些变异**摘不出来**，断言就是空的
 * （`LEARNINGS #004-13`）。`capabilities.ts` 自己写着「009 落地后 ID 可能与显示名分家
 * （如 `fund-link-analysis` / 「资金关联分析」）」——**它变成真断言的那天是 009**，
 * 今天它同时是一条探测器与哨兵（`#005-15`：别让注释比断言强）。
 */
const 造skill = (id: string, 显示名: string, description: string): SkillCapability => ({
  skill: id,
  name: 显示名,
  description,
  group: "业务研判",
  cards: [],
})

const 资金 = 造skill("fund-link-analysis", "资金关联分析", "按账户拉资金往来的关联图")
/**
 * 第二条的显示名刻意**不含**它连接键里的任何一段英文。
 *
 * 一开始我写成「RTL 与 LTR」，而连接键是 `rtl-aware-development`——于是「打 `/rtl` 按**连接键**筛」
 * 那条断言其实是被 `title` 命中的（`filterKeys` 两项都在搜），**它测的不是它说的那件事**。
 * 变异把它照出来了：把 `trigger` 换成显示名之后，那条断言**照样绿**（`#005-15`：注释不许比断言强）。
 * 换成纯中文显示名之后，`/rtl` 只可能从 `trigger` 命中。
 */
const 方向 = 造skill("rtl-aware-development", "双语方向适配", "RTL / LTR behavior in the web app")
const 默认清单 = [资金, 方向]

/** 一个 tick。`useFilteredList` 底下是 `createResource`，结果**不是同步**就绪的。 */
const 歇 = () => new Promise((r) => setTimeout(r, 10))

/**
 * 把清单接进**原生 controller**（§4.7.4 的那一个空位），返回几个取数口。
 *
 * 装配照 `packages/session-ui/src/v2/components/prompt-input/prompt-input.stories.tsx`
 * 的最小用例抄——`store` 就是 `createStore` 那个 tuple，`view` 只给 controller 真的会碰的那几项。
 */
async function 起会话(清单: readonly SkillCapability[] = 默认清单) {
  let 取: { suggestions: () => Array<{ id: string }>; value: () => string; popover: () => { type: string } } | undefined
  let 打正文: ((串: string) => Promise<void>) | undefined
  let 开面板: (() => void) | undefined
  let 选中第: ((i: number) => Promise<void>) | undefined

  await new Promise<void>((done) =>
    createRoot((dispose) => {
      建过的.push(dispose)

      const store = createStore<PromptInputV2PersistedState>({
        prompt: [{ type: "text", content: "", start: 0, end: 0 }],
        cursor: 0,
        context: { items: [] },
      })

      const controller = createPromptInputV2Controller({
        store,
        commands: () => skillCommands(清单),
        context: () => [],
        searchContextFiles: () => [],
        view: { submit: { stopping: () => false, onSubmit: () => {}, onStop: () => {} } },
      })

      取 = {
        suggestions: () => controller.suggestions(),
        value: () => controller.value(),
        popover: () => controller.state.popover,
      }
      打正文 = async (串: string) => {
        controller.onInput(串, [{ type: "text", content: 串, start: 0, end: 串.length }], 串.length)
        await 歇()
      }
      开面板 = () => controller.openCommands()
      选中第 = async (i: number) => {
        controller.dispatch({ type: "popover.select", item: controller.suggestions()[i] })
        await 歇()
      }
      done()
    }),
  )

  return { 取: 取!, 打正文: 打正文!, 开面板: 开面板!, 选中第: 选中第! }
}

/** 弹层里现在挂着哪几条（按 `id`，顺序即列表顺序）。 */
const 列出 = (取: { suggestions: () => Array<{ id: string }> }) => 取.suggestions().map((条) => 条.id)

describe("`/` 命令面板的适配层（FR-005 / §4.7.4）", () => {
  test("一条 skill 映射成一个 command 建议：`label` 与 `trigger` 取**连接键**、`title` 取**显示名**", () => {
    // 2026-10-07 裁定：`label` 取连接键。理由与两个备选的取舍见 `state.md` 的「T007 出参」。
    // 关键的**实测**依据：原生弹层渲染的是 `item.label`（`index.tsx` 的 `PromptInputV2Popover`
    // 只画 `label` ＋ `description`，**`title` 根本不显示**），而选中后插进正文的也是 `label`
    // （`machine.ts` 的 `suggestionSelected` 走 `replaceTrigger`）⇒ `label` 一物二用，
    // **没法**做成「显示中文名、插入连接键」。
    const [一条] = skillCommands([资金])

    expect(一条.kind).toBe("command")
    expect(一条.label).toBe("/fund-link-analysis")
    expect(一条.trigger).toBe("fund-link-analysis")
    expect(一条.title).toBe("资金关联分析")
    expect(一条.description).toBe("按账户拉资金往来的关联图")
  })

  test("`id` 逐条不同（它是原生 `useFilteredList` 的键，撞了会静默丢条目）", () => {
    // `types.ts` 的 `PromptInputV2Suggestion.id` 是列表的 `key`（`interaction.ts` 的
    // `key: (item) => item.id`）。id 撞上时 `createList` 只认一条，列表**静默少一项**。
    // ⚠️ 这里断的是**集合**不是**序列**——顺序归下一条管。一开始写成了有序 `toEqual`，
    // 「反过来排」那个变异就红在这条头上，而它声称的是「id 各不相同」（`#005-15`）。
    const 两条 = skillCommands(默认清单)

    expect(new Set(两条.map((条) => 条.id)).size).toBe(2)
  })

  test("顺序 = 清单给的顺序（不排序），条数 = 清单的条数（FR-005 的「skill **全集**」）", () => {
    expect(skillCommands(默认清单).map((条) => 条.trigger)).toEqual(["fund-link-analysis", "rtl-aware-development"])
  })

  test("空清单 ⇒ 空建议（不抛错、不塞占位项）", () => {
    expect(skillCommands([])).toEqual([])
  })
})

describe("`/` 唤起 + 模糊匹配（真 controller + 真 fuzzysort，§4.7.4）", () => {
  test("打 `/` ⇒ 弹层开（`command-inline`）且列出 skill 全集", async () => {
    // 这一条同时是**「机制是活的」的对照**（`LEARNINGS #004-08`）：下面几条断「筛掉谁」，
    // 若这条链路压根没通，那些「筛完是空的」会**绿得毫无意义**。
    const { 取, 打正文 } = await 起会话()

    // 「打 `/` 之前弹层是关着的」——**只有这一条**当前置。
    // ⚠️ 这里**不能**顺手断一句「之前列表是空的」：`suggestions()` 读的是那个过滤列表，
    // 它**与弹层开关无关**（`interaction.ts` 的 `suggestions = () => list().flat()`，
    // 建 controller 时就把 `commands()` 收进去了，资源一 resolve 就有内容）。
    // 「列表是活的」由下面几条来证——筛掉谁、全不匹配时为空——而不是由一句假的前置。
    expect(取.popover().type).toBe("closed")

    await 打正文("/")

    expect(取.popover().type).toBe("command-inline")
    expect(列出(取)).toEqual(["skill.fund-link-analysis", "skill.rtl-aware-development"])
  })

  test("接着打**中文** ⇒ 按显示名筛到那一条（民警记不住英文标识符也不影响用）", async () => {
    const { 取, 打正文 } = await 起会话()

    await 打正文("/资")

    expect(列出(取)).toEqual(["skill.fund-link-analysis"])
  })

  test("接着打**英文** ⇒ 按连接键筛到那一条（`filterKeys` 两项：trigger 与 title）", async () => {
    // 与上一条成对：只写中文那条时，把 `title` 挪出 `filterKeys`、或把 `trigger` 填成中文
    // 显示名，都可能只红一条；两条一起才钉住「**两个键都在搜**」。
    const { 取, 打正文 } = await 起会话()

    await 打正文("/rtl")

    expect(列出(取)).toEqual(["skill.rtl-aware-development"])
  })

  test("打成真·模糊：`/资金分析` 命中显示名「资金关联分析」（中间跳过「关联」）", async () => {
    // 「模糊匹配」不是「子串包含」——`资金分析` **不是** `资金关联分析` 的子串。
    // 这条钉的是底层 `fuzzysort` 的子序列语义，也是 FR-005 措辞「模糊匹配」的直接判据。
    const { 取, 打正文 } = await 起会话()

    await 打正文("/资金分析")

    expect(列出(取)).toEqual(["skill.fund-link-analysis"])
  })

  test("什么都不匹配 ⇒ 空列表（不是「列全集」）", async () => {
    const { 取, 打正文 } = await 起会话()

    await 打正文("/zzzz")

    expect(列出(取)).toEqual([])
  })

  test("正文非空时唤起 ⇒ 走浮层那条路（`command-menu`），列表同样是 skill 全集", async () => {
    // machine 有两支：正文为空时 `command-inline`（把 `/` 写进正文就地筛），非空时
    // `command-menu`（浮层 + 顶部搜索框）。**两支吃的是同一个 `commands()`**——
    // 只测一支的话，另一支的数据源断了不会有任何断言跳出来（`LEARNINGS #005-11`）。
    const { 取, 打正文, 开面板 } = await 起会话()

    await 打正文("帮我看看这个账户")

    expect(取.popover().type).toBe("closed")

    开面板()
    await 歇()

    expect(取.popover().type).toBe("command-menu")
    expect(列出(取)).toEqual(["skill.fund-link-analysis", "skill.rtl-aware-development"])
  })

  test("选中一条 ⇒ 插进正文的是**连接键**（`/fund-link-analysis `），弹层关上", async () => {
    // 这一条是 2026-10-07 那条裁定的**回归网**：原生 `suggestionSelected` 把 `label` 就地
    // 替换进正文，而 `label` = 连接键 ⇒ 民警打的是中文、插进去的是标识符。
    // 若哪天有人把 `label` 改成显示名，这条会红——而不是等到执行层认不出那个名字时才红。
    const { 取, 打正文, 选中第 } = await 起会话()

    await 打正文("/资")
    await 选中第(0)

    expect(取.value()).toBe("/fund-link-analysis ")
    expect(取.popover().type).toBe("closed")
  })
})
