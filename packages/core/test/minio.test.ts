import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Minio } from "@opencode-ai/core/minio"
import { type FakeS3, startFakeS3 } from "../src/test-support/fake-s3"

/**
 * MinIO 客户端（005 T011 / FR-007 / `minio.md` §1 §3）。
 *
 * **被测对象是真的 `@aws-sdk/client-s3`**，对上 `src/test-support/fake-s3.ts` 那个真 HTTP 端点——
 * 不是替身。理由见夹具文件头与 `LEARNINGS #002-02`：T011 的产物就是那段实装，用替身会把
 * 被测对象换掉。本机测不到的那半边（桶策略 / STS / `${aws:username}`）在 D-13，**不在本文件**。
 */
let s3: FakeS3

beforeEach(() => {
  s3 = startFakeS3()
})

afterEach(() => {
  s3.stop()
})

/** 假凭据——本夹具不验签名（验签是真实 MinIO 的事，D-13）。 */
const 凭据 = { accessKeyId: "test-key", secretAccessKey: "test-secret" }

const 编码 = (text: string) => new TextEncoder().encode(text)
const 解码 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const 开 = (scope: Minio.Scope) =>
  Minio.makeStore({ endpoint: s3.endpoint, bucket: "openhive", credentials: 凭据, scope })

/** 取第 n 个到达的请求——没到就当场说清楚，不让断言去猜 `undefined`。 */
function 第(n: number) {
  const request = s3.requests[n]
  if (request === undefined) throw new Error(`假 S3 只收到 ${s3.requests.length} 个请求，取不到第 ${n} 个`)
  return request
}

/**
 * 跑一个**注定要抛**的动作，返回它抛出来的那个错误；**它要是没抛，就用一个说清楚的错炸掉本用例**
 * （而不是让后面的断言去对着 `undefined` 猜）。
 *
 * ⚠️ **刻意不写 `await expect(fn()).rejects.toThrow()`**：`bun-types` 把 `.rejects` 声明成
 * `Matchers<unknown>`，`await` 一个 `void` 会被 `await-thenable` 记一条（全仓已有 98 处同类命中，
 * 见 `packages/auth/src/rbac.test.ts` 的同因同注）。本 task 的门禁判据是「本次新增文件 0 命中」，
 * 所以沿用仓库里已经定下的写法，而不是新添第 99 处。
 *
 * 返回**错误本体**而不是布尔，是为了让调用方还能钉「抛的是哪一个错」：「抛了」只是伴随信号，
 * 光有它，把 `NoSuchBucket` 错当成 `NoSuchKey` 的实装照样绿（`#004-14`）。
 */
async function 抛了(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught
}

/**
 * 「拦没拦住」这个布尔——只给 `拒于门外` 用，所以不单独记错误本体。
 *
 * ⚠️ 两个分支别写反：`抛了` 在「动作真的抛了错」时是**正常 resolve**（它把错误当返回值交出去），
 * 只有在「动作居然成功了」时才 reject。所以 resolve ⇒ 拦住了。
 */
const 拦住了 = (run: () => Promise<unknown>) => 抛了(run).then(() => true, () => false)

/**
 * 「这个出口**拒了**，而且**一个字都没发出去**」——两条断言，顺序照 `#004-14`：
 * **被测属性在前**（没逃出前缀），伴随信号在后（抛没抛）。
 *
 * 为什么被测属性是「没发出去」而不是「抛了」：S3 的键是**不透明字符串**，但 URL 不是——
 * `007/p-42/../../p-99/x` 若被原样放进请求路径，HTTP 那层一规范化就落在 `007/p-99/x`，
 * 也就是**别人的前缀**。所以真正的安全属性是「这个请求根本没产生」，不是「调用方收到了错」。
 */
async function 拒于门外(店: Minio.Interface, action: () => Promise<unknown>) {
  const 抛没抛 = await 拦住了(action)

  expect(s3.requests.length).toBe(0)
  expect(抛没抛).toBe(true)
}

