#!/usr/bin/env bun
/**
 * 006 局部前后端联调 · **真栈的提供者侧**（`fullstack-slice-testing` 步骤 1「起真栈」）。
 *
 * 这个脚本只做一件事：把**真内核**（`Server.listen`，真 TCP socket）＋**真 PG**（默认 PGlite 经
 * TCP 暴露；`REAL_STACK_DB=remote` 时改为远端 PostgreSQL）＋**真 seed**（`auth.user` 一行）以
 * **可复现**的方式拉活，然后打印一行机器可读的 `READY {...}` 给编排器读端口，再挂住等 SIGTERM。
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
 * - 关栈：收到 SIGTERM/SIGINT 时按「内核 → PG」次序收，且**清理临时沙箱目录**（设了
 *   `REAL_STACK_STATE_DIR` 的落盘态**不清理**——那是「停栈再起，数据还在」的载体，见 `SANDBOX` 注释）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
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

/**
 * 010 · **治理后台的种子管理员**（`fullstack-slice-testing` 环境编排）。
 *
 * 为什么非补不可：治理后台的入口在顶栏用户下拉里是 `adminOnly` 的那一项，而**服务端**进后台
 * 还要过两道——`is_admin = 1` 与「该板块有 read 行」（`packages/auth/src/governance.ts`
 * 的 `authorizeGovernance`：`status` / `is_admin` 都满足后，再按 `role_resource` 查板块）。
 * 只种 `auth.user` 一行会得到「有身份、进不去」的半吊子态，症状长得像「治理接口没挂」。
 *
 * 角色不另建：`0013_governance.sql` 已经种好两张模板角色与 16 行授权，本脚本只做部署侧
 * 那一步「把人挂上模板」（迁移刻意不认业务里的人，见该文件注释）。
 *
 * ALICE 一行不动：其余真栈 spec 用的就是「非管理员」这个身份（`topbar-user-menu-real.spec.ts`
 * 断言她的下拉恰三项），把她的 `is_admin` 改大等于把那些用例的判据一起改掉。
 */
const 管理员: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  policeNo: "020600",
  name: "李四",
  isAdmin: true,
}

/**
 * 手动验收 · **业务专家**（2026-10-26 用户实报：真栈里没有能过业务审核的账号）。
 *
 * 为什么不复用 ALICE 或管理员：
 * - ALICE 被 `topbar-user-menu-real.spec.ts` 钉成「下拉恰三项」的普通民警，改她的 `is_admin`
 *   等于把那条用例的判据一起改掉；
 * - 009 / 010 的两道关刻意**互不蕴含**（`review` 与 `admin` 是两行授权），管理员替业务审核
 *   会被服务端回 403。要手动走完「审核 → 发布」，必须真有一个挂了 `gov-business-expert` 的人。
 *
 * 角色模板不另建：`0013_governance.sql` 已种好 16 行授权，这里只做部署侧「把人挂上模板」。
 */
const 业务专家: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  policeNo: "020602",
  name: "王五",
  isAdmin: true,
}

/**
 * 状态目录 —— **设了 `REAL_STACK_STATE_DIR` 就落在那儿、停栈不删**；**不设 ⇒ 与 2026-10-09 之前逐字一致**
 * （`mkdtempSync` 临时目录 ＋ 停栈删掉）。
 *
 * 为什么要有这条支路：用户实报「项目管理里之前的项目和会话没了」。根因就是本脚本 `stop()` 里那句
 * `rmSync`——开发时用真栈手动验收（「退出再登录，项目 / 会话还在不在」）本就走不通，因为**一停栈就没了**。
 * 落盘之后那类验收才做得成（`Item 2` 的「成员退出再登录仍可见共享项目」也得靠它手动验收）。
 *
 * ⚠️ **落盘的不止三个根**（三根都从 `SANDBOX` 派生，所以设了它就一起落）：业务库在
 * `<状态目录>/data`（per-user SQLite）、共享事实在 `<状态目录>/pg`（PGlite 的 dataDir）。
 * 两半都要落——只落一半会出现「自己建的项目在、被加进的共享项目不在」这类半吊子态，正是要治的病。
 * PGlite 的落盘形态已当场实测（见 `startProductionDb` 调用处的注释与 `test-support.ts`）。
 */
const STATE_DIR = process.env.REAL_STACK_STATE_DIR ? path.resolve(process.env.REAL_STACK_STATE_DIR) : undefined
const SANDBOX = STATE_DIR ?? mkdtempSync(path.join(tmpdir(), "openhive-real-stack-"))
// `mkdtempSync` 自己会建目录；`path.resolve(STATE_DIR)` 不会 ⇒ 落盘态得自己建（SQLite 与 PG 都要往底下写）。
if (STATE_DIR) mkdirSync(SANDBOX, { recursive: true })

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

