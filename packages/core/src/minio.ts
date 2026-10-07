export * as Minio from "./minio"

import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

/**
 * MinIO 客户端（005 T011 / FR-007 / `minio.md` §1 §3）。
 *
 * ## 它是什么、不是什么
 *
 * 一个**窄接口**（`minio.md` §3）：`put / get / list / delete` 四个动作，
 * **入参里不带桶名与前缀**——前缀由构造时的 `scope` 定死，调用者给不出也改不了。
 *
 * 这个收窄不是为了好看：它让 T012 / T013 的测试能在**边界**注入替身（替掉的是「对象存储」
 * 这件事），而不是把被测对象本身换成假的（`LEARNINGS #002-02`）。
 *
 * ## 凭据由调用方注入 —— 本机验不了的那一半刻意不在这里
 *
 * `minio.md` §2 的模型是「服务凭据 ＋ 每次外呼按身份签发 STS `AssumeRole` 临时凭据」，
 * 但**内网 MinIO 支不支持策略变量 / STS 只能在目标环境实测**（该文档 §2 的 ⚠️，落 `D-13`）。
 * 所以本模块**只收凭据、不签发凭据**：D-13 裁定之后换一个 credential provider 即可，
 * 这里一行不改。把 `fromTemporaryCredentials` 现在串进来，等于把一条**本机一行都验不到**的
 * 分支写进产品码，还要靠注释去记「它没被验证过」。
 *
 * ⚠️ **本模块不闭合的账**（如实登记，`LEARNINGS #002-02`：测不了的要写成缺口，不能写成覆盖）：
 * 桶策略、STS、`${aws:username}` 绑定一个都没验（本机无 MinIO，D-13 部署时做）。
 * 本模块的测试验的是**我们发出去的请求长什么样**（键、method、body、错误映射），
 * 观测面是 `packages/core/src/test-support/fake-s3.ts` 那个真 HTTP 端点。
 */

/** 对象键的前两段：`{userId}/{projectId}/`，见 `minio.md` §1。 */
export interface Scope {
  readonly userId: string
  readonly projectId: string
}

export interface Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

export interface Config {
  /** 内网 endpoint（`host:port`，或带协议）。 */
  readonly endpoint: string
  readonly bucket: string
  readonly credentials: Credentials
  readonly scope: Scope
  /**
   * 单次外呼的超时（毫秒），默认 `DEFAULT_TIMEOUT_MS`（30_000）。
   *
   * ⚠️ 不给它一个好值等于「**挂起**」不是「**慢**」：MinIO 僵死（进程还在、就是不回话）时，
   * aws-sdk v3 **默认没有 request 超时** ⇒ `store.put` 永不 settle，调用方（归档 / 找回）
   * 永远停在那次 `await` 上——不是 500、不是可重试，界面一直转、日志里什么都没有
   * （005 Step 5 审查 **X4-1**）。这里给每一次 `client.send` 套一个 `AbortSignal`，
   * 到点就 abort ⇒ 变成一次**普通的、可捕获的失败**。
   *
   * 测试把它调小（几百毫秒）到「黑洞端点」上验；生产用默认值。
   */
  readonly timeoutMs?: number
}

export interface Interface {
  readonly put: (input: { readonly path: string; readonly body: Uint8Array }) => Promise<void>
  readonly get: (input: { readonly path: string }) => Promise<Uint8Array | undefined>
  readonly list: () => Promise<readonly string[]>
  readonly delete: (input: { readonly path: string }) => Promise<void>
}

/** win32 的盘符（`C:`），只认开头——`a:C` 这种中段出现的不算。 */
const DRIVE = /^[A-Za-z]:/

/** 单次外呼的默认超时（毫秒）——理由见 `Config.timeoutMs`（005 Step 5 审查 X4-1）。 */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 键的**每一段**都要过这里。三段（`userId` / `projectId` / `path`）用的是同一条判据。
 *
 * ## 为什么应用层还要查一遍
 *
 * `minio.md` §2 说「越权在**存储层**被拒，不依赖应用层把键拼对」——那是**主**防线（桶策略钉
 * `${aws:username}`）。这里是**次**防线，防的是**另一个**东西：主防线钉的是「你是谁」，
 * 而 `007/p-42/../p-99/x` 这种键**在同一个人的前缀内部**就换了项目——S3 的键是不透明字符串，
 * 但 URL 不是，HTTP 那层一规范化，`..` 就没了。
 *
 * 所以这条同时是**安全**判据与**正确性**判据，而且判据的形式是「**请求根本没产生**」
 * （见测试里的 `拒于门外`）——「调用方收到了错」是伴随信号，不是被测属性（`#004-14`）。
 *
 * 反斜杠单列一条：win32 拿它当分隔符，`..\p-99\x` 与 `../p-99/x` 在那边是同一个意思。
 */