describe("Minio 客户端（005 T011 / FR-007）", () => {
  describe("键拼装：{userId}/{projectId}/{相对路径}（minio.md §1）", () => {
    test("put 把对象落到**调用者自己**的前缀下，桶是单桶 openhive", async () => {
      const 店 = 开({ userId: "007", projectId: "p-42" })

      await 店.put({ path: "笔记/a.txt", body: 编码("你好") })

      expect(第(0).method).toBe("PUT")
      expect(第(0).bucket).toBe("openhive")
      expect(第(0).key).toBe("007/p-42/笔记/a.txt")
      expect(解码(第(0).body)).toBe("你好")
    })

    test("键里的非 ASCII 与空格原样往返——`%E7%AC%94` 那套编码不能把键改掉", async () => {
      const 店 = 开({ userId: "007", projectId: "p-42" })

      await 店.put({ path: "讯问 1/张三.txt", body: 编码("x") })

      // pathname 是编码态（真的发出了 `%E8%AE%AF%E9%97%AE%201`），而夹具解回来的 key 必须还原
      expect(第(0).path).not.toContain("讯问")
      expect(第(0).key).toBe("007/p-42/讯问 1/张三.txt")
    })
  })

  describe("路径边界：调用者给不出自己的前缀（minio.md §2 的应用层那一半）", () => {
    const 店 = () => 开({ userId: "007", projectId: "p-42" })

    test("拒绝向上穿越（`..`）——`007/p-42/../p-99/x` 规范化后会落到别人的前缀", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "../p-99/x.txt", body: 编码("x") }))
    })

    test("拒绝藏在深处的穿越（`a/../../b`）——只查开头那一段是不够的", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "a/../../b.txt", body: 编码("x") }))
    })

    test("拒绝绝对路径（`/…`）——绝对路径拼在前缀后面等于把前缀丢掉", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "/etc/passwd", body: 编码("x") }))
    })

    test("拒绝盘符（`C:/…`）——win32 上这条等价于绝对路径", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "C:/Windows/x.txt", body: 编码("x") }))
    })

    test("拒绝反斜杠——win32 拿它当分隔符，于是它也能拼出 `..`", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "..\\p-99\\x.txt", body: 编码("x") }))
    })

    test("拒绝空路径——空路径的对象键就是那个目录本身，写它没有意义", async () => {
      const store = 店()
      await 拒于门外(store, () => store.put({ path: "", body: 编码("x") }))
    })

    test("get 与 delete 走同一个边界——**数出口要数「底层函数被调用的地方」**（#004-01）", async () => {
      const store = 店()
      await 拒于门外(store, () => store.get({ path: "../p-99/x.txt" }))
      await 拒于门外(store, () => store.delete({ path: "../p-99/x.txt" }))
    })

    test("对照：合法的多层路径照常发出去——证明上面那几条不是「什么都发不出去」的假象", async () => {
      await 店().put({ path: "笔录/2026/讯问 1.txt", body: 编码("x") })

      expect(s3.requests.length).toBe(1)
      expect(第(0).key).toBe("007/p-42/笔录/2026/讯问 1.txt")
    })

    /**
     * 前缀**自己**也是输入——`#004-01` 的「数底层函数的调用点」在这里的形态是：
     * 键是**三段拼起来的**，只查第三段（`path`）就漏掉了前两段。
     *
     * 身份由服务端给 ≠ 可以不查：`userId` 一个 `..` 就让每个键都从别人的前缀下面走，
     * 而这一条比 `path` 那条更隐蔽——因为它**不在任何一次调用的入参里**。
     */
    test("scope 的 userId 也不能穿——只查 path 会漏掉键的前两段", () => {
      expect(() => 开({ userId: "../p-99", projectId: "p-42" })).toThrow()
    })

    test("scope 的 projectId 同理", () => {
      expect(() => 开({ userId: "007", projectId: "a/../../p-99" })).toThrow()
    })
  })

  describe("四个动作（minio.md §3 的窄接口：put / get / list / delete）", () => {
    const 店 = () => 开({ userId: "007", projectId: "p-42" })

    test("get 取回刚 put 上去的字节——往返不掉内容", async () => {
      const store = 店()
      await store.put({ path: "a.txt", body: 编码("你好") })

      expect(解码((await store.get({ path: "a.txt" })) ?? 编码(""))).toBe("你好")
    })

    test("get 一个**没备份过**的路径 ⇒ undefined（404 是一种正常答案，不是异常）", async () => {
      expect(await 店().get({ path: "没有的.txt" })).toBeUndefined()
    })

    test("但**真错误**不能被吞成 undefined——403 要抛，否则「拉不回」与「凭据错了」长得一模一样", async () => {
      const store = 店()
      s3.seed("007/p-42/a.txt", "1")
      s3.failWith(403)

      // 实得值取**错误本体**而不是布尔：还要钉「抛的是服务端给的那个错」，
      // 光钉「抛了」的话，随便抛个什么都能过（`#004-14`）
      const 错 = await 抛了(() => store.get({ path: "a.txt" }))

      expect(错.name).toBe("InternalError")
    })

    /**
     * 这一条与上面那条**不是同一件事**，别看形状像就并掉：
     *
     * - 上面：非 404 的真错误（403）。
     * - 这里：**也是 404**，只是不是 `NoSuchKey`——桶名配错时 S3 回 `NoSuchBucket`。
     *
     * 差别的价值在于它会杀死**另一种实现**：把判据写成 `状态码 === 404 ⇒ undefined`——这是很自然的
     * 写法（「404 就是没有嘛」），而上面那条 403 **照样绿**，只有这条会红。两者的后果方向完全相反：
     * 一个是「这个文件没备份过」，一个是「你的桶根本不存在」，处理动作南辕北辙。
     *
     * 钉的是 `"NoSuchBucket"` 这个值本身，不是我们自己编的字符串：实测（2026-10-06，
     * `@aws-sdk/client-s3` 3.933.0）SDK 把响应 XML 里的 `<Code>` 原样放进 `error.name`。
     */
    test("桶名配错（404 但**不是** NoSuchKey）同样要抛——「404 ⇒ 没备份过」是错的写法", async () => {
      s3.stop()
      s3 = startFakeS3({ bucket: "别的桶" })
      const store = 开({ userId: "007", projectId: "p-42" })

      const 错 = await 抛了(() => store.get({ path: "a.txt" }))

      expect(错.name).toBe("NoSuchBucket")
    })

    test("list 只列**自己这个项目**的键（别人／别的项目一条都不能露）", async () => {
      s3.seed("007/p-42/a.txt", "1")
      s3.seed("007/p-42/子目录/b.txt", "2")
      s3.seed("007/p-99/同人别的项目.txt", "3")
      s3.seed("008/p-42/别人同名项目.txt", "4")

      expect(await 店().list()).toEqual(["a.txt", "子目录/b.txt"])
    })

    test("list 把前缀剥掉——窄接口的入参出参都不带前缀（minio.md §3）", async () => {
      s3.seed("007/p-42/子目录/b.txt", "2")

      // 剥没剥干净，看的就是「回给你的东西里没有 userId/projectId」
      expect(await 店().list()).not.toContain("007/p-42/子目录/b.txt")
    })

    test("delete 真的删掉", async () => {
      const store = 店()
      await store.put({ path: "a.txt", body: 编码("x") })

      await store.delete({ path: "a.txt" })

      expect(s3.keys()).toEqual([])
      expect(await store.get({ path: "a.txt" })).toBeUndefined()
    })

    test("删一个从没有过的键不抛——真 S3 回 204（幂等），夹具与实装都照抄", async () => {
      await 店().delete({ path: "从没有过.txt" })
    })

    test("list 是**整个项目**的——顶层与深层的都要列到", async () => {
      s3.seed("007/p-42/顶层.txt", "1")
      s3.seed("007/p-42/深/两/层.txt", "2")

      // ⚠️ 顺序是**真 S3 的顺序**（按键的字节序），不是「人觉得顺眼」的顺序：
      // `深` = U+6DF1 排在 `顶` = U+9876 前面。别照着中文语义去「修正」这两项——
      // 夹具是按整键排序的，改成别的顺序反而会让实装与真 MinIO 之间多出一个假差异。
      expect(await 店().list()).toEqual(["深/两/层.txt", "顶层.txt"])
    })

    /**
     * `ListObjectsV2` 一次最多回 1000 条——**这条用例把 1000 缩小成 2**，
     * 于是「过千才出错」的缺陷在三条数据上就现形。
     *
     * 为什么非钉不可：只发一次请求的实装**在小项目上永远绿**，而归档（T013）正是拿
     * `list()` 的清单去传文件的——少列一条 = **少备份一个文件**，且没有任何报错。
     */
    test("list 要把分页**走完**——`IsTruncated` 时不能当成「就这些」", async () => {
      s3.stop()
      s3 = startFakeS3({ pageSize: 2 })
      s3.seed("007/p-42/a.txt", "1")
      s3.seed("007/p-42/b.txt", "2")
      s3.seed("007/p-42/c.txt", "3")

      // 先钉被测属性：三条一条不少
      expect(await 开({ userId: "007", projectId: "p-42" }).list()).toEqual(["a.txt", "b.txt", "c.txt"])
      // 再钉伴随信号：确实是**翻了页**才拿全的（一页最多 2 条，三条至少要两次）
      expect(s3.requests.length).toBe(2)
    })
  })
})

