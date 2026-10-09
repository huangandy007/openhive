import type { DirectorySDK } from "@/context/sdk"
import {
  fetchSessionExport,
  sessionExportFilename,
  type SessionExportClient,
  type SessionExportData,
} from "@/utils/session-export"
import { routeSessionID } from "./route-session"

/**
 * 右栏会话动作的**可测那一半**：新建 / 删除 / 切换（T015 / FR-010 / US4 场景 2）
 * ＋ 导出（T016 / FR-010）。
 *
 * ## 为什么单独一个文件
 *
 * 这些动作都发生在 `ai-session-slot.tsx`（生产组装），而那是**纯接线、挂不起来测**的一层
 * （它要活着的服务器连接才建得起 `ServerSyncProvider`，见那文件头）。
 * ⇒ 把**有判断的那些**抽到这里：目录参数怎么传、删完去哪一场、切会话的 URL 怎么拼、
 * 导出拿的是哪一场的哪两块数据。接线层只剩「取 SDK → 调这里 → `navigate` / 落盘」。
 *
 * ## 都照上游现成实现，不自己发明（`LEARNINGS #004-12`：新出口先抄同族）
 *
 * | 这里 | 蓝本（上游调用点） |
 * |---|---|
 * | `建会话` | `components/prompt-input/submit.ts:404` — `api.session.create({ location: { directory } })` |
 * | `删会话` | `pages/session/timeline/message-timeline.tsx:826` — `api.session.remove({ sessionID })` |
 * | `删除后去哪` | 同文件 **`:823`** — `sessions[index + 1] ?? sessions[index - 1]`（连上面那行 `.filter` 一起） |
 * | `会话路径` | `route-session.ts` 的**逆命题**（那边解 id，这边拼 id） |
 * | `导出会话` | `utils/session-export.ts` 的三件套（`session-context-tab.tsx:231` / `message-timeline.tsx:796` / `use-session-commands.tsx:242` 三处同形） |
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
 * 给一场会话改名（左栏右键菜单与右栏顶栏**共用这一个出口**——两边都只调它）。
 *
 * ## 出口名是**实测**的（`rename`），不是推断
 *
 * `api.session.rename` 早就在兼容层实现好了：`utils/server-compat.ts` 的
 * `async rename(value) { await legacy(value).session.update({ sessionID, title }) }`。
 * ⚠️ **底下那一下是 legacy 客户端的 `session.update`**，而 `rename` 这个名字是兼容层
 * `Omit<…, "rename"> & { rename: … }` 显式加回来的——与同文件 `remove` 那条注释是同一个坑：
 * 写错名字**不报错**，`lazyApi` 的 `get` 对取不到的函数直接返回 `sample`（`undefined`）
 * ⇒ 点下去那一刻才 `TypeError`。本仓另有两处上游调用点同形：
 * `pages/session/timeline/message-timeline.tsx` 的 `titleMutation` 与
 * `components/titlebar-tab-strip.tsx` 的 `rename`，两处都是 `api.session.rename({ sessionID, title })`
 * （**不带 `directory`**：目录由 SDK 上下文带，与那两处的口径一致）。
 *
 * ## 不传目录、也不传别的字段
 *
 * 就 `{ sessionID, title }` 两项——照**被调方**的签名打勾（`LEARNINGS #004-07`），
 * 多传的字段在兼容层会被忽略、在下游会变成噪音。
 *
 * **失败向上抛**（`rename` 的 reject 原样冒出去），由接线层回话——与同文件 `删会话` 同一分工。
 */
export async function 重命名会话(input: {
  api: 会话出口
  sessionID: string
  title: string
}): Promise<void> {
  await input.api.rename({ sessionID: input.sessionID, title: input.title })
}

