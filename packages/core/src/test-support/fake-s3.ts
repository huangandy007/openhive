/**
 * ⚠️ **本文件住在 `src/` 而不是 `test/`，是刻意的**（005 T013 从 `test/fixture/` 移入）：
 * `packages/opencode` 的归档测试也要用这个端点，而本包的 `exports` 是 `"./*": "./src/*.ts"`
 * ⇒ 放在 `test/` 下**别的包 import 不到**（T013 实测：`@opencode-ai/core/test/fixture/fake-s3`
 * 解析成 `./src/test/fixture/fake-s3.ts`，不存在）。处置与 `packages/auth/src/test-support.ts`
 * 同因同形——那份文件头写着同一句话，是本仓「跨包夹具放 `src/`」的既有先例。
 *
 * **约定：只有 `*.test.ts` 才 import 本模块。**
 * ⚠️ 这是一条**没有门守着的约定**（2026-10-06 三席评审 S1-06 纠的：原文写「MUST NOT」，读起来像
 * 有东西在拦）：文件搬进 `src/` 之后它进了生产包的**编译面**，而谁在生产代码里 import 它，
 * typecheck / lint / 全部测试**一个都不会红**。要把它变成有门的约束得加一条 lint 的
 * `no-restricted-imports`（或一条「生产文件不得出现该 import」的断言）——**本轮没做**，
 * 已挂 `005/state.md` 的 T013 缺口表（`#004-03`：说「有 X 钉住」必须点名那条测试）。
 */

/**
 * 一个够用的**假 S3 端点**（005 T011 的观测面）。
 *
 * ## 为什么不是「注入替身」
 *
 * `minio.md` §3 说窄接口「测试注入替身」——那是给 **T012 / T013** 用的：它们的被测对象是
 * 归档流程，把 MinIO 换成替身是**边界替身**。但 T011 **自己**的产物正是那个 S3 实装，
 * 若也用替身，被测对象就消失了（`LEARNINGS #002-02`：「如果一条测试没有真正执行被测的
 * 那条路径，它不是测试，是缺口」）。
 *
 * 本机没有 MinIO 可连（`minio.md` 文件头），但**可以有**一个够用的 S3 端点：
 * `Bun.serve({ port: 0 })` 起一个真 HTTP 服务，让**真的 `@aws-sdk/client-s3`**
 * 真的签名、真的发请求。于是「键有没有拼进 URL」「用的是不是 PUT」「body 到没到」
 * 「404 映射成什么」全部**可断言**——这些正是实装里唯一可能写错的地方。
 *
 * 这与 `#002-05` 是同一条路数（PGlite 让生产驱动真连上），连残差也一样：
 * **它不闭合「真实 MinIO 的语义」**——桶策略、STS、`${aws:username}` 一个都没验，
 * 那些在 D-13（部署时实测）。本夹具只回答「我们发出去的请求长什么样」。
 *
 * ## 端口传 0
 *
 * 让 OS 挑空闲端口（`#002-05` 的要点 ①）：`bun test` 并行跑用例时不会互抢。
 *
 * ## 为什么绑 `localhost` 而不是 `127.0.0.1`
 *
 * 这不是随手写的：**端点的 host 是 IP 字面量时，SDK 会自己退回 path-style**
 * （`openhive.127.0.0.1` 不是合法主机名），于是实装里那句 `forcePathStyle: true`
 * **一行都测不到**——2026-10-06 变异实测：把 `true` 改成 `false`，21 条**全绿**。
 * 而它在真环境里是要命的（MinIO 在 `minio.internal:9000`，不开就会打到
 * `openhive.minio.internal`）。换成主机名 `localhost` 后，`forcePathStyle: false`
 * 会让 SDK 拼出 `openhive.localhost` —— win32 实测 **ENOTFOUND**，变异立刻变红；
 * 万一某台机器上 `*.localhost` 被通配解析，请求也会带着桶名当主机名到达，
 * 落到「桶名不是 openhive」那条 404 上，**两种世界都是红**。
 *
 * 服务端也绑 `localhost`（不绑 `0.0.0.0`）：免得在某些系统上 `localhost` 先解析成
 * `::1` 而服务只听了 IPv4。
 */

