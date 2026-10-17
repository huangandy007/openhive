export * as Minio from "./minio"

import { Readable } from "node:stream"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"

/**
 * MinIO 客户端（005 T011 / FR-007 / `minio.md` §1 §3）。
 *
 * ## 它是什么、不是什么
 *
 * 一个**窄接口**（`minio.md` §3）：`put / get / head / list / delete` 五个动作，
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

/** 对象键的前两段：`{userId}/{projectId}/`；给了 `namespace` 就是 `{userId}/{namespace}/{projectId}/`。 */
export interface Scope {
  readonly userId: string
  readonly projectId: string
  /**
   * 中间多插一段（文件级备份快照用 `_openhive-backups`）。
   *
   * 为什么要它：归档镜像写 `{userId}/{projectId}/`，而备份快照是**另一件事**——
   * 两者的清单必须互不可见，否则归档收敛（`backupAll` 那条 `wanted`）会把快照对象删掉。
   */
  readonly namespace?: string
}

/** 一条对象。`path` 相对**store 前缀**，`lastModified` 是毫秒时间戳。 */
export interface Entry {
  readonly path: string
  readonly size: number
  readonly lastModified: number
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
  /**
   * 可选日志器，原样交给 `S3Client`。
   *
   * 为什么要有：SDK 的 retry middleware 在**流式请求**失败时会 `warn`
   * （`An error was encountered in a non-retryable streaming request.`），
   * 而它的默认 logger 是 NoOp ⇒ 那句话**退到 `console`**（`@smithy/core` 的
   * `retryMiddleware` 里写死的分支）。测试要干净输出时，只给那条用例传静默器；
   * **产品里不全局关**——生产上那行 warn 是有用的线索。
   */
  readonly logger?: S3ClientConfig["logger"]
}

export interface Interface {
  readonly put: (input: { readonly path: string; readonly body: Uint8Array }) => Promise<void>
  readonly head: (input: { readonly path: string }) => Promise<Entry | undefined>
  readonly get: (input: { readonly path: string }) => Promise<Uint8Array | undefined>
  readonly list: (input?: { readonly prefix?: string }) => Promise<readonly Entry[]>
  readonly delete: (input: { readonly path: string }) => Promise<void>
  readonly putStream: (input: {
    readonly path: string
    readonly body: AsyncIterable<Uint8Array>
    readonly size: number
    readonly onProgress?: (bytes: number) => void
    readonly idleTimeoutMs?: number
  }) => Promise<void>
  readonly getStream: (input: {
    readonly path: string
    readonly onProgress?: (bytes: number) => void
    readonly idleTimeoutMs?: number
  }) => Promise<AsyncIterable<Uint8Array> | undefined>
}

/** 流式传输的默认空闲超时（毫秒）——`idleTimeoutMs` 不给时用它。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000

/** 流式传输在 `idleTimeoutMs` 内没有新字节。 */
export class StreamTimeoutError extends Error {
  override readonly name = "StreamTimeoutError"
}

