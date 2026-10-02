import { Context } from "effect"

export * as User from "./user"

/**
 * 一次请求的**已验签**用户身份。
 *
 * 这是 openhive 多租户的「用户主体」——每用户独立 db 的路由键、沙箱目录的锚定依据、
 * 配额计数的归属，全都从这里取。**放在 core 而不是 opencode**，理由有两条：
 * ① 被点名的仿照对象 `Location` 就在 core，`Location.Service` 的消费者也在 core；
 * ② `003` 的 T005 写的是「db 查询**从 User 上下文取** userId 路由到对应连接」，
 *    而 `Database` 在 `packages/core/src/database/`——core 要读得到，tag 就得在 core。
 *
 * ⚠️ **它是「验签结果」，不是「请求里带的值」**。`X-User-ID` 是明文头，
 * 任何够得着端口的人都能自填，**MUST NOT** 被当作身份来源（003 裁定【甲】，2026-09-29）。
 * 填这个上下文的唯一合法来源是 `packages/auth/src/token.ts` 的 `verifyToken` 的返回。
 *
 * 与 `Location` 的**不同**之处（别照搬那边）：`Location` 是 `LayerNode.unbound` 造的、按 key
 * 缓存的服务树（`buildLocationServiceMap` 的 `LayerMap` + TTL 回收）；用户身份是**每请求**的
 * 数据，不需要构造、不需要缓存——中间件验完签直接 `Effect.provideService` 填进来即可。
 * 用 `Context.Service` 拿到的「未填即报错」保证与 `LayerNode.unbound` 的编译期保证等价
 * （消费者要求了却没被提供 = 类型上过不去 / 运行时 Service not found），
 * 且不必为此把整棵层树按请求重建。
 */
export interface Info {
  /** 用户 id（`auth.user.id`，UUID）——per-user db 与沙箱目录的路由键。 */
  readonly id: string
  readonly policeNo: string
  readonly name: string
  readonly isAdmin: boolean
}

/**
 * `Info.id` 能不能**当一个路径段用**——凡是要拿它拼路径的调用点，先过这里。
 *
 * 为什么要有这个谓词：`id` 的正常来源是 002 的 `registerUser` 用 `crypto.randomUUID()` 铸的
 * UUID，但**没有任何类型或校验把这条写死**——`verifyToken` 只查 `typeof sub === "string"`，
 * 于是「id 是 UUID」这个前提靠的是**另一个模块的实现细节**，不是使用侧自己能保证的事。
 * 而 `id` 在这套系统里是**隔离边界**：拿它拼路径的地方一旦拼接逃逸，就是跨用户（甚至出沙箱）。
 *
 * 判据是「**拼出来的路径会不会跑掉**」，不是「id 长得像不像 UUID」——所以拦的是四类：
 * - 空串：`join(root, "")` = 根自己，**所有用户塌进同一个目录**（隔离整个失效，最坏的一种）；
 * - `.` / `..`：前者同上，后者落到根的**外面**；
 * - 含 `/` 或 `\`：多带一段就换了一层目录，`../bob` 由此逃逸。
 *
 * ⚠️ **`packages/auth/src/workspace.ts` 有一份等价实现（`assertSafeUserId`），不是漏改**：
 * core 与 auth 互相够不着（core 不能 import auth，auth 也不依赖 core），两份都得住。
 * 本文件这份**覆盖 core 与 opencode 侧**：`core/database/router.ts` 的 `userDatabasePath`、
 * `opencode/src/server/routes/instance/httpapi/middleware/anchor-workspace.ts` 的锚定。
 * 将来若两边能互相依赖了，合并成一份——在那之前，改一侧记得看另一侧。
 */
export function isSafePathSegment(id: string): boolean {
  return id !== "" && id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\")
}

export class Service extends Context.Service<Service, Info>()("@opencode/User") {}
