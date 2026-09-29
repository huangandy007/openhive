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

export class Service extends Context.Service<Service, Info>()("@opencode/User") {}