/** 等 `promise`，但超过 `ms` 没有结果就算「卡住」。 */
async function withIdle<T>(promise: Promise<T>, ms: number, onStall: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const 超时 = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onStall()
      reject(new StreamTimeoutError(`流式传输 ${ms}ms 没有新数据`))
    }, ms)
  })
  try {
    return await Promise.race([promise, 超时])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `response.Body` 的静态类型是 SDK 的联合（Node 下 `IncomingMessage`、浏览器下 `Blob`），
 * 只有前者能按异步流读——**先问再读**，不用 `as` 硬转（理由同 `get` 里那段 `Reflect.get`）。
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

/**
 * 给一个异步源套空闲超时；卡住时抛 `StreamTimeoutError`。
 *
 * ⚠️ 这里**不负责**掐断外呼：`iterator.return()` 只收上游，而真正让 SDK 的
 * in-flight 请求 settle 的是调用方在 `catch` 里的 `AbortController.abort()`
 * （见 `putStream` 里那段实测说明）。两件事分开，是因为**非超时的源错误**
 * 也走同一条 abort——把它挂在这里的「超时」分支上就漏了那一半。
 */
async function* idleGuarded(source: AsyncIterable<Uint8Array>, idleMs: number): AsyncGenerator<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]()
  let stalled = false
  try {
    while (true) {
      const next = await withIdle(iterator.next(), idleMs, () => {
        stalled = true
      })
      if (next.done) return
      yield next.value
    }
  } finally {
    /**
     * ⚠️ 卡住时**不能 `await` `return()`**：async generator 停在 `await` 上时，`return()`
     * 返回的 promise 要等那个 `await` 结束才 settle（2026-10-18 实测：`Promise.race` 300ms
     * 仍读到 `return still pending`）⇒ 真去 await 就等于把正要抛出的 `StreamTimeoutError`
     * 一起挂死，`putStream` 又变成无限期挂起（005 X4-1 的同一个症状）。
     * 所以卡住那一路只发不收（`void`）；正常收尾仍 await，让上游的清理跑完。
     * 卡住路径上只在这里收一次——定时器回调里再收一次是重复动作（008 T2 修复轮 1）。
     */
    if (stalled) void iterator.return?.()
    else await iterator.return?.()
  }
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
  if (value.includes("\u0000")) throw new Error(`对象键的${label}不能含 NUL：${JSON.stringify(value)}`)
  const segments = value.split("/")
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`对象键的${label}不能含空段或尾分隔符：${JSON.stringify(value)}`)
  }
  if (segments.some((segment) => segment === ".")) {
    throw new Error(`对象键的${label}不能含「.」段：${JSON.stringify(value)}`)
  }
}

/**
 * `404 NoSuchKey` ⇒ `undefined`；**其余一律上抛**。`extraNames` 是**逐调用方**的补充
 * （今天只有 `head` 用它认 `NotFound`，见下）。
 *
 * 默认只认 `NoSuchKey` 是对的，认「凡是 404」是错的：桶名写错时 S3 回的是 `NoSuchBucket`（也是 404），
 * 而那**不是**「这个文件没备份过」，是**配置错了**。把两者并成一个 `undefined`，用户会看到
 * 「没备份过」而不是「桶没了」——静默，且指向完全相反的处理方向。
 * `GetObject` 的 404 带 XML body，SDK 把 `<Code>` 放进 `error.name`，所以 `NoSuchKey` 是可区分的
 * （测试里那条 403 与这条 404 各钉一次）。
 *
 * ⚠️ **`head` 是已知的例外**（008 T1 审查实测）：HEAD 响应按 HTTP 规范不带 body，SDK 读不到
 * `<Code>` ⇒ 任何 404 的 `error.name` 都是 `NotFound` ⇒ **missing key 与 missing bucket 不可区分**。
 * 所以只有 `head` 额外认 `NotFound`，它对两者都回 `undefined`；**不能**把 `NotFound` 挪进默认集合，
 * 否则 `get` 会把「反代 / 网关裸 404」也吞成「没备份过」。配置错误由 `list` / `put` 以显式错误暴露。
 */
async function notFoundToUndefined<T>(
  action: () => Promise<T>,
  extraNames: readonly string[] = [],
): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof Error && (error.name === "NoSuchKey" || extraNames.includes(error.name))) return undefined
    throw error
  }
}

