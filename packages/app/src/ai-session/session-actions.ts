import type { DirectorySDK } from "@/context/sdk"
import { routeSessionID } from "./route-session"

/**
 * 右栏「会话管理三件事」（T015 / FR-010 / US4 场景 2）的**可测那一半**：新建 / 删除 / 切换。
 *
 * ## 为什么单独一个文件
 *
 * 三件事都发生在 `ai-session-slot.tsx`（生产组装），而那是**纯接线、挂不起来测**的一层
 * （它要活着的服务器连接才建得起 `ServerSyncProvider`，见那文件头）。
 * ⇒ 把**有判断的那些**抽到这里：目录参数怎么传、删完去哪一场、切会话的 URL 怎么拼。
 * 接线层只剩「取 SDK → 调这里 → `navigate`」。
 *
 * ## 三件事都照上游现成实现，不自己发明（`LEARNINGS #004-12`：新出口先抄同族）
 *
 * | 这里 | 蓝本（上游调用点） |
 * |---|---|
 * | `建会话` | `components/prompt-input/submit.ts:404` — `api.session.create({ location: { directory } })` |
 * | `删会话` | `pages/session/timeline/message-timeline.tsx:826` — `api.session.remove({ sessionID })` |
 * | `删除后去哪` | 同文件 **`:823`** — `sessions[index + 1] ?? sessions[index - 1]`（连上面那行 `.filter` 一起） |
 * | `会话路径` | `route-session.ts` 的**逆命题**（那边解 id，这边拼 id） |
 *
 * ⚠️ **`remove` 这个名字是实测的、不是推断**：`DirectorySDK["api"]["session"]` 来自
 * `createCompatibleApi`（`utils/server-compat.ts:86`）——一个 **lazy Proxy**，而它底下 v2 生成客户端
 * 上那个方法其实叫 **`delete`**（`packages/sdk/js/src/v2/gen/sdk.gen.ts` 的 `Session2`）。
 * 名字是 `CompatibleSessionApi` 那层显式改回来的（`server-compat.ts:21-32`）。
 * ⇒ 写 `delete` **不会报错**，只会静默取到 `undefined`（`lazyApi` 的 `get` 对非函数非对象直接返回
 * `sample`），点删除那一刻才 `TypeError`。
 *
 * ## 为什么不用 `utils/session-route.ts` 的 `sessionHref`
 *
 * 它要一个 `ServerConnection.Key`（真 key 对象），而右栏手上只有 `useLocation().pathname`
 * ——本文件是**从路径推路径**，`requireServerKey` 那道校验已经在 `SelectedServerProviders`
 * 里跑过了（`route-session.ts` 文件头有同一句）。这里**不解码** key，只搬它。
 */

/** 右栏要用的那一份 SDK 出口（生产＝`ai-session-slot.tsx` 从 `ensureDirSdkContext` 取的那份）。 */
export type 会话出口 = DirectorySDK["api"]["session"]

/** 会话表里的一行。「删除后去哪」只读这三项（子会话与归档都不算候选）。 */
export interface 会话行 {
  readonly id: string
  readonly parentID?: string
  readonly time?: { readonly archived?: number }
}

/**
 * 建一场会话，返回它的 id。
 *
 * ⚠️ `location.directory` **必须带**：`create` 的四个字段全可选（`V2SessionCreateData`），
 * 少传不会报错——只是会话落到 SDK 的默认目录，即**新建的会话跟民警当前这个项目不在一个目录里**。
 * `agent` / `model` 同样可选，本处**不传**：右栏没有选择器，新会话用默认 agent，与上游
 * 会话页「新建」的语义一致（那边是从 prompt-input 的状态里取，右栏没有那份状态）。
 */
export async function 建会话(input: { api: 会话出口; directory: string }): Promise<string> {
  const 会话 = await input.api.create({ location: { directory: input.directory } })
  return 会话.id
}

/**
 * 删一场会话。**失败向上抛**（`remove` 的 reject 原样冒出去），由接线层回话——
 * 与上游 `message-timeline.tsx` 在 `.catch` 里弹 toast 是同一分工，只是那口锅在那边是内联的。
 */
export async function 删会话(input: { api: 会话出口; sessionID: string }): Promise<void> {
  await input.api.remove({ sessionID: input.sessionID })
}

/**
 * 删掉某场会话之后该去哪一场。**就是上游 `message-timeline.tsx:823` 那三行**。
 *
 * 两个筛子各是一件事、各有断言守着：`!parentID`（子会话不是一个能切过去的对等会话）、
 * `!archived`（归档＝冻结，切过去是一场只读会话）。
 *
 * 找不到（`-1`）返回 `undefined`，而不是「回落到第一场」——被删的 id 可能来自一份**旧表**
 * （`data.session` 还没同步到），那种时候「跳去第一场」是把用户从原位挪走。
 */
export function 删除后去哪(会话表: readonly 会话行[], 被删id: string): string | undefined {
  const 候选 = 会话表.filter((行) => !行.parentID && !行.time?.archived)
  const 位置 = 候选.findIndex((行) => 行.id === 被删id)
  if (位置 === -1) return undefined
  return (候选[位置 + 1] ?? 候选[位置 - 1])?.id
}

/**
 * 把会话路径的末段换成另一个 id（切会话 ＝ **改路由**：右栏的会话 id 只有一个产地，
 * 就是 URL——见 `route-session.ts` 文件头）。
 *
 * 形状判据**复用 `routeSessionID`**，不在这里重写一遍那三个条件：重写就是同一件事的第二处
 * 写法（`LEARNINGS #002-06`），而两份判据一旦漂开，表现是「点了切会话，右栏什么都不变」。
 */
export function 会话路径(pathname: string, id: string): string | undefined {
  if (routeSessionID(pathname) === undefined) return undefined
  return `/server/${pathname.split("/")[2]}/session/${id}`
}
