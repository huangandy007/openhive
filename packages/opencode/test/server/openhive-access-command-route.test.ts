import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect } from "../lib/effect"

/**
 * 004 收尾补测（`backend-testing` · 越权 BOLA/BFLA）——**在 HTTP 路由接缝上**。
 *
 * ## 这条补的是哪个洞
 *
 * R1 的门（`src/session/prompt.ts` 的 `SessionPrompt.command`，skill 命令出口）已有两条见证，
 * 但它们在 **Effect 层**（`test/session/prompt.test.ts`），且**自己把规则集塞进
 * `sessions.create({ permission })`**——整条
 * 「HTTP 身份头 → 用户 → 每用户库 → 会话行 → 规则集 → 判决」的搬运**一步都没走**。
 * 于是这一层可以整段坏掉而两条 Effect 见证照样全绿：`capabilityFor` 没算、会话没落库、
 * 请求 fiber 上认错了会话……任何一处断，`POST /session/:id/command` 都会变成对外可达的越权出口，
 * 而**不会有任何测试变红**（`LEARNINGS #002-02`：没真正执行被测路径的测试不是测试）。
 *
 * ## 判据刻意绕开被测接口
 *
 * 「skill 正文有没有进模型」不看 HTTP 响应体的形状，看**模型端收到了什么**——
 * 一个**记录请求体的假模型**（本文件 `beforeAll` 起在 `127.0.0.1:0`）。R1 在 Effect 层
 * 用的是 `llm.calls`/`llm.inputs`，这里用同一思路（`#003-05`：镜像要对着被调方的形状写）。
 *
 * ## 第二条判据：门的**顺序**（不是「有没有门」）
 *
 * 同一个请求还钉第二件事——门必须在**读 `cmd.template` 之前**（那时正文里的 ```!``` 块
 * 还没被执行）。这条只有「门之前就有观测面」才测得出来：文件系统副作用（见 `writeSandbox`）。
 * 两者必须都在：只钉「有没有门」的话，门挪到读模板之后**照样全绿**，
 * 而未授权身份会**先挨一发 shell 副作用再被拒**（`LEARNINGS #004-01`）。
 *
 * ## 为什么两条用例是同一条请求
 *
 * 两条只差**身份**，请求体逐字相同（同一个 skill 名、同一个 agent 路径、同一个模型）。
 * 少了 ALICE 那条，BOB 那条在「skill 根本没被发现 ⇒ `Command not found`」时**也会绿**——
 * 测的就不是权限了（R1 注释里同一条理由）。**每一条判据都配着它的对照**：
 * 泄漏 ↔ ALICE 的正文真进了模型；文件系统副作用 ↔ ALICE 的 ```!``` 块真执行了。
 *
 * ## 与 `openhive-access-wiring.test.ts` 的分工
 *
 * 那个文件钉「capability 有没有**落到会话行里**」（读库文件 + 真判决器）；本文件钉
 * 「**对外那条 HTTP 出口**照不照这份 capability 执行」。两者都是 I1/I11 那一族
 * 「同一件事有第二个出口」的守门人（`LEARNINGS #004-01`）。
 *
 * ## 变异验证（两条，记录在 004 `state.md`）
 *
 * 补测写出来**一次就绿**（行为本就正确，属覆盖缺口）⇒ 必须证明它抓得住东西：
 * ① 去掉 R1 的门 ⇒ 红在「正文泄漏」；② 把门**挪到读模板之后** ⇒ **恰红一条**
 * （未授权那条的文件系统副作用），另两条断言照样绿——② 正是本文件存在的理由。
 *
 * ⚠️ 夹具文件级、只建一次（理由与 `openhive-access-wiring.test.ts` / `tenant-db-isolation.test.ts`
 * 同：应用层模块级构建，同目录实例在进程内是缓存的）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "770e8400-e29b-41d4-a716-446655440000",
  policeNo: "020603",
  name: "王五",
  isAdmin: false,
}
const BOB: TokenSubject = {
  id: "880e8400-e29b-41d4-a716-446655440001",
  policeNo: "020604",
  name: "赵六",
  isAdmin: false,
}

/** 探针 skill 的命令名 = skill 名（`Command.init` 就是这么注册的）。 */
const SKILL = "openhive-route-probe"

/**
 * 只出现在这个 skill 正文里。判据是「**模型端的请求体里有没有这串**」——
 * 不是「HTTP 响应里有没有」（响应里本来就不该有正文，两边都是）。
 */