/**
 * 外呼超时（005 Step 5 审查 **X4-1**）。
 *
 * 问题：`makeStore` 造 `S3Client` 时**一个超时都没给**（`requestTimeout` / `connectionTimeout` /
 * `socketTimeout` 全缺，aws-sdk v3 默认没有 request 超时）。⇒ MinIO 僵死（进程还在、就是不回话）时，
 * 归档 / 找回**无限期挂起**——不是 500、不是可重试，就是永远不 settle：`handleArchive` 里那次
 * `await store.put(...)` 永远不会返回，界面一直转、日志里什么都没有。
 *
 * 这条把「挂起」钉成「**有限时间内失败**」。判据的关键在**失败是谁给的**：必须是**外呼自己**
 * 在超时后失败的，不是本用例的兜底掐断的（`#004-14`：「抛了错」只是伴随信号，兜底也会抛）。
 */
const 兜底标记 = "【RED 兜底】外呼到 2s 还没自己失败"
/** 给被测调用套一个兜底计时器——**修好之后用不上**（外呼 300ms 就自己失败），
 * **修好之前**它保证 RED 快速失败、而不是把整个 `bun test` 挂在一条永不 settle 的 await 上（`#005-01` 同族的坏结果）。 */
const 快过 = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(兜底标记)), ms))])

