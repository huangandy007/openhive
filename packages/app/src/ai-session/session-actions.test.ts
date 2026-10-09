import { describe, expect, test } from "bun:test"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import type { DirectorySDK } from "@/context/sdk"
import type { SessionExportClient } from "@/utils/session-export"
import { routeSessionID } from "./route-session"
import {
  删除后去哪,
  在途守卫,
  导出会话,
  建会话,
  改名草稿,
  删会话,
  当前项目目录,
  会话路径,
  重命名会话,
  type 会话行,
  type 可定位的项目行,
} from "./session-actions"

/**
 * 右栏会话语义层：**新建 / 切换 / 删除**（T015）**＋ 导出**（T016）。
 *
 * ## 这一组测的边界在哪
 *
 * 本文件止步于**三件事**：① 交给 SDK 的**形状**（`create` / `remove` / 导出要的那两下取数各收到什么）；
 * ② 两个**纯计算**（删完去哪一场、切会话的 URL 怎么拼）；③ 导出会话**拼出来的那一份导出物**
 * （谁跟谁拼、文件名叫什么）。**真的建出 / 删掉一场会话、真的落一个文件**都不在这里
 * ——`bun test` 里没有活着的服务器（T008 已实测），那一半归 `packages/opencode/test/server/`；
 * 落盘那一下是上游已测的 `downloadSessionExport`。
 * ⇒ 别把这一组读成「会话真的没了、文件真的下载了」：它证的是「**右栏按正确的形状交出去了**」。
 *
 * ## 蓝本（`LEARNINGS #004-12`：新出口先抄同族，别自己从零搭）
 *
 * 上游**都已经有现成实现**，本文件逐字对它们取证，不自己发明：
 * ① 新建 ⇒ `components/prompt-input/submit.ts:404` 的 `api.session.create({ location: { directory } })`；
 * ② 删除 ⇒ `pages/session/timeline/message-timeline.tsx:826` 的 `api.session.remove({ sessionID })`；
 * ③ 删完去哪 ⇒ 同一文件 **`:823`** 的 `sessions[index + 1] ?? sessions[index - 1]`，
 *    连它上面那行 `.filter((s) => !s.parentID && !s.time?.archived)` 一起；
 * ④ 导出 ⇒ `utils/session-export.ts` 的三件套（`fetchSessionExport` → `sessionExportFilename` →
 *    `downloadSessionExport`），三处生产调用点形状一致（`session-context-tab.tsx:231` /
 *    `message-timeline.tsx:796` / `use-session-commands.tsx:242`）。
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
 *
 * ⚠️ 它替的是 `DirectorySDK["api"]["session"]`（compatible api）——**导出那一路不用它**：
 * 那份 api 上**没有 `messages`**（见 `造客户端` 的注释）。
 */
const 造会话出口 = (
  回话: { 建?: unknown; 建失败?: unknown; 删失败?: unknown; 改失败?: unknown } = {},
): {
  建的: Array<Record<string, unknown>>
  删的: Array<Record<string, unknown>>
  改的: Array<Record<string, unknown>>
  api: DirectorySDK["api"]["session"]
} => {
  const 建的: Array<Record<string, unknown>> = []
  const 删的: Array<Record<string, unknown>> = []
  const 改的: Array<Record<string, unknown>> = []
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
    rename: async (value: Record<string, unknown>) => {
      改的.push(value)
      if (回话.改失败 !== undefined) throw 回话.改失败
      return {}
    },
    // ⚠️ 其余出口**故意留空**（不写「碰就抛」的哨兵）：留空时调它当场
    // `TypeError: … is not a function`，本身就是一句会响的断言（`LEARNINGS #002-02`：
    // 空替身是把**缺口**写成**覆盖**；这里反过来——空得会响，不是覆盖）。

    // 这一行只是为了让读者看清「本模块真调的只有上面两下」。
  } as unknown as DirectorySDK["api"]["session"]
  return { 建的, 删的, 改的, api }
}

/**
 * 记录型**客户端**替身（T016 导出用）。
 *
 * ⚠️ 为什么与 `造会话出口` **不是同一份**（不是重复代码，是两个不同的东西）：导出那条链要的
 * 根本不是同一件东西——`fetchSessionExport` 要 `{ session: { get, messages } }`
 * （上游 `SessionExportClient`），而**上游三处生产调用点传的都是 `sdk().client`**：
 * `createOpencodeClient` 出来的 **legacy 客户端**。右栏「会话出口」
 * （`DirectorySDK["api"]["session"]`）是 `createCompatibleApi` 的产物，**新协议里没有
 * `session.messages` 这个出口**——消息在另一个命名空间里（`contract.ts` 的
 * `endpointNames["session.messages"] = "list"`），新形状还要过 `normalizeSessionMessages`。
 * 传 `api` 进 `fetchSessionExport` 的后果由 tsgo 当场点破：
 * `Property 'messages' is missing in type 'CompatibleSessionApi'`（2026-10-08 实测）。
 */
