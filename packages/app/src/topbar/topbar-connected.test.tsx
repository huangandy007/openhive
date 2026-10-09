/**
 * 顶栏接线（2026-10-09 用户下达：「用户区下拉三个功能全部真实实现」）。
 *
 * ## 这一条钉的是「菜单项 → 动作」那一段
 *
 * 三段各有各的观测面，刻意分开，谁也不替谁作证：
 * ① **映射**（id ⇒ 动作）——纯函数，`user-menu-actions.test.ts`；
 * ② **本文件**（动作 ⇒ 真的去开弹窗 / 喊 signOut）——要 `DialogProvider` ＋ `AuthSessionProvider`；
 * ③ **两端各自的行为**——`profile-dialog.test.tsx` / `change-password-dialog.test.tsx` /
 *    `auth-gate.test.tsx` 的「T015 退出登录」。
 *
 * 在接线之前，四个菜单项的 `onSelect` **没有任何生产调用方**（`TopbarMount` 根本没把它透出去）
 * ⇒ 点下去 `props.onSelect?.()` 是个空操作、不报错、不变红。这就是用户看到的那一幕。
 *
 * ⚠️ 弹窗经上游 `useDialog()` 的栈（`Kobalte.Portal`）落在 `document.body` ⇒ 弹窗类断言一律
 * 从 `document.body` 取；顶栏本身在**宿主**里（`Portal mount={host}`），从宿主取。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { render } from "solid-js/web"
import { AuthSessionProvider, type AuthSession } from "@/auth/session-context"
import type { Identity } from "@/auth/gateway"
import { TopbarConnected } from "./topbar-connected"

const 挂过的: Array<() => void> = []

afterEach(() => {
  // 顺序：**先 dispose、再清 body**（`LEARNINGS #005-03`）。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 民警: Identity = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
  mustChangePw: false,
}

const 管理员: Identity = { ...民警, name: "李四", policeNo: "010001", isAdmin: true }

/**
 * 挂一棵「够用的树」：宿主（顶栏投进去）＋ 两个 provider。
 *
 * ⚠️ `session` 收的是**值**而不是现成的元素——同 `auth-gate.test.tsx` 里那条注释：在测试体里
 * **调用**一个读 context 的组件，`useContext` 会取不到（那一刻没有 owner）。
 */
async function 挂上(identity?: Identity): Promise<{ host: HTMLElement; 退出次数: () => number }> {
  let 次数 = 0
  const 会话: AuthSession = { identity, signOut: async () => void 次数++ }
  const host = document.createElement("div")
  document.body.appendChild(host)

  挂过的.push(
    render(
      () => (
        <DialogProvider>
          <AuthSessionProvider value={会话}>
            <TopbarConnected host={host} />
          </AuthSessionProvider>
        </DialogProvider>
      ),
      host,
    ),
  )
  await flush()
  return { host, 退出次数: () => 次数 }
}

/** 点用户区 ⇒ 展开下拉。⚠️ 它是**开合**的：菜单已经开着时再点一次是关。 */
function 展开下拉(host: HTMLElement) {
  const 用户区 = host.querySelector<HTMLElement>("[data-slot='topbar-user']")
  if (!用户区) throw new Error("顶栏上没有用户区")
  用户区.click()
}

const 可见项 = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='topbar-menu-item']")].map((el) => el.textContent?.trim())

/** 点下拉里某一项（**要求菜单已经开着**）。 */
function 点项(host: HTMLElement, label: string) {
  const 项 = [...host.querySelectorAll<HTMLElement>("[data-slot='topbar-menu-item']")].find(
    (el) => el.textContent?.trim() === label,
  )
  if (!项) throw new Error(`下拉里没有「${label}」`)
  项.click()
}

/** 用户的真实路径：展开下拉，再点某一项。 */
function 点菜单项(host: HTMLElement, label: string) {
  展开下拉(host)
  点项(host, label)
}

const 有 = (selector: string) => document.body.querySelector(selector) !== null

describe("顶栏接线 · 用户区下拉", () => {
  test("个人信息 ⇒ 开只读弹窗，且没有误喊退出", async () => {
    const { host, 退出次数 } = await 挂上(民警)

    点菜单项(host, "个人信息")
    await flush()

    expect(document.body.querySelector("[data-field='name']")?.textContent?.trim()).toBe("张三")
    expect(document.body.querySelector("[data-field='policeNo']")?.textContent?.trim()).toBe("020601")
    expect(退出次数()).toBe(0)
  })

  test("修改密码 ⇒ 开改密弹窗（带确认字段）", async () => {
    const { host, 退出次数 } = await 挂上(民警)

    点菜单项(host, "修改密码")
    await flush()

    expect(有("[data-component='dialog'] input[name='confirmPassword']")).toBe(true)
    expect(退出次数()).toBe(0)
  })

  /**
   * 退出登录**不弹窗**（用户 2026-10-09 的裁定：点一下直接退）；这里只钉「喊了一声」，
   * 「喊了之后界面怎么变」由 `auth-gate.test.tsx` 的「T015 退出登录」钉。
   */
  test("退出登录 ⇒ 直接喊 signOut，不弹任何窗", async () => {
    const { host, 退出次数 } = await 挂上(民警)

    点菜单项(host, "退出登录")
    await flush()

    expect(退出次数()).toBe(1)
    expect(有("[data-component='dialog']")).toBe(false)
  })

  /**
   * 对照（**本轮最有信息量的一条**）：「用户管理」**是管理员可见的菜单项，但本轮刻意不接线**
   * （后端没有对应的管理端点，见 `user-menu-actions.ts` 的文件头）。它必须在界面上**看得见、
   * 点了没反应**——而不是被悄悄删掉、也不是弹一个空壳窗。
   *
   * 判据写「点了什么都没发生」而不是「它被移除了」：用户下达的是「下拉三项」，第四项的存在
   * 是既成事实，删它属于改需求。哪天有人给它接上线，这条会红，逼他回来回答「接到哪」。
   */
  test("对照：管理员的「用户管理」看得见，但点了什么都不发生", async () => {
    const { host, 退出次数 } = await 挂上(管理员)

    展开下拉(host)
    expect(可见项(host)).toEqual(["个人信息", "修改密码", "用户管理", "退出登录"])

    点项(host, "用户管理")
    await flush()

    expect(有("[data-component='dialog']")).toBe(false)
    expect(退出次数()).toBe(0)
  })

  /**
   * 网关不在（本机开发常态）：`AuthSession.identity` 是 `undefined` ⇒ **用户区整个不渲染**。
   * `Identity` 在这里可以是 `undefined` 这件事写在 `session-context.ts` 的文件头里；这条把它
   * 落成判据——「宁缺勿假」，不拿假身份去填首字母头像。
   */
  test("网关不在（没有身份）⇒ 用户区不渲染，其余四项照旧", async () => {
    const { host } = await 挂上(undefined)

    expect(host.querySelector("[data-slot='topbar-user']")).toBeNull()
    expect(host.querySelector("[data-slot='topbar-home']")).not.toBeNull()
    expect(host.querySelector("[data-slot='topbar-messages']")).not.toBeNull()
    expect(host.querySelector("[data-slot='topbar-fullscreen']")).not.toBeNull()
  })
})