function assertSafeSegment(label: string, value: string): void {
  if (value.length === 0) throw new Error(`对象键的${label}不能为空`)
  if (value.includes("\\")) throw new Error(`对象键的${label}不能含反斜杠：${JSON.stringify(value)}`)
  if (value.startsWith("/")) throw new Error(`对象键的${label}不能以「/」开头：${JSON.stringify(value)}`)
  if (DRIVE.test(value)) throw new Error(`对象键的${label}不能带盘符：${JSON.stringify(value)}`)
  if (value.split("/").includes("..")) throw new Error(`对象键的${label}不能含「..」：${JSON.stringify(value)}`)
}

/**
 * `404 NoSuchKey` ⇒ `undefined`；**其余一律上抛**。
 *
 * 只认 `NoSuchKey` 是对的，认「凡是 404」是错的：桶名写错时 S3 回的是 `NoSuchBucket`（也是 404），
 * 而那**不是**「这个文件没备份过」，是**配置错了**。把两者并成一个 `undefined`，用户会看到
 * 「没备份过」而不是「桶没了」——静默，且指向完全相反的处理方向。
 *
 * 「找错形状」这件事只认一个 `name` 也够：本模块只对着 `@aws-sdk/client-s3` 一个实现，
 * 而它把 XML 里的 `<Code>` 直接放进 `error.name`（测试里那条 403 与这条 404 各钉一次）。
 */
async function notFoundToUndefined<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") return undefined
    throw error
  }
}

