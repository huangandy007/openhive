/**
 * 「新建文件 / 新建文件夹」弹窗（005 · 2026-10-11 用户下达：新建不再落**行内输入条**，改弹窗）。
 *
 * ## 这一条钉的是「名字怎么收」这半件事
 *
 * 弹窗**不在树里**（`dialog.show` 传送到 `document.body`），所以本文件一律查 `document`，
 * 与 `change-password-dialog.test.tsx` 同款。树那一侧（哪个入口 ⇒ 落点在哪儿）由
 * `file-tree.test.tsx` 钉——两件事分开，红了才看得出是哪一半。
 *
 * ## 判据「值不值得交出去」复用 `改名草稿`，不在这里再写一份
 *
 * 「trim 后为空 ⇒ 不算」「交出去的是 trim 后的值」两条都在 `@/components/inline-rename-input`
 * 的 `改名草稿` 里（`LEARNINGS #002-06`：同一个判断不许两处各写一份）。新建这一支没有「原名」，
 * 于是传 `undefined`——那个函数的第二条判据（与原样相同 ⇒ 不改）在这里自然不成立。
 * 本文件有一条专门钉它（两头空白 ⇒ 交出去的是 trim 后的名字）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileCreateDialog, type FileCreateDialogProps } from "./file-create-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 剧本：`回话` = 服务端每次回的那句话（`string` = 没办成）；`在飞` = 手工控回话时机的通道。 */
interface 剧本 {
  回话?: string
  在飞?: Promise<string | undefined>
}

function 触发器(props: Omit<FileCreateDialogProps, "onConfirm"> & { 收到: string[] } & 剧本): JSX.Element {
  const dialog = useDialog()
  return (
    <button
      data-slot="open"
      onClick={() =>
        dialog.show(() => (
          <FileCreateDialog
            {...props}
            onConfirm={(name) => {
              // 块体 ⇒ 返回 `void`，落在新契约的 `| void` 那一支上。
              // （原来那个表达式体 `(name) => props.收到.push(name)` 返回 `number`——
              //  `number` **落不进**新契约的联合类型，2026-10-16 用 `tsc --strict` 实测过。）
              props.收到.push(name)
              return props.在飞 ?? props.回话
            }}
          />
        ))
      }
    >
      开
    </button>
  )
}

async function 打开(props: Omit<FileCreateDialogProps, "onConfirm"> & 剧本): Promise<string[]> {
  const 收到: string[] = []
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器({ ...props, 收到 })}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return 收到
}

/**
 * 弹窗里那个输入框。
 *
 * ⚠️ 不按自己传的 `data-slot` 查：`TextInputV2` 把 `data-slot="text-input-v2-input"` **写在
 * `{...inputProps}` 之后**，调用方传进去的名字**被静默覆盖**（同 `LEARNINGS #005-22` 的
 * `ContextMenuTrigger`）。所以这里按**它自己的**槽位查。
 */