const 造客户端 = (
  回话: { 会话?: unknown; 消息?: unknown } = {},
): {
  取会话的: Array<Record<string, unknown>>
  取消息的: Array<Record<string, unknown>>
  client: SessionExportClient
} => {
  const 取会话的: Array<Record<string, unknown>> = []
  const 取消息的: Array<Record<string, unknown>> = []
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同上面「假依赖」一节的因由：替身只实现 `fetchSessionExport` 真调的那两下。
  const client = {
    session: {
      // ⚠️ `会话` 传 `null` ⇒ `{ data: null }`（真客户端「这场会话没了」的形状，④ 要它）；
      // 不传才取默认那场。写成 `?? 默认` 就没有「取不到」这一支了。
      get: async (value: Record<string, unknown>) => {
        取会话的.push(value)
        if (回话.会话 === null) return { data: null }
        return { data: 回话.会话 ?? { id: "ses_默认", title: "默认会话" } }
      },
      messages: async (value: Record<string, unknown>) => {
        取消息的.push(value)
        return { data: 回话.消息 ?? [] }
      },
    },
  } as unknown as SessionExportClient
  return { 取会话的, 取消息的, client }
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

describe("会话重命名（左栏右键菜单 ＋ 右栏顶栏，同一个出口）", () => {
  test("① 改的是**这一场**：rename 收到 { sessionID, title }，就这两项", async () => {
    const 出口 = 造会话出口()

    await 重命名会话({ api: 出口.api, sessionID: "ses_要改的", title: "新名字" })

    // ⚠️ 这一条同时也是**出口名**的哨兵：右栏那份 api 是 `createCompatibleApi` 的 lazy Proxy，
    // 写错方法名（例如 v2 那边的 `update`）**不会报错**，只会静默取到 `undefined`
    // ⇒ 点重命名那一刻才 `TypeError`。`toEqual` 一旦变成空数组，就是这条链断了。
    expect(出口.改的).toEqual([{ sessionID: "ses_要改的", title: "新名字" }])
  })

  test("② rename 失败 ⇒ 抛出去，由调用方回话", async () => {
    const 出口 = 造会话出口({ 改失败: new Error("改名失败") })

    await expect(重命名会话({ api: 出口.api, sessionID: "ses_甲", title: "乙" })).rejects.toThrow(
      "改名失败",
    )
  })
})

describe("改名草稿：这一份草稿值不值得发出去（蓝本 message-timeline.tsx 的 saveTitleEditor）", () => {
  test("① 正常改动 ⇒ 交出 trim 后的新名字", () => {
    expect(改名草稿("新名字", "旧名字")).toBe("新名字")
  })

  test("② 前后空白被 trim 掉（右栏顶栏那一下带得进空格）", () => {
    expect(改名草稿("  新名字  ", "旧名字")).toBe("新名字")
  })

  test("③ 空草稿 ⇒ undefined（**不发请求**：把标题清空不是一次重命名）", () => {
    expect(改名草稿("", "旧名字")).toBe(undefined)
  })

  test("④ 纯空白草稿 ⇒ undefined（同上，别把 `\"   \"` 发成标题）", () => {
    expect(改名草稿("   ", "旧名字")).toBe(undefined)
  })

  test("⑤ 与原名相同 ⇒ undefined（点开又原样关掉，不该产生一次写请求）", () => {
    expect(改名草稿("旧名字", "旧名字")).toBe(undefined)
  })

  test("⑥ 原名还没有（`undefined`）而草稿非空 ⇒ 照改", () => {
    expect(改名草稿("新名字", undefined)).toBe("新名字")
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
 * **两根线**（新建 / 删除）各交出去一个**不可重入**的动作：新建连点两下 ⇒ 建出**两场**会话，
 * 第二场是个没人认领的孤儿（界面只会跳到第一场）；删除连点 ⇒ 第二下在第一下还没回来时就发出去了
 * ——而 `session-panel.tsx` 的二次确认在 `await` **之前**就把 `待删` 归了零，所以「确认」那一下
 * 并不会被它自己的状态机拦住。
 *
 * ⚠️ **2026-10-08 改**：原文写「三根线（新建 / 切换 / 删除）都交出去一个不可重入的动作」——
 * **数错了**：切换那条是**同步**的（只 `navigate`），根本没有在途窗口，也就不存在「不可重入」。
 * 这条与 `session-actions.ts` 实现注释那处（同一句话）是同一笔账（`LEARNINGS #005-04`：
 * 说「已统一」前先 grep 出全部同类落点——这处就是当时的漏网）。
 *
 * ⚠️ 与缺口表里那条「`待删` 是**粘**的」**不是同一件事**：那条讲的是「确认态在切走再切回之后
 * 还亮着」，这条讲的是「同一个动作能不能同时在途两份」。两条都真实，修法不同。
 *
 * ## 为什么放在这一层
 *
 * 那两根线的异步动作都在 `ai-session-slot.tsx`（纯接线、挂不起来测）。守卫是有判断的那一半的
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

/**
 * 导出会话（T016 / FR-010 · [出参：右栏能把当前会话导出成 JSON 落盘]）。
 *
 * ## 为什么补这一条 task
 *
 * Step 5 的 **D2**：原裁定写「FR-010 的『导出会话』本仓没有这个能力 ⇒ 改 spec 正文」，
 * 2026-10-07 复核把那个前提推翻了——**能力在上游就在**（`utils/session-export.ts`，三处生产调用点），
 * 缺的只是**右栏的入口**。裁定：补进 006，新开 T016。
 *
 * ## 这一组钉的是什么（照 T015 的分工）
 *
 * `ai-session-slot.tsx` 是**纯接线、挂不起来测**（要活着的服务器）。所以这里钉**有判断的那一半**：
 * ① **取的是哪一场**（两个取数都按同一个 `sessionID`，不是别的 id）；
 * ② **拼出来的是什么**（会话 ＋ 消息拼成上游那份 `{ info, messages }` 形状）；
 * ③ **文件名叫什么**（交给上游 `sessionExportFilename`，不在这里重写一份正则 —— `#002-06`）。
 * 落盘那一下（blob / `<a download>` / `URL.createObjectURL`）**不在这里测**：它是上游
 * `downloadSessionExport` 的活，上游有自己的单测（`utils/session-export.test.ts`）；
 * 在这里再钉一遍就等于把同一件事的判据写第二份（`#004-12` 的反面：抄同族的**形状**，
 * 不抄同族的**断言**）。
 *
 * ## ④ 与 ③ 的分工
 *
 * ③ 钉「会话**取到了**、标题可用」这条正常路；④ 钉**取不到**那条路——它在生产里对应
 * 「会话被别处删了 / id 是旧的」，而这条链**必须抛**：接线层 `.catch(报错)` 才有话说。
 * 一个 `.catch(() => undefined)` 的实现会过 ①②③、在 ④ 上红，而它的症状是**点了导出什么都不发生**
 * （没有文件、也没有报错）。
 */
describe("T016 / FR-010 · 导出会话", () => {
  /**
   * 一份最小的上游导出物形状（`{ info, messages: [{ info, parts }] }`，见 `utils/session-export.ts`）。
   *
   * ⚠️ 这两条断言就地关掉（`lint:openhive` 的判据是「本次新增/改动文件 0 命中」）：夹具只需要
   * `id` / `title` 一个 / 两个字段，逐字段填是给夹具加噪音 —— 与 `session-panel.test.tsx` 的
   * `造会话` / `造消息` 同因同注。`as` 只能从**子集**断言上来（`Session` / `Message` 都带必填字段），
   * 所以这里没有任何「形状被绕过」的风险。
   */
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码；理由见上。
  const 假会话 = { id: "ses_甲", title: "资金分析会话" } as Session
  const 假消息 = [
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同上（`Message` / `Part` 都是联合类型，必填字段多）。
    { info: { id: "msg_1" } as Message, parts: [{ id: "prt_1" } as Part] },
  ]

  test("① 取的是**这一场**：两下取数都按同一个 sessionID，拼成一份 { info, messages }", async () => {
    const 客户端 = 造客户端({ 会话: 假会话, 消息: 假消息 })

    const 导出 = await 导出会话({ client: 客户端.client, sessionID: "ses_甲" })

    // **被测属性**：两份数据都进了导出物（少一份就是「导出的历史缺一半」，而它不报错）。
    expect(导出.数据).toEqual({ info: 假会话, messages: 假消息 })
    // 形状：两下取数都**按当前这一场**——导错一场的代价是把**别人的会话**导出成文件。
    expect(客户端.取会话的).toEqual([{ sessionID: "ses_甲" }])
    expect(客户端.取消息的).toEqual([{ sessionID: "ses_甲" }])
  })

  test("② 文件名交给上游 `sessionExportFilename`（不在这里重写一遍正则）", async () => {
    // 判据取上游那份**英文标题**的样张（`utils/session-export.test.ts` 里就有同一条）：
    // 这里钉的是「本模块把它**接上了**」，不是「正则写得对」——正则对不对归上游那条。
    const 客户端 = 造客户端({ 会话: { id: "ses_甲", title: "Clone PR in worktree" } })

    const 导出 = await 导出会话({ client: 客户端.client, sessionID: "ses_甲" })

    expect(导出.文件名).toBe("clone-pr-in-worktree.json")
  })

  test("③ ⚠️ 中文标题 ⇒ 文件名**回落成会话 id**（上游那条只留 `[a-z0-9_-]`）——记录 ＋ 哨兵", async () => {
    // 这是**上游既有行为**，本处不改（「不许发明」：文件名形态照上游三处）。
    // 但它是**民警看得见**的一条：本产品的会话标题基本全是中文 ⇒ 导出的文件叫 `ses_xxxx.json`。
    // ⇒ 写成用例是为了当**哨兵**：哪天有人去改 `sessionExportFilename` 的正则，这条会红，
    //   逼人回来回答「中文标题该叫什么文件名」。⚠️ 别把它读成「本模块干了什么」
    //   （`LEARNINGS #005-15`：注释不许比断言强）。
    const 客户端 = 造客户端({ 会话: { id: "ses_甲", title: "资金分析会话" } })

    const 导出 = await 导出会话({ client: 客户端.client, sessionID: "ses_甲" })

    // 落点是 `clean || session.id`：中文标题被洗成空串 ⇒ **取 id**，而 id 是**原样**拼上去的
    // （上游最后那行不洗 id）⇒ 结果是 `ses_甲.json`。
    expect(导出.文件名).toBe("ses_甲.json")
  })

  test("④ 会话取不到 ⇒ **抛出去**（接线层的 `报错` 才有话说）", async () => {
    // 吞掉它的实现（`.catch(() => undefined)`）在界面上是「点了导出，什么都没发生」。
    const 客户端 = 造客户端({ 会话: null })

    await expect(导出会话({ client: 客户端.client, sessionID: "ses_没了" })).rejects.toThrow("Session not found: ses_没了")
  })
})

describe("当前项目目录（左栏会话列表的取数前提，2026-10-08）", () => {
  /**
   * 左栏「会话」tab 要靠**目录**取数，而目录是服务端在项目列表上给的（`ProjectEntry.directory`）。
   * 本函数把「清单 ＋ 当前项目 → 该去哪个目录取会话」这一条判断**从接线层抽出来**——接线层
   * （`sidebar-sessions.tsx`）依赖活着的服务器连接，挂不起来测；而这条判断错了**不报错、不变红**，
   * 只是左栏列的是另一个目录的会话。
   */
  const 行 = (over: Partial<可定位的项目行> & { id: string }): 可定位的项目行 => ({
    directory: `/workspaces/u1/${over.id}`,
    ...over,
  })

  test("当前项目在清单里、活跃、有目录 ⇒ 给出它的目录", () => {
    expect(当前项目目录("p2", [行({ id: "p1" }), 行({ id: "p2" })])).toBe("/workspaces/u1/p2")
  })

  test("没选项目（undefined）⇒ 没有目录可去", () => {
    expect(当前项目目录(undefined, [行({ id: "p1" })])).toBe(undefined)
  })

  test("清单还没到（undefined）⇒ 没有目录可去（不是「空清单」）", () => {
    expect(当前项目目录("p1", undefined)).toBe(undefined)
  })

  test("清单里找不到这个 id ⇒ 没有目录可去（宁缺勿假，不猜一个）", () => {
    expect(当前项目目录("p9", [行({ id: "p1" })])).toBe(undefined)
  })

  test("那一行没有 directory 键 ⇒ 没有目录可去", () => {
    expect(当前项目目录("p1", [{ id: "p1" }])).toBe(undefined)
  })

  /**
   * **已归档 ⇒ 没有目录可去**——这条不是洁癖，是左右栏会不会分家的判据。
   *
   * 归档＝冻结，而服务端的目录锚定（`project-location.ts`）**只对活跃项目生效**：项目已归档时
   * 它当作没带 cookie，会话实际读的是**沙箱根**。此时左栏若照常列出「项目目录下的会话」，
   * 列出来的是**另一个目录**的东西——屏幕上完全看不出不对（这正是后端出参那段注释警告的
   * 「列的是另一个目录的会话」）。所以这里返回 `undefined` ⇒ 不画「＋」、不去取数、不画空态。
   */
  test("当前项目**已归档** ⇒ 没有目录可去（冻结：服务端对它不做目录锚定）", () => {
    expect(当前项目目录("p1", [行({ id: "p1", archived: true })])).toBe(undefined)
  })

  test("同清单里活跃的那一个照常给（不是「有归档行就全不给」）", () => {
    expect(当前项目目录("p2", [行({ id: "p1", archived: true }), 行({ id: "p2" })])).toBe(
      "/workspaces/u1/p2",
    )
  })
})
