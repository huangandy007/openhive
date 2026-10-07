import { describe, expect, test } from "bun:test"
import type { DirectorySDK } from "@/context/sdk"
import { routeSessionID } from "./route-session"
import { 删除后去哪, 在途守卫, 建会话, 删会话, 会话路径, type 会话行 } from "./session-actions"

/**
 * 右栏「会话管理三件事」（T015 / FR-010 / US4 场景 2）：**新建 / 切换 / 删除**。
 *
 * ## 这一组测的边界在哪
 *
 * 本文件止步于**两件事**：① 交给 SDK 的**形状**（`create` / `remove` 各收到什么）；
 * ② 两个**纯计算**（删完去哪一场、切会话的 URL 怎么拼）。**真的建出 / 删掉一场会话**不在这里
 * ——`bun test` 里没有活着的服务器（T008 已实测），那一半归 `packages/opencode/test/server/`。
 * ⇒ 别把这一组读成「会话真的没了」：它证的是「**右栏把这三件事按正确的形状交出去了**」。
 *
 * ## 蓝本（`LEARNINGS #004-12`：新出口先抄同族，别自己从零搭）
 *
 * 三件事上游**都已经有现成实现**，本文件逐字对它们取证，不自己发明：
 * ① 新建 ⇒ `components/prompt-input/submit.ts:404` 的 `api.session.create({ location: { directory } })`；
 * ② 删除 ⇒ `pages/session/timeline/message-timeline.tsx:826` 的 `api.session.remove({ sessionID })`；
 * ③ 删完去哪 ⇒ 同一文件 **`:823`** 的 `sessions[index + 1] ?? sessions[index - 1]`，
 *    连它上面那行 `.filter((s) => !s.parentID && !s.time?.archived)` 一起。
 *
 * ⚠️ **`remove` 这个名字是实测过的、不是推断**：`DirectorySDK["api"]["session"]` 是
 * `createCompatibleApi` 出来的 **lazy Proxy**（`utils/server-compat.ts:86`），而 v2 生成客户端上
 * 那个方法其实叫 **`delete`**（`packages/sdk/js/src/v2/gen/sdk.gen.ts` 的 `Session2`）——
 * 名字是 `CompatibleSessionApi` 那层显式改回来的（`server-compat.ts:21-32` 的 `Omit<…, "remove"> & { remove: … }`）。
 * 写 `delete` 不会报错，只会**静默取到 `undefined`**（`lazyApi` 的 `get` 对非函数、非对象直接返回
 * `sample`）⇒ 点删除那一刻才 `TypeError`。
 */

// ── 假依赖 ──────────────────────────────────────────────────────────────────
//
// 形状照 `submit-prompt.test.ts` / `session-panel.test.tsx` 的仓库惯例
// （`as unknown as X` ＋ 就地关掉那条 lint 规则，注释贴在**对象字面量开头**）：
// `DirectorySDK["api"]["session"]` 是由 context 反推出的巨型类型，逐字段填是给夹具加噪音。

/**
 * 记录型会话出口替身。**两个出口各记一本账**（`建` / `删`）——只记一本的话，另一半的断言在
 * 「哪条出口被走了」这件事上是**空的**（`LEARNINGS #004-13`：先问「我这条断言是不是空的」）。
 *
 * 失败由参数注入（与 `submit-prompt.test.ts` 的 `造api` 同因同注：省下**同一句**巨型断言写第二遍）。
 */
