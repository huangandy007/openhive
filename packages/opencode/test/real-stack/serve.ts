#!/usr/bin/env bun
/**
 * 006 局部前后端联调 · **真栈的提供者侧**（`fullstack-slice-testing` 步骤 1「起真栈」）。
 *
 * 这个脚本只做一件事：把**真内核**（`Server.listen`，真 TCP socket）＋**真 PG**（PGlite 经
 * TCP 暴露）＋**真 seed**（`auth.user` 一行）以**可复现**的方式拉活，然后打印一行机器可读的
 * `READY {...}` 给编排器读端口，再挂住等 SIGTERM。
 *
 * ## 为什么是「真 socket」而不是测试里那套 `HttpRouter.toWebHandler`
 *
 * 本仓**所有** `openhive-*.test.ts` 用的都是 `toWebHandler`——它把请求喂给**进程内**的
 * handler，**根本没有网络**。这在本格不够用：本格的价值是「真前端 ↔ 真后端」，浏览器只能
 * 连一个**真在监听的地址**。`Server.listen` 就是 `bun run ./src/index.ts serve` 走的那条路
 * （`packages/opencode/src/cli/cmd/serve.ts`），本脚本与它同源。
 *
 * ## 为什么 PG 必须真起（而不是像纯会话单测那样绕开）
 *
 * 身份门开（`OPENHIVE_REQUIRE_USER_ID=1`）时，`middleware/project-location.ts` 的
 * `projectLocationLayer` 会 `if (Option.isNone(user)) return effect` ——**没有身份就直通**。
 * 也就是说：身份门一开，`/api/*` 的**每一条**出口都会走到「读 `auth.project_archive`」那句，
 * 于是 PG 成了切片路径上的硬依赖，绕不过去。
 *
 * ## 编排纪律（与 `#002-02` 配套）
 *
 * - 端口一律**传 0** 让 OS 挑（PG 的 socket server 与内核都如此）：并行用例不抢端口。
 * - 本脚本**自己不做断言**——它是「起栈」，不是「测栈」。测栈在 Playwright spec 里。
 * - 关栈：收到 SIGTERM/SIGINT 时按「内核 → PG」次序收，且**清理临时沙箱目录**。
 */

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { hashPassword } from "@opencode-ai/auth/password"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { Server } from "../../src/server/server"

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。与 `openhive-project.test.ts` 同值。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

/** 登录身份的种子（与 `openhive-project.test.ts` 的 ALICE 逐字同值——**故意不 import**：那是测试文件，不是契约）。 */
const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-real-stack-"))

const env = {
  OPENHIVE_DATA_ROOT: path.join(SANDBOX, "data"),
  OPENHIVE_WORKSPACE_ROOT: path.join(SANDBOX, "workspaces"),
  OPENHIVE_SHARED_ROOT: path.join(SANDBOX, "shared"),
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_DEFAULT_PASSWORD: DEPLOYED_DEFAULT_PASSWORD,
}

/** `OPENHIVE_*` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，不是 Effect Config）。 */
const previous = new Map<string, string | undefined>()
for (const [key, value] of Object.entries(env)) {
  previous.set(key, process.env[key])
  process.env[key] = value
}
/** `DEFAULT_PASSWORD_ENV` 走 auth 的常量（别自己写字符串）——`restorePoint` 会在退出时还原。 */
const restorePassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

const log = (line: string) => process.stdout.write(`${line}\n`)