/**
 * 这份草稿**值不值得发出去**——不值得就是 `undefined`（调用方据此**不发请求**、直接退出编辑态）。
 *
 * 三条判据，一条一个理由：
 * - **trim 后为空** ⇒ 不改：把标题清空不是一次重命名，是一次删除内容（本产品没有「无标题」这个态，
 *   清空之后的界面会退回去显示会话 id）。
 * - **trim 后与原名相同** ⇒ 不改：用户点开输入框、什么都没动就关掉，不该产生一次写请求
 *   （蓝本 `message-timeline.tsx` 的 `saveTitleEditor` 就是这么收尾的）。
 * - 其余 ⇒ 交 **trim 后**的值：`\"  新名字  \"` 两头的空白是输入法的边角，不是名字的一部分。
 *
 * ⚠️ 单独抽成一个纯函数**不是为了好看**：这条判断在**两个入口**上都要用（左栏那一行、右栏那一行），
 * 各写一遍就是同一件事的第二处写法（`LEARNINGS #002-06`）——而两份一旦漂开**不报错、不变红**，
 * 只是「左栏能改成空标题、右栏不能」。
 */
export function 改名草稿(草稿: string, 原名: string | undefined): string | undefined {
  const 新 = 草稿.trim()
  if (新 === "" || 新 === 原名) return undefined
  return 新
}

/**
 * 一份会话表里**能列出来 / 能切过去**的那几场。两个筛子各是一件事：
 *
 * - `!parentID` —— 子会话不是一个能切过去的**对等**会话；
 * - `!archived` —— 归档＝冻结，切过去是一场只读会话。
 *
 * ⚠️ **它是唯一一份判据**（`LEARNINGS #002-06`）：`删除后去哪` 拿它算「下一场」，
 * 右栏那份列表（`session-panel.tsx`）拿它算「能点的那几场」。这两件事的判据必须是同一个
 * ——两处各写一遍时，「删完跳去的那一场」与「列表里点得到的那几场」会分家，
 * 而且**不报错、不变红**（右边那个集合原先根本没筛，是 006 Step 5 的 D1）。
 *
 * 泛型是为了**保住调用方的元素类型**：面板要用 `title` 渲染，`Session` 比 `会话行` 宽，
 * 收窄成 `会话行[]` 会把 `title` 丢掉。
 */
export function 可列出的会话<T extends 会话行>(会话表: readonly T[]): T[] {
  return 会话表.filter((行) => !行.parentID && !行.time?.archived)
}

/**
 * 删掉某场会话之后该去哪一场。**就是上游 `message-timeline.tsx:823` 那三行**。
 *
 * 候选集走 `可列出的会话`（上面那条注释讲清了为什么必须共用一份）。
 *
 * 找不到（`-1`）返回 `undefined`，而不是「回落到第一场」——被删的 id 可能来自一份**旧表**
 * （`data.session` 还没同步到），那种时候「跳去第一场」是把用户从原位挪走。
 */
export function 删除后去哪(会话表: readonly 会话行[], 被删id: string): string | undefined {
  const 候选 = 可列出的会话(会话表)
  const 位置 = 候选.findIndex((行) => 行.id === 被删id)
  if (位置 === -1) return undefined
  return (候选[位置 + 1] ?? 候选[位置 - 1])?.id
}

/**
 * 在途守卫：一件**不可重入**的动作，在它回来之前再点一次就**当场忽略**（返回 `undefined`）。
 *
 * **两根线（新建 / 删除）各配一份**——⚠️ **切换那条不配**：它是**同步**的（只 `navigate`），
 * 没有在途窗口（接线处 `ai-session-slot.tsx` 同一个 `在途守卫` 的注释里写着同一句，
 * 别把「两根」记成「三根」）。堵的是同一个洞的两种落法：连点两下「＋ 新会话」
 * ⇒ **建出两场**会话，第二场没人认领（界面只跳到第一场）；连点两下「确认删除」
 * ⇒ 第二下在第一下还没回来时就发出去了。
 *
 * ⚠️ **失败路径也必须解锁**（**用例 ③④**——两条各钉一条复位路径，`#005-12`：落点 N 处写 N 条）：
 * ③ 是**异步**拒绝（走 `结果.finally`），④ 是**同步**抛出（走下面那个 `catch`）。
 * 只在成功分支把 `忙` 放回 `false` 的写法，症状是「一次网络抖动之后那颗钮**永久**没反应」
 * ——不报错、不变红。
 * 所以这里的复位在 `finally` 里，且动作**同步抛出**时也复位（`try` 只包住 `动作()` 这一下，
 * 状态与承诺分开管）。
 *
 * ⚠️ 返回 `Promise<T> | undefined` 而不是 `Promise<T | undefined>`：`undefined` 要能
 * **同步**拿到，调用方才能区分「这次被忽略了」与「这次跑完了」。异步形态做不到这件事
 * （`async` 函数**永远**回一个承诺），那会让「被忽略」在 `await` 之后与「动作真的返回了
 * undefined」长得一样。
 */
