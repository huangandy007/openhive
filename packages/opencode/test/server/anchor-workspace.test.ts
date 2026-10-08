import { afterAll, describe, expect } from "bun:test"
import { join, resolve, sep } from "path"
import { realpathSync } from "fs"
import { tmpdir } from "os"
import { ConfigProvider, Context, Effect, Equal, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { User } from "@opencode-ai/core/user"
import { AnchorWorkspace } from "../../src/server/routes/instance/httpapi/middleware/anchor-workspace"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

/**
 * ⚠️ **T020 遗留的修补（2026-10-02，质量门禁期间发现）**：同 `multi-tenant-routing.test.ts` 与
 * `tenant-db-isolation.test.ts` 上那几条注释——T020 把 `defaultPassword(process.env)` 放进了网关的
 * 层构造期且选定「缺失即抛」，于是**任何建真应用（`HttpApiApp.routes`）的测试，都必须像一次真部署
 * 那样把口令配上**。本文件下面那个 `realApp` 正是这种测试。
 *
 * ⚠️ **本条是 T023 那笔修补漏掉的**：T023 的收尾 grep 用的判据是「谁引用了 `OPENHIVE_REQUIRE_USER_ID`」，
 * 而真正的前提是「**谁在建真应用**」——判据选错，于是漏了两处（本文件 + `user-identity.test.ts`）。
 * 又一次 `LEARNINGS #002-06`：改完一处要 grep 的是「**谁按那个前提在做同一件事**」，不是「谁提到了同一个名字」。
 *
 * 为什么走 `process.env` 而不是下面 `ConfigProvider.layer`：网关读的是 `process.env`，
 * 塞进 `ConfigProvider` 会被**无声忽略**（同另几处的注释）。
 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

/** 两个不同用户——「拿不到同一个 Location.Ref」那条判据要的就是两个人。 */
const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}
const BOB: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  policeNo: "020602",
  name: "李四",
  isAdmin: false,
}

/**
 * 沙箱根。**不用默认的 `/workspaces`**：测试绝不碰真实路径，且根可注入才断言得了
 * 「落在配置的那个根下面」，而不是「碰巧不等于伪造值」这种谁都能过的弱断言。
 *
 * ⚠️ 末段（`openhive-anchor-workspace`）**本文件不创建**，而本机 `TMP` 是 **8.3 短名**
 * （`ADMINI~1` 那一层）⇒ 锚定那一侧会把它归一成长名（`openhive-project-directory.test.ts`
 * 同款）。故这里**只把存在的父目录归一化**、末段原样接回去：断言钉的是**归属**，不是拼法。
 */
const ROOT = join(realpathSync.native(tmpdir()), "openhive-anchor-workspace")

/**
 * 断言落进某人的沙箱。**不写成 `toBe(join(ROOT, id))` 的字面比对**：
 * 契约是「锚到配置的根 + 该用户」，中间经 `InstanceStore.load` 解析，
 * 大小写与分隔符的归一化不是本 task 要钉的东西。钉的是**归属**。
 */
function expectSandbox(directory: string, subject: TokenSubject) {
  const got = normalize(directory)
  const root = normalize(ROOT)

  expect(got).not.toBe(normalize(FORGED))
  expect(got === root || got.startsWith(`${root}/`)).toBe(true)
  expect(got.endsWith(`/${subject.id}`)).toBe(true)
}

/** 归一化成分隔符与大小写无关的形式——断言不该因 Windows 的 `\` / 盘符大小写假红。 */
const normalize = (value: string) => value.replaceAll(sep, "/").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

/** 客户端谎报的目录：一个绝不可能是沙箱根的绝对路径。 */
const FORGED = resolve(tmpdir(), "evil-outside-sandbox")

/**
 * 用真实签发器造令牌——**不手搓 JWT**，免得测试自己写错格式还自以为对。
 * （`signToken` 是 002 的产物，`user-identity.test.ts` 也这么取。）
 */
const token = (subject: TokenSubject = ALICE) => Effect.promise(() => signToken(subject, SECRET))

/**
 * **真应用**（`HttpApiApp.routes`）+ 指定环境变量，走与生产同一套装法。
 * 锚定是全局中间件，只有接进真实 `createRoutes` 才测得到「装法对不对」——
 * 搭个最小路由自己套中间件那种测法，漏装也照样绿。
 */
