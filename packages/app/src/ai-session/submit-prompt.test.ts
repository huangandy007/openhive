import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import type { ServerSync } from "@/context/server-sync"
import type { DirectorySDK } from "@/context/sdk"
import type { DirectorySync } from "@/context/sync"
import { submitRightPanePrompt } from "./submit-prompt"

/**
 * 右栏「提交一句话」（T010 / FR-007 / US4 场景 1）——Hero 输入框里那一行正文
 * **真的交给既有会话执行链**（`components/prompt-input/submit.ts` 的 `sendFollowupDraft`）。
 *
 * ## 这一组测的边界在哪（2026-10-07 裁定：两侧拆开）
 *
 * 本文件止步于**网络边界**：`sendFollowupDraft` **原样执行**（不是替身），被替身顶掉的一共**四处**
 * ——三处是记录型：`api.session.prompt` 与 `api.session.command`（那两下真的打到服务器）、
 * `sync.session.optimistic.*`（那几笔写到本地 store）；第**四**处 `serverSync` ⚠️ 不是记录型，
 * 是**碰就抛的哨兵**（理由见下面 `假serverSync` 那段）。**AI 真的跑起来**那一半不在这里
 * （`bun test` 里起不了 opencode 服务器，T008 已实测），
 * 它在 `packages/opencode/test/server/openhive-prompt-minimal.test.ts` 用**假模型回真 SSE ＋ 真库**
 * 跑。
 *
 * ⇒ 别把这一组读成「AI 执行过了」：它证的是「**右栏把那句话按正确的形状交出去了**」。
 */

// ── 假依赖 ──────────────────────────────────────────────────────────────────
//
// 形状照 `session-panel.test.tsx` 的仓库惯例（`as unknown as X` ＋ 就地关掉那条 lint 规则）：
// `DirectorySDK` / `DirectorySync` / `ServerSync` 都是**由 context 反推出的巨型类型**，
// 逐字段填是给夹具加噪音，且上游每加一个必填字段就红在我们这条夹具上。

/** 「这场会话上次用的」agent / model —— 右栏没有选择器，值只能从会话自己身上取。 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `Session` 是上游巨型接口，替身只填本模块真读的两个字段（见文件头「假依赖」一节）；没有值可收窄。
const 会话 = (agent?: string, model?: Session["model"]) => ({ agent, model }) as Session

/**
 * 记录型 `api` 替身。可选传一个 `实现` 覆盖默认行为（「发失败」那条用例用它，省下**同一句**
 * 巨型断言写第二遍 —— `LEARNINGS #002-06`：同一件事两处写法是缺陷的温床）。
 *
 * **两个出口各记一本账**（`prompt` / `command`）：`sendFollowupDraft` 有两条互斥的出口，
 * 只记一本的话，另一半的断言在「哪条出口被走了」这件事上是**空的**
 * （`LEARNINGS #004-13`：先问「我这条断言是不是空的」）。
 */
const 造api = (实现?: (value: Record<string, unknown>) => Promise<unknown>) => {
  const 收到: Array<Record<string, unknown>> = []
  const 命令: Array<Record<string, unknown>> = []
  // ⚠️ disable 注释要贴在这里，不是 `as` 那一行：这条规则把诊断**锚在对象字面量的开头**。
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `DirectorySDK["api"]["session"]` 是 context 反推的巨型接口（见文件头「假依赖」一节），替身只实现本模块真调的那两下。
  const api = {
    prompt: async (value: Record<string, unknown>) => {
      if (实现) return 实现(value)
      收到.push(value)
      return {}
    },
    command: async (value: Record<string, unknown>) => {
      命令.push(value)
      return {}
    },
  } as unknown as DirectorySDK["api"]["session"]
  return { 收到, 命令, api }
}

/**
 * `sync` 只需要满足 `sendFollowupDraft` **真的会碰**的那两处（`#004-07`：按被调方的全部必填项打勾，
 * 不按调用方的直觉）：`data.command`（`/` 分支的查表）与 `session.optimistic.add/remove`（乐观插入）。
 * 用**记录型**替身而不是空对象——空对象下「乐观插入有没有发生」这条判据是**空的**
 * （`LEARNINGS #004-13`：先问「我这条断言是不是空的」）。
 */
