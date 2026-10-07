import { describe, expect, test } from "bun:test"
import { createRoot, createSignal, onCleanup } from "solid-js"
import { createRightPaneSource } from "./right-pane-source"

/**
 * 右栏那三样东西（会话 id → 目录 → 数据）的解析链（T008）。
 *
 * 为什么要把它从组件里**抽出来**单测：这条链是本轮唯一「真的会出错」的一段——
 * 它是**异步**的（目录要向会话问一次），而异步的东西在组件里测不到时，最常见的后果不是
 * 「红了」而是「慢的那个盖了新的那个」——不报错、不变红（`LEARNINGS #002-06` 同族）。
 * 组件那一层因此只剩 ~15 行 context 读取，如实记进缺口表（`#002-02`）。
 *
 * 用真实生产形态的路由串喂进去（`/server/<key>/session/<id>`）——**不**直接喂 id：
 * 否则「路径怎么解」这一段就没人测了（那一段在 `route-session.test.ts`）。
 *
 * ⚠️ **本文件为什么是 `.test.tsx` 而不是 `.test.ts`**（实测 2026-10-07，bun 1.3.14）：
 * `package.json` 的两条测试脚本走**不同的 Solid 构建**——
 * - `test:unit` 是 `--conditions=solid` ⇒ `solid-js` 解析到 **`dist/server.js`（SSR 构建）**；
 * - `test:components` 是 `--conditions=browser` ⇒ 解析到 `dist/solid.js`（客户端构建）。
 *
 * 而 **SSR 构建的响应式是「一次性」的**：探针实测（`createRoot` ＋ `createEffect`/`createComputed`
 * ＋ 两次 `setSignal`）——SSR 下只出 `["computed:0"]`，**`createEffect` 一次都没跑、`createComputed`
 * 也不再重跑**；客户端下是 `["computed:0","effect:0","computed:1","effect:1"]`。
 * 本文件测的正是**「换会话要跟着换」**，在 SSR 下会得到 3 条**假红**（与被测代码无关）。
 * 所以它必须落在 `--conditions=browser` 那一侧；`test:unit` 用 `--path-ignore-patterns`
 * 把 `.test.tsx` 整个排除在外，故它只跑一次、只跑对的那一次。
 * （⚠️ 这里**故意不写那条 glob 的字面量**：它含 `星号＋斜杠`，写在块注释里会**当场把注释闭合**
 *  —— `LEARNINGS #004-06` 那条踩过的坑，本次差点又踩一次。）
 * （纯函数那个文件 `route-session.test.ts` 不碰响应式，照旧留在 `.test.ts`。）
 */
const 歇 = () => new Promise((r) => setTimeout(r, 5))

/** 一个我控制何时落地的 promise（竞态用例要用它把「慢的那个」捏在手里）。 */
function 悬着<T>() {
  let 交!: (value: T) => void
  let 弃!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    交 = resolve
    弃 = reject
  })
  return { promise, 交, 弃 }
}

type 数据 = { 目录: string }

function 造源(输入: {
  pathname: () => string
  directoryOf: (sessionID: string) => Promise<string | undefined>
  dataFor?: (directory: string) => 数据
}) {
  return createRightPaneSource<数据>({
    pathname: 输入.pathname,
    directoryOf: 输入.directoryOf,
    dataFor: 输入.dataFor ?? ((目录) => ({ 目录 })),
  })
}