export function 在途守卫() {
  let 忙 = false
  return <T>(动作: () => Promise<T>): Promise<T> | undefined => {
    if (忙) return undefined
    忙 = true
    let 结果: Promise<T>
    try {
      结果 = 动作()
    } catch (错) {
      // 同步抛出（取 SDK 那一句就可能抛）——不复位的话这颗钮当场焊死。
      忙 = false
      throw 错
    }
    return 结果.finally(() => {
      忙 = false
    })
  }
}

/**
 * 项目清单里的一行——「当前项目目录」只读这三样：`id` 用来认行、`archived` 判冻结、
 * `directory` 就是答案本身。**形状由被调方定义**（`LEARNINGS #004-07`）：本函数不需要
 * `ProjectEntry` 的其余字段（`name` / `type` / `lastAccessedAt` …），写成窄形状，测试才不必
 * 造一个假项目出来。
 */
export interface 可定位的项目行 {
  readonly id: string
  readonly archived?: boolean
  readonly directory?: string
}

/**
 * 左栏会话列表该去**哪个目录**取数（2026-10-08）。
 *
 * ## 为什么要单独一个函数
 *
 * 这条判断的落点是接线层（`sidebar-sessions.tsx`），而那一层要活着的服务器连接才挂得起来
 * ⇒ 挂不起来测。可它的判据错了**不报错、不变红**，只是**左栏列的是另一个目录的会话**
 * ——同上 `#002-06` 那条「同一个判断两处各写一份」的另一种形态。所以按本文件一贯的做法把它
 * 抽出来：接线层只剩「读这两个信号 → 调它 → 把结果喂给 `SessionList`」。
 *
 * ## 四种「没有目录」（返回 `undefined`）——四种都**不**猜一个
 *
 * ① 没选项目（`项目ID === undefined`）；② 清单还没到（`清单 === undefined`，不是「空清单」）；
 * ③ 清单里找不到这个 id；④ 那一行没有 `directory` 键。四者的界面后果都是：不画「＋」
 * （`SessionList` 的 `directory` 是 `undefined`）、不去取会话、不画空态。
 *
 * ## ⑤ 已归档 ⇒ **也没有目录**（这条是左右栏会不会分家的判据）
 *
 * 归档＝冻结，而服务端的目录锚定（`project-location.ts`）**只对活跃项目生效**：项目已归档时
 * 它当作没带那个信号，会话实际落在**沙箱根**（`packages/opencode/src/server/routes/instance/
 * httpapi/middleware/project-location.ts` 的「第四笔裁定」）。此刻左栏若照常列出「项目目录下
 * 的会话」，列出的是**另一个目录**的东西，而屏幕上完全看不出不对
 * （后端 `project.ts` 出参那段注释警告的正是这个）。⇒ 宁可什么都不列：界面上的说法是
 * 「这个项目冻结了」，而不是一句看起来正常的、错的列表。
 */