const 造sync = (命令: string[] = []) => {
  const 乐观: Array<{ 动作: string; 入参: Record<string, unknown> }> = []
  // ⚠️ 同上：锚点在对象字面量开头。
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `DirectorySync` 同样是巨型类型，这里只立被真碰的那两处（`data.command` 与 `session.optimistic.*`）。
  const sync = {
    data: { command: 命令.map((name) => ({ name })) },
    session: {
      optimistic: {
        add: (入参: Record<string, unknown>) => void 乐观.push({ 动作: "add", 入参 }),
        remove: (入参: Record<string, unknown>) => void 乐观.push({ 动作: "remove", 入参 }),
      },
    },
  } as unknown as DirectorySync
  return { 乐观, sync }
}

/**
 * `ServerSync` 只在 `optimisticBusy` 为真时被碰；本模块不传那个开关（裁定：右栏不乐观置忙）。
 * ⇒ 这个替身**故意写成会抛**：空的 `set` 会让「右栏哪天开始动 `session_status`」这件事**不报错、
 * 不变红**。写成抛，那条通路一旦接通就当场红——它同时是一句断言，不是占位
 * （`LEARNINGS #002-02`：空替身是把缺口写成覆盖；`#005-15`：别让注释比代码强）。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同上：`ServerSync` 是巨型类型，这里只立被真碰的那一处。
const 假serverSync = {
  session: {
    set: () => {
      throw new Error("右栏不该碰 serverSync.session.set（本模块不传 optimisticBusy）")
    },
  },
} as unknown as ServerSync

const 提交 = (
  输入: Partial<Parameters<typeof submitRightPanePrompt>[0]> & { text: string },
  夹具: { api: DirectorySDK["api"]["session"]; sync: DirectorySync },
) =>
  submitRightPanePrompt({
    sessionID: "ses_1",
    sessionDirectory: "/工作区/甲方/项目",
    session: 会话("build", { id: "gpt", providerID: "openai" }),
    serverSync: 假serverSync,
    ...夹具,
    ...输入,
  })

/**
 * 取一组 part 里的文本（v1 的 `legacyParts` 是 part 数组，正文藏在里面）。
 *
 * 用 `in` 收窄而不是 `as`（`no-unsafe-type-assertion` 会拦 `as`，仓里既有先例一律走收窄）：
 * `parts` 是 `unknown`，先落成 `readonly unknown[]` 再逐项判形状 —— 既过 lint，也真的在
 * 运行时挡住「不是对象 / 没有那两个字段」的东西。
 */
const 文本part = (parts: unknown) => {
  const 组: readonly unknown[] = Array.isArray(parts) ? parts : []
  return 组
    .filter((part): part is { type: string; text: string } => {
      if (typeof part !== "object" || part === null) return false
      if (!("type" in part) || !("text" in part)) return false
      return part.type === "text" && typeof part.text === "string"
    })
    .map((part) => part.text)
}

/** 「某个对象上带着 `id: string`」—— 类型谓词，不用 `as`（同上）。 */
const 有id = (值: unknown): 值 is { id: string } =>
  值 !== null && typeof 值 === "object" && "id" in 值 && typeof 值.id === "string"