export function makeStore(config: Config): Interface {
  assertSafeSegment("userId", config.scope.userId)
  if (config.scope.namespace !== undefined) assertSafeSegment("namespace", config.scope.namespace)
  assertSafeSegment("projectId", config.scope.projectId)

  const client = new S3Client({
    endpoint: config.endpoint,
    // MinIO 不看 region，但 SDK 要求给一个；给谁都一样，给个不会有人误读的
    region: "us-east-1",
    // MinIO 是 path-style（桶在路径第一段，不是 `<bucket>.host` 子域）——
    // 不开这个，SDK 会把请求打到 `openhive.127.0.0.1` 这种不存在的域名上
    forcePathStyle: true,
    credentials: config.credentials,
    /**
     * ⚠️ **流式 body 不要 SDK 自动加校验和**（008 T2 实测）：
     * SDK 3.933 的默认（`WHEN_SUPPORTED`）对**流** body 会套一层 **aws-chunked**
     * （`<len>\r\n<chunk>\r\n…0\r\nx-amz-checksum-crc32:…`）——发到线上的就不是调用方给的
     * 那几个字节了，而本模块的契约是「`putStream` 把源原样发出去」（夹具也只能按原样收）。
     * 真 S3 / MinIO 认这层编码，但假端点不认 ⇒ 它会把 framing 当正文收下，且**不报错**。
     * 内网 MinIO 不要求 PutObject 带校验和；需要时调用方自己给 `ChecksumAlgorithm`。
     */
    requestChecksumCalculation: "WHEN_REQUIRED",
    logger: config.logger,
  })

  const base =
    config.scope.namespace === undefined
      ? `${config.scope.userId}/${config.scope.projectId}/`
      : `${config.scope.userId}/${config.scope.namespace}/${config.scope.projectId}/`
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
  const withTimeout = async <Out,>(
    run: (signal: AbortSignal) => Promise<Out>,
    limitMs = timeoutMs,
  ): Promise<Out> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limitMs)
    try {
      return await run(controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 唯一的键拼装点：**每个动作都从这里过**，所以边界只有一处（`#004-01`）。 */
  const keyOf = (path: string) => {
    assertSafeSegment("路径", path)
    return `${base}${path}`
  }

  return {
    put: async ({ path, body }) => {
      await withTimeout((abortSignal) =>
        client.send(new PutObjectCommand({ Bucket: config.bucket, Key: keyOf(path), Body: body }), { abortSignal }),
      )
    },

    /**
     * 流式上传：`Body` 是一条异步源，`ContentLength` 由调用方给（备份时就是文件的 `stat.size`）。
     *
     * ⚠️ **不引入 `@aws-sdk/lib-storage`**（`Upload`）：它会按 5 MB 分片走 multipart，
     * 而 `fake-s3` 不支持分片上传（本机没有真 MinIO，见文件头）⇒ 那条路一行都验不到。
     * 单次 `PutObject` ＋ 文件流 ＋ `ContentLength` 对**内网 MinIO** 是够的，且假端点能真收字节。
     *
     * ⚠️ **总上限不是 `timeoutMs`**：一次 5 GB 的上传本来就该跑很久，用 30 秒会把它当场掐死。
     * 6 小时只是「别无限挂」的兜底；真正判「卡住」的是下面的空闲超时（`idleTimeoutMs`）。
     */
    putStream: async ({ path, body, size, onProgress, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS }) => {
      let sent = 0
      /**
       * 源那一侧的错——**任何**错（空闲超时、磁盘 EIO、`onProgress` 自己抛……），不只是超时。
       * 包一层对象是为了让收尾的 `throw` 分得清「留住过」与「留住的值恰好是 `undefined`」。
       */
      let 源错: { readonly error: unknown } | undefined
      /**
       * ⚠️ 源一出错就**主动 abort 这次外呼**——不能只靠「body 流抛错」让 SDK 自己失败：
       * 2026-10-18 实测（Bun 1.4.3），同一条路径在 `bun <脚本>` 下 `client.send` 会 reject，
       * 而在 `bun test` 下它**一直 pending**（源已抛错、请求永不 settle）⇒ 又变成无限期挂起。
       * abort 是 SDK 一定听得到的信号，两个运行器下都能收敛。
       *
       * 只挂在超时分支上是不够的（修复轮 1）：磁盘坏了 / `onProgress` 抛错时源同样已经死了，
       * 不 abort 就一样挂到 6 小时兜底，而最终抛哪个错还取决于微任务谁先跑。
       */
      const 中断 = new AbortController()
      async function* 计数(): AsyncGenerator<Uint8Array> {
        try {
          for await (const chunk of idleGuarded(body, idleTimeoutMs)) {
            sent += chunk.byteLength
            onProgress?.(sent)
            yield chunk
          }
        } catch (error) {
          /**
           * ⚠️ 顺序不能换：**先留住起因，再 abort，再抛**。
           * abort 会让 `client.send` 立刻以 `AbortError` 失败，外层 `catch` 随后只看得见
           * 那个 `AbortError`——起因不先存下，「为什么断的」当场丢失。
           */
          源错 = { error }
          中断.abort()
          throw error
        }
      }
      /**
       * ⚠️ 必须挂一只（哪怕是空的）`error` 监听器：`Readable.from` 在源抛错时 emit `error`，
       * 而这一拍没有别的监听者 ⇒ Node 把 EventEmitter 的 `error` 升级成 **uncaughtException**
       * （2026-10-18 实测：Bun 1.4.3 下整条用例红，而 `putStream` 的 rejection 其实是对的）。
       * 错误本身仍由 `client.send` rejection ＋ 下面的 `catch` 交回调用方——这里只是不让它
       * **额外**炸一次进程。
       */
      const 流 = Readable.from(计数())
      流.on("error", () => {})
      try {
        await withTimeout(
          (abortSignal) =>
            client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: keyOf(path),
                Body: 流,
                ContentLength: size,
              }),
              { abortSignal: AbortSignal.any([abortSignal, 中断.signal]) },
            ),
          6 * 60 * 60 * 1000,
        )
      } catch (error) {
        /**
         * SDK 会把流里的错误换成本名 `TimeoutError` 的壳（"An error was encountered in a
         * non-retryable streaming request."），我们自己的 abort 又会换来一个 `AbortError`
         * ——不还原的话，调用方分不出「源出了什么错」与「网络 / 凭据 / 我们自己掐的」，
         * 而它们的处置完全不同（源错要重读磁盘或改调用方代码，网络错要看端点）。
         * 接口约定是抛源错误本体，所以只要源先出过错，就按**起因**还原。
         */
        if (源错 !== undefined) throw 源错.error
        throw error
      }
    },

    /**
     * 流式下载：头照常吃 `timeoutMs`；body 由调用方按需读，**读的每一步**吃空闲超时。
     *
     * 与 `get` 的差别：`get` 在回调里把 body 一次读完并套 `timeoutMs`（那是「取回一个小对象」）；
     * 这里返回流，不替调用方收完——但「一步不动」仍要失败，否则 MinIO 半死时消费方无限期挂着。
     */
    getStream: ({ path, onProgress, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS }) =>
      notFoundToUndefined(async () => {
        const response = await withTimeout((abortSignal) =>
          client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), { abortSignal }),
        )
        const body = response.Body
        if (body === undefined) throw new Error(`MinIO 对 ${JSON.stringify(path)} 回了空 body`)
        if (!isAsyncIterable(body)) throw new Error(`MinIO 对 ${JSON.stringify(path)} 回了不可流的 body`)
        let received = 0
        async function* 计数(源: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
          for await (const chunk of idleGuarded(源, idleTimeoutMs)) {
            received += chunk.byteLength
            onProgress?.(received)
            yield chunk
          }
        }
        return 计数(body)
      }),

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
     * `HEAD` 一条对象：在 ⇒ `Entry`，不在 ⇒ `undefined`。
     *
     * ⚠️ **缺键与缺桶都回 `undefined`**（008 T1 审查实测）：HEAD 无 body，SDK 认不出
     * `NoSuchKey` / `NoSuchBucket`，404 的 `error.name` 一律是 `NotFound` ⇒ 两者**不可区分**。
     * 这是 `head` 已知的代价；配置错误由 `list` / `put` 以显式错误暴露（见 `notFoundToUndefined`）。
     *
     * 备份的增量判断要「这条对象的 size / lastModified 是什么」，而**不是**它的字节——
     * 用 `get` 会把整个对象拉下来只为了看几个数字。
     */
    head: ({ path }) =>
      notFoundToUndefined(async () => {
        const response = await withTimeout((abortSignal) =>
          client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), { abortSignal }),
        )
        return {
          path,
          size: response.ContentLength ?? 0,
          lastModified: response.LastModified?.getTime() ?? 0,
        }
      }, ["NotFound"]),

    /**
     * 列出**本项目**的全部对象，**剥掉前缀**（`minio.md` §3：窄接口的入参出参都不带前缀）。
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
    list: async (input) => {
      const prefix = input?.prefix === undefined ? base : `${base}${input.prefix}`
      const entries: Entry[] = []
      let token: string | undefined
      do {
        const response = await withTimeout((abortSignal) =>
          client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }), {
            abortSignal,
          }),
        )
        for (const item of response.Contents ?? []) {
          if (item.Key === undefined) continue
          entries.push({
            path: item.Key.slice(base.length),
            size: item.Size ?? 0,
            lastModified: item.LastModified?.getTime() ?? 0,
          })
        }
        token = response.IsTruncated === true ? response.NextContinuationToken : undefined
      } while (token !== undefined)
      return entries
    },

    delete: async ({ path }) => {
      await withTimeout((abortSignal) =>
        client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), { abortSignal }),
      )
    },
  }
}