export function makeStore(config: Config): Interface {
  assertSafeSegment("userId", config.scope.userId)
  assertSafeSegment("projectId", config.scope.projectId)

  const client = new S3Client({
    endpoint: config.endpoint,
    // MinIO 不看 region，但 SDK 要求给一个；给谁都一样，给个不会有人误读的
    region: "us-east-1",
    // MinIO 是 path-style（桶在路径第一段，不是 `<bucket>.host` 子域）——
    // 不开这个，SDK 会把请求打到 `openhive.127.0.0.1` 这种不存在的域名上
    forcePathStyle: true,
    credentials: config.credentials,
  })

  const prefix = `${config.scope.userId}/${config.scope.projectId}/`
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * 给**一次动作**套上限时：到点 `abort()`，被 `signal` 拴住的外呼随之拒绝
   * （理由与后果见 `Config.timeoutMs`）。
   *
   * ⚠️ **回调的整段都算「一次动作」，不只是 `client.send` 那一下。** `get` 的响应体是**流**
   * （`GetObjectCommand` 的 `Body` 要等 `transformToByteArray()` 才读得完），定时器若在
   * `send` resolve 时就放掉，那条读取路径就**没有超时**了——005 第二轮审查实测：
   * MinIO「发得出头、不发完 body」⇒ `get` 无限期挂起，正是 X4-1 要消灭的症状，
   * 只是从 `put` 挪到了找回路径上。所以调用方要把「读 body」也写进回调里。
   *
   * ⚠️ `async` ＋ `try/finally`，**不是** `.finally()`：回调**同步**抛时（`keyOf` 对非法路径
   * 当场抛）`.finally()` 根本接不上那个 promise，定时器会白活一整段 `timeoutMs`。
   *
   * **每个动作都从这里过**——边界只有一处（`#004-01`：数「做那件事的那一行」，别数「已经包了超时的那几行」）。
   */
  const withTimeout = async <Out,>(run: (signal: AbortSignal) => Promise<Out>): Promise<Out> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await run(controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 唯一的键拼装点：**每个动作都从这里过**，所以边界只有一处（`#004-01`）。 */
  const keyOf = (path: string) => {
    assertSafeSegment("路径", path)
    return `${prefix}${path}`
  }

  return {
    put: async ({ path, body }) => {
      await withTimeout((abortSignal) =>
        client.send(new PutObjectCommand({ Bucket: config.bucket, Key: keyOf(path), Body: body }), { abortSignal }),
      )
    },

    /**
     * ⚠️ 这条比别的动作多一层，两层都不能省（005 第二轮审查实测出来的）：
     *
     * ① **读 body 要在 `withTimeout` 的回调里**——`GetObjectCommand` 的 `Body` 是**流**，
     *    `client.send` 收到响应头就返回了，body 是后面 `transformToByteArray()` 才读的；
     *    读在回调外面，它就落在超时之外。
     * ② **光挪进来还不够**：`abortSignal` 对**已经发出的响应流没有约束力**（SDK 只在请求
     *    阶段听它，`send` 一 resolve 这条线就断了）——实测：只做 ① 仍然挂到本用例的兜底。
     *    所以到点要**自己把中断接到流上**，`transformToByteArray()` 才会失败。
     *
     *    ⚠️ 而且必须是 **`destroy(new Error(...))`，不能是裸 `destroy()`**：2026-10-07 探针实测
     *    （Bun 1.3.14），裸的只 emit `aborted` ＋ `close`、`readable` 转 false，而
     *    `transformToByteArray()` **照样挂着**；带上 error 才 emit `error` 并让读取当场 reject。
     *
     * 症状：MinIO 发得出响应头、发不出 body（网络断、进程冻、反代半死）⇒ 找回**无限期挂起**。
     */
    get: ({ path }) =>
      notFoundToUndefined(() =>
        withTimeout(async (abortSignal) => {
          const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), {
            abortSignal,
          })
          const body = response.Body
          if (body === undefined) throw new Error(`MinIO 对 ${JSON.stringify(path)} 回了空 body`)

          /**
           * ⚠️ `response.Body` 的**静态**类型是 SDK 的联合（Node 下是 `IncomingMessage`、浏览器下是
           * `Blob & SdkStreamMixin`），只有前者有 `destroy` —— 所以**先问再调**，不硬转类型
           * （`Reflect.get` 取出来当 `unknown` 看，`typeof === "function"` 之后才调）。
           * 真落到 `Blob` 那一支时不调（那一支没有可中断的流）；本模块跑在 Bun/Node 上，走的是
           * `IncomingMessage`。
           */
          const 停读 = () => {
            const 目标: unknown = body
            if (typeof 目标 !== "object" || 目标 === null) return
            const 销毁: unknown = Reflect.get(目标, "destroy")
            if (typeof 销毁 === "function")
              Reflect.apply(销毁, 目标, [new Error(`读 MinIO 响应体超时（${timeoutMs}ms）`)])
          }
          abortSignal.addEventListener("abort", 停读, { once: true })
          try {
            return await body.transformToByteArray()
          } finally {
            abortSignal.removeEventListener("abort", 停读)
          }
        }),
      ),

    /**
     * 列出**本项目**的全部对象键，**剥掉前缀**（`minio.md` §3：窄接口的入参出参都不带前缀）。
     *
     * ⚠️ **必须把分页走完**：`ListObjectsV2` 一次最多回 1000 条，超出时置 `IsTruncated`
     * 并给 `NextContinuationToken`。只发一次请求的写法**在小项目上永远绿**，项目文件过千就
     * 静默少列——而归档（T013）正是拿这份清单去传文件的，「少列一条」= **少备份一个文件**，
     * 且不报错。这类「小数据下测不出来」的缺陷是本项目最想拦的一种（`#002-01`）。
     *
     * ⚠️ 超时是**每页各拿一次**（`withTimeout` 在循环体内，不是整轮共用一个）：好处是「一页慢」
     * 不牵连别的页；代价是整轮的上界成了**「页数 × `timeoutMs`」**——对象越多，`list()` 的
     * 合法耗时就越长（每页 1000 个对象）。这**是有界**的（不是 X4-1 那种无限挂起），所以不改；
     * 写在这里只为让这个上界是**已知**的，而不是哪天被当成 bug 重新发现一遍。
     */
    list: async () => {
      const keys: string[] = []
      let token: string | undefined
      do {
        const response = await withTimeout((abortSignal) =>
          client.send(
            new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }),
            { abortSignal },
          ),
        )
        for (const item of response.Contents ?? []) {
          if (item.Key !== undefined) keys.push(item.Key.slice(prefix.length))
        }
        token = response.IsTruncated === true ? response.NextContinuationToken : undefined
      } while (token !== undefined)
      return keys
    },

    delete: async ({ path }) => {
      await withTimeout((abortSignal) =>
        client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), { abortSignal }),
      )
    },
  }
}
