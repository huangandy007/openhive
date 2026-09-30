import { afterAll, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T013（验收 · FR-010 / SC-001 / SC-003）：**用户 A 读写不到用户 B 的沙箱目录**。
 *
 * ## 这份断言证明的是什么——**别把它说大**（任务书 `plan.md` R3 ② 的原话）
 *
 * 挡在中间的是**应用层锚定**（T006）：客户端传什么 `directory` 都被改写成
 * `{沙箱根}/{自己的 userId}`。**不是** OS 权限——003 已裁定：单进程 = 一个 OS 主体，
 * `0700` 对「A vs B」零作用，它的效力降级为**容器外防护**（`isolation-scheme.md` §5）。
 *
 * 所以本文件的每条断言都只说明「**请求进不来**」；**不得**据此宣称「OS 已隔离」
 * （`plan.md` R3 ②：断言必须如实写「由应用层锚定保证」）。
 *
 * ## 为什么走真实 HTTP 而不是直接调 `anchor()`
 *
 * 锚定是**全局中间件**，只有接进真实 `createRoutes` 才测得到「装法对不对」——
 * 自己搭个最小路由套中间件，漏装也照样绿（同 `anchor-workspace.test.ts` 的理由）。
 * 本文件与它不重复：那边证「锚到哪」，这边证「**锚定之后，A 到底够不够得着 B 的东西**」
 * ——用的是文件读接口这条**真实数据通路**。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-tenant-dir-"))
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/** 两个人各自的沙箱目录。**测试自己建**——生产里由 `createWorkspace` 落地，这里只要「已存在」。 */
const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)
mkdirSync(sandboxOf(ALICE), { recursive: true })
mkdirSync(sandboxOf(BOB), { recursive: true })

/** 各自的机密文件名与内容。**用内容断言，不只断言状态码**——见下「为什么断言内容」。 */
const OWN_FILE = "own-report.txt"
const OWN_TEXT = "这是自己的研判报告"
writeFileSync(path.join(sandboxOf(ALICE), OWN_FILE), OWN_TEXT, "utf8")
const SECRET_FILE = "bob-secret.txt"
const SECRET_TEXT = "鲍勃的机密材料"
writeFileSync(path.join(sandboxOf(BOB), SECRET_FILE), SECRET_TEXT, "utf8")

afterAll(() => {
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

const openApp = realApp(OPEN)

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const INSTANCE_PATH = "/path"

/** `/path` 的响应体形状。 */
const PathInfo = Schema.Struct({ directory: Schema.String })

const readDirectory = (subject: TokenSubject, forged: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, `${INSTANCE_PATH}?directory=${encodeURIComponent(forged)}`)
    expect(response.status).toBe(200)
    // 过一遍 `Schema` 而不是 `as`：`Response.json()` 是 `any`，直接 `as` 会被
    // oxlint 的 `no-unsafe-type-assertion` 命中（本文件要 0 命中）。
    return (yield* Effect.map(Effect.promise(() => response.json()), (body: unknown) =>
      Schema.decodeUnknownSync(PathInfo)(body),
    )).directory
  })

/**
 * 归一化：断言不该因 Windows 的 `\` / 盘符大小写假红（同 `anchor-workspace.test.ts`）。
 *
 * ⚠️ **再加一道 `realpath`**：本机 `tmpdir()` 给的是 **8.3 短名**（`ADMINI~1`），而应用把目录
 * 解析成**长名**（`Administrator`）——两者是同一个目录，直接比字符串会假红。
 * （`anchor-workspace.test.ts` 没撞上是因为它的沙箱目录**从未被创建**，应用不会去 realpath；
 * 本文件要先建出目录来放文件，于是必然撞上。）两条都归一到**真实路径**再比，断言才落在
 * 「**归属**」这个契约上，而不是路径的书写形式。
 */
const canonical = (value: string) => {
  const real = (() => {
    try {
      return realpathSync.native(value)
    } catch {
      return value // 不存在（例如刚被伪造的那个）就退回原样
    }
  })()
  return real.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

/**
 * 读一个文件接口。**返回整段响应文本**——下面的断言要的是「机密内容有没有出现在响应里」，
 * 只断言状态码的话，一个 200 + 错误体 / 一个 500 + 把内容带进错误详情的实现都能混过去。
 */
const readFileAs = (subject: TokenSubject, relativePath: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, `/file/content?path=${encodeURIComponent(relativePath)}`)
    return { status: response.status, body: yield* Effect.promise(() => response.text()) }
  })