/** 一次被打到的请求。断言就写在这些字段上，不写实现细节。 */
export interface Recorded {
  readonly method: string
  /** URL 的 pathname，**编码态**（`/openhive/007/a%20b.txt`）——要看编码对不对就看它。 */
  readonly path: string
  readonly query: URLSearchParams
  /** forcePathStyle ⇒ 第一段是桶名。 */
  readonly bucket: string
  /** 去掉桶名之后的**对象键**（已解码，形如 `007/p-42/a b.txt`）。 */
  readonly key: string
  /** 请求体。`GET` / `DELETE` 恒为空。 */
  readonly body: Uint8Array
}

export interface FakeS3 {
  /** 交给 `S3Client` 的 `endpoint`（`http://localhost:<随机端口>`，用主机名而非 IP 的理由见文件头）。 */
  readonly endpoint: string
  readonly bucket: string
  /** 按到达顺序记下的全部请求。 */
  readonly requests: readonly Recorded[]
  /** 直接塞一个对象进去——`get` / `list` 的起点。 */
  seed(key: string, body: string): void
  /** 当前存在哪些键（给「delete 真的删了」当对照）。 */
  keys(): readonly string[]
  /**
   * 让**之后**的请求一律返回这个状态码。
   *
   * 给「404 是一种正常答案，而 403 / 500 不是」这条判据用：实装若把所有错误都吞成
   * `undefined`，用户看到的是「没备份过」而不是「凭据错了」——**静默**，且方向危险。
   * 传 `undefined` 恢复（同时把 `failOn` 的条件一并清掉）。
   */
  failWith(status: number | undefined): void
  /**
   * **从第一个匹配 `when` 的请求起**一律回 `status`，之前的一律照常放过。
   *
   * `failWith` 只答得了「第一次外呼就失败」；而「**备份没做完之前不许删本地**」这条顺序判据
   * 需要「前一半成功、后一半失败」（005 T013）：那时才看得出实装是「全员传完再全员删」
   * 还是「传一个删一个」——后者会在第二个成员上传失败时，让第一个成员的沙箱**已经没了**，
   * 而项目并**没有**被标成已归档（`archived_at` 为空）。
   *
   * ## ⚠️ 条件写在**「哪个键」上，不是「第几个请求」**（T013 变异实测改的）
   *
   * 初版是 `failAfter(count, status)`——「放过前 `count` 个」。它有两个坑，且都不报错：
   * ① 计数用的是**服务端累计的 `requests.length`**，而本夹具是**文件级共享**的
   *    （`bun test` 跑完同文件的前若干用例后，水位早已上千）⇒ `failAfter(1, …)` 的实际含义是
   *    「**从这个请求起全失败**」，与「第一次外呼就失败」成了同一件事；
   * ② 「一个成员要传几个对象」不是一个**测试该去数**的数——沙箱项目目录里必然含 `.git`
   *    （T018 的 `git init`，本机实测 19 个文件），数它会随平台/版本漂。
   * 改成按**键**判定后，用例说的是它的本意：「**乙的第一个对象**起就失败」——而乙的键在甲的
   * 全部键之后（`backupAll` 按成员逐个传完），于是「前一半成功、后一半失败」是**由构造保证的**。
   *
   * 2026-10-06 实测（T013 的 M2 变异：把「全员传完再删」改成「传一个删一个」）：旧夹具下**全绿**
   * ——判据没测到它要测的东西；换成按键判定后 M2 **恰红**那一条。
   */
  failOn(status: number, when: (request: Recorded) => boolean): void
  stop(): void
}

const XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/"