export function 当前项目目录(
  项目ID: string | undefined,
  清单: readonly 可定位的项目行[] | undefined,
): string | undefined {
  if (项目ID === undefined || 清单 === undefined) return undefined
  const 行 = 清单.find((候选) => 候选.id === 项目ID)
  if (行 === undefined || 行.archived === true) return undefined
  return 行.directory
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

/** 一份导出物：**文件名 ＋ 内容**，两样都齐了才落得成盘。 */
export interface 导出物 {
  readonly 文件名: string
  readonly 数据: SessionExportData
}

/**
 * 取回**这一场**会话的导出物（T016 / FR-010 / US4）。
 *
 * ## 它只做「取 ＋ 拼 ＋ 起名」，不落盘
 *
 * 上游三件套的第三件 `downloadSessionExport`（blob ＋ `<a download>` ＋ `URL.createObjectURL`）
 * **不由本函数调用**，而是接线层接在 `.then` 上。理由只有一条，是**可测性**：本函数是「有判断的
 * 那一半」，它要在 `bun test` 里挂得起来；把 DOM 那一下留在里面，这一组就得靠打桩才测得了
 * （`LEARNINGS #004-12` 的反面：抄同族的**形状**，不抄同族的**断言**——落盘那一下上游自己有单测）。
 * ⇒ 判据只剩「取的是哪一场」「拼出来是什么」「文件名叫什么」，三条都实打实。
 *
 * ## ⚠️ 它要的是**legacy 客户端**，不是右栏那个 `api`（2026-10-08 实测更正）
 *
 * `fetchSessionExport` 要 `{ session: { get, messages } }`（`SessionExportClient`），而上游三处
 * 生产调用点传的都是 **`sdk().client`**——那份 `createOpencodeClient` 出来的 **legacy** 客户端。
 *
 * ⚠️ **不能传 `DirectorySDK["api"]["session"]`**（右栏 T015 一直在用的那个「会话出口」）：
 * 它是 `createCompatibleApi` 的产物，而**新协议里根本没有 `session.messages` 这个出口**——
 * 消息在**另一个命名空间**里（`endpointNames["session.messages"] = "list"`，
 * `packages/client/src/contract.ts`；协议侧 `groups/message.ts` 的 `GET /api/session/:id/message`），
 * 且新形状要过 `normalizeSessionMessages` 才是 `{ info, parts }`。
 * 这是 tsgo 抓出来的（`Property 'messages' is missing in type 'CompatibleSessionApi'`），
 * 不是推断——**T016 的 task 条目原先写的「`api.session.get` / `api.session.messages` 正是右栏已有的
 * 两个方法」有一半是错的**，那条更正见 `tasks.md` 该条与 `state.md`。
 *
 * ⇒ 右栏要的那一份就在同一个 `ensureDirSdkContext(目录)` 上：**`.client`**（`DirectorySDK` 的两个
 * 属性之一，`context/server-sdk.tsx` 的 `createDirSdkContext` 同时返回 `client` 与 `api`）。
 * 一行适配都不用写——**上游传什么，这里就传什么**（`LEARNINGS #004-12`）。
 *
 * ## 为什么不去用右栏**已经有的** `data`
 *
 * 右栏手上确实有一份 `props.data`（sync store 的投影）。不用它的理由不是「取不到」，而是
 * **别再写第二份导出物形状**（`LEARNINGS #002-06`）：上游那份 `{ info, messages }` 是
 * CLI `opencode export` 的同一个形状，三处生产调用点都走这条取数；拿 store 拼一份「像导出物」
 * 的东西，两份形状一旦漂开**不报错、不变红**，只是导出的文件跟 CLI 导出的不一样。
 *
 * ## ⚠️ 中文标题 ⇒ 文件名回落成会话 id
 *
 * 起名交给上游 `sessionExportFilename`（照抄，不重写正则），而它只保留 `[a-z0-9_-]`
 * ⇒ 本产品的会话标题基本全是中文时，导出的文件叫 `ses_xxxx.json`。**这是上游既有行为**，
 * 本处不改（`用例 ③` 把它记成哨兵：哪天有人动那条正则，会红）。
 *
 * ## ⚠️ 与 `session.share` 不是一回事
 *
 * share 是**发布到网上**（`"Publish on web"` / 复制链接），数据适用性在公安场景**未裁定**；
 * 导出是**落到本地一个文件**。别把两者混成一条需求（见 `spec.md` 的 FR-010 更正块）。
 */
export async function 导出会话(input: { client: SessionExportClient; sessionID: string }): Promise<导出物> {
  const 数据 = await fetchSessionExport({ sessionID: input.sessionID, client: input.client })
  return { 文件名: sessionExportFilename(数据.info), 数据 }
}
