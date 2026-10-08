/**
 * 右栏「同一条消息显示两遍」的**复现网**（2026-10-08 真栈肉眼报出）。
 *
 * ## 为什么另开一个文件，而不加进 `server-session.test.ts`
 *
 * 被测的 `server-session.ts` 与它那个测试文件都是**上游原样文件**
 * （`git diff --name-status upstream/dev..HEAD` 对本文件为空）。往那儿加用例等于在**上游高频文件**
 * 上埋合并冲突点，撞本项目第一号约束（`openhive/CLAUDE.md`「必须能持续同步官方更新」）。
 * 本文件是 fork 自己的落点：**上游哪天修了，删掉这一个文件即可**，不动上游一行。
 *
 * ## 复现的是什么（假设，尚未当结论用）
 *
 * 同一条消息有**两个写入出口**，去重的判据**不是同一个**：
 *
 * - **fetch**（`reconcileFetched`，`server-session.ts` 的 `:151`）按 **`id`** 去重 ⇒ 上游用例
 *   「replaces confirmed optimistic content with the initial page」钉着它，同 id 不同时间**只留一条**；
 * - **事件**（`message.updated`，`:1053`）按 **`messageKey = time.created + id`** 做 `Binary.search`
 *   ⇒ **完全没有用例**。
 *
 * 而乐观插入（`optimistic.add`，`:1343`）写进 `data.message` 的 `input.message` 带的是
 * **调用方给的** `time.created`；服务端回包的信封带的是**服务端**时钟。两者一旦不同，
 * `Binary.search` 就找不到那条同 id 的消息 ⇒ 走 `!found` 支路 `splice` **再插一条**
 * ⇒ 数组里出现**两条同 id**。
 *
 * 这与真栈实测吻合：同 id 渲染两遍、**刷新整页即消失**（刷新走 fetch 那条出口）、内核 oracle 只有一条。
 *
 * ## 两条用例是一对，缺一不可
 *
 * 只写「不同时间」那条时，一个「无论时间如何都插第二条」的坏法**照样绿**（`#005-07`）；
 * 只写「相同时间」那条时，被测的坏法**照样绿**（`#005-15`：拿不到红就等于没钉住）。
 * 所以下面对照组与被测组都必须有，且**对照组现在就该是绿的**——它证明这条链本身是活的。
 *
 * ⚠️ 夹具整段抄自 `server-session.test.ts`（`LEARNINGS #004-12`：同族 harness 整段搬，别自己造）。
 */
import { describe, expect, test } from "bun:test"
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/v2/client"
import { createServerSession } from "./server-session"

type UserMessage = Extract<Message, { role: "user" }>
type TextPart = Extract<Part, { type: "text" }>
type MessageResponse = {
  data: { info: Message; parts: Part[] }[]
  response: { headers: Headers }
}

const session = (id: string, parentID?: string) => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "1",
  parentID,
  time: { created: 1, updated: 1 },
})

const userMessage = (id: string, input: Partial<UserMessage> = {}): UserMessage => ({
  id,
  sessionID: "child",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
  ...input,
})

const textPart = (messageID: string, input: Partial<TextPart> = {}): TextPart => ({
  id: "part",
  sessionID: "child",
  messageID,
  type: "text",
  text: "text",
  ...input,
})

const response = (data: MessageResponse["data"] = [], cursor?: string): MessageResponse => ({
  data,
  response: { headers: new Headers(cursor ? { "x-next-cursor": cursor } : undefined) },
})

function messageClient(...responses: Array<MessageResponse | Promise<MessageResponse>>) {
  let index = 0
  const client = {
    session: {
      get: async () => ({ data: session("child", "root") }),
      // 一条都取不到：把「数组里有什么」这件事**完全交给**乐观插入与事件两条出口，
      // 免得 fetch 那条出口（它按 id 去重，是对的）把被测的现象盖掉。
      messages: () => responses[index++],
    },
  } as unknown as OpencodeClient
  return client
}

/** 数组里此刻有哪些 id——用原语比对，别把整个 store 当实得值打印（`#005-01`）。 */
const ids = (store: { data: { message: Record<string, Message[] | undefined> } }) =>
  (store.data.message.child ?? []).map((message) => message.id)

describe("同一条消息的两个写入出口（右栏重复显示）", () => {
  test("对照：事件信封与乐观插入**同一时刻** ⇒ 只该有一条", () => {
    const optimistic = userMessage("message", { time: { created: 1 } })
    const part = textPart(optimistic.id, { text: "hi" })
    const store = createServerSession(messageClient(response()))
    store.optimistic.add({ sessionID: "child", message: optimistic, parts: [part] })

    // 服务端回包的信封与乐观那条**时间相同**（同 id ⇒ 同一枚 key）。
    store.apply({ type: "message.updated", properties: { info: { ...optimistic } } })

    expect(ids(store)).toEqual(["message"])
  })

  test("被测：事件信封带**服务端时钟**（与乐观那条不同）⇒ 仍只该有一条", () => {
    const optimistic = userMessage("message", { time: { created: 1 } })
    const part = textPart(optimistic.id, { text: "hi" })
    const store = createServerSession(messageClient(response()))
    store.optimistic.add({ sessionID: "child", message: optimistic, parts: [part] })

    // 生产里乐观插入用的是**客户端** `Date.now()`，回包带的是**服务端**时钟
    // （`context/directory-sync.ts` 的 `addOptimisticMessage` 与内核各自的时钟）。
    // 跨进程同毫秒是巧合，不同才是常态 ⇒ 这里取 2。
    store.apply({ type: "message.updated", properties: { info: { ...optimistic, time: { created: 2 } } } })

    expect(ids(store)).toEqual(["message"])
  })
})