describe("右栏解析链：路由 id → 目录 → 数据（T008 / 裁定 A′）", () => {
  test("路由里没有会话 ⇒ 三样都是空，且**一次都不去问会话**", async () => {
    await createRoot(async (dispose) => {
      const 问过: string[] = []
      const 源 = 造源({
        pathname: () => "/",
        directoryOf: async (id) => {
          问过.push(id)
          return "/不该被问到"
        },
      })

      await 歇()

      expect(源.sessionID()).toBeUndefined()
      expect(源.directory()).toBeUndefined()
      expect(源.data()).toBeUndefined()
      // 这一条是**被调方**的判据：没有会话就该零请求。只断三样为空的话，一个「为空 id 也去问一次」
      // 的写法照样过（`LEARNINGS #004-07`：按被调方的全部必填项打勾）。
      expect(问过).toEqual([])
      dispose()
    })
  })

  test("有会话 ⇒ 用解出来的 id 问目录，再按那个目录取数据", async () => {
    await createRoot(async (dispose) => {
      const 问过: string[] = []
      const 取过: string[] = []
      const 源 = 造源({
        pathname: () => "/server/c2VydmVyMQ/session/ses_abc123",
        directoryOf: async (id) => {
          问过.push(id)
          return "/projects/资金案"
        },
        dataFor: (目录) => {
          取过.push(目录)
          return { 目录 }
        },
      })

      await 歇()

      expect(问过).toEqual(["ses_abc123"])
      expect(取过).toEqual(["/projects/资金案"])
      expect(源.sessionID()).toBe("ses_abc123")
      expect(源.directory()).toBe("/projects/资金案")
      expect(源.data()?.目录).toBe("/projects/资金案")
      dispose()
    })
  })

  test("会话问不出目录 ⇒ 不去取数据（别拿一个空目录去取）", async () => {
    await createRoot(async (dispose) => {
      let 取过 = 0
      const 源 = 造源({
        pathname: () => "/server/c2VydmVyMQ/session/ses_abc123",
        directoryOf: async () => undefined,
        dataFor: (目录) => {
          取过 += 1
          return { 目录 }
        },
      })

      await 歇()

      expect(源.sessionID()).toBe("ses_abc123")
      expect(源.directory()).toBeUndefined()
      expect(源.data()).toBeUndefined()
      expect(取过).toBe(0)
      dispose()
    })
  })

  test("问目录失败 ⇒ 不抛、退回空态（右栏不该把整页带崩）", async () => {
    await createRoot(async (dispose) => {
      const 源 = 造源({
        pathname: () => "/server/c2VydmVyMQ/session/ses_abc123",
        directoryOf: async () => {
          throw new Error("会话没拉到")
        },
      })

      await 歇()

      expect(源.sessionID()).toBe("ses_abc123")
      expect(源.directory()).toBeUndefined()
      expect(源.data()).toBeUndefined()
      dispose()
    })
  })

  test("换会话 ⇒ 跟着换（同一份源，不是新建一个）", async () => {
    await createRoot(async (dispose) => {
      const [路径, set路径] = createSignal("/server/c2VydmVyMQ/session/ses_甲")
      const 源 = 造源({
        pathname: 路径,
        directoryOf: async (id) => `/projects/${id}`,
      })

      await 歇()
      expect(源.directory()).toBe("/projects/ses_甲")

      set路径("/server/c2VydmVyMQ/session/ses_乙")
      await 歇()
      expect(源.sessionID()).toBe("ses_乙")
      expect(源.directory()).toBe("/projects/ses_乙")
      expect(源.data()?.目录).toBe("/projects/ses_乙")
      dispose()
    })
  })

  test("慢的旧响应**不能**盖掉新的（竞态：这是本条链最容易静默出错的地方）", async () => {
    await createRoot(async (dispose) => {
      const [路径, set路径] = createSignal("/server/c2VydmVyMQ/session/ses_甲")
      const 甲 = 悬着<string | undefined>()
      const 乙 = 悬着<string | undefined>()
      const 源 = 造源({
        pathname: 路径,
        directoryOf: (id) => (id === "ses_甲" ? 甲.promise : 乙.promise),
      })

      // 先把会话换掉，再让「旧的」最后落地。
      await 歇()
      set路径("/server/c2VydmVyMQ/session/ses_乙")
      await 歇()
      乙.交("/projects/ses_乙")
      await 歇()
      甲.交("/projects/ses_甲")
      await 歇()

      expect(源.sessionID()).toBe("ses_乙")
      expect(源.directory()).toBe("/projects/ses_乙")
      expect(源.data()?.目录).toBe("/projects/ses_乙")
      dispose()
    })
  })

  test("从「有会话」走回「没会话」⇒ 全部退回空态（别留着上一场的目录）", async () => {
    await createRoot(async (dispose) => {
      const [路径, set路径] = createSignal("/server/c2VydmVyMQ/session/ses_甲")
      const 源 = 造源({
        pathname: 路径,
        directoryOf: async (id) => `/projects/${id}`,
      })

      await 歇()
      expect(源.data()?.目录).toBe("/projects/ses_甲")

      set路径("/")
      await 歇()

      expect(源.sessionID()).toBeUndefined()
      expect(源.directory()).toBeUndefined()
      expect(源.data()).toBeUndefined()
      dispose()
    })
  })

  /**
   * `dataFor` 的**调用点必须在有 owner 的作用域里**——这条不是为了好看，是为了
   * `ensureDirSyncContext` 的**引用计数能释放**。
   *
   * 实测（2026-10-07，bun 1.3.14 ＋ solid-js 1.9.10）：在 effect 体内 `getOwner()` 非空，
   * 而同一个 effect 的 `.then(...)` 回调里 `getOwner()` 是 **null** ⇒ 在那里注册的
   * `onCleanup` 永不执行（探针原文：`同步owner有？ true ｜then里的owner有？ false`，
   * 卸载后注册的回调一条都没跑）。
   * 而 `createRefCountMap`（`utils/refcount.ts`）的释放动作**正是**写在 `onCleanup` 里
   * ⇒ 把 `dataFor` 放在 `.then` 里，每次换会话只加引用、从不减，目录同步上下文再也放不掉。
   *
   * 判据取**后果**（回调真的跑了），不取 `getOwner()` 非空这种实现细节。
   */
  test("`dataFor` 注册的 `onCleanup` 要真的跑（换会话时释放上一个目录）", async () => {
    await createRoot(async (dispose) => {
      const [路径, set路径] = createSignal("/server/c2VydmVyMQ/session/ses_甲")
      const 释放过: string[] = []
      const 源 = 造源({
        pathname: 路径,
        directoryOf: async (id) => `/projects/${id}`,
        dataFor: (目录) => {
          onCleanup(() => 释放过.push(目录))
          return { 目录 }
        },
      })

      await 歇()
      expect(源.data()?.目录).toBe("/projects/ses_甲")
      expect(释放过).toEqual([])

      set路径("/server/c2VydmVyMQ/session/ses_乙")
      await 歇()
      expect(源.data()?.目录).toBe("/projects/ses_乙")
      // 换到乙时必须先放掉甲——否则 `createRefCountMap` 的计数只增不减。
      expect(释放过).toEqual(["/projects/ses_甲"])

      dispose()
      expect(释放过).toEqual(["/projects/ses_甲", "/projects/ses_乙"])
    })
  })

  /**
   * `ready`：三样**齐了**才是「可以渲染右栏」的态。
   *
   * 为什么要有它，而不是让调用方去断 `data() !== undefined`：`SessionPanel` 的
   * `directory` / `sessionID` 是**必填**，而调用方（`ai-session-slot.tsx`）从三个访问器里
   * 各取一个，只能靠 `!` 去说服类型系统「它们一定在」——那句 `!` 没有任何东西守着。
   * 把「三样齐」这件事放回**拥有这三样的这一层**，调用方就只剩一句 `<Show when={源.ready()}>`。
   */
  test("`ready`：目录还没解出来之前不算就绪，齐了给三样", async () => {
    await createRoot(async (dispose) => {
      const 甲 = 悬着<string | undefined>()
      const 源 = 造源({
        pathname: () => "/server/c2VydmVyMQ/session/ses_甲",
        directoryOf: () => 甲.promise,
      })

      await 歇()
      // 会话 id 有了、目录还没有 ⇒ 不算就绪（此时去渲染会拿到一个空目录）。
      expect(源.sessionID()).toBe("ses_甲")
      expect(源.ready()).toBeUndefined()

      甲.交("/projects/资金案")
      await 歇()
      expect(源.ready()).toEqual({
        sessionID: "ses_甲",
        directory: "/projects/资金案",
        data: { 目录: "/projects/资金案" },
      })

      dispose()
    })
  })
})