describe("MinIO 外呼超时（005 Step 5 审查 X4-1）", () => {
  test("MinIO 不回话时，外呼**自己在超时后失败** —— 不是无限期挂起", async () => {
    // 一个「收下连接、永远不回话」的端点：这是真挂起（TCP 建得上、请求发出去了、就是不回）。
    const 黑洞 = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    try {
      const 店 = Minio.makeStore({
        endpoint: `http://127.0.0.1:${黑洞.port}`,
        bucket: "openhive",
        credentials: 凭据,
        scope: { userId: "007", projectId: "p-42" },
        timeoutMs: 300,
      })

      const 错 = await 抛了(() => 快过(店.put({ path: "a.txt", body: 编码("x") }), 2000))

      // 被测属性：这次失败是**外呼自己的超时**给的，不是本用例的兜底掐断的。
      expect(错.message).not.toContain(兜底标记)
    } finally {
      void 黑洞.stop(true)
    }
  })
})

/**
 * 同一条超时的**另一半**（005 第二轮对抗审查，当场抓到的漏网）。
 *
 * 上面那条只盖住了 `put`，而 `put` 的超时**顺带**成立：上传体是随请求发出去的，
 * `client.send` 要等整个请求发完才 resolve ⇒ 定时器活到那时候，覆盖面够。
 *
 * `get` 不一样，它有两个阶段：
 *  ① `client.send(GetObjectCommand)` —— **收到响应头就 resolve**（`GetObjectCommand` 的
 *     `Body` 是**流式**的，SDK 不替你收完，这是它的设计）；
 *  ② `response.Body.transformToByteArray()` —— 真把 body 读出来。
 *
 * 定时器只在 ① 里活着，① 一 resolve 就把 `clearTimeout` 了 ⇒ ② 是**没有超时的**。
 * MinIO 回了头、然后卡住不发 body（网络中断、进程被冻、反代半死）时，`get` 照样
 * **无限期挂起**——正是 X4-1 要消灭的那个症状，只是从 `put` 挪到了找回路径上。
 * （`list` / `delete` 不受影响：它们的响应体由 SDK 在 `send` **内部**收完再解析，
 * 天然落在定时器覆盖范围内。）
 *
 * 判据形式与上面那条一致：失败必须是**外呼自己**在超时后给的（`#004-14`）。
 */