function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (path: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(path, "http://localhost"), init), HttpApiApp.context)),
    )
}

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: ROOT,
}

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/**
 * 从请求里读回「当前实例目录」的唯一途径：`handlers/instance.ts` 的 `getPath`
 * 返回 `InstanceState.context.directory`。而它正是 `WorkspaceRouteContext.directory`
 * 经 `instanceContextLayer` → `InstanceStore.load` 下来的——客户端那个 `directory` 的**真正落点**。
 */
const INSTANCE_PATH = "/path"

/** 读 JSON 体，同 `httpapi-mcp.test.ts` 的 `json<A>`——仓库里既有的写法，不另立一种。 */
const json = <A>(response: Response): Effect.Effect<A> => Effect.promise<A>(() => response.json())

/** 门开着的那个 app 只搭一次：搭一次要建整棵路由树，逐请求重搭是白烧时间。 */
const openApp = realApp(OPEN)

function readDirectory(subject: TokenSubject, forged: string, workspace?: string) {
  return Effect.gen(function* () {
    const extra = workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""
    const response = yield* openApp(`${INSTANCE_PATH}?directory=${encodeURIComponent(forged)}${extra}`, {
      headers: cookie(yield* token(subject)),
    })
    expect(response.status).toBe(200)
    return yield* json<{ directory: string }>(response)
  })
}

describe("工作目录锚定（T006）", () => {
  // 出参：伪造 directory 被忽略，落沙箱根。
  it.live("客户端伪造的 directory 被忽略，落自己的沙箱", () =>
    Effect.gen(function* () {
      const body = yield* readDirectory(ALICE, FORGED)

      expectSandbox(body.directory, ALICE)
    }),
  )

  // T004 移交的书面验收项，判据原话：「两个用户拿不到同一个 Location.Ref」。
  // 不拿「目录字符串不相等」充数——**构造生产代码构造的那个 Ref**
  // （`handlers/file.ts` / `handlers/pty.ts` 都是 `Location.Ref.make({ directory: AbsolutePath.make(dir) })`），
  // 再用 Effect 的**结构相等**比对。LayerMap 的键正是这个 Ref，用的正是这套相等。
  it.live("两个用户拿不到同一个 Location.Ref（各自锚定到自己的沙箱）", () =>
    Effect.gen(function* () {
      const alice = yield* readDirectory(ALICE, FORGED)
      const bob = yield* readDirectory(BOB, FORGED)
      const refOf = (directory: string) => Location.Ref.make({ directory: AbsolutePath.make(directory) })

      expect(Equal.equals(refOf(alice.directory), refOf(bob.directory))).toBe(false)
      // 「不相等」本身不够——两个都错得不一样的 Ref 也不相等。各自还得钉回自己的沙箱。
      expectSandbox(alice.directory, ALICE)
      expectSandbox(bob.directory, BOB)
    }),
  )

  // 「一人一工作区」＝库路径不带 workspace 维度那个隐含假设的**被验**版本。
  it.live("同一用户拿不到第二个工作区：换着花样传 directory，仍只有一个锚点", () =>
    Effect.gen(function* () {
      const first = yield* readDirectory(ALICE, FORGED)
      const second = yield* readDirectory(ALICE, resolve(tmpdir(), "somewhere-else"))
      const third = yield* readDirectory(ALICE, ROOT)

      expect(normalize(second.directory)).toBe(normalize(first.directory))
      expect(normalize(third.directory)).toBe(normalize(first.directory))
      expectSandbox(first.directory, ALICE)
    }),
  )

  /**
   * ⚠️ 守的是 `anchor()` 里那行**承重的删除**：`url.searchParams.delete("workspace")`。
   *
   * 不删会怎样：`?workspace=` 选中的工作区，其 `target.directory` 会**完全绕过**
   * `defaultDirectory`（`planRequest` 用的是工作区自己的目录），上面三处改写等于白改。
   *
   * **变异敏感、且红得确定**：去掉那行 `delete` 本测试必红——客户端传的 `wrk_...` 是
   * **合法形状**（`WorkspaceID` 只要求以 `wrk` 开头），于是走到 `resolveWorkspace`、
   * 查不到 ⇒ `RequestPlan.MissingWorkspace` ⇒ **500**，而这里要的是 200 + 落自己的沙箱。
   * （已实测变异验证，记录见 `state.md` 的 T006 段。）
   *
   * 为什么值得单独一条：删 `?workspace=` 当初**超出字面出参**，是靠自己判断加的；
   * 而「全仓没有客户端发它」这个论据**会随时间失效**（哪天有人加了就悄悄破了）——
   * 论据会过期，测试不会。
   */
  it.live("客户端传 ?workspace= 指别人的工作区：参数被剥掉，仍落自己的沙箱", () =>
    Effect.gen(function* () {
      const body = yield* readDirectory(ALICE, FORGED, "wrk_someone_elses")

      expectSandbox(body.directory, ALICE)
    }),
  )
})

