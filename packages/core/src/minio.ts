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
 * 观测面是 `packages/core/test/fixture/fake-s3.ts` 那个真 HTTP 端点。
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
}

export interface Interface {
  readonly put: (input: { readonly path: string; readonly body: Uint8Array }) => Promise<void>
  readonly get: (input: { readonly path: string }) => Promise<Uint8Array | undefined>
  readonly list: () => Promise<readonly string[]>
  readonly delete: (input: { readonly path: string }) => Promise<void>
}

/** win32 的盘符（`C:`），只认开头——`a:C` 这种中段出现的不算。 */
const DRIVE = /^[A-Za-z]:/

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

  /** 唯一的键拼装点：**每个动作都从这里过**，所以边界只有一处（`#004-01`）。 */
  const keyOf = (path: string) => {
    assertSafeSegment("路径", path)
    return `${prefix}${path}`
  }

  return {
    put: async ({ path, body }) => {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: keyOf(path), Body: body }))
    },

    get: ({ path }) =>
      notFoundToUndefined(async () => {
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }))
        if (response.Body === undefined) throw new Error(`MinIO 对 ${JSON.stringify(path)} 回了空 body`)
        return response.Body.transformToByteArray()
      }),

    /**
     * 列出**本项目**的全部对象键，**剥掉前缀**（`minio.md` §3：窄接口的入参出参都不带前缀）。
     *
     * ⚠️ **必须把分页走完**：`ListObjectsV2` 一次最多回 1000 条，超出时置 `IsTruncated`
     * 并给 `NextContinuationToken`。只发一次请求的写法**在小项目上永远绿**，项目文件过千就
     * 静默少列——而归档（T013）正是拿这份清单去传文件的，「少列一条」= **少备份一个文件**，
     * 且不报错。这类「小数据下测不出来」的缺陷是本项目最想拦的一种（`#002-01`）。
     */
    list: async () => {
      const keys: string[] = []
      let token: string | undefined
      do {
        const response = await client.send(
          new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }),
        )
        for (const item of response.Contents ?? []) {
          if (item.Key !== undefined) keys.push(item.Key.slice(prefix.length))
        }
        token = response.IsTruncated === true ? response.NextContinuationToken : undefined
      } while (token !== undefined)
      return keys
    },

    delete: async ({ path }) => {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }))
    },
  }
}
