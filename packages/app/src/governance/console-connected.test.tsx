/**
 * 治理后台接线（010 T003）：**两类管理员各见各的功能**。
 *
 * 这一条钉的既不是服务端（`packages/auth/src/governance.test.ts` 打真库）也不是覆盖层本身
 * （`console.test.tsx` 钉过滤与焦点），而是**中间那一段**：身份里的 `governance` 有没有
 * 真的走到导航上。缺了它，前后两端各自全绿，界面上却是「管理员进后台什么都看不见」
 * （`#008-02` 的同一形状：组件绿、真栈红）。
 *
 * 三个身份刻意都测：
 * - 系统管理员 6 项、业务专家 3 项 —— 「各见各的」；
 * - 没有身份（网关不在）—— 空态，而不是把八项全露出去（fail-closed）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import type { Identity } from "@/auth/gateway"
import { AuthSessionProvider } from "@/auth/session-context"
import { render } from "solid-js/web"
import { GovernanceConsoleConnected } from "./console-connected"

const 挂过的: Array<() => void> = []

afterEach(() => {
  // 顺序：**先 dispose、再清 body**（`LEARNINGS #005-03`）。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 身份 = (governance: string[], isAdmin = true): Identity => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "010001",
  name: "张三",
  isAdmin,
  mustChangePw: false,
  governance,
})

const 系统管理员 = 身份([
  "account-manage",
  "org-tree",
  "asset-governance",
  "usage-cost",
  "audit-log",
  "data-source",
])

const 业务专家 = 身份(["asset-governance", "template-lib", "data-project-perm"])

/** 挂上：open 恒真（本文件不测开合，那是 `console-host.test.tsx` 的事）。 */
function 挂上(identity?: Identity) {
  const root = document.createElement("div")
  document.body.appendChild(root)

  挂过的.push(
    render(
      () => (
        <AuthSessionProvider value={{ get identity() { return identity }, signOut: async () => {} }}>
          <GovernanceConsoleConnected open={true} onClose={() => {}}>
            <div data-testid="workspace-bg">工作区</div>
          </GovernanceConsoleConnected>
        </AuthSessionProvider>
      ),
      root,
    ),
  )

  return root
}

const 导航项 = () =>
  [...document.querySelectorAll("[data-slot='governance-nav'] [data-section]")].map((el) =>
    el.getAttribute("data-section"),
  )

describe("治理后台 · 身份接线", () => {
  test("系统管理员：导航只出现他的六个板块（顺序同注册表）", async () => {
    挂上(系统管理员)
    await flush()

    expect(导航项()).toEqual([
      "account-manage",
      "org-tree",
      "asset-governance",
      "usage-cost",
      "audit-log",
      "data-source",
    ])
  })

  test("业务专家：看不到账号 / 组织 / 用量 / 审计 / 数据源", async () => {
    挂上(业务专家)
    await flush()

    expect(导航项()).toEqual(["asset-governance", "template-lib", "data-project-perm"])
  })

  test("没有身份（网关不在）：空态，不把八项全露出来", async () => {
    挂上(undefined)
    await flush()

    expect(导航项()).toEqual([])
    expect(document.querySelector("[data-slot='governance-empty']")).not.toBeNull()
  })

  test("身份在、板块集为空：同样是空态（fail-closed，不是「不过滤」）", async () => {
    挂上(身份([], true))
    await flush()

    expect(导航项()).toEqual([])
    expect(document.querySelector("[data-slot='governance-empty']")).not.toBeNull()
  })
})