const 造会话出口 = (
  回话: { 建?: unknown; 建失败?: unknown; 删失败?: unknown } = {},
): {
  建的: Array<Record<string, unknown>>
  删的: Array<Record<string, unknown>>
  api: DirectorySDK["api"]["session"]
} => {
  const 建的: Array<Record<string, unknown>> = []
  const 删的: Array<Record<string, unknown>> = []
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `DirectorySDK["api"]["session"]` 是 context 反推的巨型接口（见上面「假依赖」一节），替身只实现本模块真调的那两下。
  const api = {
    create: async (value: Record<string, unknown>) => {
      建的.push(value)
      if (回话.建失败 !== undefined) throw 回话.建失败
      return 回话.建 ?? { id: "ses_默认" }
    },
    remove: async (value: Record<string, unknown>) => {
      删的.push(value)
      if (回话.删失败 !== undefined) throw 回话.删失败
      return {}
    },
    // ⚠️ 其余出口**故意留空**（不写「碰就抛」的哨兵）：留空时调它当场
    // `TypeError: … is not a function`，本身就是一句会响的断言（`LEARNINGS #002-02`：
    // 空替身是把**缺口**写成**覆盖**；这里反过来——空得会响，不是覆盖）。

    // 这一行只是为了让读者看清「本模块真调的只有上面两下」。
  } as unknown as DirectorySDK["api"]["session"]
  return { 建的, 删的, api }
}

/** 会话表的一行。三个字段就是「删除后去哪」真读的那些（`#004-07`：照**被调方**的签名打勾）。 */
const 行 = (id: string, 加?: Partial<会话行>): 会话行 => ({ id, ...加 })

/** 会话 URL 里那一段 server key（真值来自 `utils/session-route.ts` 的 `base64Encode`，URL-safe）。 */
const 键 = "eyJpZCI6ImFiYyJ9"
const 会话路径样例 = `/server/${键}/session/ses_旧`

describe("T015 / FR-010 · 建会话", () => {
  test("① 交给 create 的形状是 { location: { directory } }，并把回话里的 id 交回来", async () => {
    const 出口 = 造会话出口({ 建: { id: "ses_新" } })

    const id = await 建会话({ api: 出口.api, directory: "/proj/甲" })

    // **被测属性**：id 来自**回话**（不是常量、不是入参）——下面这条与上面那条一起，
    // 把「读的是 `create` 的返回」钉住了：改成交回 `directory` 或写死一个 id 都会红。
    expect(id).toBe("ses_新")
    // 形状：目录**必须**带上——`location` 缺了，会话会落到 SDK 自己的默认目录（不是民警当前这个项目），
    // 而那种错**不报错、不变红**，只表现为「新建的会话跟当前项目不在一个目录里」。
    expect(出口.建的).toEqual([{ location: { directory: "/proj/甲" } }])
  })

  test("② create 失败 ⇒ 抛出去，不返回一个假的 id", async () => {
    const 出口 = 造会话出口({ 建失败: new Error("落库失败") })

    // 吞掉异常（例如 `.catch(() => undefined)`）的后果是接线层拿 `undefined` 去拼 URL，
    // 于是路由变成 `/session/undefined`——一个**看着像建成了**的空会话页。
    await expect(建会话({ api: 出口.api, directory: "/proj/甲" })).rejects.toThrow("落库失败")
  })
})

describe("T015 / FR-010 · 删会话", () => {
  test("① 删除的是**这一场**——remove 收到 { sessionID }，不是别的 id", async () => {
    const 出口 = 造会话出口()

    await 删会话({ api: 出口.api, sessionID: "ses_要删的" })

    // 这条是**数据丢失类**判据：删错一场的代价不是「界面不对」，是**那场会话连同它的消息永久没了**。
    expect(出口.删的).toEqual([{ sessionID: "ses_要删的" }])
  })

  test("② remove 失败 ⇒ 抛出去，由调用方回话", async () => {
    const 出口 = 造会话出口({ 删失败: new Error("删不掉") })

    await expect(删会话({ api: 出口.api, sessionID: "ses_甲" })).rejects.toThrow("删不掉")
  })
})