/**
 * 数据库模式：默认 `pglite`（E2E / 隔离验收，与今天逐字一致）；
 * 显式 `REAL_STACK_DB=remote` 才连**远端 PostgreSQL**（手动验收用）。
 *
 * 为什么必须是显式开关、不能靠「检测到 PG_* 就切」：本脚本由 `stack.ts` 以
 * `cwd=packages/opencode` spawn，bun 会自动加载该目录的 `.env` / `.env.local`——
 * 于是 `.env.local` 里的 `PG_*` **在两种模式下都在** process.env 里。若按「有 PG_* 就用远端」，
 * Playwright 的 real-stack 用例会整批打到远端库上（写入、改名、发布资产都不再隔离）。
 */
const DB_MODE = process.env.REAL_STACK_DB === "remote" ? "remote" : "pglite"

/**
 * 远端模式的安全护栏：**只允许 `_dev` / `_test` 结尾的库名**。
 *
 * 本脚本会跑迁移（向上）并种账号，都是写操作。`.env.local` 与生产 `.env` 共用同一套
 * `PG_*` 变量名，一个手滑就会把真栈指到生产库上。真要连别的库，显式设
 * `REAL_STACK_ALLOW_ANY_DB=1`——让「越过护栏」成为一个看得见的动作。
 */
function remoteTargetOf(env: Record<string, string | undefined>): string {
  const missing = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"].filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(
      `REAL_STACK_DB=remote 需要 ${missing.join(", ")}；请在内核 cwd（packages/opencode）的 .env / .env.local 里配好`,
    )
  }
  const database = env.PG_DATABASE!
  if (!/_dev$|_test$/.test(database) && env.REAL_STACK_ALLOW_ANY_DB !== "1") {
    throw new Error(`拒绝把真栈指向库 "${database}"：库名必须以 _dev 或 _test 结尾（或显式设 REAL_STACK_ALLOW_ANY_DB=1）`)
  }
  return `${env.PG_HOST}:${env.PG_PORT}/${database}`
}

// 护栏在任何副作用（迁移 / 种子 / 起监听）之前就判，别等库都写了才报。
const REMOTE_TARGET = DB_MODE === "remote" ? remoteTargetOf(process.env) : undefined

// 落盘态把 PGlite 的 dataDir 指到 `<状态目录>/pg`（实测过会真落盘，见 `test-support.ts` 的 JSDoc）；
// 临时态不传 ⇒ 内存实例，与今天逐字一致。远端模式不起 PGlite，也不覆盖 process.env 里的 PG_*。
const pglite = DB_MODE === "pglite" ? await startProductionDb({ dataDir: STATE_DIR ? path.join(SANDBOX, "pg") : undefined }) : undefined
const db = pglite?.db ?? connect(process.env)
await migrate(db)
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
await db.execute(sql`
  insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, must_change_pw, password_hash, created_at)
  values (${ALICE.id}, ${ALICE.policeNo}, ${ALICE.name}, 'x', 'x', 'x', 'x', 'x', 1, 0, ${PASSWORD_HASH}, 0)
  on conflict (id) do nothing
`)

// 管理员：`is_admin = 1` ＋ `status = 1` ＋ `must_change_pw = 0`（三列都会把后台锁住，理由同 ALICE），
// 再把人挂上已种好的 `gov-system-admin` 模板（16 行授权由 `0013_governance.sql` 提供）。
// `on conflict do nothing` 让**落盘态重起**时不重复挂角色（PK 是 `(user_id, role_id)`）。
await db.execute(sql`
  insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, must_change_pw, password_hash, created_at)
  values (${管理员.id}, ${管理员.policeNo}, ${管理员.name}, 'x', 'x', 'x', 'x', 'x', 1, 1, 0, ${PASSWORD_HASH}, 0)
  on conflict (id) do nothing
`)
await db.execute(sql`
  insert into auth.user_role (user_id, role_id) values (${管理员.id}, 'gov-system-admin')
  on conflict do nothing
`)

// 业务专家：同样是 `is_admin = 1` ＋ `status = 1` ＋ `must_change_pw = 0`，再挂
// `gov-business-expert`（`asset-governance` 的 `read` ＋ `review`）。两道关因此各有人：
// 李四只能发布，王五只能审核——与 010 的分权矩阵逐字一致。
await db.execute(sql`
  insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, must_change_pw, password_hash, created_at)
  values (${业务专家.id}, ${业务专家.policeNo}, ${业务专家.name}, 'x', 'x', 'x', 'x', 'x', 1, 1, 0, ${PASSWORD_HASH}, 0)
  on conflict (id) do nothing
`)
await db.execute(sql`
  insert into auth.user_role (user_id, role_id) values (${业务专家.id}, 'gov-business-expert')
  on conflict do nothing
`)

