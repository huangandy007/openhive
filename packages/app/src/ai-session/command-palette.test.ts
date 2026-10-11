import { describe, expect, test } from "bun:test"
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

const 服务端 = (...条: string[]) => 条.map((name) => ({ name }))

const 内建 = (...条: Array<Partial<内建命令条> & { id: string }>): 内建命令条[] =>
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
