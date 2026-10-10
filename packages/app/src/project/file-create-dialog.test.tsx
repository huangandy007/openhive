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

function 触发器(props: Omit<FileCreateDialogProps, "onConfirm"> & { 收到: string[] }): JSX.Element {
  const dialog = useDialog()
  return (
    <button
      data-slot="open"
      onClick={() =>
        dialog.show(() => <FileCreateDialog {...props} onConfirm={(name) => props.收到.push(name)} />)
      }
    >
      开
    </button>
  )
}

async function 打开(props: Omit<FileCreateDialogProps, "onConfirm">): Promise<string[]> {
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
})