// ⚠️ 种子是**直接种 SQL**（不走 `register.ts` → `createWorkspace`），所以 `workspaces/<userId>`
// 这个目录**没人建**。但内核 `FileSystem` 层在 `Server.listen` 构造期就要
// `fs.realPath(location.directory).pipe(Effect.orDie)`（`core/filesystem.ts:65`）——目录不存在
// ⇒ 那一层**当场死掉**，之后一切经 `FileSystem` 的出口（`GET /api/command` 就是一条：命令清单的
// skill 枚举要借 `FileSystem` 层）都 500（`PlatformError: NotFound: FileSystem.realPath …`）。
// 生产里这个目录由 `register` 的 `createWorkspace` 建（`auth/workspace.ts:79`，同款
// `recursive` ＋ `mode: 0o700`）；这里照它补上，与生产同形。不建的话右栏 `/` 面板与模型选择的
// 真栈验收（`right-pane-slash-and-model-real.spec.ts`）第一步就 500。
mkdirSync(path.join(env.OPENHIVE_WORKSPACE_ROOT, ALICE.id), { recursive: true, mode: 0o700 })
mkdirSync(path.join(env.OPENHIVE_WORKSPACE_ROOT, 管理员.id), { recursive: true, mode: 0o700 })
mkdirSync(path.join(env.OPENHIVE_WORKSPACE_ROOT, 业务专家.id), { recursive: true, mode: 0o700 })

/**
 * 待审资产种子（2026-10-26 手动验收「AI 资产管理」用）。
 *
 * 作者侧本应走 `create_skill_draft` → `submit_skill_for_review`，但治理 MCP server 的
 * `opencode.json` 写入器还没落（009 `state.md` 的阻塞项）⇒ 真栈里那条链路走不通。
 * 这里按真栈种子的既有做法直接种，但**文件与元数据必须一起补**：只种 SQL 表的话，发布时
 * `pending` 目录不存在，症状会长得像「发布接口坏了」（`#006-28` 的同一类）。
 */
const 待审资产 = "asset_demo_review"
const 资产根 = process.env.OPENHIVE_ASSETS_ROOT ?? "/assets"
const 待审目录 = path.join(资产根, "pending", 待审资产)
mkdirSync(待审目录, { recursive: true })
writeFileSync(
  path.join(待审目录, "SKILL.md"),
  `---\nname: fund-flow-summary\ndescription: 演示用：按账户汇总资金流水并列出可疑账户\n---\n\n# 资金流水快速汇总\n\n真栈手动验收用的演示 skill，可以安全删除。\n`,
)
const 资产时间 = Math.floor(Date.now() / 1000)
await db.execute(sql`
  insert into auth.asset (id, name, type, description, icon, category, tags, owner_id, owner_name, department, visibility, version, status, created_at, updated_at)
  values (${待审资产}, '资金流水快速汇总（演示）', 'skill', '真栈演示资产：按账户维度汇总资金流水，输出可疑账户线索', '🧩', 'intelligence', array['资金', '演示']::text[], ${管理员.id}, ${管理员.name}, 'x', 'global', 1, 'in_review', ${资产时间}, ${资产时间})
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
/** 010 · 管理员的真令牌，同样由内核侧签发（spec 一行签名逻辑都没有）。 */
const adminToken = await signToken(管理员, SECRET)

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
    // 让消费者一眼看出这次连的是哪个库；远端目标只写 host/port/db，**不含口令**。
    db: REMOTE_TARGET ?? "pglite",
    alice: ALICE.id,
    policeNo: ALICE.policeNo,
    name: ALICE.name,
    password: PASSWORD,
    secret: SECRET,
    token,
    admin: 管理员.id,
    adminPoliceNo: 管理员.policeNo,
    adminName: 管理员.name,
    adminToken,
  })}`,
)

let closing = false
async function stop(code: number) {
  if (closing) return
  closing = true
  try {
    await listener.stop()
  } catch {}
  // 远端模式没有 PGlite 句柄；连接池随 `process.exit` 一起结束。
  try {
    await pglite?.stop()
  } catch {}
  restorePassword()
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  // 落盘态（`REAL_STACK_STATE_DIR` 设了）**不删**——那正是「停栈再起，数据还在」的载体。
  if (!STATE_DIR) {
    try {
      rmSync(SANDBOX, { recursive: true, force: true })
    } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成失败
  }
  process.exit(code)
}

process.on("SIGTERM", () => void stop(0))
process.on("SIGINT", () => void stop(0))