describe("T015 / FR-010 · 删完去哪一场（蓝本 message-timeline.tsx:823）", () => {
  test("① 后面还有 ⇒ 去后面那一场", () => {
    const 表 = [行("ses_甲"), 行("ses_乙"), 行("ses_丙")]

    expect(删除后去哪(表, "ses_甲")).toBe("ses_乙")
  })

  test("② 删的是最后一场 ⇒ 退到前面那一场", () => {
    const 表 = [行("ses_甲"), 行("ses_乙")]

    expect(删除后去哪(表, "ses_乙")).toBe("ses_甲")
  })

  test("③ 表里就它一场 ⇒ 没有下一场（undefined）", () => {
    expect(删除后去哪([行("ses_甲")], "ses_甲")).toBe(undefined)
  })

  test("④ 紧跟在后的是一场**子会话** ⇒ 不算候选，继续往后找", () => {
    // 蓝本那行 filter 的第一半：`!s.parentID`。子会话（如 task 派生的）不是一个能「切过去」的
    // 对等会话，切过去右栏会显示一场没有独立上下文的会话。
    const 表 = [行("ses_甲"), 行("ses_子", { parentID: "ses_甲" }), 行("ses_丙")]

    // 拆掉 filter ⇒ 表变 [甲, 子, 丙]、index 0 ⇒ 回 `ses_子` ⇒ 红。
    expect(删除后去哪(表, "ses_甲")).toBe("ses_丙")
  })

  test("⑤ 紧跟在后的是一场**已归档**会话 ⇒ 不算候选，视作没有下一场", () => {
    // 蓝本那行 filter 的第二半：`!s.time?.archived`。归档＝冻结（005 的门），切过去是一场只读会话。
    const 表 = [行("ses_甲"), 行("ses_归档", { time: { archived: 1 } })]

    // 拆掉 filter ⇒ 回 `ses_归档` ⇒ 红。
    expect(删除后去哪(表, "ses_甲")).toBe(undefined)
  })

  test("⑥ 被删的 id 不在表里 ⇒ undefined（表可能是旧的）", () => {
    expect(删除后去哪([行("ses_甲")], "ses_不存在")).toBe(undefined)
  })
})

describe("T015 / FR-010 · 切会话 = 换 URL 末段", () => {
  test("① 只换末段，server key 原样带着", () => {
    expect(会话路径(会话路径样例, "ses_新")).toBe(`/server/${键}/session/ses_新`)
  })

  test("② 拼出来的路径**认得回来**——与 routeSessionID 是同一份形状", () => {
    // 两个投影要有一条**故意会红的相等断言**（`LEARNINGS #004-02`）：`会话路径` 是
    // `routeSessionID` 的逆命题，两边一旦不同步，表现是「点了切会话，右栏**什么都不变**」
    // ——不报错、不变红，因为路由变成了一个 `routeSessionID` 认不出的形状。
    const 拼的 = 会话路径(会话路径样例, "ses_新")

    expect(拼的 && routeSessionID(拼的)).toBe("ses_新")
  })

  test("③ 不是会话路径 ⇒ undefined，一个字都不拼", () => {
    // 首页 `/`、草稿页 `/new-session`、旧布局 `/…/session/<id>` 都不是。
    // 拼错的话会得到一条**半截 URL**（例如 `/server/undefined/session/x`），而那会真的把页面导航走。
    expect(会话路径("/", "ses_新")).toBe(undefined)
    expect(会话路径("/new-session", "ses_新")).toBe(undefined)
  })
})

/**
 * 在途守卫（Step 5 · R-01）。
 *
 * ## 它堵的是什么
 *
 * 三根线（新建 / 切换 / 删除）都交出去一个**不可重入**的动作：新建连点两下 ⇒ 建出**两场**会话，
 * 第二场是个没人认领的孤儿（界面只会跳到第一场）；删除连点 ⇒ 第二下在第一下还没回来时就发出去了
 * ——而 `session-panel.tsx` 的二次确认在 `await` **之前**就把 `待删` 归了零，所以「确认」那一下
 * 并不会被它自己的状态机拦住。
 *
 * ⚠️ 与缺口表里那条「`待删` 是**粘**的」**不是同一件事**：那条讲的是「确认态在切走再切回之后
 * 还亮着」，这条讲的是「同一个动作能不能同时在途两份」。两条都真实，修法不同。
 *
 * ## 为什么放在这一层
 *
 * 三根线的异步动作都在 `ai-session-slot.tsx`（纯接线、挂不起来测）。守卫是有判断的那一半的
 * 一小块 ⇒ 落在这里，接线层只写 `在途守卫()(动作)`。
 */