describe("右栏提交一句话（T010 / FR-007 / US4 场景 1）", () => {
  /**
   * ⚠️ 那条 `expect(发了).toBe(true)` 不是凑数——它钉的是**两个文件之间的那道缝**
   * （第二轮审查 F-2，`LEARNINGS #005-12` 的跨文件版）。
   *
   * `submitRightPanePrompt` 的回话是 `session-panel.tsx` **清空输入框的唯一依据**
   * （`false` ⇒ 正文回填），而两端各测一角、**缝上没人看着**：本文件所有成功用例
   * 原先都只 `await 提交(...)` 不看返回值，面板那侧喂的又是手搓 `return true` 的替身。
   * 坏法很具体：`return sendFollowupDraft(...)` 哪天被写成 `await …; return false`
   * ⇒ 每次**成功**提交后正文都会被重新填回输入框。
   */
  test("正文真的交出去：`api.session.prompt` 收到那一行正文，挂在**这场会话**上", async () => {
    const { 收到, api } = 造api()
    const 发了 = await 提交({ text: "帮我查这个账户的资金流向" }, { api, sync: 造sync().sync })

    expect(收到.length).toBe(1)
    expect(收到[0].sessionID).toBe("ses_1")
    expect(发了).toBe(true)
  })

  /**
   * 两条协议各读**不同**的字段（`utils/server-compat.ts`）：v2 读 `text`；v1 优先读
   * `legacyParts`，**读不到就用 `text` 兜一个纯文本 part**
   * （`parts: value.legacyParts ?? [{ type: "text", text: value.text }, …]`）。
   * ⇒ **两处各写一条**（`LEARNINGS #005-12`：同一个判断落在 N 个出口上就写 N 条），
   * 但两条钉的**不是同一件事**，别读成「一条顶另一条」。
   *
   * ⚠️ 原注释写「v1 把 `text` 扔掉、只认 `legacyParts`」「少了它 v1 下正文静默变空」——
   * **两句都不成立**，那个 `??` 就是兜底（`#004-03`：写「有 X 钉住」这类事实性说法，
   * 落笔前去代码里核）。
   */
  test("v2 读的那一处带上正文（`text`）", async () => {
    const { 收到, api } = 造api()
    await 提交({ text: "帮我查这个账户的资金流向" }, { api, sync: 造sync().sync })

    expect(收到[0].text).toBe("帮我查这个账户的资金流向")
  })

  /**
   * `legacyParts` 的用处**不是**「让 v1 有正文」（上面说了，有 `??` 兜底）——是 **part 的保真**：
   * `buildRequestParts` 造出的每一件都带 `id`（该文件里 `PromptRequestPart = … & { id: string }`，
   * 每处 `id: Identifier.ascending("part")`），而**同一笔**还有一份 `optimisticParts` 供乐观插入
   * ⇒ 服务端按 `legacyParts` 建出来的 part 与本地那份**同源**（**钉在下面那条相等断言上**，
   * 不是「看着像」）。退到 `text` 兜底那条路，那件 part 由服务端自己造（id 也它自己生成）
   * ⇒ 与本地乐观那份**不同源**（**这一半未实测**——本文件只实测了「同源」那一半）。
   *
   * ⚠️ 「**不同源会怎样**」这一条**读码可证、不是推断**（第二轮审查指出我原来写得太保守）：
   * 乐观那份的回收**按 `part.id` 对账**——`context/sync.tsx` 的 `hasParts` 是
   * `want.every((part) => Binary.search(parts, part.id, (item) => item.id).found)`
   * ⇒ id 对不上就认不出本地那条乐观插入。**这条因果本文件不复现**（要真服务器回环，
   * 属于上面说的「AI 真的跑起来」那一半）。
   */
  test("v1 优先读的那一处带着 **part 数组本身**（`legacyParts`，含 `id`），不只是 `text`", async () => {
    const { 收到, api } = 造api()
    const { 乐观, sync } = 造sync()
    await 提交({ text: "帮我查这个账户的资金流向" }, { api, sync })

    expect(文本part(收到[0].legacyParts)).toEqual(["帮我查这个账户的资金流向"])
    // 顺带钉住「带着 `id`」——保真的那一半：正文对得上不算，形状也得对。
    const 那件 = Array.isArray(收到[0].legacyParts) ? 收到[0].legacyParts[0] : undefined
    expect(有id(那件)).toBe(true)

    // ⚠️ 上面那条只证了「**发出去那件**带 id」；上面注释里声称的「**两边同源**」要靠**这条
    //    相等断言**才算钉住（第二轮审查 F-3：注释比断言强）。`LEARNINGS #004-02`：一个判定
    //    有两个投影时，必须有一条**故意会红**的相等断言，而不是让两边各自长。
    //    同源的理由（读码核过，不是推断）：乐观那份是**同一份** `requestParts` 经
    //    `toOptimisticPart` 逐件映射来的（`build-request-parts.ts` 末尾，`id: part.id` 原样带过）
    //    ⇒ 哪天它改成自己造 id（或 v1 那条退到 `text` 兜底、由服务端另造 id），这条当场红。
    const 乐观组: readonly unknown[] = Array.isArray(乐观[0].入参.parts) ? 乐观[0].入参.parts : []
    const 本地那件: unknown = 乐观组[0]
    expect(有id(本地那件)).toBe(true)
    expect(有id(本地那件) ? 本地那件.id : undefined).toBe(有id(那件) ? 那件.id : undefined)
  })

  /**
   * 右栏**没有** agent / model 选择器（`useLocal()` 挂在路由层的 `LocalProvider` 上，
   * `pages/directory-layout.tsx`，与右栏平级 ⇒ 取不到）。⇒ 本轮语义固定为「**沿用这场会话的**」
   * ——这不是造数据：会话上那两个字段就是「上次用的」，而服务端缺省时的回退（`prompt.ts`
   * 的 `input.model ?? ag.model ?? currentModel(sessionID)`）第一档读的**正是它**。
   */
  test("agent 取**会话**的，不是本处另编一个", async () => {
    const { 收到, api } = 造api()
    await 提交(
      { text: "查一下", session: 会话("plan", { id: "gpt", providerID: "openai" }) },
      { api, sync: 造sync().sync },
    )

    expect(收到[0].agent).toBe("plan")
  })

  test("model 取**会话**的，且字段名按被调方换过（`Session.model.id` → `modelID`）", async () => {
    const { 收到, api } = 造api()
    await 提交(
      { text: "查一下", session: 会话("build", { id: "sonnet-5-5", providerID: "anthropic" }) },
      { api, sync: 造sync().sync },
    )

    expect(收到[0].model).toEqual({ providerID: "anthropic", modelID: "sonnet-5-5" })
  })

  /**
   * ⚠️ 会话还没记过 model 时**不传**，而不是编一个空对象：服务端 `input.model ?? …` 对
   * `{providerID:"",modelID:""}` 是**真值**，会拿它去解析模型、当场报错；`undefined` 才会走回退链。
   * 前端不镜像那条链（`LEARNINGS #002-06`）——「本栏不自选」的唯一正确表达就是**不传**。
   */
  test("会话还没记过 model ⇒ 两个字段都**不传**（交给服务端回退，不编空值）", async () => {
    const { 收到, api } = 造api()
    await 提交({ text: "查一下", session: 会话(undefined, undefined) }, { api, sync: 造sync().sync })

    expect(收到[0].model).toBeUndefined()
    expect(收到[0].agent).toBeUndefined()
  })

  /**
   * 乐观插入 = 用户自己那条消息**当场**进消息流，不必等 SSE 回环（`sendFollowupDraft` 里
   * `batch(() => { setBusy(); add() })`）。它是「展示过程」里**用户那一侧**的可见性，
   * 且失败时会 `remove()` 回滚——所以这两笔各自有牙。
   */
  test("乐观插入：用户那条消息当场进消息流（挂在**这场会话**上）", async () => {
    const { api } = 造api()
    const { 乐观, sync } = 造sync()
    await 提交({ text: "查一下" }, { api, sync })

    expect(乐观.map((笔) => 笔.动作)).toEqual(["add"])
    expect(乐观[0].入参.sessionID).toBe("ses_1")
    expect(乐观[0].入参.directory).toBe("/工作区/甲方/项目")
  })

  test("发失败 ⇒ 那笔乐观插入被回滚（不留一条永远不回话的假消息）", async () => {
    const { api } = 造api(async () => {
      throw new Error("网络断了")
    })
    const { 乐观, sync } = 造sync()

    // ⚠️ 顺序按 `LEARNINGS #004-14`（被测属性在前、伴随信号在后）：这里被测属性是**回滚**，
    // 而它只在承诺落定之后才发生 ⇒ 先用 try/catch 落定承诺，再断回滚，**最后**才断
    // 「错误有没有冒给调用方」这条弱信号。原来写成 `await expect(…).rejects.toThrow()` 打头，
    // 红的时候第一句只说「它没抛」，看不出那笔乐观插入到底回滚了没有。
    let 抛出来的: unknown
    try {
      await 提交({ text: "查一下" }, { api, sync })
    } catch (err) {
      抛出来的 = err
    }

    expect(乐观.map((笔) => 笔.动作)).toEqual(["add", "remove"])

    // 两笔的字段名不一样（`add` 带整个 `message`，`remove` 只带 `messageID`），
    // 所以这里跨两笔比 —— 钉的是「**回滚的是那一笔**」，不是「随便删了一条」。
    // ⚠️ 先断言 `动作` 序列、再比这一对：若 `add` 压根没发生，`乐观[0]` 已是 `remove` 那一笔，
    // 这条会读到错位的两笔，红出来的信息不如上面那条直白。
    // ⚠️ `toBe` 要求实参与**收到的那一侧**同型，所以 `回滚的`（`unknown`）必须在外面 —— 反着写
    // `expect(插进去的).toBe(乐观[1].入参.messageID)` 是 TS2769（`unknown` 不给 `string | undefined`）。
    const 那笔插入 = 乐观[0].入参.message
    const 插进去的 = 有id(那笔插入) ? 那笔插入.id : undefined
    const 回滚的 = 乐观[1].入参.messageID
    expect(回滚的).toBe(插进去的)

    // 伴随信号：错误确实冒给了调用方（`ai-session-slot` 的 `catch` 靠它弹 toast）。
    // 放最后 —— 它比上面两条弱：`sendFollowupDraft` 把错误吞掉、只回滚不发的话，上面两条照样绿。
    expect(抛出来的).toBeInstanceOf(Error)
  })

  /**
   * **2026-10-07 裁定 U6（同日修正）**：`/skill-name` 会**命中命令分支**——不是「原样当正文」。
   *
   * 裁定当时的前提（「服务端没有这个命令」）**不成立**，三环实测反证：
   * ① `packages/opencode/src/command/index.ts` 把 `skill.all()` 的每一项都注册成一条命令
   *    （`source: "skill"`）；② app 侧 `loadCommands`（`context/global-sync/bootstrap.ts`）
   *    把 `GET /command` 的返回**全量**装进 `sync.data.command`（不过滤 `source`）；
   * ③ 右栏 `/` 面板插进正文的正是 `/${条.skill}`（`command-palette.ts` 的 `label`），
   *    与上面那条命令名**同值**。⇒ 「选 skill → 回车」这条主路径今天真的在执行那个 skill。
   *
   * 修正后的裁定是**保持既有链行为**，所以下面两条**各钉一半**
   * （`LEARNINGS #005-12`：同一个判断落在 N 个出口上，就写 N 条）。
   */
  test("`/skill-name` 命中服务端命令 ⇒ 走命令分支执行该 skill（不是当正文发）", async () => {
    const { 收到, 命令, api } = 造api()
    const { 乐观, sync } = 造sync(["effect"])
    const 发了 = await 提交({ text: "/effect 帮我看看这段代码" }, { api, sync })

    // 这一条与上面 normal 分支那条**各钉一次**回话：两条分支是同一个 `return` 的两个入口
    // （`#005-12` 的跨文件版，理由见上面 normal 分支那条的注释）。
    expect(发了).toBe(true)
    expect(命令.length).toBe(1)
    expect(命令[0].command).toBe("effect")
    // 命令名之后的部分走 `arguments`，不再带那个 token。
    expect(命令[0].arguments).toBe("帮我看看这段代码")
    // ⚠️ 命令分支**不碰** `api.session.prompt`、也**不做**乐观插入 —— 后者是「回车之后界面零反馈」
    //    那条挂账（`state.md` 缺口表）的**事实根据**，钉在这里免得它悄悄变。
    expect(收到.length).toBe(0)
    expect(乐观.length).toBe(0)
  })

  /**
   * 另一支**不是假想的**：`sync.data.command` 是**异步**填的
   * （`context/server-sync.tsx` 的 `void loadCommands(…).then(setStore("command", …))`，不 await），
   * 命令表还没就绪时提交就走这一支 ⇒ **同一操作两种结果**，已挂账。
   */
  test("命令表里没有这个名字 ⇒ 原样当正文发出（回退支）", async () => {
    const { 收到, 命令, api } = 造api()
    await 提交({ text: "/effect 帮我看看这段代码" }, { api, sync: 造sync().sync })

    expect(命令.length).toBe(0)
    expect(收到[0].text).toBe("/effect 帮我看看这段代码")
    expect(文本part(收到[0].legacyParts)).toEqual(["/effect 帮我看看这段代码"])
  })

  /**
   * ⚠️ **已知缺陷哨兵**（`state.md` 缺口表 F3 挂着；`LEARNINGS #005-15`：「哨兵」是它的正当用途之一）。
   *
   * 命令分支构造入参时**解引用** `draft.model.modelID`（`components/prompt-input/submit.ts`），
   * 而右栏在会话没记过 model 时**正是要传 `undefined`**（上面替身那段注释写了为什么不能编空对象）
   * ⇒ 这一组合当场抛。**这不是期望行为**：哪天模型缺省被照料上（或右栏接上 `onNewSession`），
   * 这条会红 —— 那时请连着本注释一起改，别把红的它当成「新发现的缺陷」。
   *
   * 钉「抛的是哪一句」而不是「反正抛了」：`modelID` 只出现在那一处解引用上。
   */
  test("⚠️ 已知缺陷：会话没记过 model ＋ 正文命中命令名 ⇒ 当场抛（F3，挂账中）", async () => {
    const { api } = 造api()
    await expect(
      提交(
        { text: "/effect 帮我看看这段代码", session: 会话(undefined, undefined) },
        { api, sync: 造sync(["effect"]).sync },
      ),
    ).rejects.toThrow(/modelID/)
  })

  test("空白正文不提交（不发一条空 prompt、也不留一笔乐观插入）", async () => {
    const { 收到, api } = 造api()
    const { 乐观, sync } = 造sync()

    expect(await 提交({ text: "   " }, { api, sync })).toBe(false)
    expect(收到.length).toBe(0)
    expect(乐观.length).toBe(0)
  })
})