const pg = await startProductionDb()
await migrate(pg.db)
// ⚠️ 两列都**必须显式种**，两处默认值都会把界面锁住：
//
// - `status` 必须是 **1**（启用）。这一列在 `packages/auth` 里是 `integer` 取值而非布尔：
//   `login.ts` 与 `sessionIdentity()` 两处都写着「**1 启用 / 0 停用**」，且都是 `!== 1` 就拒。
//   种 0 的后果特别隐蔽——内核那道身份门**只看凭证签名、不看账号状态**，于是 `/api/session`
//   照样 200，单单网关的 `/openhive/auth/me` 回 401（`sessionIdentity` 查库判状态），
//   前端于是正确地停在登录页：症状长得像「身份通道没接通」，其实是种子把这人标成停用了。
// - `must_change_pw` 建表默认是 **1**（`0001_init.sql`，003 的 `0003_flags_not_null.sql`
//   回填时也取 1，注释写明那是**保守侧**）。不种 0 的话，工作台之上会盖一层
//   `aria-modal` 的强制改密对话框（`data-component="change-password"`），右栏一切点击都被它
//   **截获**——Playwright 的报错是 `… intercepts pointer events`，症状长得像「按钮点不动」。
//   种子语义取「已改过密的普通用户」，那正是过完入职流程之后的生产常态。
//
// ⚠️ 还有第三列不是「有默认值」而是**必须自己给**：`password_hash`。
//   2026-10-08 之前这里种的是占位符 `'h'`，后果是**人登不进来**——`status` 种错至少还长得像
//   「身份通道没接通」，这一列种错长得像「密码输错了」：`login.ts` 的 `passwordMatches` 把
//   `Bun.password.verify` 对垃圾 hash 抛的 `UnsupportedAlgorithm` **吞成「密码不匹配」**
//   （那是 FR-005「账号不存在与密码错误提示一致」的**刻意**取舍，有注释、有理由）⇒ 这个账号
//   输任何口令都回 400「账号或密码错误」，而库里一切正常、日志里什么都没有。
//   本脚本的消费者（Playwright）**不受影响**：它走 cookie（`ai-session-real.spec.ts:83` 把内核
//   签发的 token 塞进 cookie jar），从不碰密码；所以只有「人用登录页进来」这一条路被锁住，
//   而那条路正是验收时要走的。⇒ 种**真哈希**：口令取 deployment 的默认口令
//   （`policy.ts` 的 `defaultPassword(env)`，production 里 `bootstrap.ts` / `register.ts`
//   给新账号发的是同一个值），于是「警号 ＋ 一行口令」就能从登录页进来。
const PASSWORD = DEPLOYED_DEFAULT_PASSWORD
const PASSWORD_HASH = await hashPassword(PASSWORD)
await pg.db.execute(sql`
  insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, must_change_pw, password_hash, created_at)
  values (${ALICE.id}, ${ALICE.policeNo}, ${ALICE.name}, 'x', 'x', 'x', 'x', 'x', 1, 0, ${PASSWORD_HASH}, 0)
  on conflict (id) do nothing
`)

/**
 * 端口当默认 4096（= 上游 dev 默认，也是 `entry.tsx` 的 `getCurrentUrl()` 在 DEV 的默认目标）——
 * 于是「app 零配置就能连上这台内核」，编排里不用为前端再传一次端口。要并行多套栈时用 env 覆盖。
 */
const port = Number(process.env.REAL_STACK_KERNEL_PORT ?? 4096)
const listener = await Server.listen({ hostname: "127.0.0.1", port })

/**
 * 真签发的身份令牌，**由内核侧产出**（只有这个进程能 import `@opencode-ai/auth/token`）——
 * 于是消费者侧（Playwright spec）**一行签名逻辑都没有**，它只是把这张真券塞进 cookie jar。
 * 若让 spec 自己签，就等于把 `signToken` 的形状镜像一份到测试里（`LEARNINGS #003-05`）。
 */
const token = await signToken(ALICE, SECRET)

/**
 * 这一行是给**编排器**的交接物（`stack.ts` 解析它、落进 `STACK_FILE`）。
 *
 * ⚠️ `password` 也放进来，纯粹是给**人**的：2026-10-08 起 `password_hash` 种的是真哈希，
 * 于是「警号 ＋ 口令」能从登录页进来——而「口令是多少」此前要靠读本文件才知道
 * （那次是用户直接问「登录的用户名和密码是多少？」）。它不是新秘密：这是 `test-support.ts`
 * 的 `DEPLOYED_DEFAULT_PASSWORD`，且只在本地这台栈上有效。
 */
log(
  `READY ${JSON.stringify({
    kernel: listener.port,
    sandbox: SANDBOX,
    alice: ALICE.id,
    policeNo: ALICE.policeNo,
    name: ALICE.name,
    password: PASSWORD,
    secret: SECRET,
    token,
  })}`,
)

let closing = false
async function stop(code: number) {
  if (closing) return
  closing = true
  try {
    await listener.stop()
  } catch {}
  try {
    await pg.stop()
  } catch {}
  restorePassword()
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成失败
  process.exit(code)
}

process.on("SIGTERM", () => void stop(0))
process.on("SIGINT", () => void stop(0))