describe("T015 / FR-010 · 在途守卫", () => {
  /** 一个「要外面放行才回来」的动作，外加它被跑了几次。 */
  const 造挂起动作 = () => {
    const 放行: Array<() => void> = []
    let 次数 = 0
    const 动作 = () =>
      new Promise<string>((好) => {
        次数 += 1
        放行.push(() => 好(`第 ${次数} 次`))
      })
    return { 动作, 放行, 次数: () => 次数 }
  }

  test("① 动作没回来之前再点 ⇒ **当场忽略**（动作只跑一次）", async () => {
    const { 动作, 放行, 次数 } = 造挂起动作()
    const 守 = 在途守卫()

    const 第一次 = 守(动作)

    // 被测属性：第二下**当场**就没有下文（返回 `undefined`），而不是「排着队等第一下回来再跑」。
    expect(守(动作)).toBe(undefined)
    expect(次数()).toBe(1)

    放行[0]()
    expect(await 第一次).toBe("第 1 次")
  })

  test("② 动作回来之后 ⇒ 解锁，能再跑一次（守卫不是一次性的）", async () => {
    // 少了这一条，一个「跑过一次就永远返回 undefined」的实现也能过 ①——那个实现的症状是
    // 「第一场会话建完之后，「＋ 新会话」再也按不动了」。
    const { 动作, 放行 } = 造挂起动作()
    const 守 = 在途守卫()

    const 一 = 守(动作)
    放行[0]()
    await 一

    const 二 = 守(动作)
    expect(二).not.toBe(undefined)
    放行[1]()
    expect(await 二).toBe("第 2 次")
  })

  test("③ 动作**失败**之后也解锁（失败不能把钮焊死）", async () => {
    // 这一条是**失败路径**上的 ②。少了它，一个「只在成功分支解锁」的实现（例如
    // `动作().then(() => { 忙 = false })`）会同时过 ①②，而它的症状最坏：一次网络抖动之后，
    // 那颗钮**永久**没反应，且不报错、不变红。
    let 次数 = 0
    const 守 = 在途守卫()
    const 动作 = () => {
      次数 += 1
      return Promise.reject(new Error("坏了"))
    }

    await expect(守(动作)!).rejects.toThrow("坏了")

    const 第二次 = 守(动作)
    expect(第二次).not.toBe(undefined)
    await expect(第二次!).rejects.toThrow("坏了")
    expect(次数).toBe(2)
  })

  test("④ 动作**同步抛出**之后也解锁（取 SDK 那一句就抛，钮同样不能焊死）", () => {
    // ⚠️ 这是 ③ 的**另一半**，两条各钉一条复位路径（`#005-12`：落点 N 处就写 N 条用例）：
    // ③ 喂 `Promise.reject`（**异步**拒绝 ⇒ 走实现里 `结果.finally(...)` 那条复位），
    // 这一条喂**同步**抛出（⇒ 走 `try/catch` 那条复位）。
    // 少了这一条：把实现里那个 `catch { 忙 = false; throw 错 }` 整个删掉，③ 照样绿——
    // 而症状正是实现注释点名的那句「取 SDK 那一句就可能抛 ⇒ 这颗钮当场焊死」。
    let 次数 = 0
    const 守 = 在途守卫()
    const 动作 = (): Promise<string> => {
      次数 += 1
      throw new Error("取 SDK 那一句就抛了")
    }

    expect(() => 守(动作)).toThrow("取 SDK 那一句就抛了")
    expect(次数).toBe(1)

    // 被测属性：被忽略时 `守` **同步**回 `undefined`（不抛）⇒ 这一行挂在焊死的实现上会红在
    // 「没抛」；而次数那条钉的是「第二下确实跑到了动作里」。
    expect(() => 守(动作)).toThrow("取 SDK 那一句就抛了")
    expect(次数).toBe(2)
  })
})