/** 列目录。同样看整段响应体。 */
const listDirAs = (subject: TokenSubject, relativePath: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, `/file?path=${encodeURIComponent(relativePath)}`)
    return { status: response.status, body: yield* Effect.promise(() => response.text()) }
  })

describe("跨目录隔离（T013 · FR-010 / SC-001 / SC-003）", () => {
  /**
   * 伪造 directory **指向对方的沙箱**——比 `anchor-workspace.test.ts` 里那个
   * 「随便一个不存在的绝对路径」更贴近真实攻击：攻击者会报一个**真实存在**的别人家的目录。
   */
  it.live("A 伪造 directory 指向 B 的沙箱：被忽略，仍落自己的沙箱（两边都验）", () =>
    Effect.gen(function* () {
      const alice = yield* readDirectory(ALICE, sandboxOf(BOB))
      const bob = yield* readDirectory(BOB, sandboxOf(ALICE))

      expect(canonical(alice)).toBe(canonical(sandboxOf(ALICE)))
      expect(canonical(bob)).toBe(canonical(sandboxOf(BOB)))
    }),
  )

  /**
   * 核心那条：**A 用相对路径穿越去读 B 的文件**。
   *
   * 为什么用 `..` 而不是绝对路径：文件接口的 `path` 是**相对**实例目录解析的，
   * 而「实例目录」锚定之后是 A 自己的沙箱 ⇒ `../{B的 userId}/…` 正是从 A 的沙箱走出去、
   * 落进 B 沙箱的那条路。
   *
   * ## 挡住它的**不是**一个地方（变异验证实测出来的，别记错）
   *
   * 有两道 `FSUtil.contains`，都在上游自有代码里，本 feature **一行都没加**：
   * ① `packages/core/src/filesystem.ts` 的 `resolve()`（`read` / `list` **共用**）；
   * ② `handlers/file.ts` 的 `content`（只护 `content`）。
   * 实测：只拿掉 ②，本文件两条穿越用例**都还绿**（① 兜住）；
   * 只拿掉 ①，**「列目录」那条红**（`list` 只有 ①）；两条都拿掉，两条用例才都红。
   * ⇒ 「读文件」是**双重**的（任一道在就够），「列目录」**只有** ① 一道。
   *
   * 这也是「断言内容而不只断言状态码」的理由之一：只断言非 200 的话，
   * 两道守卫里少一道、另一道正好把状态码变成 500，测试照样绿。
   */
  it.live("A 用 `..` 穿越读 B 沙箱里的文件：被拒，且响应里不含 B 的内容", () =>
    Effect.gen(function* () {
      const cross = yield* readFileAs(ALICE, `../${BOB.id}/${SECRET_FILE}`)

      expect(cross.status).not.toBe(200)
      // 真正的安全属性是「内容没漏」——状态码只是它的一个表征。
      expect(cross.body).not.toContain(SECRET_TEXT)
    }),
  )

  /**
   * ⚠️ 这条**只靠 core 的 `FileSystem.resolve` 一道守卫**（`handlers/file.ts` 的 `list` 没有自己的
   * `contains`）——变异验证里它是**唯一**被「拿掉 ①」单独打红的一条。别把它的安全性
   * 记在 handler 那道守卫上。
   */
  it.live("A 列 B 的沙箱目录：看不到 B 的文件名", () =>
    Effect.gen(function* () {
      const cross = yield* listDirAs(ALICE, `../${BOB.id}`)

      expect(cross.body).not.toContain(SECRET_FILE)
    }),
  )

  /**
   * **双向**（任务书 Step 4：「过紧也是缺陷」，`plan.md` R3）。
   *
   * 少了这两条，把所有人锚进一个空目录也能让上面几条全绿——那样的「隔离」是坏掉的，
   * 不是安全的。
   */
  it.live("反向：A 读得到自己沙箱里的文件（锚定没锚过头）", () =>
    Effect.gen(function* () {
      const own = yield* readFileAs(ALICE, OWN_FILE)

      expect(own.status).toBe(200)
      expect(own.body).toContain(OWN_TEXT)
      // 顺带说明「上面那条的拒」不是「接口整体坏了」——同一条通路读自己的文件是通的。
      expect(own.body).not.toContain(SECRET_TEXT)
    }),
  )

  it.live("反向：A 列得到自己沙箱（看得见自己的文件、看不见 B 的）", () =>
    Effect.gen(function* () {
      const own = yield* listDirAs(ALICE, ".")

      expect(own.status).toBe(200)
      expect(own.body).toContain(OWN_FILE)
      expect(own.body).not.toContain(SECRET_FILE)
    }),
  )
})