const 框 = () => {
  const el = document.body.querySelector<HTMLInputElement>("[data-slot='file-create-dialog'] input")
  if (!el) throw new Error("弹窗里没有输入框——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  return el
}

/** 确定那颗（`data-slot` 落在 `ButtonV2` 自己那层，`rest` 原样透传，不会被覆盖）。 */
const 确定 = () => document.body.querySelector<HTMLButtonElement>("[data-slot='file-create-ok']")

const 填 = (值: string) => {
  const el = 框()
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 走真实的表单提交（`ButtonV2 type="submit"` 在 happy-dom 里点不出一条 `submit`，故直接派发）。 */
const 提交 = () => {
  const form = document.body.querySelector<HTMLFormElement>("[data-slot='file-create-dialog']")
  if (!form) throw new Error("弹窗里没有表单")
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

const 文案 = (slot: string) => document.body.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

/** 新建文件清单（`file-create-catalog.ts` 的 9 个大类画出来的那一片）。 */
const 大类们 = () => [...document.body.querySelectorAll<HTMLElement>("[data-slot='file-create-category']")]

const 大类 = (名称: string) => {
  const el = 大类们().find((候选) => 候选.dataset.category === 名称)
  if (!el) throw new Error(`没有「${名称}」大类——这条用例的前提不成立`)
  return el
}

const 后缀们 = () => [...document.body.querySelectorAll<HTMLElement>("[data-slot='file-create-suffix']")]

const 后缀项 = (后缀: string) => {
  const el = 后缀们().find((候选) => 候选.dataset.suffix === 后缀)
  if (!el) throw new Error(`没有「${后缀}」后缀项——这条用例的前提不成立`)
  return el
}

const 勾 = (后缀: string) => 后缀项(后缀).click()

/** 新建弹窗还在不在。**布尔**，不是节点——见 `file-op-error.test.tsx` 顶部那条警告。 */
const 弹窗在 = () => document.body.querySelector("[data-slot='file-create-dialog']") !== null

/**
 * `useDialog().close()` 是两步：状态**立刻**变、节点 **~100ms 后**才 `dispose()`
 * （`context/dialog.tsx:57` 的 `setTimeout`，`LEARNINGS #005-33`）。
 * ⇒ 「弹窗还在吗」在 `setTimeout 0` 的窗里**恒真**，零判别力。
 * 这个助手一直等到它**不见**为止（有界上限）；`false` = 整个窗口里它都没消失。
 */
const 等它没了 = async (上限 = 25) => {
  for (let i = 0; i < 上限 && 弹窗在(); i++) await new Promise((r) => setTimeout(r, 20))
  return !弹窗在()
}

describe("新建弹窗（FileCreateDialog）", () => {
  test("建文件 ⇒ 标题是「新建文件」", async () => {
    await 打开({ kind: "file", parent: "" })

    expect(文案("dialog-header-title")).toBe("新建文件")
  })

  /** `kind` 是服务端 `Schema.Literals(["file","directory"])` 要逐字对上的那一个（翻错当场 400）。 */
  test("建文件夹 ⇒ 标题是「新建文件夹」", async () => {
    await 打开({ kind: "directory", parent: "" })

    expect(文案("dialog-header-title")).toBe("新建文件夹")
  })

  /**
   * 落点提示（用户 2026-10-11 裁定「要显示」）。
   *
   * 弹窗一盖，树就不在眼前了——「选中目录 ⇒ 建在它里面、选中文件 ⇒ 建在它所在目录、没选 ⇒ 根」
   * 这条规则是**看不见**的，不说出来用户就不知道自己建到了哪儿。
   */
  test("落点是子目录 ⇒ 把它写出来", async () => {
    await 打开({ kind: "file", parent: "资料/内层" })

    expect(文案("file-create-parent")).toContain("资料/内层")
  })

  /** 空落点**要说「项目根目录」**，不能只留一个冒号——「什么都没写」和「写在根上」是两句话。 */
  test("落点是根 ⇒ 说「项目根目录」", async () => {
    await 打开({ kind: "file", parent: "" })

    expect(文案("file-create-parent")).toContain("项目根目录")
  })

  test("名字没填 ⇒ 「确定」是禁用态——不假装能建一个没名字的条目", async () => {
    await 打开({ kind: "file", parent: "" })
    expect(确定()?.disabled).toBe(true)

    填("话单.csv")

    expect(确定()?.disabled).toBe(false)
  })

  test("只敲了空白 ⇒ 仍是禁用态（「空」是 trim 之后算的）", async () => {
    await 打开({ kind: "file", parent: "" })

    填("   ")

    expect(确定()?.disabled).toBe(true)
  })

  test("提交 ⇒ 交出去的只有一个名字（kind / parent 由树的入口自己带着，不必弹窗再传一遍）", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("话单.csv")
    提交()

    expect(收到).toEqual(["话单.csv"])
  })

  /** 两头空白是输入法的边角，不是名字的一部分——判据在 `改名草稿` 里，这里钉它**真的被用上了**。 */
  test("名字两头带空白 ⇒ 交出去的是 trim 后的值", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("  话单.csv  ")
    提交()

    expect(收到).toEqual(["话单.csv"])
  })

  test("点「取消」⇒ 一次都没喊", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("建了一半")
    document.body.querySelector<HTMLButtonElement>("[data-slot='file-create-cancel']")?.click()

    expect(收到).toEqual([])
  })

  /**
   * ── 「失败回到发起它的那个面」（2026-10-16）────────────────────────
   *
   * 改之前：`确定()` **立刻** `dialog.close()`，服务端那句话落在**工具栏下方**的内联红字里
   * （`workspace-entry.tsx` 的 `file-op-message`）——用户在弹窗里按了确定，话掉到一棵树之外，
   * 既看不到名字还在不在、也不知道该不该重来（民警 2026-10-16 实报）。
   * 改之后：回了字符串 ⇒ 弹窗**不关**、话就地在落点那行下面。
   */

  test("没办成 ⇒ 弹窗**不关**、服务端原话就地显示、名字草稿还在", async () => {
    await 打开({ kind: "file", parent: "资料", 回话: "目标目录不存在" })

    填("新.md")
    提交()
    await flush()
    await flush()

    // 主判据：那句话在**弹窗里那一件**上（`FileOpError` 的根带 `data-slot="file-op-error"`）
    expect(文案("file-op-error") ?? "").toContain("目标目录不存在")
    // 这只是 flush 窗里「还在」，**不是**「不关」的证据——那个窗里旧实现（提交即 close）也还在；
    // 「不关」的证据在下面那条「扛过 dispose 窗」的用例里。
    expect(弹窗在()).toBe(true)
    // 名字草稿留着：改一处就能再交一次，不必重开、重敲
    expect(框().value).toBe("新.md")
  })

  test("没办成 ⇒ 过了 dispose 窗它**还在**（这才是「不关」的证据）", async () => {
    await 打开({ kind: "file", parent: "资料", 回话: "目标目录不存在" })

    填("新.md")
    提交()

    // 主判据：「不关」= 扛过那 ~100ms 的 dispose 窗之后它还开着。
    // 只断一句 `弹窗在()` 是**空转**——旧实现（提交即 `close()`）在那个窗里也满足。
    expect(await 等它没了()).toBe(false)
  })

  /**
   * 「办成 ⇒ 关掉」——**另一半**方向（`file-delete-dialog.test.tsx` 两个方向都有，本文件此前只守了「不关」）。
   *
   * ⚠️ 这是 2026-10-16 这次改动**新造出来的分支**：改之前 `确定()` **无条件** `close()`，「不关」这个
   * 可能性不存在，所以旧代码不需要这条判据；改之后它有了两支，只守一支等于没守（一个「办成也不关」的
   * 回归会让 `bun test` 整轮全绿——既有的成功路径用例只断树 / 清单 / 请求次数，弹窗消没消失没人看）。
   *
   * 这里必须用 `等它没了()`（有界轮询扛过 ~100ms 的 dispose 窗），不能断一句 `弹窗在()`——
   * 那个窗里**两支都还在**，零判别力（`LEARNINGS #005-33`）。
   */
  test("办成（回 `undefined`）⇒ 弹窗关掉", async () => {
    await 打开({ kind: "file", parent: "资料" })

    填("新.md")
    提交()

    expect(await 等它没了()).toBe(true)
  })

  /**
   * ⚠️ 这条用例在 happy-dom 里对「改没改」**没有判别力**——旧实现（提交即 `close()`）在
   * dispose 窗内节点仍在 DOM，二次提交照样喊到回调（`LEARNINGS #005-33`）。它守的是
   * 「失败后还能再交一次」这个行为本身，**不是**本改动的守护者。留着，但别让后来人高估它。
   */
  test("没办成之后改个名字再交 ⇒ **会再发一次**（弹窗没关，所以这条链还在）", async () => {
    const 收到 = await 打开({ kind: "file", parent: "资料", 回话: "目标目录不存在" })

    填("新.md")
    提交()
    await flush()
    await flush()

    填("改过的.md")
    提交()
    await flush()
    await flush()

    expect(收到).toEqual(["新.md", "改过的.md"])
  })

  /**
   * ── 大类 + 后缀选择（013 · T3，用户 2026-11-16 裁定）────────────────
   *
   * 类型区从「一排胶囊」换成「9 个大类，每类一行、后缀流式」：大类名只是分组标题
   * （不可点），同一时刻至多选一个后缀，再点已选的一项即取消。
   * 默认不选 = 普通文件——这条语义与胶囊时代相同，不能因为换了控件就走样。
   * 2026-11-16 二轮又去掉了勾选框与「V」、改成蜜蜂金边框（见下方专门用例）。
   */

  test("九个大类按序出现", async () => {
    await 打开({ kind: "file", parent: "" })

    expect(大类们().map((el) => el.dataset.category)).toEqual([
      "文档",
      "表格",
      "图文",
      "关系图",
      "思维导图",
      "PDF",
      "图片",
      "网页",
      "代码",
    ])
  })

  /** 用户原话：大类标题是**纯分组标题**（不可点、不承担选择）。做成 button 就是另一种交互。 */
  test("大类标题是纯文本，不是按钮", async () => {
    await 打开({ kind: "file", parent: "" })
    const title = 大类("文档").querySelector<HTMLElement>("[data-slot='file-create-category-title']")
    if (!title) throw new Error("没有大类标题——这条用例的前提不成立")

    expect(title.tagName).not.toBe("BUTTON")
    expect(title.closest("button")).toBeNull()
  })

  /**
   * 勾选框与「V」**去掉了**（用户 2026-11-16 第二裁定：「现在看来这个 V 不应该要」）。
   *
   * 原来那条「勾选框在标签之前」的用例随判据一起删——判据不再是「先后顺序」，而是
   * 「不存在」。选中与否由**金边框**表达（见下面那条金边框用例），不再靠一个占位的勾。
   */
  test("后缀按钮里没有勾选框、也没有「V」——文本就是后缀本身", async () => {
    await 打开({ kind: "file", parent: "" })

    // 非空前提：没有后缀时 `every` 会真空通过（`#005-18`）。
    expect(后缀们().length).toBeGreaterThan(0)
    for (const 项 of 后缀们()) {
      // ⚠️ 用布尔断言而不是 `.toBeNull()`：本机实测 `expect(元素).toBeNull()` 在命中非空元素时
      // 出现过**通过**（2026-11-16，bun 1.4.3 + happy-dom + solid-jsx preload；同一形态下
      // `expect(元素 === null).toBe(true)` 才如实报红）。隔离探针复现不了，成因未定 ⇒
      // 这里改用布尔形式，并把「元素确实在文档里」立成前提（`#005-18` 假绿第一问）。
      expect(document.body.contains(项)).toBe(true)
      expect(项.querySelector("[data-slot='file-create-suffix-check']") === null).toBe(true)
      expect(项.textContent?.trim()).toBe(项.dataset.suffix ?? "")
    }
  })

  /** 默认不勾 = 普通文件；也不该有大类被高亮。 */
  test("默认一个都没勾", async () => {
    await 打开({ kind: "file", parent: "" })

    // 先立非空前提：旧界面（胶囊）下后缀集合为空，`every` / `toEqual([])` 会真空通过（`#005-18`）。
    expect(大类们().length).toBe(9)
    expect(后缀们().length).toBeGreaterThan(0)
    expect(后缀们().map((el) => el.getAttribute("aria-checked"))).toEqual(后缀们().map(() => "false"))
    expect(大类们().map((el) => el.dataset.selected)).toEqual(大类们().map(() => "false"))
  })

  /**
   * 标题不可点不只看标签名（2026-11-16 审查 R15）：若把标题包进一个带 `onClick` 的非 button
   * 容器，`tagName !== "BUTTON"` 照样绿。这里用**行为**钉：点标题后没有任何后缀被勾、提交名不变。
   */
  test("点大类标题 ⇒ 什么也不发生（不选中、不补后缀）", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("张三")
    const title = 大类("文档").querySelector<HTMLElement>("[data-slot='file-create-category-title']")
    if (!title) throw new Error("没有大类标题——这条用例的前提不成立")
    title.click()
    await flush()

    expect(后缀们().every((el) => el.getAttribute("aria-checked") === "false")).toBe(true)
    提交()
    expect(收到).toEqual(["张三"])
  })

  /**
   * 选中样式与选中态同源（2026-11-16 审查 R6）：只断 `aria-checked` 的话，把两个 class
   * 三元分支改成同一串，用例照样全绿（`#005-18`）。这里钉「视觉分支确实不同」。
   */
  test("勾中的后缀与未勾的样式类不同（高亮不是只写在 aria 上）", async () => {
    await 打开({ kind: "file", parent: "" })

    勾(".docx")

    expect(后缀项(".docx").className).not.toBe(后缀项(".xlsx").className)
  })

  /**
   * 选中态 = **蜜蜂金边框**（用户 2026-11-16 第二裁定：「边框用蜜蜂金颜色」）。
   *
   * 断的是**具体 token**，不是「两个 class 串不同」——后者在把金色换成任意别的颜色时照样绿
   * （`#005-18` 假绿第一问：断言的是不是要证的那件事）。
   * `border-v2-border-border-focus` 取 `--v2-brand-gold`（#D97706，DESIGN §1.1），与
   * `governance/audit-log.tsx` / `template-lib.tsx` 的选中条目同一先例，不新造色。
   */
  test("选中的后缀用蜜蜂金边框，未选中的不是", async () => {
    await 打开({ kind: "file", parent: "" })

    勾(".docx")

    expect(后缀项(".docx").className).toContain("border-v2-border-border-focus")
    expect(后缀项(".xlsx").className).not.toContain("border-v2-border-border-focus")
    expect(后缀项(".xlsx").className).toContain("border-v2-border-border-muted")
  })

  /** 方框缩小（用户 2026-11-16：「后续可以适当缩小方框」，本轮就缩）。 */
  test("后缀方框缩到 12px、内边距收窄", async () => {
    await 打开({ kind: "file", parent: "" })

    // 非空前提：没有后缀时循环空转（`#005-18`）。
    expect(后缀们().length).toBeGreaterThan(0)
    for (const 项 of 后缀们()) {
      expect(项.className).toContain("text-[12px]")
      expect(项.className).toContain("px-1.5")
      expect(项.className).toContain("py-0.5")
    }
  })

  /**
   * 大类名**加粗、用正文色**（用户 2026-11-16：「让大类类名更突出……大类名称可以考虑加粗」），
   * 选中该大类的后缀时染蜜蜂金——否则用户在长清单里看不出勾的东西属于哪个大类。
   */
  test("大类名默认加粗用正文色；选中某后缀后该类名染金，其它类名不变", async () => {
    await 打开({ kind: "file", parent: "" })

    const 标题 = (名称: string) => {
      const el = 大类(名称).querySelector<HTMLElement>("[data-slot='file-create-category-title']")
      if (!el) throw new Error(`没有「${名称}」标题——前提不成立`)
      return el
    }

    expect(标题("文档").className).toContain("font-semibold")
    expect(标题("文档").className).toContain("text-v2-text-text-base")

    勾(".docx")

    expect(标题("文档").className).toContain("text-v2-text-text-accent")
    expect(标题("表格").className).toContain("text-v2-text-text-base")
    expect(标题("表格").className).not.toContain("text-v2-text-text-accent")
  })

  /**
   * 排布结构（用户 2026-11-16：「后缀直接在大类排在一行中」）：每个 section 是两格网格——
   * 左格类名、右格后缀容器。happy-dom 量不了几何，「真的在同一行」进缺口表（真栈视觉验收）；
   * 这里钉**结构声明**：两格、类名在左格、后缀容器就是右格本身。
   */
  test("类名与后缀是同一行的两格（左类名、右后缀）", async () => {
    await 打开({ kind: "file", parent: "" })

    const 区 = 大类("文档")
    const 标题 = 区.querySelector<HTMLElement>("[data-slot='file-create-category-title']")
    const 组 = 区.querySelector<HTMLElement>("[role='group']")
    if (!标题 || !组) throw new Error("标题或后缀容器缺失——前提不成立")

    expect(区.className).toContain("grid-cols-[4.5rem_1fr]")
    expect(区.children.length).toBe(2)
    expect(区.children[0]?.contains(标题)).toBe(true)
    expect(区.children[1]).toBe(组)
  })

  /** 清单限高自己滚（用户 2026-11-16：「是不是可以在有限的一个界面中展现」）。 */
  test("清单区限高并自己滚（确定按钮不在里面）", async () => {
    await 打开({ kind: "file", parent: "" })

    const catalog = document.body.querySelector<HTMLElement>("[data-slot='file-create-catalog']")
    if (!catalog) throw new Error("没有清单区——前提不成立")

    expect(catalog.className).toContain("max-h-")
    expect(catalog.className).toContain("overflow-y-auto")
  })

  test("勾 .docx ⇒ 提交名补 .docx、该项打勾、所属大类高亮", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("张三")
    勾(".docx")

    const 项 = 后缀项(".docx")
    expect(项.getAttribute("aria-checked")).toBe("true")
    expect(项.dataset.picked).toBe("true")
    expect(大类("文档").dataset.selected).toBe("true")
    for (const 其它 of 大类们()) {
      if (其它.dataset.category !== "文档") expect(其它.dataset.selected).toBe("false")
    }

    提交()
    expect(收到).toEqual(["张三.docx"])
  })

  test("互斥：先勾 .docx 再勾 .xlsx ⇒ 只有后者被勾，名字只补一次", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("张三")
    勾(".docx")
    勾(".xlsx")

    expect(后缀项(".docx").getAttribute("aria-checked")).toBe("false")
    expect(后缀项(".xlsx").getAttribute("aria-checked")).toBe("true")

    提交()
    expect(收到).toEqual(["张三.xlsx"])
  })

  test("再点已勾的后缀 ⇒ 取消勾选，名字原样", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("张三")
    勾(".docx")
    勾(".docx")

    expect(后缀们().every((el) => el.getAttribute("aria-checked") === "false")).toBe(true)
    expect(大类们().every((el) => el.dataset.selected === "false")).toBe(true)

    提交()
    expect(收到).toEqual(["张三"])
  })

  /** 追加语义（spec §2）：已带同后缀（大小写不敏感）不重复加；带其它后缀照常追加。 */
  test("追加语义：张三.md + .hgraph ⇒ 张三.md.hgraph；.HGRAPH 不重复加", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("张三.md")
    勾(".hgraph")
    提交()
    expect(收到).toEqual(["张三.md.hgraph"])

    // 关掉这一份，再开一份干净的（同一个用例里先后问两次）
    document.body.querySelector<HTMLButtonElement>("[data-slot='file-create-cancel']")?.click()
    if (!(await 等它没了())) throw new Error("第一份弹窗没关掉——第二段的查询会落到旧节点上")

    const 收到2 = await 打开({ kind: "file", parent: "" })
    填("张三.HGRAPH")
    勾(".hgraph")
    提交()
    expect(收到2).toEqual(["张三.HGRAPH"])
  })

  test("代码大类默认折叠；点「展开」出现、再点消失", async () => {
    await 打开({ kind: "file", parent: "" })

    expect(document.body.querySelector("[data-suffix='.ts']")).toBeNull()
    const toggle = 大类("代码").querySelector<HTMLButtonElement>("[data-slot='file-create-category-toggle']")
    if (!toggle) throw new Error("代码大类没有折叠开关——前提不成立")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")

    toggle.click()
    await flush()
    expect(后缀项(".ts")).toBeDefined()
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    toggle.click()
    await flush()
    expect(document.body.querySelector("[data-suffix='.ts']")).toBeNull()
  })

  /**
   * 折叠是**看**的动作，不是选的动作（2026-11-16 裁定）：选中 `.ts` 后收起「代码」，
   * 提交名仍补 `.ts`，且「代码」标题保持高亮——否则用户看不出自己选了什么。
   * 反过来说，如果把「收起」实现成「清空选中」，这条会红，改动者必须显式决定。
   */
  test("选中代码后缀后收起大类 ⇒ 选择保留、提交名仍补后缀、标题仍高亮", async () => {
    const 收到 = await 打开({ kind: "file", parent: "" })

    填("脚本")
    const toggle = 大类("代码").querySelector<HTMLButtonElement>("[data-slot='file-create-category-toggle']")
    if (!toggle) throw new Error("代码大类没有折叠开关——前提不成立")
    toggle.click()
    await flush()
    勾(".ts")
    expect(大类("代码").dataset.selected).toBe("true")

    toggle.click()
    await flush()
    expect(document.body.querySelector("[data-suffix='.ts']")).toBeNull()
    expect(大类("代码").dataset.selected).toBe("true")

    提交()
    expect(收到).toEqual(["脚本.ts"])
  })

  /**
   * 布局结构（2026-11-16 审查 R1）：`dialog-container` 默认写死 368px，而 9 大类装不下。
   * 修法是 `fit` + body 自己滚，footer 必须在滚动区之外——否则「展开代码」后确定/取消会被推走。
   * happy-dom 量不了 CSS，这里只钉结构；真实观感进缺口表（真栈视觉验收）。
   */
  test("确定按钮不在滚动清单里（footer 固定）", async () => {
    await 打开({ kind: "file", parent: "" })

    const catalog = document.body.querySelector("[data-slot='file-create-catalog']")
    const ok = document.body.querySelector("[data-slot='file-create-ok']")
    if (!catalog || !ok) throw new Error("清单或确定按钮缺失——前提不成立")

    expect(catalog.contains(ok)).toBe(false)
    expect(catalog.closest("[data-slot='dialog-body']")).not.toBeNull()
  })

  test("新建文件夹的弹窗里没有清单（目录不能变成 .docx/.hgraph）", async () => {
    await 打开({ kind: "directory", parent: "" })

    expect(document.body.querySelector("[data-slot='file-create-catalog']")).toBeNull()
  })

  test("勾了后缀但名字为空 ⇒ 「确定」仍禁用", async () => {
    await 打开({ kind: "file", parent: "" })

    勾(".docx")

    expect(确定()?.disabled).toBe(true)
  })

  test("在飞时再按一次「确定」⇒ 只发一次（这个洞是「弹窗不关」新造出来的）", async () => {
    let 放行: ((话: string | undefined) => void) | undefined
    // 一条**不自己兑现**的 promise 当剧本，由本用例手工放行
    const 在飞 = new Promise<string | undefined>((resolve) => (放行 = resolve))
    const 收到 = await 打开({ kind: "file", parent: "资料", 在飞 })

    填("新.md")
    提交()
    提交() // 第二次：此刻回话还没到（`在飞` 尚未兑现）
    await flush()
    放行?.(undefined)
    await flush()
    await flush()

    expect(收到).toEqual(["新.md"])
  })
})