describe("MinIO 外呼超时 · get 的响应体（005 第二轮审查）", () => {
  test("MinIO 回了响应头却**不发完 body** 时，get 也要自己在超时后失败", async () => {
    // 「发得出头、发不出 body」：先 enqueue 一小段，**然后永不 close**。
    // 这一步是必须的——纯黑洞（连头都不回）在 ① 就挂住了，验不到 ② 这一半。
    const 半截 = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(编码("half"))
            },
          }),
        ),
    })
    try {
      const 店 = Minio.makeStore({
        endpoint: `http://127.0.0.1:${半截.port}`,
        bucket: "openhive",
        credentials: 凭据,
        scope: { userId: "007", projectId: "p-42" },
        timeoutMs: 300,
      })

      const 错 = await 抛了(() => 快过(店.get({ path: "a.txt" }), 2000))

      // 被测属性：这次失败是**外呼自己的超时**给的，不是本用例的兜底掐断的。
      expect(错.message).not.toContain(兜底标记)
    } finally {
      void 半截.stop(true)
    }
  })
})

/**
 * 剩下两个动作的超时（005 **后端**缺口补测）。
 *
 * ## 为什么这两条必须存在
 *
 * 上面那段注释里有一句**断言性的话**：
 * 「（`list` / `delete` 不受影响：它们的响应体由 SDK 在 `send` **内部**收完再解析，天然落在
 * 定时器覆盖范围内。）」——它是**推断**，而当时**零用例**兜着（list 只测过分页、delete 只测过
 * 幂等；两次 grep 实测 2026-10-07）。按 `#003-04`（推断落笔前先复现）与 `#002-02`
 * （没覆盖的要写成缺口，不能写成已覆盖）：**这句「不受影响」今天是一句没人验过的话。**
 *
 * 它的失败模式与 X4-1 一模一样、且同样静默：MinIO 僵死时 `list` / `delete` 无限期挂住，
 * 不是 500、是可重试性为零的永久 pending。而 `list` 正处在**归档链的上游**
 * （`backupAll` 拿它的清单去传文件），`delete` 在收敛那一步——两条都在归档这条链上。
 *
 * ## 两条各钉什么
 *
 * - `delete`：**单次 `send`**，与 `put` 同形，定时器罩住整段。
 * - `list`：**每页各一次** `withTimeout`（`minio.ts` 的 do/while 把调用放在**体内**）。
 *   黑洞端点下第一页就挂住，所以它同时反证了「分页没有把定时器拆到罩不住的地方」。
 *
 * 判据形式与上面两条一致（`#004-14`）：失败必须是**外呼自己**在超时后给的——`兜底标记` 是
 * 本用例自己的兜底计时器抛的字符串，断言 `not.toContain` 就是「不是兜底掐断的」。
 */
describe("MinIO 外呼超时 · list 与 delete（005 后端缺口补测）", () => {
  /** 一个「收下连接、永远不回话」的端点（同上面两条的 fixture：TCP 建得上、请求发出去了、就是不回）。 */
  const 造黑洞 = () => Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })

  const 对着黑洞开 = (port: number) =>
    Minio.makeStore({
      endpoint: `http://127.0.0.1:${port}`,
      bucket: "openhive",
      credentials: 凭据,
      scope: { userId: "007", projectId: "p-42" },
      timeoutMs: 300,
    })

  test("MinIO 不回话时，list 自己在超时后失败 —— 不是无限期挂起", async () => {
    const 黑洞 = 造黑洞()
    try {
      const 错 = await 抛了(() => 快过(对着黑洞开(黑洞.port).list(), 2000))

      expect(错.message).not.toContain(兜底标记)
    } finally {
      void 黑洞.stop(true)
    }
  })

  test("MinIO 不回话时，delete 自己在超时后失败 —— 不是无限期挂起", async () => {
    const 黑洞 = 造黑洞()
    try {
      const 错 = await 抛了(() => 快过(对着黑洞开(黑洞.port).delete({ path: "a.txt" }), 2000))

      expect(错.message).not.toContain(兜底标记)
    } finally {
      void 黑洞.stop(true)
    }
  })
})
