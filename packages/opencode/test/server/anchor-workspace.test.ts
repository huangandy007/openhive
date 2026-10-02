import { afterAll, describe, expect } from "bun:test"
import { resolve, sep } from "path"
import { tmpdir } from "os"
import { ConfigProvider, Effect, Equal, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
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
 */
const ROOT = resolve(tmpdir(), "openhive-anchor-workspace")

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