const MARKER = "openhive-route-seam-body-marker-7c2e"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-command-route-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`：`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，**不是** Effect 的 `Config` 服务——塞进 `ConfigProvider` 会被无声忽略。
 * 与 `openhive-access-wiring.test.ts` 同因同注。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 网关开着时 `routes` 的层构造期要解析它，缺失即抛（T020 的裁定）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

/* ------------------------------------------------------------------ 假模型 */

const llmBodies: string[] = []
let llmServer: ReturnType<typeof Bun.serve> | undefined
let llmUrl = ""

const line = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: Record<string, unknown>, finish?: string) => ({
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
})
/** 最小可用的 OpenAI 兼容流（照 `test/lib/llm-server.ts` 的 chunk 形状写）。 */
const sse = [line(chunk({ role: "assistant" })), line(chunk({ content: "done" })), line(chunk({}, "stop")), "data: [DONE]\n\n"].join("")

/**
 * 假模型：**只做两件事**——把请求体原样记下来、回一个能收尾的流。
 *
 * 「正文有没有进模型」的判据是 `llmBodies` 里有没有 `MARKER`，与响应无关；
 * 响应只是让「已授权」那条能走到收尾（否则它也会以 500 结束，两条用例的响应就没法区分了）。
 */
beforeAll(() => {
  llmServer = Bun.serve({
    port: 0,
    fetch: async (request) => {
      llmBodies.push(await request.text())
      return new Response(sse, { headers: { "content-type": "text/event-stream" } })
    },
  })
  llmUrl = `http://127.0.0.1:${llmServer.port}`
})

afterAll(async () => {
  await llmServer?.stop(true)
})

/* ------------------------------------------------------------------ 用户环境 */

/**
 * 沙箱 = `{OPENHIVE_WORKSPACE_ROOT}/{userId}`（`middleware/anchor-workspace.ts` 的锚定结果），
 * 所以 skill 与配置都写在这里——客户端报什么目录都无效。
 *
 * ## 正文里那个 ```!``` 块是**第二条判据**（门的**顺序**）
 *
 * R1 的门有个更硬的附带要求：必须在**读 `cmd.template` 之前**。模板读出来之后，
 * `command()` 会用 `ConfigMarkdown.shell` + `Process.text` **真的执行**正文里的 ```!``` 块
 * （命令就是 skill 正文自带的、执行者自己的用户跑什么它就跑什么）。
 * 门若挪到读之后 ⇒ 未授权身份**先挨一发 shell 副作用、再被拒**：
 * 拒是拒了，`bodiesWithMarker` 之类**门之后的**观测面全都看不出来（`LEARNINGS #004-01`：
 * 判据要锚在「做那件事的那一行」）。
 *
 * 这条只有「**门之前**就有观测面」才测得出来，所以副作用落在**文件系统**上，每个身份一个
 * 独立标记文件（跨用例不共享状态，单跑任一条都成立）。
 *
 * ⚠️ shell 必须显式配：win32 上 `Shell.preferred()` 默认选到 powershell，而
 * `Process.text([cmd], { shell })` 走 node 的 `spawn`——win32 下**一律**按
 * `['/d','/s','/c','"cmd"']` 拼参（对着 shell 是不是 bash 都一样），于是默认那条在 Windows 上
 * **根本执行不了**（这正是上游的 shell 用例全部 `unix` 门控的原因）。
 * 显式指到 `cmd.exe` / `/bin/sh` 后，两种平台上那条拼参都收得住，用例两边都能跑。
 */
function markerPath(user: TokenSubject) {
  return path.join(SANDBOX, `shell-probe-${user.id}.txt`)
}

/** win32 取 `ComSpec`（系统自己给的 cmd.exe 全路径），其余平台取 POSIX sh。 */
const SHELL = process.platform === "win32" ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe") : "/bin/sh"

/** 拼一行 ```!`cmd` ```（反引号得拼出来——散文里写不了裸的）。 */
const shellLine = (marker: string) => ["!", "`", `echo probed> "${marker}"`, "`"].join("")