/**
 * **请求体这条缝**（2026-10-02，代码审查 R-01 补）。
 *
 * T006 当初把锚定的入参清点成三个：`?directory=`、`location[directory]`、`x-opencode-directory`
 * ——三个**全在 URL 或头上**。而 v2 的 `POST /api/session`（`v2.session.create`）把会话落点放在
 * **请求体** `payload.location.directory` 里（`packages/protocol/src/groups/session.ts` 的
 * `HttpApiEndpoint.post("session.create", "/api/session", …)`），handler 直接读
 * `ctx.payload.location`（`packages/server/src/handlers/session.ts` 的 `session.create`）。
 *
 * `anchor()` 只 `request.modify({ url, headers })`，**正文一字不碰** ⇒ 客户端在体里报的目录
 * 原样落进会话行，锚定等于白做。这个端点确实挂在生产路由树上
 * （`server.ts` 的 `serverRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))`，
 * 而 `Api` 由 `makeDefaultApi` → `.add(makeSessionGroup(...))` 组成），所以这是**可达**的。
 *
 * 为什么单独一组、不并进上面那些：上面三条钉的是「URL 与头被改写」，本组钉的是
 * 「**正文也被改写**」。当初的错在于把「入参」清点成"URL 与头"就收工了。
 */
describe("锚定：请求体里的 location（R-01）", () => {
  /** 建会话：照 SDK v2 `session.create` 的形状，落点放在**请求体**里。 */
  const createSession = (subject: TokenSubject, directory: string) =>
    Effect.gen(function* () {
      const response = yield* openApp("/api/session", {
        method: "POST",
        headers: { ...cookie(yield* token(subject)), "Content-Type": "application/json" },
        body: JSON.stringify({ location: { directory } }),
      })
      return response
    })

  it.live("客户端在请求体里伪造 location.directory：忽略它，仍落自己的沙箱", () =>
    Effect.gen(function* () {
      const response = yield* createSession(ALICE, FORGED)
      expect(response.status).toBe(200)

      const body = yield* json<{ data: { location: { directory: string } } }>(response)
      expectSandbox(body.data.location.directory, ALICE)
    }),
  )

  /**
   * handler 在**没**拿到 location 时兜底成 `AbsolutePath.make(process.cwd())`
   * （`packages/server/src/handlers/session.ts` 的 `session.create`）——那个 cwd 是**内核进程的**，
   * 不是该用户的沙箱。所以「省略 location」和「伪造 location」是同一个洞的两种填法：
   * 前者连伪造都不用，直接落进程 cwd。这条钉的就是它。
   */
  it.live("请求体里干脆不带 location：也不落进程 cwd，落自己的沙箱", () =>
    Effect.gen(function* () {
      const response = yield* openApp("/api/session", {
        method: "POST",
        headers: { ...cookie(yield* token(ALICE)), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = yield* json<{ data: { location: { directory: string } } }>(response)
      expectSandbox(body.data.location.directory, ALICE)
    }),
  )

  /**
   * ⚠️ **不带 `Content-Type` 的请求，下游照样当 JSON 解。**
   *
   * 修复复查（2026-10-02）抓到：当初那道守卫写的是
   * `(headers["content-type"] ?? "").includes("application/json")`，
   * 而下游 `HttpApiBuilder` 的判据是 `getRequestContentType`：
   * **没有头（或空串）就当 `application/json`**，有头才 `toLowerCase().trim()`
   * 再在 `;` 处切出媒体类型。两条判据不一致 ⇒ 客户端**只要不发 `Content-Type`**，
   * 体改写就被跳过，而下游照样按 JSON 解 —— R-01 那个洞原样复现，只是换了个入口。
   */
  it.live("不带 Content-Type：下游当 JSON 解，锚定也必须当 JSON 改", () =>
    Effect.gen(function* () {
      const response = yield* openApp("/api/session", {
        method: "POST",
        headers: cookie(yield* token(ALICE)),
        body: JSON.stringify({ location: { directory: FORGED } }),
      })
      expect(response.status).toBe(200)

      const body = yield* json<{ data: { location: { directory: string } } }>(response)
      expectSandbox(body.data.location.directory, ALICE)
    }),
  )

  // 同一个判据的另一半：有头时下游会 `toLowerCase().trim()` 再切 `;`，
  // 所以 `APPLICATION/JSON; charset=utf-8` 对下游就是 `application/json`。
  it.live("Content-Type 大写 + 带参数：下游认它，锚定也必须认", () =>
    Effect.gen(function* () {
      const response = yield* openApp("/api/session", {
        method: "POST",
        headers: { ...cookie(yield* token(ALICE)), "Content-Type": "APPLICATION/JSON; charset=utf-8" },
        body: JSON.stringify({ location: { directory: FORGED } }),
      })
      expect(response.status).toBe(200)

      const body = yield* json<{ data: { location: { directory: string } } }>(response)
      expectSandbox(body.data.location.directory, ALICE)
    }),
  )

  /**
   * ⚠️ **「是哪个端点」必须看路由匹配结果，不是请求 URL 原文。**
   *
   * `needsLocation`（判断要不要替客户端补一个 location）当初比的是
   * `new URL(request.url).pathname === "/api/session"`。而路由匹配器
   * （`find-my-way-ts`，默认 `ignoreTrailingSlash` / `ignoreDuplicateSlashes` / `caseSensitive: false`）
   * 把这些写法**全都**归到同一个端点：`/api/session/`、`/api//session`、`/API/SESSION`、`/api/%73ession`。
   * 于是「带尾斜杠」这一个字符就够让补 location 的那一半失效——体里没有 `location` 时，
   * handler 兜底成 `AbsolutePath.make(process.cwd())`，落到**内核进程的**目录。
   *
   * 修法不去镜像那套归一化（`LEARNINGS #002-01`：镜像就是下一个漂移点），
   * 而是直接读路由匹配结果 `HttpRouter.RouteContext`——它给的是**路由表里的规范形状**，
   * 匹配器怎么归一化，它就长什么样，两件事天然一致。
   */
  it.live("路径的等价写法（尾斜杠 / 重复斜杠）：一样认出是建会话端点", () =>
    Effect.gen(function* () {
      for (const path of ["/api/session/", "/api//session"]) {
        const response = yield* openApp(path, {
          method: "POST",
          headers: { ...cookie(yield* token(ALICE)), "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        expect({ path, status: response.status }).toEqual({ path, status: 200 })

        const body = yield* json<{ data: { location: { directory: string } } }>(response)
        expectSandbox(body.data.location.directory, ALICE)
      }
    }),
  )

  // 两个用户各带各的伪造值 ⇒ 各自落各自的沙箱，谁也不越界。
  it.live("两个用户各自伪造请求体目录：各自落自己的沙箱", () =>
    Effect.gen(function* () {
      const alice = yield* createSession(ALICE, FORGED)
      const bob = yield* createSession(BOB, resolve(tmpdir(), "evil-outside-sandbox-bob"))

      const aliceBody = yield* json<{ data: { location: { directory: string } } }>(alice)
      const bobBody = yield* json<{ data: { location: { directory: string } } }>(bob)

      expectSandbox(aliceBody.data.location.directory, ALICE)
      expectSandbox(bobBody.data.location.directory, BOB)
    }),
  )
})

/**
 * **user id 是拼进路径的**（2026-10-02 代码审查 R-05）。
 *
 * 锚定那行是 `join(config.root, user.value.id)`——`id` 直接当一个**路径段**用。
 * 它正常是 `auth.user.id`，由 002 的 `registerUser` 用 `crypto.randomUUID()` 铸的 UUID；
 * 但**没有任何类型或校验把这件事写死**：`User.Info.id` 是 `string`，
 * `verifyToken` 只查 `typeof sub === "string"`。于是「id 是 UUID」这条前提，
 * 靠的是**另一个 feature 的实现细节**，不是本边界自己能保证的事。
 *
 * 同一件事在本仓**已经有既定判据**，且不止一处：
 * - `packages/core/src/database/router.ts` 的 `userDatabasePath`（T005）；
 * - 002 的 `packages/auth/src/workspace.ts` 的 `assertSafeUserId`（T018 的归档 / 恢复 / 删除三个
 *   破坏性动作共用它，那里删错的后果比这里更直接）。
 *
 * 也就是说：**「id 要当路径段用」这个维度上，偏偏锚定这一处没查**——
 * `LEARNINGS #002-01` 说的正是这个形状（同一维度咬两次，别只修当下那一个点）。
 * 修完的落法：判据本体提到 `User.isSafePathSegment`（core），core 与 opencode 两侧共用；
 * auth 那份**保持独立**（core 与 auth 互相够不着，合并会造出反向依赖）。
 *
 * 判据是**路径是否逃出沙箱根**，不是「id 长得对不对」：`join(root, "../bob")` 落在根**外面**，
 * 而 `""` 会让沙箱变成**根自己**（所有用户共用同一个目录，隔离整个失效）。
 *
 * 修法取**拒**（fail closed），不取「不锚定」：不锚定 = 客户端那个伪造的 `directory` 直接生效，
 * 正是本中间件存在的理由。与 T011 磁盘配额对「量不出来」的选择同源——
 * **门看着还在、其实没有**是最坏的一种（`LEARNINGS #002-02`）。
 *
 * ⚠️ 据实记下射程：**这条今天打不到**（拿不到密钥就签不出这样的令牌，而系统自己签发的那条路
 * 只铸 UUID）。它守的是**边界不依赖别人家的实现细节**，不是「已经能被利用」。
 *
 * ⚠️ **为什么这组不走真应用**（`openApp`）：实测过，走真应用的话**分不出对错**——
 * 每个非法 id 都已经拿到 500 了。但那个 500 来自**下游**：`/path` 要经
 * `DatabaseConnectionRouting` 取连接，撞上 T005 的 `userDatabasePath`，而**那个函数有这道校验**
 * （它的注释自己写着「与 002 `createWorkspace` 等价」）。也就是说，端到端那条路上，
 * 锚定的缺口**被另一个模块的守卫遮住了**——断言「500」在那里恒真，测不出任何东西
 * （这正是「测试写成了对另一个东西的断言」，`#002-01` 的另一种长相）。
 * 所以这一组**把锚定单独挂到一个最小路由上**：只有路由层 + 锚定，下游不做任何事，
 * 观察到的就是这一层自己的产出。
 *
 * ⚠️ **挂这层时踩到的两个坑，都记在这**（都实测过，都是「不报错、只是什么也没发生」）：
 * ① **只给 `Config` 不给 `anchorWorkspaceLayer` 也能跑**——层构造成功、请求 200，只是**没有锚定**。
 *    中间件没挂上不会报错，于是「观察原始请求」和「观察没挂中间件」在现象上完全一样。
 *    这正是不加对照组就写不出来的那种测试：对照组先证明**这一层真的在改写**，
 *    后面那七条「拒了」才有意义。
 * ② **两个层不能写成数组** `Layer.provide([锚定层, Config层])`：数组里的两层**并列**，
 *    锚定层够不着 Config，会明确报 `Service not found`。要**链式**两次 `Layer.provide`，
 *    才表达「锚定层 require Config、Config 在外层供给」的上下关系。
 */
describe("非法 user id 拼路径（R-05）", () => {
  /**
   * 能过验签、但**不能当路径段**的 id。覆盖两个方向：
   * 逃出根（`../bob` / 分隔符 / 绝对路径）与塌成根自身（空串 / `.` / `..`）。
   */
  const HOSTILE_IDS = ["../bob", "a/b", "a\\b", "/abs", "", ".", ".."] as const

  const asUser = (id: string): User.Info => ({ id, policeNo: ALICE.policeNo, name: ALICE.name, isAdmin: false })

  /**
   * 只挂锚定这一层的最小路由：内部路由把**改写后的入参**原样回声出来——
   * 这是观察这一层产出的唯一途径（真应用里那些下游会把它盖掉）。
   */
  const anchoredDirectory = (id: string) =>
    Effect.gen(function* () {
      const handler = HttpRouter.toWebHandler(
        HttpRouter.use((router) =>
          // 从**上下文**取请求：锚定正是靠 `Effect.provideService(effect, HttpServerRequest…)` 换掉
          // 下游看到的那一个；handler 的入参是路由器手上那个原始的，看不到改写。
          // 回声走**响应头**、不走 JSON 体：被拒的那几条是**空体**（effect 的 defect 出口不写响应体），
          // 读体就得先兜「解析失败怎么办」，于是「断言状态码」悄悄变成「断言能不能解析」——
          // 测试红在一个与判据无关的地方。响应头两者都不沾。
          router.add("GET", "/*", () =>
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest
              return HttpServerResponse.text("echo").pipe(
                HttpServerResponse.setHeader("x-echo-url", request.url),
                HttpServerResponse.setHeader("x-echo-directory", request.headers["x-opencode-directory"] ?? ""),
              )
            }),
          ),
          // ⚠️ **两个都要给，且必须链式（分成两次 `Layer.provide`）**：
          // ① 少给 `anchorWorkspaceLayer` = 整个探针没挂锚定，观察到的永远是原始请求，
          //    而**不报任何错**——`LEARNINGS #002-02` 的「门看着还在、其实没有」实测坐实；
          // ② 写成一个数组 `Layer.provide([锚定层, Config层])` 也不行：数组里的两层是**并列**的，
          //    锚定层够不着 Config（实测报 `Service not found: @opencode/OpenhiveWorkspaceAnchorConfig`）。
          //    链式才是「锚定层 require Config、Config 在外层供给」的上下关系。
        ).pipe(
          Layer.provide(AnchorWorkspace.anchorWorkspaceLayer),
          Layer.provide(AnchorWorkspace.Config.configLayer({ root: ROOT })),
        ),
        { disableLogger: true },
      ).handler

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          handler(new Request("http://localhost/anything?directory=%2Fetc%2Fpasswd"), Context.make(User.Service, asUser(id))),
        ),
      )
      return {
        response,
        url: response.headers.get("x-echo-url"),
        directory: response.headers.get("x-echo-directory"),
      }
    })

  // 对照组：这一层确实在改写（否则下面那条「拒了」可能只是因为整个探针是坏的）。
  it.live("正常 UUID：URL 与头都被改写成自己的沙箱", () =>
    Effect.gen(function* () {
      const { response, url, directory } = yield* anchoredDirectory(ALICE.id)

      expect(response.status).toBe(200)
      expect(directory).toBe(resolve(ROOT, ALICE.id))
      // 断言走**解析**而不是子串比对：`URL` 会把 `~` 编成 `%7E`，而 `encodeURIComponent` 不编，
      // 于是「拼一个期望串去 contains」在 Windows 短路径（`ADMINI~1`）上会假红。
      // 要钉的是「这个入参的值是不是沙箱」，不是「两个编码器是否逐个字符一致」。
      expect(new URL(url!, "http://localhost").searchParams.get("directory")).toBe(resolve(ROOT, ALICE.id))
    }),
  )

  for (const id of HOSTILE_IDS)
    it.live(`id = ${JSON.stringify(id)} ⇒ 拒绝（不放行、也不锚到沙箱外）`, () =>
      Effect.gen(function* () {
        const { response } = yield* anchoredDirectory(id)

        // 修之前：200，且改写成的目录是 `join(root, id)`——`../bob` 落在根**外面**，
        // `""` / `.` / `..` 让沙箱塌成**根自己**（全体用户共用一个目录）。
        expect(response.status).toBe(500)
      }),
    )
})

describe("锚定的开关与回退（零回归）", () => {
  // 身份门关着 ⇒ 上下文里没有 User ⇒ 锚定**必须直通**。
  // 今天所有客户端都没有会话凭证，锚定若无条件生效，等于把一个没有身份的系统
  // 整体搬到 `/workspaces/<undefined>/`——那是比缺口更大的事故。
  it.live("身份门关着（默认）：不改写请求，客户端 directory 照旧生效", () =>
    Effect.gen(function* () {
      const response = yield* realApp({ OPENHIVE_WORKSPACE_ROOT: ROOT })(
        `${INSTANCE_PATH}?directory=${encodeURIComponent(FORGED)}`,
      )

      expect(response.status).toBe(200)
      const body = yield* json<{ directory: string }>(response)
      expect(normalize(body.directory)).toBe(normalize(FORGED))
    }),
  )
})
