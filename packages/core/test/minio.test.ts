import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Minio } from "@opencode-ai/core/minio"
import { type FakeS3, startFakeS3 } from "./fixture/fake-s3"

/**
 * MinIO 客户端（005 T011 / FR-007 / `minio.md` §1 §3）。
 *
 * **被测对象是真的 `@aws-sdk/client-s3`**，对上 `test/fixture/fake-s3.ts` 那个真 HTTP 端点——
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