/** `&` `<` `>` 在 XML 文本里必须转义——键里出现它们时（测试会用到）不转义会产出坏 XML。 */
function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function errorXml(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`
}

export function startFakeS3(options: { bucket?: string; pageSize?: number } = {}): FakeS3 {
  const bucket = options.bucket ?? "openhive"
  /**
   * 一次 `ListObjectsV2` 最多回几条。**这是服务器的行为**——客户端不传 `max-keys`，
   * 拿不到多少条由服务端说了算，所以「分页」这件事只能在这里造出来。
   * 真 S3 / MinIO 的默认是 1000；调小是为了让「过千才出错」的缺陷在三条数据上就现形。
   */
  const pageSize = options.pageSize ?? 1000
  // ⚠️ 泛型参数写死成 `ArrayBuffer`（不是默认的 `ArrayBufferLike`）：`Response` 的
  // `BodyInit` 在当前 lib 下**不收**兜底的 `ArrayBufferLike`。这是 T013 把本文件从 `test/`
  // 搬进 `src/` 之后才显形的——`packages/opencode` 的 program 会连带 typecheck 它，
  // 而两边的 lib 面不一样（core 自己那份不报）。语义没变，只是把「这个数组一定在普通
  // ArrayBuffer 上」写明。
  const objects = new Map<string, Uint8Array<ArrayBuffer>>()
  const requests: Recorded[] = []
  let failure: number | undefined
  /** 失败态的条件（`failWith` 恒为 `undefined` ⇒ 之后的每个请求都失败）。 */
  let shouldFail: ((request: Recorded) => boolean) | undefined

  const server = Bun.serve({
    port: 0,
    hostname: "localhost",
    async fetch(request) {
      const url = new URL(request.url)
      const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
      const requestBucket = decodeURIComponent(segments[0] ?? "")
      const key = segments.slice(1).map(decodeURIComponent).join("/")
      const body = request.method === "PUT" ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array()

      const record: Recorded = { method: request.method, path: url.pathname, query: url.searchParams, bucket: requestBucket, key, body }
      requests.push(record)

      // ⚠️ 失败态**记进请求表之后**才判：失败的请求也要留下痕迹（「外呼到没到」本身是判据）。
      if (failure !== undefined && (shouldFail === undefined || shouldFail(record))) {
        return new Response(errorXml("InternalError", "假 S3 被要求报错"), {
          status: failure,
          headers: { "content-type": "application/xml" },
        })
      }

      if (requestBucket !== bucket) {
        return new Response(errorXml("NoSuchBucket", `bucket ${requestBucket} 不存在`), {
          status: 404,
          headers: { "content-type": "application/xml" },
        })
      }

      // ListObjectsV2：pathname 只有桶名（key 为空）＋ `list-type=2` 查询串
      if (request.method === "GET" && key === "" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? ""
        // 续传令牌在真 S3 里是不透明串；这里用「上一页最后一个键」代替——形状够用，
        // 因为被测的是**客户端有没有把令牌带回来、有没有继续翻**，不是令牌怎么编的
        const after = url.searchParams.get("continuation-token") ?? ""
        const matched = [...objects.keys()]
          .filter((candidate) => candidate.startsWith(prefix))
          .sort()
          .filter((candidate) => candidate > after)
        const page = matched.slice(0, pageSize)
        const truncated = matched.length > page.length
        const next = truncated ? page[page.length - 1] : undefined
        const contents = page
          .map(
            (candidate) =>
              `<Contents><Key>${xmlEscape(candidate)}</Key><Size>${objects.get(candidate)?.length ?? 0}</Size>` +
              `<LastModified>2026-10-06T00:00:00.000Z</LastModified><ETag>"fake"</ETag>` +
              `<StorageClass>STANDARD</StorageClass></Contents>`,
          )
          .join("")
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="${XMLNS}">` +
            `<Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix>` +
            `<KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys>` +
            `<IsTruncated>${truncated}</IsTruncated>` +
            (next === undefined ? "" : `<NextContinuationToken>${xmlEscape(next)}</NextContinuationToken>`) +
            `${contents}</ListBucketResult>`,
          { headers: { "content-type": "application/xml" } },
        )
      }

      switch (request.method) {
        case "PUT": {
          objects.set(key, body)
          return new Response(null, { status: 200, headers: { etag: '"fake"' } })
        }
        case "GET": {
          const value = objects.get(key)
          if (value === undefined) {
            return new Response(errorXml("NoSuchKey", "The specified key does not exist."), {
              status: 404,
              headers: { "content-type": "application/xml" },
            })
          }
          return new Response(value, { status: 200 })
        }
        case "DELETE": {
          // 真 S3 删不存在的键也回 204（幂等）——夹具照抄，免得用例被一个不真的差异骗到
          objects.delete(key)
          return new Response(null, { status: 204 })
        }
        default: {
          return new Response(errorXml("NotImplemented", request.method), {
            status: 501,
            headers: { "content-type": "application/xml" },
          })
        }
      }
    },
  })

  return {
    endpoint: `http://localhost:${server.port}`,
    bucket,
    requests,
    seed: (key, value) => void objects.set(key, new TextEncoder().encode(value)),
    keys: () => [...objects.keys()].sort(),
    failWith: (status) => {
      failure = status
      shouldFail = undefined
    },
    failOn: (status, when) => {
      failure = status
      shouldFail = when
    },
    stop: () => void server.stop(true),
  }
}
