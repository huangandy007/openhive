export * as OpenhiveAuditDenied from "./openhive-audit-denied"

/**
 * **工具越权**的审计落点（010 T010 / FR-009「全部拒绝留痕」）。
 *
 * ## 为什么在这里、不在治理路由那一层
 *
 * `Permission.ask` 的 `deny` 分支是**链 A** 上工具被拒的唯一出口（`permission/index.ts:75-79`，
 * 004 的账）。治理路由的 `GovernanceAuthz.进()` 管的是「进不进后台板块」，两者不是一回事：
 * 一个民警在自己会话里让 AI 跑被禁用的工具，走的是这里，根本碰不到治理路由。
 *
 * ## 为什么自己建连接，不用 `OpenhivePg.Service`
 *
 * `OpenhivePg` 是**路由层作用域**的服务：它由各治理路由的 `routes` 在层构造期取到，
 * 而 permission 层比路由层低得多、构造期也早得多——在它上面加依赖等于把「谁都能改的连接池」
 * 塞进内核高频层（与「最小化上游冲突」那条一号约束直接冲突）。
 * 所以这里**按 env 惰性建一个池**，并且只在这一个文件里。
 *
 * ⚠️ 池是**模块级**缓存，但**按 env 指纹失效**：`bun test` 里同一个模块只有一份实例，
 * 而每个测试文件各起一个 PGlite、端口不同——不按指纹失效，第二个文件会继续用第一个文件
 * 那个已经停掉的服务器（`pg.ts` 文件头记着这个坑：症状是满屏 500）。生产 env 恒定，
 * 一次建好不再变。
 *
 * ## 操作人从哪来
 *
 * permission 层**没有身份服务**（身份由 HTTP 身份门每请求注入，工具却在会话 fiber 里跑）。
 * 唯一可靠的信号是**实例目录**：锚定中间件把每个请求的目录改写成
 * `{沙箱根}/{userId}`，项目会话再深一层 `{沙箱根}/{userId}/{projectId}`
 * （`anchor-workspace.ts` / `project-location.ts`）。于是**相对沙箱根的第一段就是 userId**。
 *
 * 拿到的 id 还必须**在 `auth.user` 里真实存在**才写：目录可能恰好在沙箱根下却不是用户目录
 * （本机 dev、自定义 `OPENHIVE_WORKSPACE_ROOT`），那时宁可不记也不写一行「查无此人」的审计
 * ——审计里的假操作人比缺一行更难查。
 *
 * ## 永不抛
 *
 * 本函数**没有失败路径**：写入报错、拿不到可信操作人，一律 `console.warn` 后返回；
 * **PG 没配则静默返回**——那是单机 / 上游形态，不是故障（否则本机每个 deny 规则都会刷日志）。
 * 拒绝本身的结局由 `Permission.ask` 决定，审计不许改变它（同 `server/openhive/audit.ts`）。
 *
 * ## 射程据实
 *
 * 只覆盖**链 A**（`Permission.ask`）。链 B（capability 投影到工具规则）在 004 就是挂账状态，
 * 那里没有接缝可挂，也不在本 task 的范围内。
 */

import { Audit } from "@opencode-ai/auth/audit"
import { connect } from "@opencode-ai/auth/db"
import { usersByIds } from "@opencode-ai/auth/user"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { User } from "@opencode-ai/core/user"
import { relative } from "node:path"

/** 建连前必须齐的变量（与 `@opencode-ai/auth/db` 的 `REQUIRED` 同一组）。 */
const REQUIRED = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

export interface 工具拒绝输入 {
  /** 实例目录（`InstanceRef.directory`）；没有实例上下文时为 `undefined`。 */
  readonly directory: string | undefined
  readonly sessionID: string
  /** 权限键（`bash` / `edit` / `external_directory` …），不是工具名。 */
  readonly permission: string
  readonly patterns: readonly string[]
  readonly messageID?: string
  readonly callID?: string
}

/**
 * 实例目录 → 用户 id。**纯函数**（可单测，不碰库）。
 *
 * 判据：目录必须在沙箱根**之内**、不等于根；相对路径的第一段必须是合法路径段
 * （`User.isSafePathSegment`）。第二段（项目 id）不参与判定。
 */
export function 目录用户(directory: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const root = FSUtil.resolve(workspaceRoot(env))
  const dir = FSUtil.resolve(directory)
  if (dir === root || !FSUtil.contains(root, dir)) return undefined
  const userId = relative(root, dir).split(/[\\/]/)[0] ?? ""
  return User.isSafePathSegment(userId) ? userId : undefined
}

let 缓存: { readonly key: string; readonly pg: ReturnType<typeof connect> } | undefined

/** 按 env 指纹惰性建池（理由见文件头「为什么自己建连接」）。 */
function 客户端(env: Record<string, string | undefined>): ReturnType<typeof connect> {
  const key = [env.PG_HOST, env.PG_PORT, env.PG_USER, env.PG_DATABASE].join("|")
  if (缓存?.key !== key) 缓存 = { key, pg: connect(env) }
  return 缓存.pg
}

/**
 * 记一行 `tool.denied`。**永不抛**（文件头最后一段）。
 *
 * `target_type = "session"` / `target_id = sessionID`：工具调用本身不是「对象」，
 * 而审计页面的「对象」列要能点回那次会话。权限键与 patterns 进 `detail`。
 */
export async function 记工具拒绝(input: 工具拒绝输入): Promise<void> {
  try {
    // PG 没配 ⇒ **静默**跳过：那是「单机 / 上游形态」，没有治理审计这回事。
    // 之后的每一步都在**已配置 PG** 的前提上失败，都要留痕日志（配置齐了却记不上是真问题）。
    const env = process.env
    const 缺 = REQUIRED.filter((key) => !env[key])
    if (缺.length > 0) return

    // 身份门关着（本机 dev / 上游形态）时，「目录不在沙箱内」是常态，不刷日志；
    // 身份门开着却说不出操作人，才是真异常（锚定中间件本该把目录改写进沙箱）。
    const 锚定 = env.OPENHIVE_REQUIRE_USER_ID === "1"
    const 说 = (原因: string, 值: unknown) => {
      if (锚定) console.warn(`[openhive-audit] 工具拒绝${原因}，跳过留痕`, 值)
    }
    if (input.directory === undefined) {
      说("无实例目录", input.permission)
      return
    }
    const userId = 目录用户(input.directory)
    if (userId === undefined) {
      说("的实例目录不在沙箱内", input.directory)
      return
    }
    const pg = 客户端(env)
    const 人 = (await usersByIds(pg, [userId])).get(userId)
    if (!人) {
      // 目录在沙箱根下，但那段不是已录入的账号（本机 dev / 自定义根）——不写假操作人。
      说("的目录段不是已知账号", userId)
      return
    }
    await Audit.recordAuditEvent(pg, {
      actorId: userId,
      actorName: 人.name,
      actorPoliceNo: 人.policeNo,
      board: null,
      action: "tool.denied",
      targetType: "session",
      targetId: input.sessionID,
      result: "denied",
      detail: {
        permission: input.permission,
        patterns: [...input.patterns],
        ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
        ...(input.callID === undefined ? {} : { callID: input.callID }),
      },
    })
  } catch (error) {
    console.warn("[openhive-audit] 工具拒绝写入失败", error)
  }
}