function writeSandbox(user: TokenSubject) {
  const root = path.join(WORKSPACE_ROOT, user.id)
  const skillDir = path.join(root, ".opencode", "skill", SKILL)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${SKILL}`,
      "description: 004 收尾补测的探针 skill（命令出口的路由接缝）。",
      "---",
      "",
      "# Probe",
      "",
      MARKER,
      "",
      shellLine(markerPath(user)),
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", shell: SHELL, ...testProviderConfig(llmUrl) }),
  )
}

/* ------------------------------------------------------------------ 应用 */

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* Effect.promise(() => signToken(subject, SECRET)))))
      headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 过一遍 `Schema` 而不是 `as`（`as` 会被 lint 门命中，且断言掉的形状是**假绿的来源**）。 */
const SessionInfo = Schema.Struct({ id: Schema.String })

const sessionId = (response: Response) =>
  Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(SessionInfo)))

/** 建会话（客户端不自填 `permission`——那份 capability 由服务端算）。 */
const createSessionAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session", { method: "POST" })
    expect(response.status).toBe(200)
    return (yield* sessionId(response)).id
  })

/**
 * **两条用例唯一的差别就是谁在跑**：同一个 body（同 skill、同模型），换一个身份。
 *
 * `model` 显式给 `test/test-model`：不依赖沙箱配置里的默认模型，免得「授权那条失败」
 * 被误读成权限问题。
 */
const runProbeCommand = (subject: TokenSubject, id: string) =>
  as(subject, `/session/${id}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: SKILL, arguments: "", model: "test/test-model" }),
  })

/** 假模型收到过的、含探针正文的请求体。 */
const bodiesWithMarker = () => llmBodies.filter((body) => body.includes(MARKER))

/* ------------------------------------------------------------------ 真库 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // ALICE：用户行 + 角色 + **一条探针 skill 的读授权**。BOB **故意什么都不给**——
  // 零授权 ⇒ `sessionRuleset` ① 那条整体 deny（`openhive-access-wiring.test.ts` 已从库里验过）。
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${ALICE.id}, '020603', '王五', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('r_route_probe', '接缝探针')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ALICE.id}, 'r_route_probe')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('r_route_probe', 'skill', ${SKILL}, 'read')
  `)

  writeSandbox(ALICE)
  writeSandbox(BOB)
})

afterAll(async () => {
  await pg?.stop()
})

/* ------------------------------------------------------------------ 用例 */

describe("T-RS · 路由接缝：命令出口有没有按身份执行权限（真应用 + 真库 + 假模型）", () => {
  /**
   * 🔴 **零授权的身份，走 HTTP 打同一个 skill 命令 —— 拒，且正文一个字节都没到模型。**
   *
   * 响应形状**刻意不断言**（只断言"被拒"）：R1 拒时是 `orDie` ⇒ 500，而「500 而非可读文案」
   * 是已登记挂账（004 `state.md`）；将来改成 403，这条**不该**变红。
   * 断言的落点是安全属性本身：**被拒 + 正文没进模型**。
   */
  it.live(
    "零授权身份 ⇒ 命令被拒，且 skill 正文没进模型",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(BOB)
        const response = yield* runProbeCommand(BOB, id)

        // 先钉**泄漏**（这条要红的安全属性），再钉"被拒"（伴随信号）——
        // 顺序反过来时，变异验证只会红在状态码上，看不出正文到底漏没漏。
        expect(bodiesWithMarker().length).toBe(0)
        expect(response.ok).toBe(false)
        // ② 门的**顺序**：正文的 ```!``` 块**一次都没被执行**（门在读模板之前）。
        expect(existsSync(markerPath(BOB))).toBe(false)
      }),
    30_000,
  )

  /**
   * **对照：同一个请求、授过权的身份 —— 放行，正文进模型。**
   *
   * 这条同时证明「这个 skill 真的被发现了」（否则上一条在 `Command not found` 时也会绿）。
   */
  it.live(
    "已授权身份 ⇒ 同一条命令放行，skill 正文进模型",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)
        const response = yield* runProbeCommand(ALICE, id)

        expect(response.status).toBe(200)
        expect(bodiesWithMarker().length).toBeGreaterThan(0)
        // ② 的**对照**：机制本身是活的——放行时那个 ```!``` 块**确实会执行**。
        // 少了这条，上面那句 `existsSync(...) === false` 在「shell 压根没跑起来」时也会绿
        // （`LEARNINGS #002-02`：没真正执行被测路径的断言不是断言）。
        expect(existsSync(markerPath(ALICE))).toBe(true)
      }),
    30_000,
  )
})
