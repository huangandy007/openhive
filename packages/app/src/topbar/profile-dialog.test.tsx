/**
 * 「个人信息」（2026-10-09 用户下达：下拉三项全部真实实现；本项裁定为**只读展示**）。
 *
 * ## 只读不是偷懒，是**没有接口可写**
 *
 * 内核网关这一侧只有三条：`/login`、`/me`、`/change-password` 与 `/logout`
 * （`packages/opencode/src/server/openhive/gateway.ts` 的 `PATH`）。身份的四样东西里
 * **警号是登录名**、姓名由管理员录入——两样都不是本人能改的，全仓也没有任何更新身份的端点。
 * 所以这一项做成「照 `Identity` 展示」，**不画任何输入框**：画了就是一个点了没反应的假控件。
 *
 * ## 这一条测的是**接线**，不是那几行字
 *
 * 三个字段取自 `props.identity`，不是写死的常量——故有一条**对照**（换一个管理员、换一份
 * 身份，屏幕上的角色就跟着换）。只写正向那一条的话，把角色写成字面量「民警」照样全绿
 * （`LEARNINGS #006-22` 同族：断言要能红）。
 *
 * ⚠️ 弹窗本体经上游 `useDialog()` 的栈渲染（`Kobalte.Portal` ⇒ 落在 `document.body` 上），
 * 故本文件一律从 `document.body` 取，不从宿主取。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import type { Identity } from "@/auth/gateway"
import { ProfileDialog } from "./profile-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  // 顺序：**先 dispose、再清 body**（`LEARNINGS #005-03` / 与 workspace-entry 同款）。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

/** 让 `dialog.show` 里那次 `startTransition` 落定。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 民警: Identity = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
  mustChangePw: false,
}

/**
 * 触发器：自己要一个 `useDialog()` 才能把弹窗推进栈里——这正是生产里
 * `topbar-connected.tsx` 做的事（那边是点菜单项，这里是点一个按钮）。
 */
function 触发器(props: { identity: Identity }): JSX.Element {
  const dialog = useDialog()
  return (
    <button data-slot="open" onClick={() => dialog.show(() => <ProfileDialog identity={props.identity} />)}>
      开
    </button>
  )
}

async function 打开(identity: Identity): Promise<void> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器({ identity })}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
}

const 字段 = (name: string) => document.body.querySelector(`[data-field='${name}']`)?.textContent?.trim()

describe("个人信息（只读展示）", () => {
  test("三个字段：姓名 / 警号 / 角色", async () => {
    await 打开(民警)

    expect(字段("name")).toBe("张三")
    expect(字段("policeNo")).toBe("020601")
    expect(字段("role")).toBe("民警")
  })

  // 对照：把角色写成字面量（比如恒写「民警」）时，这一条红。
  test("对照：管理员显示「管理员」，不是恒写「民警」", async () => {
    await 打开({ ...民警, name: "李四", policeNo: "010001", isAdmin: true })

    expect(字段("role")).toBe("管理员")
    expect(字段("name")).toBe("李四")
    expect(字段("policeNo")).toBe("010001")
  })

  /**
   * 只读：弹窗里**不许有输入框**。这条不是「反正现在没有」——它是本项的**裁定**本身
   * （后端没有更新身份的接口）。哪天有人加了输入框，这里就该红，逼他先回答「提交到哪」。
   */
  test("只读：一个输入框都没有", async () => {
    await 打开(民警)

    expect(document.body.querySelectorAll("[data-component='dialog'] input").length).toBe(0)
  })
})
