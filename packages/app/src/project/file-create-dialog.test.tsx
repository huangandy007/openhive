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
