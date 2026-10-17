# 文件级备份快照（备份到 MinIO / 从 MinIO 拉回）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把项目文件 Tab 里长期灰色的「备份到 MinIO」「从 MinIO 拉回」做成可用功能：按选中项手动拍快照、拖拽即备份、按恢复点预览并三选一冲突处理、有变自动拍快照、分级保留与容量告警。

**Architecture:** 在 fork 自有目录 `packages/opencode/src/server/openhive/` 内新增一套「快照存储 + 任务执行 + HTTP 出口」，与归档镜像严格分命名空间；存储层（`packages/core/src/minio.ts`）只做**加**（新方法、可选参数），既有四个方法语义不变。前端沿用「接入缝 + `ProjectData` 窄接口」的既有模式，新增恢复对话框与进度窄条。

**Tech Stack:** Bun monorepo、Effect 4.0.0-beta.83（`HttpRouter` / `ConfigService`）、`@aws-sdk/client-s3` 3.933.0、Drizzle／裸 SQL 迁移（`packages/auth`）、SolidJS 1.9.10、Tailwind v4、Playwright（真栈）。

**Spec:** `docs/superpowers/specs/2026-10-18-file-backup-snapshot-design.md`

## Global Constraints

- **最小化与官方合并冲突**：所有新代码落在 fork 自有文件；对上游文件的改动只允许「加一行 / 加一个可选字段」，并带 `【保留的定制 · 同步上游时不要丢】` 注释。
- **每次改动单独提交**，提交信息写清「这是要保留的定制」。
- **根目录禁止 `bun test`**（`test` script 明确 `exit 1`）；测试在受影响 package 内跑。
- **`bun install` 后必须 `git diff --stat bun.lock`**，被镜像源污染就 `git checkout -- bun.lock`。
- **凭据不进库**；MinIO 五个 `OPENHIVE_MINIO_*` 变量**整份配齐才算配**，缺一项回 503。
- **用户间严格隔离**：备份前缀恒为 `{userId}/...`，不做跨用户去重；owner 不得读成员备份。
- **路径安全**：拒绝 `..`、绝对路径、盘符、反斜杠、NUL、空段；符号链接不跟随。
- **备份前缀不开桶版本化**；**超限只暂停自动备份，绝不自动删旧快照**。
- 所有面向用户的文案用**中文**；代码注释沿用仓库既有密度与口吻（中文、讲清「为什么」）。
- 每个任务收尾跑：`cd packages/core && bun test` 或 `cd packages/opencode && bun test` 或 `cd packages/app && bun test <受影响文件>`，外加 `bun run typecheck`（仓库根）。

---

## 文件结构（新增与修改）

**新增（core）**

| 文件 | 职责 |
|---|---|
| `packages/core/src/test-support/fake-s3.ts`（改） | 加 HEAD、可按对象设 `lastModified` |

**新增（opencode / 服务端）**

| 文件 | 职责 |
|---|---|
| `packages/opencode/src/server/openhive/backup-model.ts` | 常量、类型（manifest / state / job / preview） |
| `packages/opencode/src/server/openhive/backup-rules.ts` | 纯函数：路径守卫、排除、快照 id、保留分桶、manifest 校验、保留两者命名 |
| `packages/opencode/src/server/openhive/backup-store.ts` | MinIO 上的 manifest / state / blob 读写 |
| `packages/opencode/src/server/openhive/backup-jobs.ts` | 内存任务注册表 + 单飞 + 取消 + 10 分钟 TTL |
| `packages/opencode/src/server/openhive/backup-run.ts` | 扫描 / 哈希 / 上传 / 写清单 / 预览 / 恢复执行 |
| `packages/opencode/src/server/openhive/backup-auto.ts` | 活跃项目表、心跳、自动检测、保留、GC |
| `packages/opencode/src/server/openhive/backup.ts` | HTTP 路由（授权 + 参数校验 + 起任务） |
| `packages/auth/src/migrations/0007_project_backup_event.sql` | 审计表 |
| `packages/auth/src/migrations/0007_project_backup_event.down.sql` | 回滚 |
| `packages/auth/src/project-backup-event.ts` | 审计写入 helper |
| `packages/opencode/test/server/openhive-backup-rules.test.ts` | 纯函数测试 |
| `packages/opencode/test/server/openhive-backup-auto.test.ts` | 保留 / GC / 调度测试 |
| `packages/opencode/test/server/openhive-backup.test.ts` | HTTP 集成测试 |

**新增（app / 前端）**

| 文件 | 职责 |
|---|---|
| `packages/app/src/project/openhive-backup.ts` | 备份客户端（路径契约 + 三态读取） |
| `packages/app/src/project/backup-restore-dialog.tsx` | 恢复预览 + 三选一对话框 |
| `packages/app/src/project/backup-restore-dialog.test.tsx` | 对话框测试 |
| `packages/app/e2e/real-stack/backup-snapshot-real.spec.ts` | 真栈 e2e |

**修改**

| 文件 | 改什么 |
|---|---|
| `packages/core/src/minio.ts` | `Scope.namespace?`、`Entry`、`head`、`list({prefix})`、`putStream`、`getStream`、路径守卫补 NUL/`.`/空段 |
| `packages/core/test/minio.test.ts` | 新方法的断言；`list()` 返回值从 `string[]` 改 `Entry[]` |
| `packages/opencode/src/server/openhive/archive.ts` | 三处 `list()` 取 `entry.path`；`dropBackups` 清备份命名空间；`handleDelete` 删前收敛任务（409 不强行删） |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 加一段 `OpenhiveBackup.routes.pipe(...)` |
| `packages/app/src/project/minio-backups.ts` | 扩成恢复点 / 用量 / 任务状态 |
| `packages/app/src/project/minio-bar.tsx` | 进度 + 取消 + 用量 |
| `packages/app/src/project/minio-bar.test.tsx` | 跟随结构改造 |
| `packages/app/src/project/dual-file-tree.tsx` | 拖拽语义改为「原路径」、下树恢复点选择与删除、MinIO 行载荷 `minio:` |
| `packages/app/src/project/dual-file-tree.test.tsx` | 改写断言旧「拼路径」语义的用例 |
| `packages/app/src/project/project-data.ts` / `.test.ts` | 备份方法 + 绑定测试 |
| `packages/app/src/workspace/workspace-entry.tsx` / `.test.tsx` | 接线：心跳、状态轮询、备份 / 恢复 / 删除恢复点 |
| `packages/app/src/workspace/workspace-entry.test.tsx` | 假数据源补新方法 + 3 条接线用例 |

### 与 spec 的刻意偏差（必须先读）

1. **模块拆分（§14.1）**：spec 把服务端写成一个 `backup.ts`。本计划拆成 7 个文件。理由：单文件会到 2000+ 行，实施者无法一次握住上下文，评审也无法按「一个判据来源」切分提交（`writing-plans` 的 File Structure 一节要求按职责拆）。**对外的 HTTP 契约与 spec §10.1 逐字一致**，拆分只发生在模块内部。
2. **任务线上形状（§10.2）**：spec 把进度画成扁平的 `filesTotal / filesDone / bytesTotal / bytesDone`。本计划把它收进 `Job.progress` 一个对象（Task 3），因为「初始化为 0 → 每阶段整体上报」在两处业务（备份 / 恢复）里都按对象整体传递；客户端 `BackupJob`（Task 13）、`minio-bar` 的 `百分比()`（Task 14）、真栈夹具（Task 18）全部按 `job.progress.*` 读。**字段名与含义不变，只多了一层**。实施时以本计划为准，别照 spec 的扁平写法另起一份。
3. **`OPENHIVE_BACKUP_QUIESCE_TIMEOUT_MS`（§5.8 末条）**：spec 只写「有上限，超时则报错」，没给数字。计划默认 **30 秒**，并允许用这个 env 覆盖（走 Effect 配置源，与 `MinioConfig` 同款）。存在的理由是**可测**：删除测试要把上限压到 120ms 才能在不跑 30 秒的前提下钉住「409 且项目不动」那条分支。生产不配即 30 秒。

---

## 阶段 P1 · 存储层

### Task 1: MinIO 存储层新表面（namespace / Entry / head / list(prefix) / 路径守卫）

**Files:**
- Modify: `packages/core/src/minio.ts:30-97`（`Scope`、`Entry`、`Interface`、`assertSafeSegment`）
- Modify: `packages/core/src/minio.ts:159-257`（`keyOf`、`list`、新增 `head`）
- Modify: `packages/core/src/test-support/fake-s3.ts`
- Test: `packages/core/test/minio.test.ts`
- Modify: `packages/opencode/src/server/openhive/archive.ts:589, 712-720, 759-764`

**Interfaces:**
- Consumes: 无（本任务是第一个任务）。
- Produces:
  - `Minio.Scope { userId: string; projectId: string; namespace?: string }`
  - `Minio.Entry { path: string; size: number; lastModified: number }`
  - `Interface.head({ path }): Promise<Entry | undefined>`
  - `Interface.list(input?: { prefix?: string }): Promise<readonly Entry[]>`
  - `FakeS3.seed(key: string, body: string, lastModified?: string): void`

- [ ] **Step 1: 写会红的测试（`packages/core/test/minio.test.ts` 追加）**

先读文件头那套 harness（`凭据` / `开(scope)` / `第(n)` / `抛了` / `拒于门外`），在文件末尾追加：

```ts
test("namespace 把前缀插在 userId 与 projectId 之间", async () => {
  const s3 = startFakeS3()
  try {
    const store = Minio.makeStore({ ...凭据(s3), scope: { userId: "007", projectId: "p-42", namespace: "_openhive-backups" } })
    await store.put({ path: "manifests/a.json.gz", body: 编码("x") })
    expect(第(s3, 0).key).toBe("007/_openhive-backups/p-42/manifests/a.json.gz")
  } finally {
    s3.stop()
  }
})

test("head：在 ⇒ 回条目，不在 ⇒ undefined，403 照旧上抛", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    s3.seed("007/p-42/笔记/a.txt", "abc", "2026-10-18T01:02:03.000Z")
    expect(await store.head({ path: "笔记/a.txt" })).toEqual({
      path: "笔记/a.txt",
      size: 3,
      lastModified: Date.parse("2026-10-18T01:02:03.000Z"),
    })
    expect(await store.head({ path: "笔记/没有.txt" })).toBeUndefined()
    s3.failWith(403)
    await expect(store.head({ path: "笔记/a.txt" })).rejects.toThrow()
  } finally {
    s3.stop()
  }
})

test("list：默认列出全部并带 size/lastModified；给了 prefix 只列那一支且路径相对前缀根", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    s3.seed("007/p-42/a.txt", "aa", "2026-10-18T00:00:00.000Z")
    s3.seed("007/p-42/blobs/ab/abcdef", "bbb", "2026-10-18T02:00:00.000Z")
    s3.seed("007/p-42/manifests/m1.json.gz", "c", "2026-10-18T03:00:00.000Z")

    expect((await store.list()).map((entry) => entry.path)).toEqual([
      "a.txt",
      "blobs/ab/abcdef",
      "manifests/m1.json.gz",
    ])

    const blobs = await store.list({ prefix: "blobs/" })
    expect(blobs).toEqual([
      { path: "blobs/ab/abcdef", size: 3, lastModified: Date.parse("2026-10-18T02:00:00.000Z") },
    ])
  } finally {
    s3.stop()
  }
})

test("路径守卫补上 NUL、`.` 段与空段", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    for (const path of ["a\u0000b", "a/./b", "a//b", "./a", "a/"]) {
      await expect(store.put({ path, body: 编码("x") }), path).rejects.toThrow()
    }
    expect(s3.requests.length).toBe(0)
  } finally {
    s3.stop()
  }
})
```

并把既有 `list()` 的两条断言（`["a.txt", "子目录/b.txt"]` 与分页那条）改成 `.map((entry) => entry.path)`。

- [ ] **Step 2: 跑红**

Run: `cd packages/core && bun test test/minio.test.ts`
Expected: FAIL —— `head is not a function` / `list` 断言拿到 `[{…}]` 而不是字符串数组 / `namespace` 项前缀仍是 `007/p-42/`。

- [ ] **Step 3: 最小实现**

`packages/core/src/minio.ts`：

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

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

export interface Interface {
  readonly put: (input: { readonly path: string; readonly body: Uint8Array }) => Promise<void>
  readonly head: (input: { readonly path: string }) => Promise<Entry | undefined>
  readonly list: (input?: { readonly prefix?: string }) => Promise<readonly Entry[]>
  readonly delete: (input: { readonly path: string }) => Promise<void>
  // get / putStream / getStream 由 Task 2 追加
}
```

`assertSafeSegment` 追加三条：

```ts
  if (value.includes("\u0000")) throw new Error(`对象键的${label}不能含 NUL：${JSON.stringify(value)}`)
  const segments = value.split("/")
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`对象键的${label}不能含空段或尾分隔符：${JSON.stringify(value)}`)
  }
  if (segments.some((segment) => segment === ".")) {
    throw new Error(`对象键的${label}不能含「.」段：${JSON.stringify(value)}`)
  }
```

`makeStore` 内：

```ts
  assertSafeSegment("userId", config.scope.userId)
  if (config.scope.namespace !== undefined) assertSafeSegment("namespace", config.scope.namespace)
  assertSafeSegment("projectId", config.scope.projectId)

  const prefix =
    config.scope.namespace === undefined
      ? `${config.scope.userId}/${config.scope.projectId}/`
      : `${config.scope.userId}/${config.scope.namespace}/${config.scope.projectId}/`
```

`list` 改成：

```ts
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
```

（把原 `const prefix = ...` 改名 `base`；`keyOf` 继续用 `base`。）

`head`：

```ts
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
      }),
```

`notFoundToUndefined` 的判据补 `NotFound`（`HeadObject` 的 404 名字与 `GetObject` 不同；`NoSuchBucket` 仍是别的名字，照旧上抛）：

```ts
    if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) return undefined
```

`fake-s3.ts`：

```ts
  const objects = new Map<string, { readonly body: Uint8Array<ArrayBuffer>; readonly lastModified: string }>()
```

PUT 改为 `objects.set(key, { body, lastModified: new Date().toISOString() })`；GET 用 `objects.get(key)?.body`；`seed` 签名改为 `(key, value, lastModified = "2026-10-06T00:00:00.000Z")`；List 的 `LastModified` 取 `objects.get(candidate)?.lastModified`、`Size` 取 `.body.length`；switch 加：

```ts
        case "HEAD": {
          const value = objects.get(key)
          if (value === undefined) {
            return new Response(null, { status: 404 })
          }
          return new Response(null, {
            status: 200,
            headers: {
              "content-length": String(value.body.length),
              "last-modified": new Date(value.lastModified).toUTCString(),
            },
          })
        }
```

`keys()` 不变（`[...objects.keys()].sort()`）。

`archive.ts` 三处跟随：`dropBackups` 的 `for (const path of await store.list())` 改成 `for (const entry of await store.list()) await store.delete({ path: entry.path })`；`backupAll` 的收敛循环同改；`restoreAll` 的 `const paths = await store.list()` 改成 `const entries = await store.list()`、循环取 `entry.path`。

- [ ] **Step 4: 跑绿**

Run: `cd packages/core && bun test test/minio.test.ts`
Expected: PASS（原 21 条 + 新增 4 条）。
Run: `cd packages/opencode && bun test test/server/openhive-project-archive.test.ts`
Expected: PASS（归档链没被 `Entry` 改造弄坏）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/minio.ts packages/core/src/test-support/fake-s3.ts packages/core/test/minio.test.ts packages/opencode/src/server/openhive/archive.ts
git commit -m "feat(core/minio): 备份命名空间、Entry 列表、head 与更严的路径守卫

【保留的定制 · 同步上游时不要丢】
- Scope.namespace 给文件级备份快照一个独立前缀
- list() 返回 Entry（path/size/lastModified），archive.ts 三处跟随
- assertSafeSegment 补 NUL / '.' 段 / 空段"
```

---

### Task 2: 流式上传 / 下载 + 字节进度 + 空闲超时

**Files:**
- Modify: `packages/core/src/minio.ts`（`Interface`、`makeStore`、新增内部 helper）
- Test: `packages/core/test/minio.test.ts`
- Test: `packages/core/src/test-support/fake-s3.ts`（若需要，给 PUT 加慢速分支；本任务用「半截 body」不依赖它）

**Interfaces:**
- Consumes: Task 1 的 `Entry` / `keyOf` / `withTimeout`。
- Produces:
  - `Interface.putStream({ path, body, size, onProgress?, idleTimeoutMs? }): Promise<void>`
  - `Interface.getStream({ path, onProgress?, idleTimeoutMs? }): Promise<AsyncIterable<Uint8Array> | undefined>`
  - `Minio.DEFAULT_IDLE_TIMEOUT_MS = 30_000`
  - `Minio.StreamTimeoutError`（`name = "StreamTimeoutError"`）

- [ ] **Step 1: 写会红的测试**

```ts
test("putStream：按 size 发 ContentLength，按块回调进度", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    const 进度: number[] = []
    async function* 源() {
      yield 编码("ab")
      yield 编码("cde")
    }
    await store.putStream({ path: "blobs/aa/x", body: 源(), size: 5, onProgress: (n) => 进度.push(n) })
    expect(第(s3, 0).method).toBe("PUT")
    expect(第(s3, 0).key).toBe("007/p-42/blobs/aa/x")
    expect(解码(第(s3, 0).body)).toBe("abcde")
    expect(进度).toEqual([2, 5])
  } finally {
    s3.stop()
  }
})

test("putStream：源卡住超过 idleTimeoutMs ⇒ 抛 StreamTimeoutError", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    async function* 卡住() {
      yield 编码("ab")
      await new Promise(() => {})
    }
    await expect(
      store.putStream({ path: "blobs/aa/x", body: 卡住(), size: 5, idleTimeoutMs: 120 }),
    ).rejects.toMatchObject({ name: "StreamTimeoutError" })
  } finally {
    s3.stop()
  }
})

test("getStream：不存在 ⇒ undefined；存在 ⇒ 分块读并报进度", async () => {
  const s3 = startFakeS3()
  try {
    const store = 开({ userId: "007", projectId: "p-42" })
    expect(await store.getStream({ path: "没有" })).toBeUndefined()
    s3.seed("007/p-42/blobs/aa/x", "abcdef")
    const 进度: number[] = []
    const body = await store.getStream({ path: "blobs/aa/x", onProgress: (n) => 进度.push(n) })
    expect(body).toBeDefined()
    let 读回 = ""
    for await (const chunk of body!) 读回 += 解码(chunk)
    expect(读回).toBe("abcdef")
    expect(进度.at(-1)).toBe(6)
  } finally {
    s3.stop()
  }
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/core && bun test test/minio.test.ts`
Expected: FAIL —— `putStream is not a function`。

- [ ] **Step 3: 实现**

在 `minio.ts` 顶部加 `import { Readable } from "node:stream"`，并加：

```ts
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

/** 给一个异步源套空闲超时；卡住时中止上游并抛 `StreamTimeoutError`。 */
async function* idleGuarded(source: AsyncIterable<Uint8Array>, idleMs: number): AsyncGenerator<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await withIdle(iterator.next(), idleMs, () => void iterator.return?.())
      if (next.done) return
      yield next.value
    }
  } finally {
    await iterator.return?.()
  }
}
```

`withTimeout` 加第二个参数：`const withTimeout = async <Out,>(run: (signal: AbortSignal) => Promise<Out>, limitMs = timeoutMs)`，`setTimeout(() => controller.abort(), limitMs)`。

接口追加：

```ts
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
```

实现（放在 `put` 之后）：

```ts
    putStream: async ({ path, body, size, onProgress, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS }) => {
      let sent = 0
      async function* 计数() {
        for await (const chunk of idleGuarded(body, idleTimeoutMs)) {
          sent += chunk.byteLength
          onProgress?.(sent)
          yield chunk
        }
      }
      // ⚠️ 总上限不是 `timeoutMs`：一次 5 GB 的上传本来就该跑很久，用 30 秒会把它当场掐死。
      // 6 小时只是「别无限挂」的兜底；真正判「卡住」的是上面的空闲超时。
      await withTimeout(
        (abortSignal) =>
          client.send(
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: keyOf(path),
              Body: Readable.from(计数()),
              ContentLength: size,
            }),
            { abortSignal },
          ),
        6 * 60 * 60 * 1000,
      )
    },

    getStream: ({ path, onProgress, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS }) =>
      notFoundToUndefined(async () => {
        // 头照常吃 `timeoutMs`；body 由调用方按需读，读的每一步吃空闲超时。
        const response = await withTimeout((abortSignal) =>
          client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyOf(path) }), { abortSignal }),
        )
        const body = response.Body
        if (body === undefined) throw new Error(`MinIO 对 ${JSON.stringify(path)} 回了空 body`)
        let received = 0
        async function* 计数() {
          for await (const chunk of idleGuarded(body as AsyncIterable<Uint8Array>, idleTimeoutMs)) {
            received += chunk.byteLength
            onProgress?.(received)
            yield chunk
          }
        }
        return 计数()
      }),
```

- [ ] **Step 4: 跑绿 + 门禁**

Run: `cd packages/core && bun test`
Expected: PASS。
Run 仓库根: `bun run typecheck`
Expected: PASS（`Readable.from` 的 chunk 类型若报 `any`，把 `计数()` 的 yield 显式写成 `yield chunk as Uint8Array`）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/minio.ts packages/core/test/minio.test.ts
git commit -m "feat(core/minio): 流式 put/get，按字节报进度并带空闲超时

【保留的定制 · 同步上游时不要丢】
- 不引入 @aws-sdk/lib-storage（假 S3 不支持 multipart）：单次 PutObject + 文件流 + ContentLength
- 空闲超时 30s 判卡住，总上限 6h 只做兜底"
```

---

## 阶段 P2 · 备份服务

### Task 3: 模型与纯规则（路径 / 排除 / 快照 id / 范围 / 保留两者命名）

**Files:**
- Create: `packages/opencode/src/server/openhive/backup-model.ts`
- Create: `packages/opencode/src/server/openhive/backup-rules.ts`
- Test: `packages/opencode/test/server/openhive-backup-rules.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `BACKUP_NAMESPACE = "_openhive-backups"`
  - 类型 `Manifest`、`ManifestFile`、`ManifestSkip`、`SnapshotSummary`、`BackupState`、`Job`、`JobState`、`RestorePreview`、`RestoreResult`、`RestoreDecision`
  - `isSafeRelativePath(path): boolean`
  - `isExcluded(path): boolean`
  - `isPathInScope(scope, path): boolean`
  - `snapshotIdOf(at: number, randomHex: string): string`
  - `keepBothName(path, at, taken): string`

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, expect, test } from "bun:test"
import {
  estimateManifestBytes,
  isExcluded,
  isPathInScope,
  isSafeRelativePath,
  keepBothName,
  snapshotIdOf,
} from "../../src/server/openhive/backup-rules"

describe("isSafeRelativePath", () => {
  test("放行正常相对路径与空串", () => {
    for (const path of ["", "a.txt", "资料/话单.csv", ".git/HEAD"]) expect(isSafeRelativePath(path)).toBe(true)
  })
  test("拒绝穿越、绝对路径、盘符、反斜杠、NUL、空段与 '.' 段", () => {
    for (const path of ["../x", "a/../b", "/etc/passwd", "C:/x", "a\\b", "a\u0000b", "a//b", "./a", "a/"]) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })
})

describe("isExcluded", () => {
  test("排除临时文件与 git 锁", () => {
    for (const path of [
      ".git/index.lock",
      ".git/refs/heads/x.lock",
      ".git/objects/pack/tmp_pack_123",
      "资料/a.tmp",
      "资料/b.swp",
      "资料/c.swo",
      "资料/d~",
      ".DS_Store",
      "资料/Thumbs.db",
      "desktop.ini",
      "~$报告.docx",
      ".openhive-restore-abc.tmp",
      ".openhive-old-abc",
    ]) {
      expect(isExcluded(path), path).toBe(true)
    }
  })
  test("不排除 .git 本身与普通文件", () => {
    for (const path of [".git", ".git/HEAD", ".git/objects/ab/cdef", "资料/报告.docx"]) {
      expect(isExcluded(path), path).toBe(false)
    }
  })
})

describe("isPathInScope", () => {
  test("根范围覆盖一切", () => expect(isPathInScope("", "a/b.txt")).toBe(true))
  test("文件范围只覆盖它自己", () => {
    expect(isPathInScope("a.txt", "a.txt")).toBe(true)
    expect(isPathInScope("a.txt", "a.txt.bak")).toBe(false)
    expect(isPathInScope("a.txt", "a/b.txt")).toBe(false)
  })
  test("目录范围覆盖整棵子树，且不误伤同前缀兄弟", () => {
    expect(isPathInScope("资料", "资料/甲.txt")).toBe(true)
    expect(isPathInScope("资料", "资料")).toBe(true)
    expect(isPathInScope("资料", "资料2/甲.txt")).toBe(false)
  })
})

describe("snapshotIdOf", () => {
  test("形如 YYYYMMDDTHHMMSSmmmZ-6位十六进制", () => {
    expect(snapshotIdOf(Date.parse("2026-10-18T14:03:05.123Z"), "a1b2c3d4")).toBe("20261018T140305123Z-a1b2c3")
  })
})

describe("keepBothName", () => {
  const at = new Date(2026, 9, 18, 14, 3, 5).getTime()
  test("带目录、带扩展名", () => {
    expect(keepBothName("资料/报告.docx", at, () => false)).toBe("资料/报告 (MinIO 2026-10-18 14-03-05).docx")
  })
  test("重名追加 (2)", () => {
    const 已有 = new Set(["资料/报告 (MinIO 2026-10-18 14-03-05).docx"])
    expect(keepBothName("资料/报告.docx", at, (candidate) => 已有.has(candidate))).toBe(
      "资料/报告 (MinIO 2026-10-18 14-03-05) (2).docx",
    )
  })
  test("无扩展名与根目录", () => {
    expect(keepBothName("README", at, () => false)).toBe("README (MinIO 2026-10-18 14-03-05)")
  })
})

test("estimateManifestBytes 向上取整", () => {
  expect(estimateManifestBytes(0)).toBe(0)
  expect(estimateManifestBytes(1)).toBe(1)
  expect(estimateManifestBytes(21)).toBe(2)
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-rules.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `backup-model.ts`**

```ts
/**
 * 文件级备份快照的**词表**（2026-10-18，spec `2026-10-18-file-backup-snapshot-design.md`）。
 *
 * 本文件只有常量与类型，没有逻辑——逻辑在 `backup-rules.ts`（纯函数）与 `backup-run.ts`（执行）。
 * 分开的理由与 `project-data.ts` 同：让「一份判断」只有一个住处，两边不会漂。
 */

/** 备份对象的中间前缀段。与归档镜像 `{userId}/{projectId}/` 严格分开。 */
export const BACKUP_NAMESPACE = "_openhive-backups"

export const MANIFEST_VERSION = 1 as const
export const STATE_VERSION = 1 as const

/** 每（用户 × 项目）容量上限：10 GiB（spec §8.3）。 */
export const QUOTA_BYTES = 10 * 1024 ** 3
/** 单文件上限：5 GB（spec §5.3）。 */
export const MAX_FILE_BYTES = 5 * 1024 ** 3
/** GC 宽限：24 小时（spec §8.4）。 */
export const GC_GRACE_MS = 24 * 60 * 60 * 1000
/** 自动备份冷却：1 小时（spec §7.2）。 */
export const AUTO_COOLDOWN_MS = 60 * 60 * 1000
/** 活跃窗口：30 分钟（spec §7.2）。 */
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000
/** 任务终态在内存里留 10 分钟（spec §5.8）。 */
export const JOB_TTL_MS = 10 * 60 * 1000
/** 预览最多 2000 条（spec §6.2）。 */
export const PREVIEW_LIMIT = 2000
/** 预览里「仅本地」最多 100 条（spec §6.2）。 */
export const LOCAL_ONLY_LIMIT = 100
/** 一次列恢复点最多 200 条（spec §10.1）。 */
export const MANIFEST_LIST_LIMIT = 200

export type SnapshotKind = "manual" | "auto"
export type SnapshotStatus = "complete" | "partial"
export type SkipReason =
  | "excluded"
  | "too-large"
  | "unreadable"
  | "changed-during-backup"
  | "symlink"
  | "upload-failed"

export interface ManifestFile {
  readonly path: string
  readonly hash: string
  readonly size: number
  readonly mtimeMs: number
  readonly mode?: number
}

export interface ManifestSkip {
  readonly path: string
  readonly reason: SkipReason
}

export interface ManifestTotals {
  readonly files: number
  readonly bytes: number
  readonly uploadedBytes: number
  readonly skipped: number
}

export interface Manifest {
  readonly version: typeof MANIFEST_VERSION
  readonly id: string
  readonly projectId: string
  readonly ownerId: string
  readonly kind: SnapshotKind
  /** `""` ＝ 整个项目；否则是项目内相对路径。 */
  readonly scope: string
  readonly createdAt: number
  readonly createdBy: string
  readonly source: "manual" | "auto"
  readonly timezone: string
  readonly status: SnapshotStatus
  readonly files: readonly ManifestFile[]
  readonly dirs: readonly string[]
  readonly skipped: readonly ManifestSkip[]
  readonly totals: ManifestTotals
}

export interface SnapshotSummary {
  readonly id: string
  readonly kind: SnapshotKind
  readonly scope: string
  readonly createdAt: number
  readonly status: SnapshotStatus
  readonly totals: ManifestTotals
}

export interface BackupState {
  readonly version: typeof STATE_VERSION
  readonly usageBytes: number
  readonly lastGcAt: number
  readonly autoPaused: boolean
  readonly snapshots: readonly SnapshotSummary[]
}

export type JobKind = "backup" | "preview" | "restore"

export type JobState =
  | "queued"
  | "scanning"
  | "hashing"
  | "uploading"
  | "committing"
  | "previewing"
  | "restoring"
  | "succeeded"
  | "failed"
  | "cancelled"

export interface JobError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly path?: string
}

export interface JobProgress {
  readonly filesTotal: number
  readonly filesDone: number
  readonly bytesTotal: number
  readonly bytesDone: number
}

export interface Job {
  readonly id: string
  readonly kind: JobKind
  readonly userId: string
  readonly projectId: string
  readonly path: string
  readonly snapshotId?: string
  readonly state: JobState
  readonly progress: JobProgress
  readonly cancelRequested: boolean
  readonly startedAt: number
  readonly updatedAt: number
  readonly finishedAt?: number
  readonly error?: JobError
  readonly result?: unknown
}

export type RestoreDecision = "overwrite" | "keep-both" | "skip"
export type PreviewStatus = "missing" | "same" | "different" | "type-mismatch"

export interface RestorePreviewEntry {
  readonly path: string
  readonly status: PreviewStatus
}

export interface RestorePreview {
  readonly snapshotId: string
  readonly scope: string
  readonly counts: Record<PreviewStatus, number>
  readonly entries: readonly RestorePreviewEntry[]
  readonly truncated: boolean
  readonly localOnly: readonly string[]
  readonly localOnlyTruncated: boolean
}

export interface RestoreResult {
  readonly restored: readonly string[]
  readonly keptBoth: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly path: string; readonly reason: string }[]
  readonly cancelled: boolean
}
```

- [ ] **Step 4: 实现 `backup-rules.ts`**

```ts
import {
  MANIFEST_VERSION,
  type Manifest,
  type ManifestFile,
  type ManifestSkip,
  type ManifestTotals,
  type SkipReason,
  type SnapshotSummary,
} from "./backup-model"

const DRIVE = /^[A-Za-z]:/

/** 项目内相对路径的守卫。与 `Minio.assertSafeSegment` 同一条判据（只多允许 `""`＝项目根）。 */
export function isSafeRelativePath(path: string): boolean {
  if (path === "") return true
  if (path.includes("\\") || path.includes("\u0000")) return false
  if (path.startsWith("/") || DRIVE.test(path)) return false
  const segments = path.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

const 精确排除 = new Set([".git/index.lock", ".DS_Store", "Thumbs.db", "desktop.ini"])
const 后缀排除 = [/\.tmp$/i, /\.swp$/i, /\.swo$/i, /~$/]

/** 备份排除名单（spec §5.3）。**不排除 `.git`**——整份版本库要在快照里。 */
export function isExcluded(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1)
  if (精确排除.has(path)) return true
  if (name.startsWith("~$")) return true
  if (name.startsWith(".openhive-restore-") || name.startsWith(".openhive-old-")) return true
  if (path.startsWith(".git/")) {
    if (path.endsWith(".lock")) return true
    const parts = path.split("/")
    if (parts.length === 4 && parts[1] === "objects" && parts[2] === "pack" && parts[3].startsWith("tmp_")) return true
  }
  return 后缀排除.some((rule) => rule.test(name))
}

/** `path` 是否落在这次备份的范围里。scope 是文件时只覆盖它自己。 */
export function isPathInScope(scope: string, path: string): boolean {
  if (scope === "") return true
  if (path === scope) return true
  return path.startsWith(`${scope}/`)
}

/** 快照 id：`YYYYMMDDTHHMMSSmmmZ-<6 位十六进制>`（spec §4.6）。 */
export function snapshotIdOf(at: number, randomHex: string): string {
  const iso = new Date(at).toISOString() // 2026-10-18T14:03:05.123Z
  const 秒 = iso.slice(0, 19).replace(/[-:]/g, "") // 20261018T140305
  const 毫秒 = String(at % 1000).padStart(3, "0")
  return `${秒}${毫秒}Z-${randomHex.slice(0, 6)}`
}

function 本地时间戳(at: number): string {
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(
    date.getMinutes(),
  )}-${two(date.getSeconds())}`
}

/** 「保留两者」的新名字（spec §6.3）。`taken` 回答「这个名字在目标目录里已经有人占了吗」。 */
export function keepBothName(path: string, at: number, taken: (candidate: string) => boolean): string {
  const slash = path.lastIndexOf("/")
  const dir = slash === -1 ? "" : path.slice(0, slash)
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  const stamp = 本地时间戳(at)
  const build = (suffix: string) => {
    const base = `${stem} (MinIO ${stamp})${suffix}${ext}`
    return dir ? `${dir}/${base}` : base
  }
  let candidate = build("")
  let n = 2
  while (taken(candidate)) candidate = build(` (${n++})`)
  return candidate
}

/** 预计 manifest 大小：`ceil(logicalBytes / 20)`（spec §8.3 的粗估）。 */
export function estimateManifestBytes(logicalBytes: number): number {
  return Math.ceil(logicalBytes / 20)
}

/** 由 manifest 生成 state 里的摘要。 */
export function summaryOf(manifest: Manifest): SnapshotSummary {
  return {
    id: manifest.id,
    kind: manifest.kind,
    scope: manifest.scope,
    createdAt: manifest.createdAt,
    status: manifest.status,
    totals: manifest.totals,
  }
}

const SNAPSHOT_ID = /^\d{8}T\d{9}Z-[0-9a-f]{6}$/
const SHA256 = /^[0-9a-f]{64}$/

function 是记录(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 数字(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function 读文件(value: unknown): ManifestFile | undefined {
  if (!是记录(value)) return undefined
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path) || value.path === "") return undefined
  if (typeof value.hash !== "string" || !SHA256.test(value.hash)) return undefined
  if (!数字(value.size) || !数字(value.mtimeMs)) return undefined
  if (value.mode !== undefined && !数字(value.mode)) return undefined
  return {
    path: value.path,
    hash: value.hash,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ...(value.mode === undefined ? {} : { mode: value.mode }),
  }
}

const 跳过原因: readonly SkipReason[] = [
  "excluded",
  "too-large",
  "unreadable",
  "changed-during-backup",
  "symlink",
  "upload-failed",
]

function 读跳过(value: unknown): ManifestSkip | undefined {
  if (!是记录(value)) return undefined
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path)) return undefined
  if (typeof value.reason !== "string" || !跳过原因.includes(value.reason as SkipReason)) return undefined
  return { path: value.path, reason: value.reason as SkipReason }
}

function 读总计(value: unknown): ManifestTotals | undefined {
  if (!是记录(value)) return undefined
  if (!数字(value.files) || !数字(value.bytes) || !数字(value.uploadedBytes) || !数字(value.skipped)) return undefined
  return { files: value.files, bytes: value.bytes, uploadedBytes: value.uploadedBytes, skipped: value.skipped }
}

/**
 * 把 manifest 当**不可信输入**校验（spec §9.5）。
 *
 * 返回 `undefined` ＝ 这份 manifest 不能用；调用方必须 fail-closed（GC 遇到它就不删任何 blob）。
 * 校验的是「读回来能不能安全地拿去写盘」：路径不许穿越、哈希必须是 sha256、id 必须是那个形状。
 */
export function validateManifest(
  raw: unknown,
  expected: { projectId: string; ownerId: string },
): Manifest | undefined {
  if (!是记录(raw)) return undefined
  if (raw.version !== MANIFEST_VERSION) return undefined
  if (typeof raw.id !== "string" || !SNAPSHOT_ID.test(raw.id)) return undefined
  if (raw.projectId !== expected.projectId || raw.ownerId !== expected.ownerId) return undefined
  if (raw.kind !== "manual" && raw.kind !== "auto") return undefined
  if (typeof raw.scope !== "string" || !isSafeRelativePath(raw.scope)) return undefined
  if (!数字(raw.createdAt)) return undefined
  if (typeof raw.createdBy !== "string") return undefined
  if (raw.source !== "manual" && raw.source !== "auto") return undefined
  if (typeof raw.timezone !== "string") return undefined
  if (raw.status !== "complete" && raw.status !== "partial") return undefined
  if (!Array.isArray(raw.files) || !Array.isArray(raw.dirs) || !Array.isArray(raw.skipped)) return undefined

  const files: ManifestFile[] = []
  for (const value of raw.files) {
    const file = 读文件(value)
    if (!file) return undefined
    files.push(file)
  }
  const dirs: string[] = []
  for (const value of raw.dirs) {
    if (typeof value !== "string" || !isSafeRelativePath(value) || value === "") return undefined
    dirs.push(value)
  }
  const skipped: ManifestSkip[] = []
  for (const value of raw.skipped) {
    const skip = 读跳过(value)
    if (!skip) return undefined
    skipped.push(skip)
  }
  const totals = 读总计(raw.totals)
  if (!totals) return undefined

  return {
    version: MANIFEST_VERSION,
    id: raw.id,
    projectId: raw.projectId,
    ownerId: raw.ownerId,
    kind: raw.kind,
    scope: raw.scope,
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    source: raw.source,
    timezone: raw.timezone,
    status: raw.status,
    files,
    dirs,
    skipped,
    totals,
  }
}
```

- [ ] **Step 5: 跑绿**

Run: `cd packages/opencode && bun test test/server/openhive-backup-rules.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/server/openhive/backup-model.ts packages/opencode/src/server/openhive/backup-rules.ts packages/opencode/test/server/openhive-backup-rules.test.ts
git commit -m "feat(backup): 快照词表与纯规则（路径/排除/范围/id/命名/manifest 校验）

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 4: 保留分桶与 GC 判据（纯函数）

**Files:**
- Modify: `packages/opencode/src/server/openhive/backup-rules.ts`
- Test: `packages/opencode/test/server/openhive-backup-rules.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `SnapshotSummary`、`Manifest`。
- Produces:
  - `zoneOf(at: number, timeZone: string): { hour: string; day: string; week: string }`
  - `retentionKeepIds(snapshots: readonly SnapshotSummary[], now: number, timeZone: string): Set<string>`
  - `referencedHashes(manifests: readonly Manifest[]): Set<string>`

- [ ] **Step 1: 写会红的测试**

```ts
function 摘要(id: string, at: number): SnapshotSummary {
  return {
    id,
    kind: "auto",
    scope: "",
    createdAt: at,
    status: "complete",
    totals: { files: 1, bytes: 1, uploadedBytes: 1, skipped: 0 },
  }
}

describe("retentionKeepIds", () => {
  const tz = "Asia/Shanghai"
  const now = Date.parse("2026-10-18T12:00:00.000Z")

  test("最新自动快照永远保留，哪怕它已经超过 84 天", () => {
    const old = now - 100 * 86400_000
    expect(retentionKeepIds([摘要("old", old)], now, tz).has("old")).toBe(true)
  })

  test("最近 24 个不同小时各留最新的一条", () => {
    const 同一小时两条 = [
      摘要("b", now),
      摘要("a", now - 10 * 60_000),
    ]
    expect([...retentionKeepIds(同一小时两条, now, tz)]).toEqual(["b"])
  })

  test("超过 84 天且不是最新的自动快照被删", () => {
    const snapshots = [摘要("new", now), 摘要("old", now - 85 * 86400_000)]
    expect(retentionKeepIds(snapshots, now, tz).has("old")).toBe(false)
  })

  test("手动快照不参与自动删除", () => {
    const manual = { ...摘要("manual", now - 200 * 86400_000), kind: "manual" as const }
    expect(retentionKeepIds([manual, 摘要("auto", now)], now, tz).has("manual")).toBe(true)
  })
})

describe("referencedHashes", () => {
  test("把所有 manifest 的 files.hash 并起来", () => {
    const a = { files: [{ hash: "a".repeat(64) }] }
    const b = { files: [{ hash: "b".repeat(64) }] }
    expect([...referencedHashes([a as never, b as never])]).toEqual(["a".repeat(64), "b".repeat(64)])
  })
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-rules.test.ts`
Expected: FAIL —— `retentionKeepIds is not a function`。

- [ ] **Step 3: 实现**

```ts
/** 按服务器时区把一个时刻切成小时 / 天 / ISO 周三个桶（spec §8.1）。 */
export function zoneOf(at: number, timeZone: string): { hour: string; day: string; week: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  const day = `${pick("year")}-${pick("month")}-${pick("day")}`
  const date = new Date(`${day}T00:00:00Z`)
  const 周一 = new Date(date)
  const 星期 = (date.getUTCDay() + 6) % 7 // 周一＝0
  周一.setUTCDate(date.getUTCDate() - 星期)
  const 周一串 = 周一.toISOString().slice(0, 10)
  return { hour: `${day}T${pick("hour")}`, day, week: 周一串 }
}

const 八十四天 = 84 * 86400_000

/**
 * 分级保留（spec §8.1）：
 * - 最新自动快照**永远**保留；
 * - 最近 24 个小时桶、30 个天桶、12 个周桶各留最新一条；
 * - 超过 84 天、且不是最新那条 ⇒ 删。
 * - 手动快照**不参与**自动删除。
 */
export function retentionKeepIds(snapshots: readonly SnapshotSummary[], now: number, timeZone: string): Set<string> {
  const kept = new Set<string>()
  const autos = snapshots
    .filter((snapshot) => snapshot.kind === "auto")
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
  const 最新 = autos[0]
  if (最新) kept.add(最新.id)

  const hours = new Set<string>()
  const days = new Set<string>()
  const weeks = new Set<string>()
  for (const snapshot of autos) {
    if (now - snapshot.createdAt > 八十四天) break
    const zone = zoneOf(snapshot.createdAt, timeZone)
    if (hours.size < 24) {
      if (!hours.has(zone.hour)) {
        hours.add(zone.hour)
        kept.add(snapshot.id)
        continue
      }
    }
    if (days.size < 30) {
      if (!days.has(zone.day)) {
        days.add(zone.day)
        kept.add(snapshot.id)
        continue
      }
    }
    if (weeks.size < 12) {
      if (!weeks.has(zone.week)) {
        weeks.add(zone.week)
        kept.add(snapshot.id)
        continue
      }
    }
  }

  for (const snapshot of snapshots) if (snapshot.kind === "manual") kept.add(snapshot.id)
  return kept
}

/** 全部 manifest 引用到的 blob 哈希（GC 的唯一「谁还在用」判据）。 */
export function referencedHashes(manifests: readonly Manifest[]): Set<string> {
  const hashes = new Set<string>()
  for (const manifest of manifests) for (const file of manifest.files) hashes.add(file.hash)
  return hashes
}
```

- [ ] **Step 4: 跑绿 + 提交**

Run: `cd packages/opencode && bun test test/server/openhive-backup-rules.test.ts`
Expected: PASS。

```bash
git add packages/opencode/src/server/openhive/backup-rules.ts packages/opencode/test/server/openhive-backup-rules.test.ts
git commit -m "feat(backup): 分级保留分桶与 blob 引用集

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 5: `backup-store.ts`（manifest / state / blob 读写）

**Files:**
- Create: `packages/opencode/src/server/openhive/backup-store.ts`
- Test: `packages/opencode/test/server/openhive-backup-auto.test.ts`（前半段先放 store 测试；后面 Task 9 追加）

**Interfaces:**
- Consumes: `Minio.makeStore`；Task 1/2 的 `putStream` / `getStream` / `head` / `list({prefix})`；Task 3 的 `validateManifest`、`Manifest`、`BackupState`、`BACKUP_NAMESPACE`。
- Produces:
  - `openBackupStore(input: { endpoint; bucket; credentials; useSSL?: boolean; userId; projectId }): BackupStore`
  - `BackupStore` 九个方法（见下）

- [ ] **Step 1: 写会红的测试**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { gzipSync } from "node:zlib"
import { startFakeS3, type FakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { openBackupStore } from "../../src/server/openhive/backup-store"
import type { Manifest } from "../../src/server/openhive/backup-model"

let s3: FakeS3
beforeEach(() => {
  s3 = startFakeS3()
})
afterEach(() => s3.stop())

const store = () =>
  openBackupStore({
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    credentials: { accessKeyId: "k", secretAccessKey: "s" },
    userId: "007",
    projectId: "p-42",
  })

function 清单(id = "20261018T140305123Z-abcdef"): Manifest {
  return {
    version: 1,
    id,
    projectId: "p-42",
    ownerId: "007",
    kind: "manual",
    scope: "",
    createdAt: Date.parse("2026-10-18T14:03:05.123Z"),
    createdBy: "007",
    source: "manual",
    timezone: "Asia/Shanghai",
    status: "complete",
    files: [{ path: "a.txt", hash: "a".repeat(64), size: 3, mtimeMs: 1 }],
    dirs: [],
    skipped: [],
    totals: { files: 1, bytes: 3, uploadedBytes: 3, skipped: 0 },
  }
}

test("manifest 写进 {userId}/_openhive-backups/{projectId}/manifests/，gzip 可解，读回逐字相同", async () => {
  const s = store()
  const 大小 = await s.writeManifest(清单())
  expect(大小).toBeGreaterThan(0)
  const 请求 = s3.requests.find((request) => request.method === "PUT")!
  expect(请求.key).toBe("007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz")
  expect(await s.readManifest("20261018T140305123Z-abcdef")).toEqual(清单())
})

test("manifest 不在 ⇒ undefined；坏了 ⇒ 抛（fail-closed）", async () => {
  const s = store()
  expect(await s.readManifest("20261018T140305123Z-abcdef")).toBeUndefined()
  s3.seed("007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz", "不是 gzip")
  await expect(s.readManifest("20261018T140305123Z-abcdef")).rejects.toThrow()
})

test("manifest 的 projectId 对不上 ⇒ 抛（不把别人的清单当自己的）", async () => {
  const s = store()
  const 别人的 = { ...清单(), projectId: "p-99" }
  s3.seed(
    "007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz",
    gzipSync(new TextEncoder().encode(JSON.stringify(别人的))).toString("latin1"),
  )
  await expect(s.readManifest("20261018T140305123Z-abcdef")).rejects.toThrow()
})

test("state 读写往返；坏了 ⇒ undefined（不阻断备份）", async () => {
  const s = store()
  expect(await s.readState()).toBeUndefined()
  await s.writeState({ version: 1, usageBytes: 9, lastGcAt: 1, autoPaused: false, snapshots: [] })
  expect(await s.readState()).toEqual({ version: 1, usageBytes: 9, lastGcAt: 1, autoPaused: false, snapshots: [] })
})

test("blobs 列出 size/lastModified；putBlob/getBlob 往返", async () => {
  const s = store()
  async function* 源() {
    yield new TextEncoder().encode("abc")
  }
  await s.putBlob({ hash: "ab".repeat(32), body: 源(), size: 3 })
  const blobs = await s.blobs()
  expect(blobs).toEqual([{ hash: "ab".repeat(32), size: 3, lastModified: expect.any(Number) }])
  const body = await s.openBlob({ hash: "ab".repeat(32) })
  let 读回 = ""
  for await (const chunk of body!) 读回 += new TextDecoder().decode(chunk)
  expect(读回).toBe("abc")
  await s.deleteBlob("ab".repeat(32))
  expect(await s.blobs()).toEqual([])
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: FAIL —— `openBackupStore` 不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 备份快照在 MinIO 上的**唯一读写口**。
 *
 * 布局（spec §4.2）：
 * ```
 * {userId}/_openhive-backups/{projectId}/
 *   manifests/<snapshotId>.json.gz
 *   blobs/<sha256 前 2 位>/<sha256>
 *   state.json
 * ```
 * 没有 `tmp/`：上传直接写 blob，最后写 manifest。manifest 不在 ⇒ 这次备份**不存在**
 * （spec §4.5 的「manifest-last」）。
 */

import { gzipSync, gunzipSync } from "node:zlib"
import { Minio } from "@opencode-ai/core/minio"
import {
  BACKUP_NAMESPACE,
  MANIFEST_VERSION,
  STATE_VERSION,
  type BackupState,
  type Manifest,
} from "./backup-model"
import { summaryOf, validateManifest } from "./backup-rules"

export interface BlobEntry {
  readonly hash: string
  readonly size: number
  readonly lastModified: number
}

export interface BackupStore {
  readonly manifests: () => Promise<readonly { id: string; size: number; lastModified: number }[]>
  /** 不在 ⇒ `undefined`；在但坏了 / 不是本项目 ⇒ **抛**（调用方 fail-closed）。 */
  readonly readManifest: (id: string) => Promise<Manifest | undefined>
  /** 写入并返回**压缩后**的字节数（用量估算用）。 */
  readonly writeManifest: (manifest: Manifest) => Promise<number>
  readonly deleteManifest: (id: string) => Promise<void>
  readonly readState: () => Promise<BackupState | undefined>
  readonly writeState: (state: BackupState) => Promise<void>
  readonly blobs: () => Promise<readonly BlobEntry[]>
  readonly putBlob: (input: {
    readonly hash: string
    readonly body: AsyncIterable<Uint8Array>
    readonly size: number
    readonly onProgress?: (bytes: number) => void
  }) => Promise<void>
  readonly openBlob: (input: {
    readonly hash: string
    readonly onProgress?: (bytes: number) => void
  }) => Promise<AsyncIterable<Uint8Array> | undefined>
  readonly deleteBlob: (hash: string) => Promise<void>
}

export interface BackupStoreInput {
  readonly endpoint: string
  readonly bucket: string
  readonly credentials: Minio.Credentials
  readonly userId: string
  readonly projectId: string
}

const MANIFEST_DIR = "manifests/"
const BLOB_DIR = "blobs/"
const STATE_PATH = "state.json"

export function openBackupStore(input: BackupStoreInput): BackupStore {
  const store = Minio.makeStore({
    endpoint: input.endpoint,
    bucket: input.bucket,
    credentials: input.credentials,
    scope: { userId: input.userId, projectId: input.projectId, namespace: BACKUP_NAMESPACE },
  })

  const manifestPath = (id: string) => `${MANIFEST_DIR}${id}.json.gz`

  return {
    manifests: async () => {
      const entries = await store.list({ prefix: MANIFEST_DIR })
      return entries
        .filter((entry) => entry.path.endsWith(".json.gz"))
        .map((entry) => ({
          id: entry.path.slice(MANIFEST_DIR.length, -".json.gz".length),
          size: entry.size,
          lastModified: entry.lastModified,
        }))
    },

    readManifest: async (id) => {
      const 文件 = await store.get({ path: manifestPath(id) })
      if (文件 === undefined) return undefined
      let raw: unknown
      try {
        raw = JSON.parse(gunzipSync(文件).toString("utf8"))
      } catch (error) {
        throw new Error(`manifest ${id} 解不开：${error instanceof Error ? error.message : String(error)}`)
      }
      const manifest = validateManifest(raw, { projectId: input.projectId, ownerId: input.userId })
      if (!manifest) throw new Error(`manifest ${id} 不是合法形状（或不属于本项目）`)
      if (manifest.id !== id) throw new Error(`manifest ${id} 里的 id 与文件名不一致：${manifest.id}`)
      return manifest
    },

    writeManifest: async (manifest) => {
      const 压缩 = gzipSync(new TextEncoder().encode(JSON.stringify(manifest)))
      await store.put({ path: manifestPath(manifest.id), body: 压缩 })
      return 压缩.byteLength
    },

    deleteManifest: async (id) => {
      await store.delete({ path: manifestPath(id) })
    },

    readState: async () => {
      const 文件 = await store.get({ path: STATE_PATH })
      if (文件 === undefined) return undefined
      try {
        const raw: unknown = JSON.parse(文件.toString("utf8"))
        if (typeof raw !== "object" || raw === null) return undefined
        const value = raw as Record<string, unknown>
        if (value.version !== STATE_VERSION) return undefined
        if (typeof value.usageBytes !== "number" || typeof value.lastGcAt !== "number") return undefined
        if (typeof value.autoPaused !== "boolean" || !Array.isArray(value.snapshots)) return undefined
        return raw as BackupState
      } catch {
        // state 是**派生索引**，不是真相（spec §4.4）：坏了就当没有，下一次由 manifest 重建。
        return undefined
      }
    },

    writeState: async (state) => {
      await store.put({ path: STATE_PATH, body: new TextEncoder().encode(JSON.stringify(state)) })
    },

    blobs: async () => {
      const entries = await store.list({ prefix: BLOB_DIR })
      return entries.map((entry) => ({
        hash: entry.path.slice(BLOB_DIR.length),
        size: entry.size,
        lastModified: entry.lastModified,
      }))
    },

    putBlob: async ({ hash, body, size, onProgress }) => {
      await store.putStream({ path: `${BLOB_DIR}${hash.slice(0, 2)}/${hash}`, body, size, onProgress })
    },

    openBlob: async ({ hash, onProgress }) =>
      store.getStream({ path: `${BLOB_DIR}${hash.slice(0, 2)}/${hash}`, onProgress }),

    deleteBlob: async (hash) => {
      await store.delete({ path: `${BLOB_DIR}${hash.slice(0, 2)}/${hash}` })
    },
  }
}

/** state 丢了就从 manifest 重建摘要（只扫最近 200 条，spec §10.1）。 */
export async function rebuildSnapshots(
  store: BackupStore,
): Promise<readonly { id: string; createdAt: number; summary: ReturnType<typeof summaryOf> }[]> {
  const listed = await store.manifests()
  const 最近 = listed.slice().sort((a, b) => b.lastModified - a.lastModified).slice(0, 200)
  const 结果: { id: string; createdAt: number; summary: ReturnType<typeof summaryOf> }[] = []
  for (const entry of 最近) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) 结果.push({ id: entry.id, createdAt: manifest.createdAt, summary: summaryOf(manifest) })
    } catch {
      // 坏 manifest 不进摘要；GC 那一侧会 fail-closed（spec §8.4）。
    }
  }
  return 结果.sort((a, b) => b.createdAt - a.createdAt)
}
```

- [ ] **Step 4: 跑绿 + 提交**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: PASS。

```bash
git add packages/opencode/src/server/openhive/backup-store.ts packages/opencode/test/server/openhive-backup-auto.test.ts
git commit -m "feat(backup): MinIO 快照存储层（manifest/state/blob）

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 6: 任务注册表与单飞

**Files:**
- Create: `packages/opencode/src/server/openhive/backup-jobs.ts`
- Test: `packages/opencode/test/server/openhive-backup-auto.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 的 `Job`、`JOB_TTL_MS`。
- Produces:
  - `createJobRegistry(options?): JobRegistry`
  - `JobRegistry.start(input): { job: Job; resumed: boolean }`
  - `JobRegistry.get(id, userId): Job | undefined`
  - `JobRegistry.activeFor(userId, projectId): Job | undefined`
  - `JobRegistry.update(id, patch): void`
  - `JobRegistry.cancel(id, userId): "cancelling" | "done" | "missing"`
  - `JobRegistry.finish(id, state, extra?): void`
  - `JobRegistry.evict(now?): void`
  - `sharedJobs: JobRegistry`（**进程内唯一实例**，spec §7.5）
  - `quiesceProject(projectId, userIds, options?: { registry?; timeoutMs?; pollMs? }): Promise<boolean>`

- [ ] **Step 1: 写会红的测试**

```ts
import { createJobRegistry, quiesceProject } from "../../src/server/openhive/backup-jobs"

test("同一（用户×项目）单飞：第二个 start 回同一个任务并标 resumed", () => {
  const registry = createJobRegistry({ now: () => 1000 })
  const first = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  const second = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "资料" })
  expect(first.resumed).toBe(false)
  expect(second.resumed).toBe(true)
  expect(second.job.id).toBe(first.job.id)
})

test("不同项目 / 不同用户互不阻塞", () => {
  const registry = createJobRegistry({ now: () => 1000 })
  const a = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  expect(registry.start({ kind: "backup", userId: "007", projectId: "p-99", path: "" }).resumed).toBe(false)
  expect(registry.start({ kind: "backup", userId: "008", projectId: "p-42", path: "" }).resumed).toBe(false)
  expect(registry.get(a.job.id, "007")?.state).toBe("queued")
})

test("get 按 userId 隔离：别人的任务 id 拿不到", () => {
  const registry = createJobRegistry({ now: () => 1000 })
  const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  expect(registry.get(job.id, "008")).toBeUndefined()
  expect(registry.get(job.id, "007")?.id).toBe(job.id)
})

test("cancel：跑着的置标记，终态的报 done，不存在报 missing", () => {
  const registry = createJobRegistry({ now: () => 1000 })
  const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  expect(registry.cancel(job.id, "007")).toBe("cancelling")
  expect(registry.get(job.id, "007")?.cancelRequested).toBe(true)
  registry.finish(job.id, "cancelled")
  expect(registry.cancel(job.id, "007")).toBe("done")
  expect(registry.cancel("没有", "007")).toBe("missing")
})

test("终态超过 10 分钟被清掉；运行中的不清", () => {
  let now = 1000
  const registry = createJobRegistry({ now: () => now })
  const a = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  const b = registry.start({ kind: "backup", userId: "007", projectId: "p-99", path: "" })
  registry.finish(a.job.id, "succeeded")
  now += 10 * 60_000 + 1
  registry.evict()
  expect(registry.get(a.job.id, "007")).toBeUndefined()
  expect(registry.get(b.job.id, "007")?.state).toBe("queued")
  // 清掉之后同一个项目可以再起任务（单飞锁已释放）
  expect(registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" }).resumed).toBe(false)
})

test("quiesceProject：先请求取消、等任务收敛；执行器不响应则以超时判失败", async () => {
  const registry = createJobRegistry({ now: () => 1000 })
  const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
  // 模拟执行器**响应取消**：150ms 后自己收尾。
  setTimeout(() => registry.finish(job.id, "cancelled"), 150)
  expect(await quiesceProject("p-42", ["007"], { registry, timeoutMs: 3000, pollMs: 20 })).toBe(true)
  expect(registry.get(job.id, "007")?.state).toBe("cancelled")

  // 模拟执行器**不响应取消**：永不 finish ⇒ 到上限回 false，且取消标记已经置上（它试过了）。
  const 硬 = registry.start({ kind: "backup", userId: "008", projectId: "p-42", path: "" })
  expect(await quiesceProject("p-42", ["008"], { registry, timeoutMs: 80, pollMs: 20 })).toBe(false)
  expect(registry.get(硬.job.id, "008")?.cancelRequested).toBe(true)
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: FAIL —— `createJobRegistry` 不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 内存里的任务表（spec §5.8）。
 *
 * - **单飞粒度是（用户×项目）**：同一个项目的第二个手动备份回 409 `job_running`；
 * - **终态任务留 10 分钟**：前端 1 秒轮询要能拿到「成功 / 失败 / 取消」与最后一份进度；
 * - **单实例假设**：多实例部署时锁不跨进程（spec §7.6 已登记）。
 */

import { randomUUID } from "node:crypto"
import { JOB_TTL_MS, type Job, type JobError, type JobKind, type JobState } from "./backup-model"

export interface StartJobInput {
  readonly kind: JobKind
  readonly userId: string
  readonly projectId: string
  readonly path: string
  readonly snapshotId?: string
}

export interface JobRegistry {
  readonly start: (input: StartJobInput) => { readonly job: Job; readonly resumed: boolean }
  readonly get: (id: string, userId: string) => Job | undefined
  readonly activeFor: (userId: string, projectId: string) => Job | undefined
  readonly update: (id: string, patch: Partial<Job>) => void
  readonly cancel: (id: string, userId: string) => "cancelling" | "done" | "missing"
  readonly finish: (
    id: string,
    state: Extract<JobState, "succeeded" | "failed" | "cancelled">,
    extra?: { readonly error?: JobError; readonly result?: unknown },
  ) => void
  readonly evict: (now?: number) => void
}

const 终态: ReadonlySet<JobState> = new Set(["succeeded", "failed", "cancelled"])

export function createJobRegistry(options: { now?: () => number; ttlMs?: number } = {}): JobRegistry {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? JOB_TTL_MS
  const jobs = new Map<string, Job>()
  /** 单飞键 ⇒ 任务 id。终态时删。 */
  const active = new Map<string, string>()
  const 键 = (userId: string, projectId: string) => `${userId}/${projectId}`

  const registry: JobRegistry = {
    start: (input) => {
      const existing = active.get(键(input.userId, input.projectId))
      if (existing !== undefined) {
        const job = jobs.get(existing)
        if (job !== undefined) return { job, resumed: true }
        active.delete(键(input.userId, input.projectId))
      }
      const at = now()
      const job: Job = {
        id: randomUUID(),
        kind: input.kind,
        userId: input.userId,
        projectId: input.projectId,
        path: input.path,
        ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
        state: "queued",
        progress: { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 },
        cancelRequested: false,
        startedAt: at,
        updatedAt: at,
      }
      jobs.set(job.id, job)
      active.set(键(input.userId, input.projectId), job.id)
      return { job, resumed: false }
    },

    get: (id, userId) => {
      const job = jobs.get(id)
      return job !== undefined && job.userId === userId ? job : undefined
    },

    activeFor: (userId, projectId) => {
      const id = active.get(键(userId, projectId))
      if (id === undefined) return undefined
      const job = jobs.get(id)
      return job !== undefined && !终态.has(job.state) ? job : undefined
    },

    update: (id, patch) => {
      const job = jobs.get(id)
      if (job === undefined) return
      jobs.set(id, { ...job, ...patch, updatedAt: now() })
    },

    cancel: (id, userId) => {
      const job = jobs.get(id)
      if (job === undefined || job.userId !== userId) return "missing"
      if (终态.has(job.state)) return "done"
      jobs.set(id, { ...job, cancelRequested: true, updatedAt: now() })
      return "cancelling"
    },

    finish: (id, state, extra) => {
      const job = jobs.get(id)
      if (job === undefined) return
      const at = now()
      jobs.set(id, {
        ...job,
        state,
        updatedAt: at,
        finishedAt: at,
        ...(extra?.error === undefined ? {} : { error: extra.error }),
        ...(extra?.result === undefined ? {} : { result: extra.result }),
      })
      active.delete(键(job.userId, job.projectId))
    },

    evict: (at = now()) => {
      for (const [id, job] of jobs) {
        if (!终态.has(job.state)) continue
        if ((job.finishedAt ?? job.updatedAt) + ttlMs > at) continue
        jobs.delete(id)
      }
    },
  }

  return registry
}

/**
 * 进程内唯一的那张任务表（spec §7.5）。
 *
 * ⚠️ **`backup.ts` 与项目删除必须共用这一个实例**——「单飞锁」的全部意义就在于两边看的是同一张表。
 * 各自 `createJobRegistry()` 会让删除看不见正在跑的备份（`#004-02`：一份判定长成两个投影）。
 */
export const sharedJobs = createJobRegistry()

/**
 * 把某个项目上所有成员的**活动任务**收敛掉（spec §5.8 末条）。
 *
 * - 返回 `true` ⇒ 此刻该项目没有任何活动任务，可以安全删除；
 * - 返回 `false` ⇒ 到上限仍有任务没收敛。调用方**不得**强行继续：删掉半备份的项目会留下孤儿
 *   blob，删掉半恢复的项目会留下改了一半的树。
 *
 * @param userIds 该项目的**全部成员**（项目删除时从成员表取；调用方已保证非空）。
 */
export async function quiesceProject(
  projectId: string,
  userIds: readonly string[],
  options: { readonly registry?: JobRegistry; readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<boolean> {
  const registry = options.registry ?? sharedJobs
  const timeoutMs = options.timeoutMs ?? 30_000
  const pollMs = options.pollMs ?? 100
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const 活 = userIds.flatMap((userId) => {
      const job = registry.activeFor(userId, projectId)
      return job === undefined ? [] : [{ userId, job }]
    })
    if (活.length === 0) return true
    // 每一轮都重发取消：第一轮可能撞在任务刚 start、执行器还没挂上取消钩子的窗口里。
    for (const { userId, job } of 活) registry.cancel(job.id, userId)
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
```

- [ ] **Step 4: 跑绿 + 提交**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: PASS。

```bash
git add packages/opencode/src/server/openhive/backup-jobs.ts packages/opencode/test/server/openhive-backup-auto.test.ts
git commit -m "feat(backup): 内存任务表、单飞锁与 10 分钟 TTL

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 7: 备份执行（扫描 / 哈希 / 上传 / 写清单）

**Files:**
- Create: `packages/opencode/src/server/openhive/backup-run.ts`
- Test: `packages/opencode/test/server/openhive-backup-auto.test.ts`（追加）

**Interfaces:**
- Consumes: Task 5 `BackupStore`；Task 3/4 规则。
- Produces:
  - `runBackup(deps: RunDeps, input: BackupInput): Promise<Manifest>`
  - `scanScope(directory, scope): Promise<{ files: ScannedFile[]; dirs: string[]; skipped: ManifestSkip[] }>`
  - `CancelledError` / `UnchangedError` / `QuotaError` / `NotFoundError`（`name` 同名）
  - `RunDeps { store; directory; report(patch); isCancelled(); timezone; maxFileBytes?; concurrency?; now? }`

- [ ] **Step 1: 写会红的测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBackup } from "../../src/server/openhive/backup-run"

function 造项目(): string {
  const root = mkdtempSync(join(tmpdir(), "openhive-backup-"))
  mkdirSync(join(root, "资料"), { recursive: true })
  writeFileSync(join(root, "资料", "甲.txt"), "aaa")
  writeFileSync(join(root, "资料", "乙.txt"), "bbb")
  writeFileSync(join(root, "报告.docx"), "ccc")
  return root
}

function 依赖(directory: string) {
  const 进度: string[] = []
  return {
    进度,
    deps: {
      store: store(),
      directory,
      projectId: "p-42",
      ownerId: "007",
      timezone: "Asia/Shanghai",
      report: (patch: { state?: string }) => 进度.push(String(patch.state)),
      isCancelled: () => false,
    },
  }
}

test("备份：manifest 最后写，blob 按内容寻址去重，files 按路径排序", async () => {
  const directory = 造项目()
  const { deps } = 依赖(directory)
  const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })

  expect(manifest.files.map((file) => file.path)).toEqual(["报告.docx", "资料/甲.txt", "资料/乙.txt"])
  expect(deps.store.blobs).toBeDefined()

  // manifest 存在
  expect(await deps.store.readManifest(manifest.id)).toEqual(manifest)
  // 三个文件、三个不同内容 ⇒ 三个 blob
  expect((await deps.store.blobs()).length).toBe(3)
  expect(manifest.totals).toEqual({ files: 3, bytes: 9, uploadedBytes: 9, skipped: 0 })
})

test("同一内容只上传一次（去重）", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openhive-backup-"))
  writeFileSync(join(directory, "a.txt"), "same")
  writeFileSync(join(directory, "b.txt"), "same")
  const { deps } = 依赖(directory)
  const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })
  expect(manifest.totals.files).toBe(2)
  expect((await deps.store.blobs()).length).toBe(1)
  expect(manifest.totals.uploadedBytes).toBe(4)
})

test("排除名单生效，且记进 skipped", async () => {
  const directory = 造项目()
  writeFileSync(join(directory, "资料", "x.tmp"), "tmp")
  const { deps } = 依赖(directory)
  const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })
  expect(manifest.skipped).toEqual([{ path: "资料/x.tmp", reason: "excluded" }])
  expect(manifest.files.some((file) => file.path.endsWith(".tmp"))).toBe(false)
})

test("按选中项备份：目录子树只含它自己", async () => {
  const directory = 造项目()
  const { deps } = 依赖(directory)
  const manifest = await runBackup(deps, { kind: "manual", scope: "资料", createdBy: "007" })
  expect(manifest.files.map((file) => file.path)).toEqual(["资料/甲.txt", "资料/乙.txt"])
  expect(manifest.dirs).toEqual(["资料"])
})

test("范围不存在 ⇒ NotFoundError", async () => {
  const directory = 造项目()
  const { deps } = 依赖(directory)
  await expect(runBackup(deps, { kind: "manual", scope: "没有", createdBy: "007" })).rejects.toMatchObject({
    name: "NotFoundError",
  })
})

test("取消 ⇒ CancelledError，且不写 manifest", async () => {
  const directory = 造项目()
  let 取消 = false
  const { deps } = 依赖(directory)
  const manifestCountBefore = (await deps.store.manifests()).length
  await expect(
    runBackup({ ...deps, isCancelled: () => 取消 }, { kind: "manual", scope: "", createdBy: "007" }).then((m) => {
      // 让取消在扫描之后发生：用第二个调用真的取消
      return m
    }),
  ).resolves.toBeDefined()
  expect((await deps.store.manifests()).length).toBe(manifestCountBefore + 1)

  取消 = true
  await expect(runBackup({ ...deps, isCancelled: () => 取消 }, { kind: "manual", scope: "资料", createdBy: "007" })).rejects.toMatchObject({
    name: "CancelledError",
  })
  expect((await deps.store.manifests()).length).toBe(manifestCountBefore + 1)
})

test("超配额 ⇒ QuotaError，且一个 blob 都不传", async () => {
  const directory = 造项目()
  const { deps } = 依赖(directory)
  await expect(
    runBackup(deps, { kind: "manual", scope: "", createdBy: "007", quotaBytes: 1, usageBytes: 0 }),
  ).rejects.toMatchObject({ name: "QuotaError" })
  expect(await deps.store.blobs()).toEqual([])
})

test("自动备份：树没变 ⇒ UnchangedError（不产生新快照）", async () => {
  const directory = 造项目()
  const { deps } = 依赖(directory)
  const first = await runBackup(deps, { kind: "auto", scope: "", createdBy: "007" })
  await expect(
    runBackup(deps, { kind: "auto", scope: "", createdBy: "007", previous: first }),
  ).rejects.toMatchObject({ name: "UnchangedError" })
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: FAIL —— `runBackup` 不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 备份 / 预览 / 恢复的**执行层**（没有 HTTP、没有 Effect）。
 *
 * 阶段顺序是**写死的**（spec §5.6）：扫描 → 哈希 → 上传 → 写 manifest。取消只在阶段边界与
 * 文件边界检查；取消或失败**不写 manifest** ⇒ 不会留下「半份备份看起来像完整备份」。
 */

import { createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, readdir, rename, rm, stat, utimes, writeFile, chmod, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  MAX_FILE_BYTES,
  type Job,
  type Manifest,
  type ManifestFile,
  type ManifestSkip,
  type SnapshotKind,
} from "./backup-model"
import { estimateManifestBytes, isExcluded, isPathInScope, isSafeRelativePath, snapshotIdOf } from "./backup-rules"
import type { BackupStore } from "./backup-store"

export class CancelledError extends Error {
  readonly name = "CancelledError"
}
export class UnchangedError extends Error {
  readonly name = "UnchangedError"
}
export class QuotaError extends Error {
  readonly name = "QuotaError"
  constructor(readonly usageBytes: number, readonly requiredBytes: number, readonly limitBytes: number) {
    super(`备份需要 ${requiredBytes} 字节，已用 ${usageBytes} / ${limitBytes}`)
  }
}
export class NotFoundError extends Error {
  readonly name = "NotFoundError"
}

export interface ScannedFile {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly mode: number
}

export interface RunDeps {
  readonly store: BackupStore
  readonly directory: string
  /** 写进 manifest 的归属。`BackupStore.readManifest` 会拿这两个值校验（防止把别人的清单当自己的）。 */
  readonly projectId: string
  readonly ownerId: string
  readonly timezone: string
  readonly report: (patch: Partial<Job>) => void
  readonly isCancelled: () => boolean
  readonly maxFileBytes?: number
  readonly concurrency?: number
}

export interface BackupInput {
  readonly kind: SnapshotKind
  readonly scope: string
  readonly createdBy: string
  /** 只有自动备份会传：用来复用哈希、并判「树没变」。 */
  readonly previous?: Manifest
  readonly quotaBytes?: number
  readonly usageBytes?: number
}

const 并发 = 4

function 检查取消(deps: RunDeps) {
  if (deps.isCancelled()) throw new CancelledError("任务已取消")
}

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failed: unknown
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      try {
        await worker(items[index]!)
      } catch (error) {
        failed ??= error
        return
      }
    }
  })
  await Promise.all(runners)
  if (failed !== undefined) throw failed
}

/** 扫描一个范围。`scope` 是文件时只返回它自己；是目录时返回整棵子树。 */
export async function scanScope(
  directory: string,
  scope: string,
  options: { maxFileBytes?: number } = {},
): Promise<{ files: ScannedFile[]; dirs: string[]; skipped: ManifestSkip[] }> {
  if (!isSafeRelativePath(scope)) throw new Error(`非法范围：${JSON.stringify(scope)}`)
  const 上限 = options.maxFileBytes ?? MAX_FILE_BYTES
  const files: ScannedFile[] = []
  const dirs: string[] = []
  const skipped: ManifestSkip[] = []
  const 绝对 = (path: string) => join(directory, ...(path === "" ? [] : path.split("/")))

  const root = scope === "" ? directory : 绝对(scope)
  let info
  try {
    info = await lstat(root)
  } catch {
    throw new NotFoundError(`路径不存在：${JSON.stringify(scope)}`)
  }

  const 收文件 = async (path: string, stats: Awaited<ReturnType<typeof lstat>>) => {
    if (isExcluded(path)) {
      skipped.push({ path, reason: "excluded" })
      return
    }
    if (stats.size > 上限) {
      skipped.push({ path, reason: "too-large" })
      return
    }
    files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs, mode: stats.mode & 0o777 })
  }

  const 走 = async (path: string, stats: Awaited<ReturnType<typeof lstat>>) => {
    if (stats.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink" })
      return
    }
    if (stats.isFile()) {
      await 收文件(path, stats)
      return
    }
    if (!stats.isDirectory()) return
    if (path !== "") dirs.push(path)
    let entries
    try {
      entries = await readdir(绝对(path), { withFileTypes: true })
    } catch {
      skipped.push({ path, reason: "unreadable" })
      return
    }
    for (const entry of entries) {
      const 子 = path === "" ? entry.name : `${path}/${entry.name}`
      let 子信息
      try {
        子信息 = await lstat(绝对(子))
      } catch {
        skipped.push({ path: 子, reason: "unreadable" })
        continue
      }
      await 走(子, 子信息)
    }
  }

  if (info.isSymbolicLink()) {
    skipped.push({ path: scope, reason: "symlink" })
  } else if (info.isFile()) {
    await 收文件(scope, info)
  } else if (info.isDirectory()) {
    await 走(scope, info)
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  dirs.sort((a, b) => a.localeCompare(b))
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  return { files, dirs, skipped }
}

async function hashFile(file: ScannedFile, absolute: string): Promise<string> {
  const before = await stat(absolute)
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolute)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  const after = await stat(absolute)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("changed-during-backup")
  }
  return hash.digest("hex")
}

/** 备份。返回写进 MinIO 的 manifest。 */
export async function runBackup(deps: RunDeps, input: BackupInput): Promise<Manifest> {
  const total = { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 }
  deps.report({ state: "scanning", progress: total })
  const 扫描 = await scanScope(deps.directory, input.scope, { maxFileBytes: deps.maxFileBytes })
  total.filesTotal = 扫描.files.length
  total.bytesTotal = 扫描.files.reduce((sum, file) => sum + file.size, 0)
  deps.report({ state: "hashing", progress: { ...total } })
  检查取消(deps)

  const 上次 = new Map<string, ManifestFile>()
  if (input.previous) for (const file of input.previous.files) 上次.set(file.path, file)

  const files: ManifestFile[] = []
  const skipped = [...扫描.skipped]
  for (const file of 扫描.files) {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    const 旧 = 上次.get(file.path)
    let hash: string
    if (input.kind === "auto" && 旧 && 旧.size === file.size && 旧.mtimeMs === file.mtimeMs) {
      hash = 旧.hash
    } else {
      try {
        hash = await hashFile(file, 绝对)
      } catch (error) {
        skipped.push({ path: file.path, reason: error instanceof Error && error.message === "changed-during-backup" ? "changed-during-backup" : "unreadable" })
        total.filesDone += 1
        deps.report({ progress: { ...total } })
        continue
      }
    }
    files.push({ path: file.path, hash, size: file.size, mtimeMs: file.mtimeMs, mode: file.mode })
    total.filesDone += 1
    deps.report({ progress: { ...total } })
  }

  检查取消(deps)
  if (input.previous && 树没变(input.previous, files, 扫描.dirs, input.scope)) throw new UnchangedError("自上次快照以来没有变化")

  const 已有 = new Set((await deps.store.blobs()).map((blob) => blob.hash))
  const 缺 = new Map<string, { size: number; path: string }>()
  for (const file of files) if (!已有.has(file.hash) && !缺.has(file.hash)) 缺.set(file.hash, { size: file.size, path: file.path })

  const 上传字节 = [...缺.values()].reduce((sum, blob) => sum + blob.size, 0)
  const 需要 = 上传字节 + estimateManifestBytes(files.reduce((sum, file) => sum + file.size, 0))
  if (input.quotaBytes !== undefined && (input.usageBytes ?? 0) + 需要 > input.quotaBytes) {
    throw new QuotaError(input.usageBytes ?? 0, 需要, input.quotaBytes)
  }

  deps.report({ state: "uploading", progress: { ...total } })
  total.bytesDone = 0
  await runPool([...缺.entries()], deps.concurrency ?? 并发, async ([hash, blob]) => {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...blob.path.split("/"))
    try {
      await deps.store.putBlob({
        hash,
        size: blob.size,
        body: 上传源(绝对, hash),
        onProgress: (bytes) => {
          total.bytesDone += bytes
          deps.report({ progress: { ...total } })
        },
      })
    } catch (error) {
      await deps.store.deleteBlob(hash).catch(() => undefined)
      throw error
    }
  })

  检查取消(deps)
  deps.report({ state: "committing", progress: { ...total } })
  const at = Date.now()
  const manifest: Manifest = {
    version: 1,
    id: snapshotIdOf(at, randomBytes(4).toString("hex")),
    projectId: deps.projectId,
    ownerId: deps.ownerId,
    kind: input.kind,
    scope: input.scope,
    createdAt: at,
    createdBy: input.createdBy,
    source: input.kind,
    timezone: deps.timezone,
    status: skipped.length === 0 ? "complete" : "partial",
    files,
    dirs: 扫描.dirs,
    skipped,
    totals: { files: files.length, bytes: total.bytesTotal, uploadedBytes: 上传字节, skipped: skipped.length },
  }
  return manifest
}

/** 上传时再算一遍哈希；与扫描时不一致就中途拒绝（spec §5.5）。 */
async function* 上传源(absolute: string, expected: string): AsyncGenerator<Uint8Array> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(absolute)) {
    hash.update(chunk as Buffer)
    yield chunk as Uint8Array
  }
  if (hash.digest("hex") !== expected) throw new Error("changed-during-backup")
}

function 树没变(previous: Manifest, files: readonly ManifestFile[], dirs: readonly string[], scope: string): boolean {
  if (previous.scope !== scope) return false
  const 旧 = previous.files.filter((file) => isPathInScope(scope, file.path))
  if (旧.length !== files.length) return false
  for (let i = 0; i < files.length; i += 1) {
    const a = 旧[i]!
    const b = files[i]!
    if (a.path !== b.path || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.hash !== b.hash) return false
  }
  return previous.dirs.length === dirs.length && previous.dirs.every((dir, index) => dir === dirs[index])
}
```

> **实施者注意**：`runBackup` **只返回** manifest，**不写**它——`store.writeManifest` 由调用方（`backup.ts` 的任务执行体）做。这样「扫描 → 哈希 → 上传 → 提交」的每一步都能在测试里单独观察，也保证取消 / 失败不会留下半份清单。`deps.projectId` / `deps.ownerId` 必须由调用方传真实值（`BackupStore.readManifest` 拿它们做归属校验）。

- [ ] **Step 4: 跑绿**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: PASS。

- [ ] **Step 5: 变异验证（④ 步）**

拆掉 `if (input.previous && 树没变(...)) throw new UnchangedError(...)` 这一行 ⇒ 「树没变 ⇒ UnchangedError」必须红，其余全绿。记录「恰好红 1 条」。

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/server/openhive/backup-run.ts packages/opencode/test/server/openhive-backup-auto.test.ts
git commit -m "feat(backup): 扫描/哈希/上传/写清单执行链

【保留的定制 · 同步上游时不要丢】
- manifest-last：取消或失败不写清单
- 内容寻址 + 同项目内去重；自动备份复用未变化文件的哈希"
```

---

### Task 8: 预览与恢复执行

**Files:**
- Modify: `packages/opencode/src/server/openhive/backup-run.ts`
- Test: `packages/opencode/test/server/openhive-backup-auto.test.ts`（追加）

**Interfaces:**
- Consumes: Task 7 的 `RunDeps`、`CancelledError`。
- Produces:
  - `runPreview(deps, input: { manifest; scope }): Promise<RestorePreview>`
  - `runRestore(deps, input: { manifest; scope; global; decisions }): Promise<RestoreResult>`

- [ ] **Step 1: 写会红的测试**

```ts
import { readFileSync } from "node:fs"
import { runPreview, runRestore } from "../../src/server/openhive/backup-run"

async function 备一份(directory: string): Promise<Manifest> {
  const { deps } = 依赖(directory)
  return (deps as never as { store: ReturnType<typeof store> }) && (await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" }))
}

test("预览：missing / same / different / type-mismatch 四种状态", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  // 改一个、删一个、把一个文件变成目录
  writeFileSync(join(directory, "资料", "甲.txt"), "changed")
  rmSync(join(directory, "资料", "乙.txt"))
  rmSync(join(directory, "报告.docx"))
  mkdirSync(join(directory, "报告.docx"))

  const { deps } = 依赖(directory)
  const preview = await runPreview(deps, { manifest, scope: "" })
  const 状态 = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.status]))
  expect(状态["资料/甲.txt"]).toBe("different")
  expect(状态["资料/乙.txt"]).toBe("missing")
  expect(状态["报告.docx"]).toBe("type-mismatch")
  expect(preview.counts).toEqual({ missing: 1, same: 0, different: 1, "type-mismatch": 1 })
})

test("恢复：missing 直接恢复，same 跳过，different 按 keep-both 生成新名字", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  writeFileSync(join(directory, "资料", "甲.txt"), "changed")
  rmSync(join(directory, "资料", "乙.txt"))
  rmSync(join(directory, "报告.docx"))

  const { deps } = 依赖(directory)
  const result = await runRestore(deps, { manifest, scope: "", global: "keep-both", decisions: {} })
  expect(result.restored).toEqual(["资料/乙.txt", "报告.docx"])
  expect(result.keptBoth).toEqual(["资料/甲.txt"])
  expect(readFileSync(join(directory, "资料", "乙.txt"), "utf8")).toBe("bbb")
  expect(readFileSync(join(directory, "报告.docx"), "utf8")).toBe("ccc")
  expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("changed")
  const 目录 = readdirSync(join(directory, "资料"))
  expect(目录.some((name) => name.startsWith("甲 (MinIO "))).toBe(true)
})

test("恢复：overwrite 覆盖；skip 不动", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  writeFileSync(join(directory, "资料", "甲.txt"), "changed")

  const { deps } = 依赖(directory)
  const 覆盖 = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
  expect(覆盖.restored).toContain("资料/甲.txt")
  expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("aaa")

  writeFileSync(join(directory, "资料", "甲.txt"), "again")
  const 跳过 = await runRestore(deps, { manifest, scope: "", global: "skip", decisions: {} })
  expect(跳过.skipped).toContain("资料/甲.txt")
  expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("again")
})

test("恢复：类型冲突只能按 skip 处理（不删目录）", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  rmSync(join(directory, "报告.docx"))
  mkdirSync(join(directory, "报告.docx"))

  const { deps } = 依赖(directory)
  const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
  expect(result.failed).toEqual([{ path: "报告.docx", reason: "type-mismatch" }])
  expect(statSync(join(directory, "报告.docx")).isDirectory()).toBe(true)
})

test("恢复：blob 缺失 ⇒ failed，不留下半截临时文件", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  rmSync(join(directory, "报告.docx"))
  const { deps } = 依赖(directory)
  await deps.store.deleteBlob(manifest.files.find((file) => file.path === "报告.docx")!.hash)
  const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
  expect(result.failed).toEqual([{ path: "报告.docx", reason: "blob-missing" }])
  expect(readdirSync(directory).some((name) => name.startsWith(".openhive-restore-"))).toBe(false)
})

test("恢复：不写穿符号链接", async () => {
  const directory = 造项目()
  const manifest = await 备一份(directory)
  rmSync(join(directory, "报告.docx"))
  // win32 建符号链接要管理员；不可用就跳过（如实记缺口，不写成覆盖）
  try {
    symlinkSync(join(directory, "资料"), join(directory, "报告.docx"), "dir")
  } catch {
    return
  }
  const { deps } = 依赖(directory)
  const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
  expect(result.failed).toEqual([{ path: "报告.docx", reason: "symlink" }])
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: FAIL —— `runPreview` / `runRestore` 不存在。

- [ ] **Step 3: 实现**

追加：

```ts
export interface PreviewInput {
  readonly manifest: Manifest
  readonly scope: string
}

/** 预览：逐文件比对并列出「仅本地」。条数有上限（spec §6.2）。 */
export async function runPreview(deps: RunDeps, input: PreviewInput): Promise<RestorePreview> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const entries: RestorePreviewEntry[] = []
  const counts: Record<PreviewStatus, number> = { missing: 0, same: 0, different: 0, "type-mismatch": 0 }
  for (const file of 目标) {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    let stats
    try {
      stats = await lstat(绝对)
    } catch {
      counts.missing += 1
      if (entries.length < PREVIEW_LIMIT) entries.push({ path: file.path, status: "missing" })
      continue
    }
    let status: PreviewStatus
    if (stats.isSymbolicLink() || !stats.isFile()) status = "type-mismatch"
    else if (stats.size !== file.size) status = "different"
    else {
      const 本地 = await hashFile({ path: file.path, size: stats.size, mtimeMs: stats.mtimeMs, mode: stats.mode & 0o777 }, 绝对).catch(() => undefined)
      status = 本地 === file.hash ? "same" : "different"
    }
    counts[status] += 1
    if (entries.length < PREVIEW_LIMIT) entries.push({ path: file.path, status })
  }

  const 清单里 = new Set(目标.map((file) => file.path))
  const localOnly: string[] = []
  let 仅本地超限 = false
  for (const file of (await scanScope(deps.directory, input.scope)).files) {
    if (清单里.has(file.path)) continue
    if (localOnly.length >= LOCAL_ONLY_LIMIT) {
      仅本地超限 = true
      break
    }
    localOnly.push(file.path)
  }

  return {
    snapshotId: input.manifest.id,
    scope: input.scope,
    counts,
    entries,
    truncated: 目标.length > entries.length,
    localOnly,
    localOnlyTruncated: 仅本地超限,
  }
}

export interface RestoreInput {
  readonly manifest: Manifest
  readonly scope: string
  readonly global: RestoreDecision
  readonly decisions: Readonly<Record<string, RestoreDecision>>
}

/** 恢复。逐文件：临时文件 → 边写边校验 → rename 两次（spec §6.4）。 */
export async function runRestore(deps: RunDeps, input: RestoreInput): Promise<RestoreResult> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const restored: string[] = []
  const keptBoth: string[] = []
  const skipped: string[] = []
  const failed: { path: string; reason: string }[] = []
  let cancelled = false

  // 空目录先建（spec §6.4）
  for (const dir of input.manifest.dirs) {
    if (!isPathInScope(input.scope, dir)) continue
    try {
      await mkdir(join(deps.directory, ...dir.split("/")), { recursive: true })
    } catch {
      // 目录建不出来时具体文件会逐个失败，不在这里吞掉整个恢复。
    }
  }

  for (const file of 目标) {
    if (deps.isCancelled()) {
      cancelled = true
      break
    }
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    const 决定 = input.decisions[file.path] ?? input.global
    let stats
    try {
      stats = await lstat(绝对)
    } catch {
      stats = undefined
    }

    if (stats?.isSymbolicLink() || (stats && !stats.isFile())) {
      // 不写穿符号链接；类型冲突只允许跳过（覆盖要先删用户目录，本版不给）。
      failed.push({ path: file.path, reason: stats.isSymbolicLink() ? "symlink" : "type-mismatch" })
      continue
    }
    const 相同 = stats?.isFile() && stats.size === file.size
    if (相同) {
      const 本地 = await hashFile({ path: file.path, size: stats.size, mtimeMs: stats.mtimeMs, mode: stats.mode & 0o777 }, 绝对).catch(() => undefined)
      if (本地 === file.hash) {
        skipped.push(file.path)
        continue
      }
    }
    if (stats && 决定 === "skip") {
      skipped.push(file.path)
      continue
    }

    let 目标路径 = file.path
    if (stats && 决定 === "keep-both") {
      目标路径 = keepBothName(file.path, input.manifest.createdAt, (candidate) => {
        try {
          lstatSync(join(deps.directory, ...candidate.split("/")))
          return true
        } catch {
          return false
        }
      })
    }
    const 目标绝对 = join(deps.directory, ...目标路径.split("/"))
    try {
      await mkdir(dirname(目标绝对), { recursive: true })
      const body = await deps.store.openBlob({ hash: file.hash })
      if (body === undefined) {
        failed.push({ path: file.path, reason: "blob-missing" })
        continue
      }
      const 临时 = join(dirname(目标绝对), `.openhive-restore-${randomUUID()}.tmp`)
      const hash = createHash("sha256")
      let 收到 = 0
      const 句柄 = await open(临时, "w")
      try {
        for await (const chunk of body) {
          hash.update(chunk)
          收到 += chunk.byteLength
          await 句柄.write(chunk)
        }
        await 句柄.sync()
      } finally {
        await 句柄.close()
      }
      if (hash.digest("hex") !== file.hash || 收到 !== file.size) {
        await rm(临时, { force: true })
        failed.push({ path: file.path, reason: "hash-mismatch" })
        continue
      }
      const 旧 = stats ? join(dirname(目标绝对), `.openhive-old-${randomUUID()}`) : undefined
      if (旧) await rename(目标绝对, 旧)
      await rename(临时, 目标绝对)
      if (旧) await rm(旧, { force: true })
      if (file.mode !== undefined && process.platform !== "win32") await chmod(目标绝对, file.mode)
      await utimes(目标绝对, file.mtimeMs / 1000, file.mtimeMs / 1000)
      if (目标路径 === file.path) restored.push(file.path)
      else keptBoth.push(file.path)
    } catch (error) {
      failed.push({ path: file.path, reason: error instanceof Error ? error.message : "unknown" })
      // 临时文件由上面的 catch 之外那条路径清理；这里再兜一次（幂等）。
      const 残留 = readdirSync(dirname(目标绝对)).filter((name) => name.startsWith(".openhive-restore-"))
      for (const name of 残留) rmSync(join(dirname(目标绝对), name), { force: true })
    }
  }

  return { restored, keptBoth, skipped, failed, cancelled }
}
```

补 import：`open, lstatSync, readdirSync, rmSync`（`node:fs`）、`randomUUID`、`keepBothName`、`PREVIEW_LIMIT`、`LOCAL_ONLY_LIMIT`、`RestoreDecision`、`RestorePreview`、`RestorePreviewEntry`、`PreviewStatus`、`RestoreResult`。

- [ ] **Step 4: 跑绿**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: PASS（符号链接那条在无权限环境里**跳过**，报告里如实写「win32 无管理员权限时未覆盖」）。

- [ ] **Step 5: 提交**

```bash
git add packages/opencode/src/server/openhive/backup-run.ts packages/opencode/test/server/openhive-backup-auto.test.ts
git commit -m "feat(backup): 恢复预览与逐文件恢复（临时文件 + 哈希校验 + 两步 rename）

【保留的定制 · 同步上游时不要丢】
- 不写穿符号链接；类型冲突只允许跳过
- 取消保留已替换文件，不回滚"
```

---

### Task 9: 自动备份调度、保留与 GC

**Files:**
- Create: `packages/opencode/src/server/openhive/backup-auto.ts`
- Test: `packages/opencode/test/server/openhive-backup-auto.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3/4 规则、Task 5 `BackupStore`、Task 6 `JobRegistry`。
- Produces:
  - `createAutoScheduler(deps): AutoScheduler`
  - `applyRetention(store, { now, timeZone }): Promise<readonly string[]>`
  - `collectGarbage(store, { now, graceMs? }): Promise<{ deleted; bytes }>`
  - `contextStatus(store): Promise<{ usageBytes; autoPaused }>`

- [ ] **Step 1: 写会红的测试**

```ts
import { applyRetention, collectGarbage, createAutoScheduler, contextStatus } from "../../src/server/openhive/backup-auto"

test("调度：心跳后 tick 触发 detect；冷却期内不重复；30 分钟不活跃移出", async () => {
  let now = 0
  const 调过: string[] = []
  const scheduler = createAutoScheduler({
    now: () => now,
    isRunning: () => false,
    detect: async (userId, projectId) => {
      调过.push(`${userId}/${projectId}`)
    },
  })
  scheduler.heartbeat("007", "p-42")
  await scheduler.tick()
  expect(调过).toEqual(["007/p-42"])

  now += 60 * 60_000 - 1
  await scheduler.tick()
  expect(调过).toEqual(["007/p-42"])

  now += 1
  await scheduler.tick()
  expect(调过).toEqual(["007/p-42", "007/p-42"])

  now += 30 * 60_000 + 1
  await scheduler.tick()
  expect(scheduler.entries()).toEqual([])
})

test("调度：任务在跑就跳过，不排队", async () => {
  let now = 0
  let 跑着 = true
  const 调过: string[] = []
  const scheduler = createAutoScheduler({
    now: () => now,
    isRunning: () => 跑着,
    detect: async () => {
      调过.push("x")
    },
  })
  scheduler.heartbeat("007", "p-42")
  await scheduler.tick()
  expect(调过).toEqual([])
  跑着 = false
  await scheduler.tick()
  expect(调过).toEqual(["x"])
})

test("保留：超过 84 天且非最新的自动快照被删，最新保留", async () => {
  const s = store()
  const now = Date.parse("2026-10-18T12:00:00.000Z")
  await s.writeManifest({ ...清单("20261018T115959000Z-aaaaaa"), createdAt: now - 1000, id: "20261018T115959000Z-aaaaaa" })
  await s.writeManifest({ ...清单("20260725T120000000Z-bbbbbb"), createdAt: now - 85 * 86400_000, id: "20260725T120000000Z-bbbbbb" })
  const 删 = await applyRetention(s, { now, timeZone: "Asia/Shanghai" })
  expect(删).toEqual(["20260725T120000000Z-bbbbbb"])
  expect(await s.readManifest("20260725T120000000Z-bbbbbb")).toBeUndefined()
})

test("GC：24 小时宽限内不删；超期且无引用才删；任一 manifest 坏了就整轮不删", async () => {
  const s = store()
  const now = Date.parse("2026-10-18T12:00:00.000Z")
  const manifest = { ...清单("20261018T115959000Z-aaaaaa"), files: [{ path: "a.txt", hash: "a".repeat(64), size: 1, mtimeMs: 1 }] }
  await s.writeManifest(manifest)
  async function* 源() {
    yield new TextEncoder().encode("x")
  }
  await s.putBlob({ hash: "a".repeat(64), body: 源(), size: 1 })
  await s.putBlob({ hash: "b".repeat(64), body: 源(), size: 1 })

  // 两个 blob 都是「刚写的」⇒ 宽限内，不删
  expect(await collectGarbage(s, { now })).toEqual({ deleted: 0, bytes: 0 })

  // 时间推到 25 小时后：引用的 a 保留，无引用的 b 删除
  const 结果 = await collectGarbage(s, { now: now + 25 * 60 * 60_000 })
  expect(结果.deleted).toBe(1)
  expect((await s.blobs()).map((blob) => blob.hash)).toEqual(["a".repeat(64)])

  // 放一份坏 manifest ⇒ fail-closed
  s3.seed("007/_openhive-backups/p-42/manifests/20261018T130000000Z-cccccc.json.gz", "坏")
  await s.putBlob({ hash: "c".repeat(64), body: 源(), size: 1 })
  expect(await collectGarbage(s, { now: now + 50 * 60 * 60_000 })).toEqual({ deleted: 0, bytes: 0 })
})

test("contextStatus：state 丢了就从 manifest 重建用量", async () => {
  const s = store()
  await s.writeManifest(清单())
  expect(await contextStatus(s)).toEqual({ usageBytes: expect.any(Number), autoPaused: false })
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 自动备份调度（spec §7）、分级保留（§8.1）、GC（§8.4）。
 *
 * 单实例假设：`active` 是进程内 Map。多实例时每个实例各扫各的，靠 MinIO 上的单飞锁不够
 * （锁也在内存里）——spec §7.6 已登记。
 */

import {
  ACTIVE_WINDOW_MS,
  AUTO_COOLDOWN_MS,
  GC_GRACE_MS,
  STATE_VERSION,
  type BackupState,
  type SnapshotSummary,
} from "./backup-model"
import { rebuildSnapshots, type BackupStore } from "./backup-store"
import { referencedHashes, retentionKeepIds } from "./backup-rules"

export interface AutoSchedulerDeps {
  readonly now: () => number
  readonly detect: (userId: string, projectId: string) => Promise<void>
  readonly isRunning: (userId: string, projectId: string) => boolean
  readonly activeWindowMs?: number
  readonly cooldownMs?: number
}

export interface AutoScheduler {
  readonly heartbeat: (userId: string, projectId: string) => void
  readonly markDirty: (userId: string, projectId: string) => void
  readonly tick: () => Promise<void>
  readonly checkNow: (userId: string, projectId: string) => Promise<void>
  readonly entries: () => readonly { userId: string; projectId: string; lastSeenAt: number; lastAutoAt: number }[]
}

interface 活跃项 {
  lastSeenAt: number
  lastAutoAt: number
  dirty: boolean
}

export function createAutoScheduler(deps: AutoSchedulerDeps): AutoScheduler {
  const now = deps.now
  const 活跃窗 = deps.activeWindowMs ?? ACTIVE_WINDOW_MS
  const 冷却 = deps.cooldownMs ?? AUTO_COOLDOWN_MS
  const active = new Map<string, 活跃项>()
  const 键 = (userId: string, projectId: string) => `${userId}/${projectId}`

  const 该拍 = (entry: 活跃项, at: number) => at - entry.lastAutoAt >= 冷却

  const checkNow = async (userId: string, projectId: string) => {
    const key = 键(userId, projectId)
    const entry = active.get(key)
    if (entry === undefined) return
    const at = now()
    if (at - entry.lastSeenAt > 活跃窗) {
      active.delete(key)
      return
    }
    if (!该拍(entry, at) || deps.isRunning(userId, projectId)) return
    entry.lastAutoAt = at
    try {
      await deps.detect(userId, projectId)
    } catch {
      // 失败不更新 lastAutoAt 才符合 spec；这里已经写了，回滚它。
      entry.lastAutoAt = at - 冷却
    }
  }

  return {
    heartbeat: (userId, projectId) => {
      const key = 键(userId, projectId)
      const entry = active.get(key)
      if (entry === undefined) active.set(key, { lastSeenAt: now(), lastAutoAt: 0, dirty: true })
      else entry.lastSeenAt = now()
    },
    markDirty: (userId, projectId) => {
      const entry = active.get(键(userId, projectId))
      if (entry !== undefined) entry.dirty = true
    },
    tick: async () => {
      for (const key of [...active.keys()]) {
        const separator = key.indexOf("/")
        await checkNow(key.slice(0, separator), key.slice(separator + 1))
      }
    },
    checkNow,
    entries: () =>
      [...active.entries()].map(([key, entry]) => {
        const separator = key.indexOf("/")
        return {
          userId: key.slice(0, separator),
          projectId: key.slice(separator + 1),
          lastSeenAt: entry.lastSeenAt,
          lastAutoAt: entry.lastAutoAt,
        }
      }),
  }
}

/** state 的摘要与用量；state 不在 / 坏了就从 manifest 重建。 */
export async function contextStatus(store: BackupStore): Promise<{ usageBytes: number; autoPaused: boolean }> {
  const state = await store.readState()
  if (state !== undefined) return { usageBytes: state.usageBytes, autoPaused: state.autoPaused }
  const 重建 = await rebuildSnapshots(store)
  const blobs = await store.blobs()
  return { usageBytes: blobs.reduce((sum, blob) => sum + blob.size, 0), autoPaused: false }
}

async function 读全部清单(store: BackupStore): Promise<{ manifests: readonly import("./backup-model").Manifest[]; ok: boolean }> {
  const listed = await store.manifests()
  const manifests: import("./backup-model").Manifest[] = []
  for (const entry of listed) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) manifests.push(manifest)
    } catch {
      return { manifests, ok: false }
    }
  }
  return { manifests, ok: true }
}

/** 分级保留：删 manifest（不删 blob，交给 GC）。返回被删的快照 id。 */
export async function applyRetention(
  store: BackupStore,
  options: { now: number; timeZone: string },
): Promise<readonly string[]> {
  const listed = await store.manifests()
  const snapshots: SnapshotSummary[] = []
  for (const entry of listed) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) {
        snapshots.push({
          id: manifest.id,
          kind: manifest.kind,
          scope: manifest.scope,
          createdAt: manifest.createdAt,
          status: manifest.status,
          totals: manifest.totals,
        })
      }
    } catch {
      // 坏 manifest 不动它：删不掉的判断与删错相比，后者代价大得多。
    }
  }
  const keep = retentionKeepIds(snapshots, options.now, options.timeZone)
  const 删 = snapshots.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => snapshot.id)
  for (const id of 删) await store.deleteManifest(id)

  const state = await store.readState()
  if (state !== undefined && 删.length > 0) {
    await store.writeState({ ...state, snapshots: state.snapshots.filter((snapshot) => !删.includes(snapshot.id)) })
  }
  return 删
}

/**
 * GC：删「没有任何 manifest 引用、且最后修改超过 `graceMs`」的 blob。
 *
 * **fail-closed**：任一 manifest 读不了，整轮一个都不删（不然可能删掉那份坏清单正引用的 blob）。
 */
export async function collectGarbage(
  store: BackupStore,
  options: { now: number; graceMs?: number },
): Promise<{ deleted: number; bytes: number }> {
  const { manifests, ok } = await 读全部清单(store)
  if (!ok) return { deleted: 0, bytes: 0 }
  const 引用 = referencedHashes(manifests)
  const 宽限 = options.graceMs ?? GC_GRACE_MS
  let deleted = 0
  let bytes = 0
  for (const blob of await store.blobs()) {
    if (引用.has(blob.hash)) continue
    if (blob.lastModified > options.now - 宽限) continue
    await store.deleteBlob(blob.hash)
    deleted += 1
    bytes += blob.size
  }
  return { deleted, bytes }
}

/** 写回 state：用量 = 剩余 blob 字节 + 全部 manifest 文件大小。 */
export async function syncState(store: BackupStore, options: { now: number; autoPaused: boolean }): Promise<BackupState> {
  const blobs = await store.blobs()
  const listed = await store.manifests()
  const usageBytes = blobs.reduce((sum, blob) => sum + blob.size, 0) + listed.reduce((sum, entry) => sum + entry.size, 0)
  const 重建 = await rebuildSnapshots(store)
  const state: BackupState = {
    version: STATE_VERSION,
    usageBytes,
    lastGcAt: options.now,
    autoPaused: options.autoPaused,
    snapshots: 重建.map((entry) => entry.summary),
  }
  await store.writeState(state)
  return state
}
```

- [ ] **Step 4: 跑绿**

Run: `cd packages/opencode && bun test test/server/openhive-backup-auto.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/opencode/src/server/openhive/backup-auto.ts packages/opencode/test/server/openhive-backup-auto.test.ts
git commit -m "feat(backup): 自动调度、分级保留与 fail-closed GC

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 10: 审计表迁移与写入 helper

**Files:**
- Create: `packages/auth/src/migrations/0007_project_backup_event.sql`
- Create: `packages/auth/src/migrations/0007_project_backup_event.down.sql`
- Create: `packages/auth/src/project-backup-event.ts`
- Test: `packages/auth/src/project-backup-event.test.ts`

**Interfaces:**
- Consumes: `authSchema`（`./project-member` 的同款写法）、`ProjectMemberTarget`。
- Produces:
  - `recordBackupEvent(target, event: { projectId; userId; action; snapshotId?; detail? }): Promise<void>`
  - `listBackupEvents(target, projectId, limit?): Promise<BackupEventRow[]>`

- [ ] **Step 1: 写迁移**

`0007_project_backup_event.sql`（语句间必须有 `--> statement-breakpoint`，前后留空行）：

```sql
-- 文件级备份快照的审计流水（2026-10-18，spec §9.3）。
-- 只增不改：每一次备份 / 恢复 / 删除恢复点 / 自动备份暂停都留一行。
-- 不存文件内容，`detail` 只放可检索的摘要（条数、字节数、冲突策略）。

CREATE TABLE IF NOT EXISTS auth.project_backup_event (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot_id TEXT,
  detail JSONB,
  created_at BIGINT NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_backup_event_project_created_idx
  ON auth.project_backup_event (project_id, created_at DESC);

--> statement-breakpoint

COMMENT ON TABLE auth.project_backup_event IS
  '文件级备份快照审计（只增不改）；created_at 是 Unix 秒，与 auth 其它表同口径';
```

`0007_project_backup_event.down.sql`：

```sql
DROP INDEX IF EXISTS auth.project_backup_event_project_created_idx;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.project_backup_event;
```

- [ ] **Step 2: 写会红的测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startProductionDb, type ProductionDb } from "./test-support"
import { migrate } from "./migrate"
import { listBackupEvents, recordBackupEvent } from "./project-backup-event"

let pg: ProductionDb
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg.stop()
})

test("写一条审计：字段逐字落库，按项目倒序列出", async () => {
  await recordBackupEvent(pg.db, {
    projectId: "p-42",
    userId: "007",
    action: "backup",
    snapshotId: "20261018T140305123Z-abcdef",
    detail: { files: 3, bytes: 9 },
  })
  const rows = await listBackupEvents(pg.db, "p-42")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    project_id: "p-42",
    user_id: "007",
    action: "backup",
    snapshot_id: "20261018T140305123Z-abcdef",
    detail: { files: 3, bytes: 9 },
  })
})

test("detail 可省略", async () => {
  await recordBackupEvent(pg.db, { projectId: "p-99", userId: "008", action: "restore" })
  expect((await listBackupEvents(pg.db, "p-99"))[0]?.detail).toBeNull()
})
```

- [ ] **Step 3: 跑红**

Run: `cd packages/auth && bun test src/project-backup-event.test.ts`
Expected: FAIL —— 模块不存在 / 表不存在。

- [ ] **Step 4: 实现**

```ts
/**
 * 文件级备份快照的审计写入（spec §9.3）。
 *
 * 与 `project-member.ts` 同一个形状：只认一个 `execute(query)` 的窄目标——测试能直接塞
 * PGlite 连接，生产塞 `OpenhivePg` 的池。**审计写失败不让主流程失败**是调用方的责任
 * （`backup.ts` 里 `.catch(() => undefined)`），不是这里的。
 */

import { sql } from "drizzle-orm"
import type { ProjectMemberTarget } from "./project-member"

export interface BackupEventInput {
  readonly projectId: string
  readonly userId: string
  readonly action: "backup" | "restore" | "delete-snapshot" | "auto-backup-paused"
  readonly snapshotId?: string
  readonly detail?: Record<string, unknown>
}

export interface BackupEventRow {
  readonly id: number
  readonly project_id: string
  readonly user_id: string
  readonly action: string
  readonly snapshot_id: string | null
  readonly detail: unknown
  readonly created_at: number
}

export async function recordBackupEvent(target: ProjectMemberTarget, event: BackupEventInput): Promise<void> {
  await target.execute(
    sql`INSERT INTO auth.project_backup_event (project_id, user_id, action, snapshot_id, detail, created_at)
        VALUES (${event.projectId}, ${event.userId}, ${event.action}, ${event.snapshotId ?? null},
                ${event.detail === undefined ? null : JSON.stringify(event.detail)}::jsonb,
                ${Math.floor(Date.now() / 1000)})`,
  )
}

export async function listBackupEvents(
  target: ProjectMemberTarget,
  projectId: string,
  limit = 50,
): Promise<readonly BackupEventRow[]> {
  const result = await target.execute(
    sql`SELECT id, project_id, user_id, action, snapshot_id, detail, created_at
        FROM auth.project_backup_event
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}`,
  )
  return (result as { rows?: BackupEventRow[] }).rows ?? []
}
```

- [ ] **Step 5: 跑绿 + 提交**

Run: `cd packages/auth && bun test src/project-backup-event.test.ts src/migrate.test.ts`
Expected: PASS。

```bash
git add packages/auth/src/migrations/0007_project_backup_event.sql packages/auth/src/migrations/0007_project_backup_event.down.sql packages/auth/src/project-backup-event.ts packages/auth/src/project-backup-event.test.ts
git commit -m "feat(auth): 备份快照审计表与读写 helper

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 11: HTTP 出口 `backup.ts`

**Files:**
- Create: `packages/opencode/src/server/openhive/backup.ts`
- Test: `packages/opencode/test/server/openhive-backup.test.ts`

**Interfaces:**
- Consumes: Task 3–10 的全部产物；`archive.ts` 的 `MinioConfig` / `MinioSettings` / `endpointOf` / 四个响应构造函数；`@opencode-ai/auth/project-member` 的 `membersOf` / `archiveStatesOf`；`ProjectMembership.asRole`；`OpenhivePg`；`User`；`PREFIX`（`./project`）。
- Produces:
  - `OpenhiveBackup.routes`（`HttpRouter` 层）
  - `PATH` 九个端点（spec §10.1）

**先确认两条已实测的事实（实施时不必再猜）：**

1. `HttpRouter` 底层是 `find-my-way-ts`，支持 `:param`，并把匹配结果放进 `RouteContext`；处理器里 `yield* HttpRouter.params` 就能拿到 `{ snapshotId }` / `{ jobId }`。**不要**从 URL 字符串里切末段（那是没有 `:param` 先例时的旧思路）。
2. `HttpServerResponse.jsonUnsafe(...)` 返回的是 Effect 自己的 `HttpServerResponse`，**不是**全局 `Response`。所以「授权失败」不能靠 `instanceof Response` 区分，用一个判别式对象（见 Step 4）。

- [ ] **Step 1: 给 `archive.ts` 的四个响应构造函数加 `export`，并补一个可选的 `code`**

`packages/opencode/src/server/openhive/archive.ts:266-289` 的 `unauthorized` / `badRequest` / `forbidden` / `unavailable` 目前是模块私有的。改成：

```ts
export function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

/** `code` 是 spec §10.3 要求的机器可读错误码；默认值让归档一侧的既有响应保持不变。 */
export function badRequest(message: string, code = "bad_request") {
  return HttpServerResponse.jsonUnsafe({ error: message, code }, { status: BAD_REQUEST })
}

export function forbidden(message: string, code = "forbidden") {
  return HttpServerResponse.jsonUnsafe({ error: message, code }, { status: FORBIDDEN })
}

export function unavailable(message: string, code = "minio_unconfigured") {
  return HttpServerResponse.jsonUnsafe({ error: message, code }, { status: UNAVAILABLE })
}
```

⚠️ 两件事**都已实测**，别当成形式主义：

1. 归档测试读响应体用的是 `Schema.Struct({ error: Schema.String })`——Effect Schema 解码**忽略多余字段**，所以多一个 `code` 不会让那三条用例红。（改完**仍要跑** `bun test test/server/openhive-project-archive-unconfigured.test.ts` 确认，别只信这句话。）
2. `401` 不带 `code`（spec §10.3 该行就是 `—`），`unauthorized()` **保持不变**（空体）。

理由（写进提交信息）：`backup.ts` 与 `archive.ts` 是同一个 HTTP 出口族的两个出口，状态码与文案口径必须同源；各写一份就是 `LEARNINGS #002-06`。`membersOf` / `archiveStatesOf` **不要**从 `archive.ts` 拿——它们本来就来自 `@opencode-ai/auth/project-member`（`archive.ts:101-110`），直接 import 那个包。

- [ ] **Step 2: 写会红的集成测试**

**先抄 harness，不要从零写**（`LEARNINGS #004-12`：同一条链的新出口，把同族测试的 harness 整段抄来、只换判据点）。来源是 `packages/opencode/test/server/openhive-project-archive.test.ts`：把它文件头到 `as(...)` / `json(...)` 这几个 helper（含 `SECRET` / `ALICE` / `BOB` / `restorePoint` / `token` / `startProductionDb` / `migrate` / `startFakeS3` / `realApp` / `OPEN`）**原样复制**到新文件，只做下面三处增改：

1. **不要**在模块顶层预造项目目录。归档测试里那几行 `mkdirSync(join(SANDBOX, …))` 会被一起抄过来——**删掉**：本项目每个用例用下面的 `新项目()` 现造一个（`SANDBOX` 只是临时根，项目落在 `WORKSPACE_ROOT/<userId>/<projectId>`；`ALICE` 是对象，写 `ALICE.id` 才是字符串）。共用一个 `p-42` 会让「快照列表有几条」这条断言被上一条用例的残留污染。

2. `OPEN` 里补五个 MinIO 变量（archive 测试本来就有，逐字确认，不要漏 `OPENHIVE_MINIO_USE_SSL`）：

```ts
OPENHIVE_MINIO_ENDPOINT: s3.endpoint,
OPENHIVE_MINIO_BUCKET: s3.bucket,
OPENHIVE_MINIO_ACCESS_KEY: "k",
OPENHIVE_MINIO_SECRET_KEY: "s",
OPENHIVE_MINIO_USE_SSL: "false",
```

3. 文件名头写清：**一个文件只建一个 app**（archive 测试文件头记过：新 app 的第一条 PG 查询会 500，随后自愈）。

然后追加用例。**写法照抄归档测试的 Effect 风格**（`const it = testEffect(Layer.empty)`，用例体是
`it.live(name, () => Effect.gen(...))`；`as(...)` 返回的是 **Effect**，不是 Promise）。再补三个夹具：

```ts
const BACKUP = "/openhive/project/backup"

/** POST 请求的固定形状（`Content-Type` 必须写，否则 `request.json` 直接失败）。 */
const 体 = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
})

/**
 * 新建一个有 owner、有文件的项目。**每个用例一个项目**——快照列表的断言才有干净的观测面。
 *
 * ⚠️ 建项目走**真实出口** `createAs(ALICE, …)`（归档测试里现成的一个 helper），
 * **不要**直接写 `project_member` 造 owner：那会绕过生产注册链（`#006-28`），
 * 而且项目目录归 `createAs` 那一步建好；这里只往里放两个文件当**输入**。
 */
const 新项目 = () =>
  Effect.gen(function* () {
    const project = yield* createAs(ALICE, { name: `备份·${Date.now()}·${randomUUID().slice(0, 6)}`, type: "private" })
    const directory = path.join(WORKSPACE_ROOT, ALICE.id, project.id)
    mkdirSync(path.join(directory, "资料"), { recursive: true })
    writeFileSync(path.join(directory, "资料", "甲.txt"), "aaa")
    writeFileSync(path.join(directory, "报告.docx"), "ccc")
    return { projectId: project.id, directory }
  })

/** `GET /jobs/{id}` 的线上形状（只收本文件要断的字段，别的会被 Schema 丢掉）。 */
const JobWire = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })),
  result: Schema.optional(Schema.Struct({ snapshotId: Schema.optional(Schema.String) })),
})

/** 轮询到终态。**等条件不等时间**（`#006-31`）：200 次 × 50ms ＝ 上限 10 秒。 */
const 等到终态 = (jobId: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const 响应 = yield* as(openApp, ALICE, `${BACKUP}/jobs/${jobId}`)
      expect(响应.status).toBe(200)
      const job = yield* json(JobWire, 响应)
      if (job.state === "succeeded" || job.state === "failed" || job.state === "cancelled") return job
      yield* Effect.sleep("50 millis")
    }
    return yield* Effect.fail(new Error("任务 10 秒内没有进入终态"))
  })
```

```ts
describe("文件级备份快照 · HTTP 出口", () => {
  it.live("POST /backup：202 + jobId；轮询到 succeeded 后能列出快照并读到文件清单", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
      expect(起.status).toBe(202)
      const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)

      const job = yield* 等到终态(jobId)
      expect(job.state).toBe("succeeded")
      expect(job.result?.snapshotId).toBeTruthy()

      const 列 = yield* as(openApp, ALICE, `${BACKUP}/snapshots?projectId=${project.projectId}`)
      expect(列.status).toBe(200)
      const body = yield* json(
        Schema.Struct({
          snapshots: Schema.Array(
            Schema.Struct({ id: Schema.String, kind: Schema.String, scope: Schema.String }),
          ),
          truncated: Schema.Boolean,
        }),
        列,
      )
      expect(body.truncated).toBe(false)
      expect(body.snapshots).toHaveLength(1)
      expect(body.snapshots[0]?.kind).toBe("manual")

      // 下树要用的「这个恢复点里有哪些文件」
      const 明细 = yield* as(
        openApp,
        ALICE,
        `${BACKUP}/snapshots/${body.snapshots[0]!.id}?projectId=${project.projectId}`,
      )
      expect(明细.status).toBe(200)
      const 清单 = yield* json(Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }), 明细)
      expect(清单.files.map((file) => file.path).sort()).toEqual(["报告.docx", "资料/甲.txt"])
    }),
    30_000,
  )

  it.live("同一项目的第二个并发手动备份 ⇒ 其中一个 409 job_running（单飞）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      // **并发**发两条：串行发的话第一个可能已经跑完，锁就观测不到了。
      const [a, b] = yield* Effect.all(
        [
          as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId })),
          as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId })),
        ],
        { concurrency: 2 },
      )
      const 状态 = [a.status, b.status].sort()
      expect(状态).toEqual([202, 409])
      const 冲突 = a.status === 409 ? a : b
      const body = yield* json(
        Schema.Struct({ code: Schema.String, jobId: Schema.String }),
        冲突,
      )
      expect(body.code).toBe("job_running")
      expect(body.jobId.length).toBeGreaterThan(0)
    }),
    30_000,
  )

  it.live("非成员 ⇒ 403；没有身份 ⇒ 401；projectId 非法 ⇒ 400", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      // BOB 有身份、不是这个项目的成员。
      const 外人 = yield* as(openApp, BOB, BACKUP, 体({ projectId: project.projectId }))
      expect(外人.status).toBe(403)

      // 不带 cookie：直接走 `openApp`，不经 `as`。
      const 匿名 = yield* openApp(BACKUP, 体({ projectId: project.projectId }))
      expect(匿名.status).toBe(401)

      const 非法 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: "../x" }))
      expect(非法.status).toBe(400)
    }),
    30_000,
  )

  it.live("范围不存在 ⇒ 400（不许开一个必失败的任务）；别人的任务 id ⇒ 404", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      const 缺 = yield* as(
        openApp,
        ALICE,
        BACKUP,
        体({ projectId: project.projectId, path: "没有这个目录" }),
      )
      // spec §10.3：路径不存在归 400 bad_request（不是先开任务再失败）。
      expect(缺.status).toBe(400)
      const 缺体 = yield* json(Schema.Struct({ code: Schema.String }), 缺)
      expect(缺体.code).toBe("bad_request")

      // 别人的任务 id：即使猜到了也读不到（`jobs.get` 按 userId 过滤）。
      const 别人 = yield* as(openApp, BOB, `${BACKUP}/jobs/00000000-0000-4000-8000-000000000000`)
      expect(别人.status).toBe(404)
    }),
    30_000,
  )
})
```

> **`BOB` 必须不是项目的成员**（项目是 `createAs(ALICE, …)` 建的，只有 ALICE 是 owner ⇒ 天然成立）。
> **`createAs` 连同 `Entry` schema 一起从归档测试抄过来**（建项目走真实出口）。`joinProject` 本文件**不需要**——不要顺手抄来再加个成员。

- [ ] **Step 2b: MinIO 未配置的 503 单独一个文件**

`packages/opencode/test/server/openhive-backup-unconfigured.test.ts` —— **不放进上面那个文件**：一个文件只建一个 app 是那套 harness 的硬约束，第二个 app 会撞「首条 PG 查询 500」（见归档测试文件头）。照 `openhive-project-archive-unconfigured.test.ts` 整套抄（`OPEN` / `openApp` / `as` / `asWho` / `json` / `startProductionDb` / `migrate` / `const it = testEffect(Layer.empty)`），只把 `OPEN` 换成「配了一半」：

```ts
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  // 整组五变量里**任一为 `None`** ⇒ `MinioConfig.connection` 是 `Option.none`（`archive.ts:190-200`）。
  // 这里照原文件那样**只配两项**——少两把密钥足以触发同一个 `None` 分支。
  OPENHIVE_MINIO_ENDPOINT: "minio.invalid:9000",
  OPENHIVE_MINIO_BUCKET: "openhive",
}
```

```ts
const BACKUP = "/openhive/project/backup"
const PROJECT_PATH = "/openhive/project"

it.live("没有身份 ⇒ 401；非成员 ⇒ 403；成员 ⇒ 503（配置态不泄漏给未授权的人）", () =>
  Effect.gen(function* () {
    // **成员项目走真实建项目出口**（同原文件：`POST /openhive/project` 让 ALICE 成为 owner）。
    // 不要直接写 `project_member`——那会绕过生产注册链（`#006-28` 的反例）。
    const 建 = yield* as(PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `备份503·${Date.now()}`, type: "private" }),
    })
    const project = yield* json(Schema.Struct({ id: Schema.String }), 建)
    const 体 = (): RequestInit => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    })

    // ⚠️ 这三条**必须同一个 app**、按这个次序：次序本身是判据（授权在配置检查之前）。
    const 匿名 = yield* openApp(BACKUP, 体())
    expect(匿名.status).toBe(401)

    const 外人 = yield* asWho(BOB, BACKUP, 体())
    expect(外人.status).toBe(403)

    const 成员 = yield* as(BACKUP, 体())
    expect(成员.status).toBe(503)
    const 错误 = yield* json(Schema.Struct({ code: Schema.String }), 成员)
    expect(错误.code).toBe("minio_unconfigured")
  }),
  30_000,
)
```

> ⚠️ 排序是判据本身：把「配置检查」提到「成员判定」之前，这条会在「外人」那一句红成 503。变异验证时拆开看（`#004-09`）。
> ⚠️ 这三条里只有第三条需要真项目（`authorize` 先查成员）；第一条连体都不需要解析就回 401。但**同一个 project 复用**更好读，也别省。`BOB` 已在 `beforeAll` 被写进 `auth.user`、且不是这个项目的成员（项目是 ALICE 建的）。

- [ ] **Step 3: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-backup.test.ts test/server/openhive-backup-unconfigured.test.ts`
Expected: FAIL —— 端点不存在（SPA 兜底回 200 + text/html，`json()` 的 content-type 断言先炸）。

- [ ] **Step 4: 实现 `backup.ts`**

```ts
/**
 * 文件级备份快照的 HTTP 出口（spec §10.1）。
 *
 * 授权次序**写死**（spec §9.1）：401 → 400 → 403（成员 + 未归档）→ 503（MinIO）→ 404（任务 /
 * 快照不属于我）。「先授权再暴露部署状态」是一条独立判据：未配置与未授权同时成立时必须是 403
 * （同 `archive.ts` 文件头记的那条）。
 *
 * `projectId` 走查询串 / 请求体，**不当路径段**（与 `archive.ts` / `member.ts` 同一口径）；
 * `snapshotId` / `jobId` 在路径里，但读的时候仍要**按 `userId` 过滤一次**，猜到了也读不到。
 */

import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { sql } from "drizzle-orm"
import { archiveStatesOf, membersOf } from "@opencode-ai/auth/project-member"
import { recordBackupEvent } from "@opencode-ai/auth/project-backup-event"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { User } from "@opencode-ai/core/user"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import {
  MinioConfig,
  badRequest,
  endpointOf,
  forbidden,
  unauthorized,
  unavailable,
  type MinioSettings,
} from "./archive"
import { OpenhivePg } from "./pg"
import { PREFIX } from "./project"
import {
  applyRetention,
  collectGarbage,
  contextStatus,
  createAutoScheduler,
  syncState,
  type AutoScheduler,
} from "./backup-auto"
import { sharedJobs, type JobRegistry } from "./backup-jobs"
import {
  MANIFEST_LIST_LIMIT,
  QUOTA_BYTES,
  STATE_VERSION,
  type Job,
  type Manifest,
  type RestoreDecision,
} from "./backup-model"
import { isPathInScope, isSafeRelativePath, summaryOf } from "./backup-rules"
import {
  CancelledError,
  NotFoundError,
  QuotaError,
  UnchangedError,
  runBackup,
  runPreview,
  runRestore,
  scanScope,
} from "./backup-run"
import { openBackupStore, rebuildSnapshots, type BackupStore } from "./backup-store"

export const PATH = {
  backup: `${PREFIX}/backup`,
  heartbeat: `${PREFIX}/backup/heartbeat`,
  status: `${PREFIX}/backup/status`,
  snapshots: `${PREFIX}/backup/snapshots`,
  snapshot: `${PREFIX}/backup/snapshots/:snapshotId`,
  preview: `${PREFIX}/backup/restore/preview`,
  restore: `${PREFIX}/backup/restore`,
  job: `${PREFIX}/backup/jobs/:jobId`,
  cancel: `${PREFIX}/backup/jobs/:jobId/cancel`,
} as const

const NOT_FOUND = 404
const CONFLICT = 409

interface Deps {
  readonly root: string
  readonly minio: Option.Option<MinioSettings>
  /** 与 `archive.ts` 同型：`OpenhivePg` 的**共享**客户端读取器（调用一次拿一次）。 */
  readonly pg: OpenhivePg.Interface["pg"]
  readonly jobs: JobRegistry
  readonly scheduler: AutoScheduler
}

/**
 * 进程内唯一的任务表（单实例假设，spec §7.5）。
 * ⚠️ **不要在这里 `createJobRegistry()`**——必须用 `backup-jobs.ts` 导出的那一个实例，
 * 项目删除（Task 12）要在同一张表上看「这个项目上还有没有任务在跑」（spec §5.8 末条）。
 */
const jobs = sharedJobs

function json(body: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(body, { status })
}

function notFound(message: string) {
  return json({ error: message, code: "not_found" }, NOT_FOUND)
}

/** 服务器本地时区（保留分桶按它分「日」与「周」，spec §8.1）。 */
function 时区(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** 两个范围是否相交。任一方是 `""`（整项目）⇒ 相交。 */
function 相交(scope: string, path: string): boolean {
  return scope === "" || path === "" || isPathInScope(scope, path) || isPathInScope(path, scope)
}

/** 只需要配置一项——`detect` 里还没有完整的 `Deps`（`scheduler` 尚未构造完）。 */
type 存储依赖 = { readonly minio: Option.Option<MinioSettings> }

function storeOf(deps: 存储依赖, userId: string, projectId: string): BackupStore | undefined {
  if (Option.isNone(deps.minio)) return undefined
  const settings = deps.minio.value
  return openBackupStore({
    endpoint: endpointOf(settings),
    bucket: settings.bucket,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    userId,
    projectId,
  })
}

interface 身份 {
  readonly user: User.Interface
  readonly projectId: string
  readonly directory: string
}

type 授权结果 =
  | { readonly ok: true; readonly value: 身份 }
  | { readonly ok: false; readonly response: HttpServerResponse.HttpServerResponse }

/**
 * 授权（次序：projectId 合法 → 成员 → 未归档 → MinIO 已配置）。
 *
 * ⚠️ 三条实现约束，都是本项目实测过的：
 * 1. 身份**不在**这里取——请求 fiber 的 context 里没有 app 层服务，`Effect.serviceOption(User.Service)`
 *    必须在 handler 自己的 `Effect.gen` 里 yield（`archive.ts` 文件头同一句）。
 * 2. 返回值的判别字段是 `ok`，**不是** `instanceof Response`：`HttpServerResponse.jsonUnsafe(...)`
 *    返回的是 Effect 自己的 `HttpServerResponse` 接口，不是全局 `Response`。
 * 3. 用户 id 不是合法路径段是**库里的数据坏了** ⇒ 抛（经 `Effect.promise` 变成 defect ⇒ 500），
 *    与「客户端递了个 `../x`」（400）分开——同 `archive.ts` 的处置。
 */
async function authorize(user: User.Interface, deps: Deps, projectId: string): Promise<授权结果> {
  if (!User.isSafePathSegment(projectId)) {
    return { ok: false, response: badRequest("projectId 不是合法的路径段") }
  }
  if (!User.isSafePathSegment(user.id)) {
    throw new Error(`非法用户 id：${JSON.stringify(user.id)}`)
  }

  const pg = deps.pg()
  const members = await membersOf(pg, projectId)
  const actor = ProjectMembership.asRole(members.find((member) => member.userId === user.id)?.role)
  // 非成员与「角色认不出」同一条守卫（安全方向相同：一律不放行）。
  if (actor === null) return { ok: false, response: forbidden("无权访问该项目的备份") }

  const archived = (await archiveStatesOf(pg, [projectId])).get(projectId)?.archived ?? false
  if (archived) return { ok: false, response: forbidden("项目已归档，备份不可用") }

  // 配置**放在授权之后**：未授权的人不该从「503 还是 403」读出这台机器的部署状态（spec §9.1）。
  if (Option.isNone(deps.minio)) return { ok: false, response: unavailable("MinIO 未配置，备份不可用") }

  return { ok: true, value: { user, projectId, directory: projectDirectory(deps.root, user.id, projectId) } }
}

/** 查询串里的一项（`projectId` 只走查询串 / 请求体，不走路径段）。 */
function 查询(request: HttpServerRequest.HttpServerRequest, key: string): string {
  return new URL(request.url.toString()).searchParams.get(key) ?? ""
}

/** 读 JSON 体并解码；畸形 JSON 与缺字段同样返回 `None`（同 `archive.ts`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
  )
}

/**
 * 拍一次快照：读上次清单 → 扫描/哈希/上传 → **最后**写 manifest → 更新派生索引 → 保留 → 审计。
 *
 * 手动与自动**共用这一条链**：两边各写一份的话，「manifest 最后写」这条不变量迟早只留在其中一份里。
 */
interface 拍一次输入 {
  readonly deps: Deps
  readonly store: BackupStore
  readonly userId: string
  readonly projectId: string
  readonly directory: string
  readonly kind: "manual" | "auto"
  readonly scope: string
  /** 手动备份才有：进度上报与取消都挂在任务上。 */
  readonly jobId?: string
}

async function 拍一次(input: 拍一次输入): Promise<Manifest> {
  const { deps, store } = input
  const jobId = input.jobId

  const { usageBytes } = await contextStatus(store)
  const listed = await store.manifests()
  const previous =
    listed[0] === undefined ? undefined : await store.readManifest(listed[0].id).catch(() => undefined)

  const manifest = await runBackup(
    {
      store,
      directory: input.directory,
      projectId: input.projectId,
      ownerId: input.userId,
      timezone: 时区(),
      report: (patch: Partial<Job>) => {
        if (jobId !== undefined) deps.jobs.update(jobId, patch)
      },
      isCancelled: () => jobId !== undefined && deps.jobs.get(jobId, input.userId)?.cancelRequested === true,
    },
    {
      kind: input.kind,
      scope: input.scope,
      createdBy: input.userId,
      quotaBytes: QUOTA_BYTES,
      usageBytes,
      ...(previous === undefined ? {} : { previous }),
    },
  )

  // ① manifest 落盘 —— 从这一刻起「备份存在」。
  await store.writeManifest(manifest)
  // ② state 是派生索引（spec §4.4）：写失败不影响这次备份。
  await 写状态(store, manifest, usageBytes)
  // ③ 保留在**每个快照成功后**跑一次（spec §8.1）；只有真删了 manifest 才需要 GC（§8.4）。
  const 删 = await applyRetention(store, { now: Date.now(), timeZone: 时区() }).catch(() => [])
  if (删.length > 0) await collectGarbage(store, { now: Date.now() }).catch(() => undefined)
  // ④ 审计失败不让备份失败（spec §9.3）。
  await recordBackupEvent(deps.pg(), {
    projectId: input.projectId,
    userId: input.userId,
    action: "backup",
    snapshotId: manifest.id,
    detail: {
      kind: input.kind,
      scope: input.scope,
      files: manifest.totals.files,
      bytes: manifest.totals.bytes,
      uploadedBytes: manifest.totals.uploadedBytes,
      status: manifest.status,
    },
  }).catch(() => undefined)

  return manifest
}

async function 写状态(store: BackupStore, manifest: Manifest, usageBytesBefore: number): Promise<void> {
  try {
    const state = await store.readState()
    const usageBytes = usageBytesBefore + manifest.totals.uploadedBytes
    await store.writeState({
      version: STATE_VERSION,
      usageBytes,
      lastGcAt: state?.lastGcAt ?? 0,
      autoPaused: state?.autoPaused === true || usageBytes > QUOTA_BYTES,
      snapshots: [summaryOf(manifest), ...(state?.snapshots ?? []).filter((snapshot) => snapshot.id !== manifest.id)],
    })
  } catch {
    // `state.json` 是派生索引（spec §4.4）：写不进去不影响这次备份——manifest 才是真相。
  }
}

/** 备份任务的收尾（手动）。异常到码的映射与 spec §10.3 一致。 */
async function 执行备份(deps: Deps, 我: 身份, store: BackupStore, scope: string, jobId: string) {
  try {
    const manifest = await 拍一次({
      deps,
      store,
      userId: 我.user.id,
      projectId: 我.projectId,
      directory: 我.directory,
      kind: "manual",
      scope,
      jobId,
    })
    deps.jobs.finish(jobId, "succeeded", { result: { snapshotId: manifest.id } })
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      return
    }
    const 码 =
      error instanceof QuotaError ? "quota_exceeded" : error instanceof NotFoundError ? "path_not_found" : "backup_failed"
    deps.jobs.finish(jobId, "failed", {
      error: {
        code: 码,
        message: error instanceof Error ? error.message : String(error),
        retryable: 码 !== "path_not_found",
      },
    })
  }
}

const BackupBody = Schema.Struct({
  projectId: Schema.String,
  path: Schema.optional(Schema.String),
  allowOverQuota: Schema.optional(Schema.Boolean),
})

function handleBackup(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(BackupBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    // `authorize` 已经挡过未配置；这里只是让类型收窄（同一条口令，不另造文案）。
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    // 范围存在性检查 ＋ 字节估算共用一次扫描（`scanScope` 只读元数据）。
    // 估算按**文件大小之和**，比去重后的真实上传量保守——宁可多问一次「要不要越限」。
    const 估算 = yield* Effect.promise(async () => {
      try {
        const 扫描 = await scanScope(我.directory, scope)
        return { ok: true as const, bytes: 扫描.files.reduce((sum, file) => sum + file.size, 0) }
      } catch (error) {
        if (error instanceof NotFoundError) return { ok: false as const }
        throw error
      }
    })
    if (!估算.ok) return badRequest("path 不存在")

    const { usageBytes } = yield* Effect.promise(() => contextStatus(store))
    if (payload.value.allowOverQuota !== true && usageBytes + 估算.bytes > QUOTA_BYTES) {
      return json(
        {
          error: "本次备份会超出容量上限",
          code: "quota_exceeded",
          usageBytes,
          limitBytes: QUOTA_BYTES,
          requiredBytes: 估算.bytes,
        },
        CONFLICT,
      )
    }

    // `start` 是单飞的**权威判定**（上面那些 await 之间别的请求可能已经起了任务）。
    const 起 = deps.jobs.start({ kind: "backup", userId: 我.user.id, projectId: 我.projectId, path: scope })
    if (起.resumed) return json({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id }, CONFLICT)

    const jobId = 起.job.id
    void 执行备份(deps, 我, store, scope, jobId)
    return json({ jobId }, 202)
  })
}

const HeartbeatBody = Schema.Struct({ projectId: Schema.String })

function handleHeartbeat(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(HeartbeatBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response

    deps.scheduler.heartbeat(授权.value.user.id, 授权.value.projectId)
    // 立刻查一次（不必等下一个 60 秒 tick）；失败由下一拍重试，不在这里报给心跳。
    void deps.scheduler.checkNow(授权.value.user.id, 授权.value.projectId)
    return HttpServerResponse.empty({ status: 204 })
  })
}

function handleStatus(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const { usageBytes, autoPaused } = yield* Effect.promise(() => contextStatus(store))
    const last = (yield* Effect.promise(() => store.manifests()))[0]
    return json({
      activeJob: deps.jobs.activeFor(我.user.id, 我.projectId) ?? null,
      lastSnapshot: last === undefined ? null : { id: last.id, size: last.size, lastModified: last.lastModified },
      usageBytes,
      limitBytes: QUOTA_BYTES,
      autoPaused,
    })
  })
}

function handleSnapshots(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const path = 查询(request, "path")
    if (!isSafeRelativePath(path)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const state = yield* Effect.promise(() => store.readState())
    const 摘要 =
      state === undefined
        ? (yield* Effect.promise(() => rebuildSnapshots(store))).map((entry) => entry.summary)
        : state.snapshots
    const 命中 = 摘要.filter((snapshot) => 相交(snapshot.scope, path))
    const snapshots = 命中.slice(0, MANIFEST_LIST_LIMIT)
    return json({ snapshots, truncated: 命中.length > snapshots.length, limitBytes: QUOTA_BYTES })
  })
}

function handleSnapshot(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const params = yield* HttpRouter.params
    const snapshotId = params.snapshotId ?? ""
    if (!isSafeRelativePath(snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    // `readManifest` 已按 `projectId` / `ownerId` 校验；别人的清单在这里是**抛**，一律折成 404。
    const manifest = yield* Effect.promise(() => store.readManifest(snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")
    return json(manifest)
  })
}

function handleDeleteSnapshot(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const params = yield* HttpRouter.params
    const snapshotId = params.snapshotId ?? ""
    if (!isSafeRelativePath(snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    yield* Effect.promise(() => store.deleteManifest(snapshotId))
    // 只删 manifest，blob 交给 GC（spec §8.2）。state 是派生索引，顺手摘掉、失败不管。
    yield* Effect.promise(async () => {
      try {
        const state = await store.readState()
        if (state !== undefined) {
          await store.writeState({
            ...state,
            snapshots: state.snapshots.filter((snapshot) => snapshot.id !== snapshotId),
          })
        }
      } catch {
        // 同上：state 坏了由下一次备份 / 每日清扫重建。
      }
    })
    yield* Effect.promise(() =>
      recordBackupEvent(deps.pg(), {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "delete-snapshot",
        snapshotId,
        detail: { kind: manifest.kind, files: manifest.totals.files, bytes: manifest.totals.bytes },
      }).catch(() => undefined),
    )
    return json({ deleted: true })
  })
}

const DecisionSchema = Schema.Literals(["overwrite", "keep-both", "skip"])

const PreviewBody = Schema.Struct({
  projectId: Schema.String,
  snapshotId: Schema.String,
  path: Schema.optional(Schema.String),
})

function handlePreview(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(PreviewBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 snapshotId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(payload.value.snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    const 起 = deps.jobs.start({
      kind: "preview",
      userId: 我.user.id,
      projectId: 我.projectId,
      path: scope,
      snapshotId: manifest.id,
    })
    if (起.resumed) return json({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id }, CONFLICT)

    const jobId = 起.job.id
    void 执行预览(deps, 我, store, manifest, scope, jobId)
    return json({ jobId }, 202)
  })
}

async function 执行预览(
  deps: Deps,
  我: 身份,
  store: BackupStore,
  manifest: Manifest,
  scope: string,
  jobId: string,
) {
  deps.jobs.update(jobId, { state: "previewing" })
  try {
    const preview = await runPreview(
      {
        store,
        directory: 我.directory,
        projectId: 我.projectId,
        ownerId: 我.user.id,
        timezone: 时区(),
        report: (patch: Partial<Job>) => deps.jobs.update(jobId, patch),
        isCancelled: () => deps.jobs.get(jobId, 我.user.id)?.cancelRequested === true,
      },
      { manifest, scope },
    )
    deps.jobs.finish(jobId, "succeeded", { result: { preview } })
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      return
    }
    deps.jobs.finish(jobId, "failed", {
      error: {
        code: error instanceof NotFoundError ? "path_not_found" : "preview_failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    })
  }
}

const RestoreBody = Schema.Struct({
  projectId: Schema.String,
  snapshotId: Schema.String,
  path: Schema.optional(Schema.String),
  /** 没有逐文件决策时用的全局决策（spec A2：默认「保留两者」）。 */
  decision: Schema.optional(DecisionSchema),
  decisions: Schema.optional(Schema.Record(Schema.String, DecisionSchema)),
})

function handleRestore(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(RestoreBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 snapshotId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(payload.value.snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    const 起 = deps.jobs.start({
      kind: "restore",
      userId: 我.user.id,
      projectId: 我.projectId,
      path: scope,
      snapshotId: manifest.id,
    })
    if (起.resumed) return json({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id }, CONFLICT)

    const jobId = 起.job.id
    const 全局: RestoreDecision = payload.value.decision ?? "keep-both"
    const decisions: Readonly<Record<string, RestoreDecision>> = payload.value.decisions ?? {}
    void 执行恢复(deps, 我, store, manifest, scope, 全局, decisions, jobId)
    return json({ jobId }, 202)
  })
}

async function 执行恢复(
  deps: Deps,
  我: 身份,
  store: BackupStore,
  manifest: Manifest,
  scope: string,
  全局决策: RestoreDecision,
  decisions: Readonly<Record<string, RestoreDecision>>,
  jobId: string,
) {
  deps.jobs.update(jobId, { state: "restoring" })
  try {
    const restore = await runRestore(
      {
        store,
        directory: 我.directory,
        projectId: 我.projectId,
        ownerId: 我.user.id,
        timezone: 时区(),
        report: (patch: Partial<Job>) => deps.jobs.update(jobId, patch),
        isCancelled: () => deps.jobs.get(jobId, 我.user.id)?.cancelRequested === true,
      },
      { manifest, scope, global: 全局决策, decisions },
    )
    deps.jobs.finish(jobId, "succeeded", { result: { restore } })
    // 恢复成功后也标记为脏：下一次自动快照记录恢复后的状态（spec §7.3）。
    deps.scheduler.markDirty(我.user.id, 我.projectId)
    await recordBackupEvent(deps.pg(), {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "restore",
      snapshotId: manifest.id,
      detail: {
        decision: 全局决策,
        restored: restore.restored.length,
        keptBoth: restore.keptBoth.length,
        skipped: restore.skipped.length,
        failed: restore.failed.length,
        cancelled: restore.cancelled,
      },
    }).catch(() => undefined)
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      return
    }
    deps.jobs.finish(jobId, "failed", {
      error: {
        code: error instanceof NotFoundError ? "path_not_found" : "restore_failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    })
  }
}

function handleJob(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const params = yield* HttpRouter.params
    // 按 `userId` 过滤：别人的任务 id 猜到了也是 404（spec §10.2）。
    const job = deps.jobs.get(params.jobId ?? "", user.value.id)
    if (job === undefined) return notFound("任务不存在")
    return json(job)
  })
}

function handleCancel(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const params = yield* HttpRouter.params
    const 结果 = deps.jobs.cancel(params.jobId ?? "", user.value.id)
    if (结果 === "missing") return notFound("任务不存在")
    return json({ cancelling: 结果 === "cancelling" }, 202)
  })
}

/**
 * 每日清扫（spec §8.1 / §8.4 的「另每天跑一次」）。
 *
 * 只处理「已经在拍新快照」的项目是不够的——长期不打开的项目永远等不到那一天。所以按
 * `auth.project_member` 枚举（**只读一列**）→ 每个成员各自的私有命名空间各扫一遍。
 * 单实例假设下，一天一次、串行，代价可接受。
 */
async function 每日清扫(deps: Deps): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const pg = deps.pg()
  const result = (await pg.execute(
    sql`SELECT DISTINCT project_id FROM auth.project_member`,
  )) as { rows?: { project_id: string }[] }
  for (const row of result.rows ?? []) {
    const members = await membersOf(pg, row.project_id)
    for (const member of members) {
      const store = storeOf(deps, member.userId, row.project_id)
      if (store === undefined) continue
      const now = Date.now()
      await applyRetention(store, { now, timeZone: 时区() }).catch(() => [])
      await collectGarbage(store, { now }).catch(() => undefined)
      // 用量降回上限以下时自动解除暂停（spec §8.3）。
      const 状态 = await syncState(store, { now, autoPaused: false }).catch(() => undefined)
      if (状态 !== undefined && 状态.usageBytes > QUOTA_BYTES) {
        await store.writeState({ ...状态, autoPaused: true }).catch(() => undefined)
      }
    }
  }
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // ⚠️ **服务全在层构造期取**（同 `archive.ts` / `project.ts` 记过的实测约束）：
    // 请求 fiber 的 context 里没有 app 层服务。身份是唯一例外。
    const config = yield* AnchorWorkspace.Config
    const minio = yield* MinioConfig
    const openhivePg = yield* OpenhivePg.Service

    const 根 = config.root
    const 连接 = minio.connection
    const 库 = openhivePg.pg

    const scheduler = createAutoScheduler({
      now: Date.now,
      isRunning: (userId, projectId) => jobs.activeFor(userId, projectId) !== undefined,
      detect: async (userId, projectId) => {
        const store = storeOf({ minio: 连接 }, userId, projectId)
        if (store === undefined) return
        const { usageBytes, autoPaused } = await contextStatus(store)
        if (autoPaused || usageBytes >= QUOTA_BYTES) {
          // 超限：**跳过**并留审计，绝不为了腾空间删旧快照（spec §8.3）。
          if (!autoPaused) {
            const state = await store.readState()
            await store.writeState({
              version: STATE_VERSION,
              usageBytes,
              lastGcAt: state?.lastGcAt ?? 0,
              autoPaused: true,
              snapshots: state?.snapshots ?? [],
            })
          }
          await recordBackupEvent(库(), {
            projectId,
            userId,
            action: "auto-backup-paused",
            detail: { usageBytes, limitBytes: QUOTA_BYTES },
          }).catch(() => undefined)
          return
        }
        try {
          await 拍一次({
            deps: { root: 根, minio: 连接, pg: 库, jobs, scheduler },
            store,
            userId,
            projectId,
            directory: projectDirectory(根, userId, projectId),
            kind: "auto",
            scope: "",
          })
        } catch (error) {
          if (error instanceof UnchangedError) return
          if (error instanceof QuotaError) {
            const state = await store.readState()
            await store.writeState({
              version: STATE_VERSION,
              usageBytes,
              lastGcAt: state?.lastGcAt ?? 0,
              autoPaused: true,
              snapshots: state?.snapshots ?? [],
            })
            return
          }
          throw error
        }
      },
    })

    const deps: Deps = { root: 根, minio: 连接, pg: 库, jobs, scheduler }

    const 心跳 = setInterval(() => {
      jobs.evict()
      void scheduler.tick()
    }, 60_000)
    const 清扫 = setInterval(() => void 每日清扫(deps).catch(() => undefined), 24 * 60 * 60_000)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(心跳)
        clearInterval(清扫)
      }),
    )

    yield* router.add("POST", PATH.backup, (request) => handleBackup(request, deps))
    yield* router.add("POST", PATH.heartbeat, (request) => handleHeartbeat(request, deps))
    yield* router.add("GET", PATH.status, (request) => handleStatus(request, deps))
    yield* router.add("GET", PATH.snapshots, (request) => handleSnapshots(request, deps))
    yield* router.add("GET", PATH.snapshot, (request) => handleSnapshot(request, deps))
    yield* router.add("DELETE", PATH.snapshot, (request) => handleDeleteSnapshot(request, deps))
    yield* router.add("POST", PATH.preview, (request) => handlePreview(request, deps))
    yield* router.add("POST", PATH.restore, (request) => handleRestore(request, deps))
    yield* router.add("GET", PATH.job, (request) => handleJob(request, deps))
    yield* router.add("POST", PATH.cancel, (request) => handleCancel(request, deps))
  }),
)
```

> **三处容易写错的地方（先看再抄）：**
>
> 1. **`scheduler` 的自引用**：`createAutoScheduler` 的 `detect` 里要用 `deps`，而 `deps` 里又要放 `scheduler`。
>    上面的写法把 `deps` 在 `detect` **内部就地构造**（`{ root: 根, minio: 连接, pg: 库, jobs, scheduler }`），
>    所以没有循环依赖；`storeOf` 因此只收 `{ minio }` 这一项（`存储依赖`），不要求完整 `Deps`。
> 2. **`Effect.promise` 里的异常是 defect**：`authorize` 抛「非法用户 id」经 `Effect.promise` 变成 500，
>    与 `archive.ts` 的 `Effect.die` 同效。**不要**改成 `Effect.tryPromise` 再 catch 成 400——那会把
>    「库里的数据坏了」误报成「客户端递错了」。
> 3. **`HttpRouter.params`**：`find-my-way-ts` 解析 `:snapshotId` / `:jobId` 后放进 `RouteContext`
>    （`HttpRouter.js:126`），`HttpRouter.params`（`:185`）就是读它。**不要**从 URL 字符串切末段。
>    查询串仍用 `查询(request, key)`（`projectId` 从来不在路径里）。

- [ ] **Step 5: 跑绿**

Run: `cd packages/opencode && bun test test/server/openhive-backup.test.ts test/server/openhive-backup-unconfigured.test.ts`
Expected: PASS（两个文件合计至少五条：备份成功链 ＋ 恢复点清单、单飞 409、授权三态、范围不存在、未配置 503 的次序）。

- [ ] **Step 6: 门禁 ＋ 提交**

Run: `cd packages/opencode && bun run typecheck && bunx oxlint src/server/openhive/backup.ts`
Expected: typecheck 无新增错误；oxlint 对该文件 0 error（warnings 按 `#001-02` 的既有口径，不强求归零）。

```bash
git add packages/opencode/src/server/openhive/backup.ts packages/opencode/src/server/openhive/archive.ts packages/opencode/test/server/openhive-backup.test.ts packages/opencode/test/server/openhive-backup-unconfigured.test.ts
git commit -m "feat(backup): HTTP 出口（备份/恢复点/预览/恢复/任务）

【保留的定制 · 同步上游时不要丢】
- 授权次序 401→400→403→503→404；projectId 只在查询串与请求体
- 单飞粒度（用户×项目），第二个手动请求 409
- archive.ts 的四个响应构造函数加 export（备份与归档同源，不各写一份）"
```

---

## 阶段 P3 · 接线

### Task 12: `server.ts` 挂路由 + 项目删除清备份命名空间

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts:128-372`
- Modify: `packages/opencode/src/server/openhive/archive.ts`（`Deps` 202-219、`routes` 240-247、`handleDelete` 544-547、`dropBackups` 579-591）
- Test: `packages/opencode/test/server/openhive-project-delete.test.ts`（追加一条「删除后备份命名空间为空」的用例）

**Interfaces:**
- Consumes: Task 11 的 `OpenhiveBackup.routes`。
- Produces: 生产应用里 `/openhive/project/backup*` 可达。

- [ ] **Step 1: 写会红的测试**

删除出口的既有用例住在 `openhive-project-delete.test.ts`（**不是** archive 文件），harness 是
`const it = testEffect(Layer.empty)`、`as(url, init)` 默认 ALICE、`asWho(subject, url, init)`、`建项目(name, type)`、`删(subject, projectId)`。
在 `describe("T-delete · 项目删除…")` 里追加（**Effect 风格**，同文件其它用例）：

```ts
it.live("删除项目：连 `_openhive-backups` 命名空间一起清掉", () =>
  Effect.gen(function* () {
    const project = yield* 建项目(`备份快照残留·${Date.now()}`, "private")

    // **前置**：往备份命名空间里种一个对象。直接走存储接口是**夹具**（构造输入），
    // 不是 oracle——断言读的仍是假 S3 收到的键。
    const 快照 = Minio.makeStore({
      endpoint: s3.endpoint,
      bucket: s3.bucket,
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      scope: { userId: ALICE.id, projectId: project.id, namespace: "_openhive-backups" },
    })
    yield* Effect.promise(() => 快照.put({ path: "state.json", body: new TextEncoder().encode("{}") }))
    // 前置真的成立（`#005-47`：不作这一条，「删完为空」在一个本来就空的现场也成立）。
    expect(
      s3.keys().some((key) => key.includes("_openhive-backups") && key.includes(project.id)),
      "种进备份命名空间之后，假 S3 上应当看得到这个键",
    ).toBe(true)

    const response = yield* 删(ALICE, project.id)
    expect(response.status).toBe(200)

    // 被测：备份命名空间里的键一个不剩（与归档镜像前缀是两个独立前缀，删项目时两边都要清）。
    expect(
      s3.keys().filter((key) => key.includes("_openhive-backups") && key.includes(project.id)),
    ).toEqual([])
  }),
  60_000,
)
```

文件顶补 `import { Minio } from "@opencode-ai/core/minio"`。

再追加**两条**（spec §5.8 末条：项目删除要先收敛该项目上的任务）：

```ts
it.live("删除项目：备份任务还在跑 ⇒ 先请求取消并等它收敛，收敛后才删", () =>
  Effect.gen(function* () {
    const project = yield* 建项目(`备份收敛·等·${Date.now()}`, "private")

    // 造一个**真的**活动任务（同一个 `sharedJobs` 实例——`backup.ts` 与删除共用）。
    const { job } = sharedJobs.start({ kind: "backup", userId: ALICE.id, projectId: project.id, path: "" })
    // 模拟执行器响应取消：30ms 后自己收尾（quiesce 的默认轮询是 100ms ⇒ 第一次轮询就能看到终态）。
    setTimeout(() => sharedJobs.finish(job.id, "cancelled"), 30)

    const response = yield* 删(ALICE, project.id)
    expect(response.status, "任务收敛之后删除应当成功").toBe(200)

    // 被测：删除**等到了**那个任务收敛，而且它收在 `cancelled`（不是被硬删后还在跑）。
    expect(sharedJobs.get(job.id, ALICE.id)?.state).toBe("cancelled")
    // 删除真的发生了（否则「等到了」和「删掉了」没有同一条证据）。
    const 列 = yield* as(PROJECT_PATH)
    const 清单 = yield* json(Schema.Array(Entry), 列)
    expect(清单.some((行) => 行.id === project.id)).toBe(false)
  }),
  60_000,
)

it.live("删除项目：任务不响应取消 ⇒ 409，项目一个字节都不动", () =>
  Effect.gen(function* () {
    const project = yield* 建项目(`备份收敛·超时·${Date.now()}`, "private")

    // 这个任务永不 finish ⇒ quiesce 到上限（本文件把上限压到 120ms，见 `OPEN`）回 false。
    const { job } = sharedJobs.start({ kind: "backup", userId: ALICE.id, projectId: project.id, path: "" })
    try {
      const response = yield* 删(ALICE, project.id)
      expect(response.status).toBe(409)
      const 体 = yield* json(Schema.Struct({ code: Schema.String }), response)
      expect(体.code).toBe("job_running")

      // ⚠️ **不强行删**是这条用例的另一半：项目仍在清单里、目录仍在盘上。
      const 列 = yield* as(PROJECT_PATH)
      const 清单 = yield* json(Schema.Array(Entry), 列)
      expect(清单.some((行) => 行.id === project.id), "409 之后项目必须还在").toBe(true)
    } finally {
      // 释放单飞锁，否则同一（用户×项目）在别的用例里永远起不来。
      sharedJobs.finish(job.id, "cancelled")
    }
  }),
  60_000,
)
```

文件顶补 `import { sharedJobs } from "../../src/server/openhive/backup-jobs"`；`OPEN` 里补一项
`OPENHIVE_BACKUP_QUIESCE_TIMEOUT_MS: "120"`（删除流程等任务收敛的上限，默认 30 秒——本文件压到
120ms，否则「超时」那条用例要跑 30 秒）。⚠️ 这一项**只影响本文件**（`OPEN` 是 `ConfigProvider` 的
一份快照），生产默认值仍是 30 秒。

- [ ] **Step 2: 跑红**

Run: `cd packages/opencode && bun test test/server/openhive-project-delete.test.ts`
Expected: FAIL —— 三条红，且红在**不同的地方**（`#005-46`：拆掉的是哪儿，决定红停在哪边）：
① 「命名空间清掉」红在最后那条 `toEqual([])`，实得数组里还有 `…/p-<id>/_openhive-backups/state.json`
（`dropBackups` 目前只清镜像前缀）；
② 「等它收敛」红在 `expect(200)`，实得 `200`**也可能**（当前实现不检查任务）——但紧接着
`expect(...state).toBe("cancelled")` 会红成 `"queued"`（任务没人碰过）；
③ 「不响应取消」红在 `expect(409)`，实得 `200`（当前实现照删不误）——这条正是「不强行删」的守卫。

- [ ] **Step 3: 改 `dropBackups`**

```ts
async function dropBackups(deps: Deps, projectId: string, userIds: readonly string[]): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const settings = deps.minio.value
  const credentials = { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey }
  for (const userId of userIds) {
    // ① 归档镜像前缀
    const 镜像 = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      credentials,
      scope: { userId, projectId },
    })
    // ⚠️ Task 1 把 `list()` 的返回从 `string[]` 改成 `Entry[]` ⇒ 这里原来直接 `delete({ path })`
    //    的那一行必须跟着取 `entry.path`（否则 `path` 是一个对象，删除静默落空）。
    for (const entry of await 镜像.list()) await 镜像.delete({ path: entry.path })

    // ② 备份快照命名空间（2026-10-18）：与镜像严格分开的两个前缀，删除时两个都要清。
    //    漏掉这一支，项目删了、快照还在，且用户再也看不到它（永久孤儿）。
    const 快照 = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      credentials,
      scope: { userId, projectId, namespace: BACKUP_NAMESPACE },
    })
    for (const entry of await 快照.list()) await 快照.delete({ path: entry.path })
  }
}
```

`import { BACKUP_NAMESPACE } from "./backup-model"`。

- [ ] **Step 3b: `handleDelete` 先收敛该项目上的任务（spec §5.8 末条）**

`archive.ts` 顶部 import 区加：

```ts
import { quiesceProject } from "./backup-jobs"
```

`Deps` 加一个字段（删项目时等任务收敛的上限；走 Effect 配置源、与 `MinioConfig` 同款，
**不是** `process.env`——测试要用 `ConfigProvider` 压到 120ms）：

```ts
  /** 删除前等待备份/恢复任务收敛的上限（毫秒）。默认 30 秒（spec §5.8「有上限」）。 */
  readonly quiesceTimeoutMs: number
```

`routes` 的构造期取值段（`const directories = yield* ProjectDirectories.Service` 之后）加：

```ts
    // ⚠️ 必须与其它配置**同一时点**取（层构造期）——请求期取不到 app 层服务/配置。
    const quiesceTimeoutMs = yield* EffectConfig.number("OPENHIVE_BACKUP_QUIESCE_TIMEOUT_MS").pipe(
      EffectConfig.withDefault(30_000),
    )
```

并把 `deps` 初始化补一项 `quiesceTimeoutMs,`。

`handleDelete` 里，在 `const userIds = ...` 之后、`dropBackups(...)` **之前**插入：

```ts
      // ── 0.5 把该项目上所有成员的任务收敛掉（spec §5.8 末条）──
      //   备份 / 预览 / 恢复与删除共用同一张任务表（`sharedJobs`）；锁被占用时**先请求取消**、
      //   有上限地等它收敛；等不到就**报错且不删任何东西**——而不是强行删。
      //   ⚠️ 位置必须在任何副作用之前：删掉一个半备份的项目会留下永久孤儿 blob，
      //   删掉一个半恢复的项目会留下改了一半的树。
      const 静了 = yield* Effect.promise(() => quiesceProject(projectId, userIds, { timeoutMs: deps.quiesceTimeoutMs }))
      if (!静了)
        return HttpServerResponse.jsonUnsafe(
          { error: "备份/恢复任务仍在进行，请稍后重试", code: "job_running" },
          { status: 409 },
        )
```

⚠️ 这段必须在 `dropBackups` / `dropTrees` / `dropResidue` / `deleteByProjectID` / `directories.removeAll`
**全部之前**——它是「不强行删」的唯一保证点。

- [ ] **Step 4: 改 `server.ts`**

import 区加 `import { OpenhiveBackup } from "@/server/openhive/backup"`；在 `OpenhiveArchive.routes.pipe(...)` 之后加：

```ts
    // openhive 文件级备份快照（2026-10-18）：备份 / 恢复点 / 预览 / 恢复 / 任务。
    // 配置与归档那条**共用两份服务**（`MinioConfig` / `AnchorWorkspace.Config`），另加
    // `OpenhivePg.layer`（授权要读 `auth.project_member` / `auth.project_archive`）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 文件级备份（2026-10-18）。
    OpenhiveBackup.routes.pipe(
      Layer.provide(OpenhiveArchive.MinioConfig.layer),
      Layer.provide(AnchorWorkspace.Config.layer),
      Layer.provide(OpenhivePg.layer),
    ),
```

- [ ] **Step 5: 跑绿 + 门禁**

Run: `cd packages/opencode && bun test test/server/openhive-project-delete.test.ts test/server/openhive-backup.test.ts`
Expected: PASS（删除文件原有条数 ＋ 新加的 3 条；`openhive-backup.test.ts` 原有条数不变）。
Run 仓库根: `bun run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/server/openhive/archive.ts packages/opencode/test/server/openhive-project-delete.test.ts
git commit -m "feat(backup): 挂上 HTTP 路由；项目删除时连备份命名空间一起清

【保留的定制 · 同步上游时不要丢】"
```

---

## 阶段 P4 · 前端

### Task 13: 客户端 `openhive-backup.ts` + `ProjectData` 方法

**Files:**
- Create: `packages/app/src/project/openhive-backup.ts`
- Modify: `packages/app/src/project/project-data.ts`
- Test: `packages/app/src/project/project-data.test.ts`

**Interfaces:**
- Consumes: `defaultSend` / `trySend` / `readJson` / `isRecord`（`openhive-fetch.ts`）。
- Produces:
  - `listSnapshots(projectId, path?)`、`snapshotDetail(projectId, id)`、`backupProject(projectId, path?, allowOverQuota?)`、`backupStatus(projectId)`、`previewRestore(projectId, input)`、`restoreBackup(projectId, input)`、`deleteSnapshot(projectId, id)`、`taskOf(jobId)`、`cancelTask(jobId)`、`backupHeartbeat(projectId)`
  - `ProjectData` 上同名十个方法

- [ ] **Step 1: 写会红的测试**

在 `project-data.test.ts` 追加（沿用 `假服务`）：

```ts
test("备份：路径、方法、体逐字对上服务端契约", async () => {
  const 假 = 假服务({
    "/openhive/project/backup": [{ 状态: 202, 体: { jobId: "j-1" } }],
    "/openhive/project/backup/jobs/j-1": [{ 状态: 200, 体: { id: "j-1", state: "succeeded" } }],
    "/openhive/project/backup/jobs/j-1/cancel": [{ 状态: 204, 体: undefined }],
    "/openhive/project/backup/snapshots?projectId=p-42": [{ 状态: 200, 体: { snapshots: [], truncated: false } }],
    "/openhive/project/backup/status?projectId=p-42": [{ 状态: 200, 体: { usageBytes: 0, limitBytes: 1, autoPaused: false } }],
  })

  expect(await PROJECT_DATA.backup("p-42", "资料", false)).toEqual({ jobId: "j-1" })
  expect(假.记.at(-1)).toMatchObject({ url: "/openhive/project/backup", method: "POST" })
  expect(JSON.parse(String(假.记.at(-1)!.体))).toEqual({ projectId: "p-42", path: "资料", allowOverQuota: false })

  expect((await PROJECT_DATA.job("j-1"))?.state).toBe("succeeded")
  expect(await PROJECT_DATA.cancelJob("j-1")).toBe(true)
  expect(await PROJECT_DATA.snapshots("p-42")).toEqual([])
  expect(await PROJECT_DATA.backupStatus("p-42")).toMatchObject({ usageBytes: 0 })
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test src/project/project-data.test.ts`
Expected: FAIL —— `PROJECT_DATA.backup is not a function`。

- [ ] **Step 3: 实现 `openhive-backup.ts`**

```ts
/**
 * 文件级备份快照的客户端（2026-10-18）。
 *
 * 三态沿用 `openhive-files.ts`：`undefined` ＝ 取不到；`[]` ＝ 明确没有。
 * 所有写操作都带 `x-openhive-project`？**不带**——服务端认的是请求体 / 查询串里的
 * `projectId`，而 `projectLocationLayer` 会把带头的那条链套上「已归档 ⇒ 403」。
 * 备份自己的授权已经判过归档（403），所以这里保持与 `openhive-members.ts` 同一口径。
 */

import { defaultSend, isRecord, readJson, trySend, type ForkFetch } from "./openhive-fetch"

export const BACKUP_PATH = "/openhive/project/backup"
export const BACKUP_STATUS_PATH = "/openhive/project/backup/status"
export const BACKUP_SNAPSHOTS_PATH = "/openhive/project/backup/snapshots"
export const BACKUP_PREVIEW_PATH = "/openhive/project/backup/restore/preview"
export const BACKUP_RESTORE_PATH = "/openhive/project/backup/restore"
export const BACKUP_HEARTBEAT_PATH = "/openhive/project/backup/heartbeat"
export const BACKUP_JOB_PATH = "/openhive/project/backup/jobs"

export type BackupSnapshotKind = "manual" | "auto"
export type BackupJobState =
  | "queued"
  | "scanning"
  | "hashing"
  | "uploading"
  | "committing"
  | "previewing"
  | "restoring"
  | "succeeded"
  | "failed"
  | "cancelled"

export interface BackupSnapshot {
  readonly id: string
  readonly kind: BackupSnapshotKind
  readonly scope: string
  readonly createdAt: number
  readonly status: "complete" | "partial"
  readonly totals: { readonly files: number; readonly bytes: number; readonly uploadedBytes: number; readonly skipped: number }
}

export interface BackupJob {
  readonly id: string
  readonly kind: "backup" | "preview" | "restore"
  readonly state: BackupJobState
  readonly progress: { readonly filesTotal: number; readonly filesDone: number; readonly bytesTotal: number; readonly bytesDone: number }
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean }
  readonly result?: { readonly snapshotId?: string; readonly preview?: BackupPreview; readonly restore?: BackupRestoreResult }
}

export interface BackupStatus {
  readonly activeJob: BackupJob | null
  readonly lastSnapshot: { readonly id: string; readonly size: number; readonly lastModified: number } | null
  readonly usageBytes: number
  readonly limitBytes: number
  readonly autoPaused: boolean
}

export interface BackupSnapshotDetail extends BackupSnapshot {
  readonly projectId: string
  readonly ownerId: string
  readonly files: readonly { readonly path: string; readonly hash: string; readonly size: number; readonly mtimeMs: number }[]
  readonly dirs: readonly string[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

export type RestoreDecision = "overwrite" | "keep-both" | "skip"

export interface BackupPreviewEntry {
  readonly path: string
  readonly status: "missing" | "same" | "different" | "type-mismatch"
}

export interface BackupPreview {
  readonly snapshotId: string
  readonly scope: string
  readonly counts: { readonly missing: number; readonly same: number; readonly different: number; readonly "type-mismatch": number }
  readonly entries: readonly BackupPreviewEntry[]
  readonly truncated: boolean
  readonly localOnly: readonly string[]
  readonly localOnlyTruncated: boolean
}

export interface BackupRestoreResult {
  readonly restored: readonly string[]
  readonly keptBoth: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly path: string; readonly reason: string }[]
  readonly cancelled: boolean
}

function 收窄快照(value: unknown): BackupSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || typeof value.createdAt !== "number") return undefined
  if (value.kind !== "manual" && value.kind !== "auto") return undefined
  if (value.status !== "complete" && value.status !== "partial") return undefined
  if (typeof value.scope !== "string" || !isRecord(value.totals)) return undefined
  const totals = value.totals
  if (typeof totals.files !== "number" || typeof totals.bytes !== "number") return undefined
  return {
    id: value.id,
    kind: value.kind,
    scope: value.scope,
    createdAt: value.createdAt,
    status: value.status,
    totals: {
      files: totals.files,
      bytes: totals.bytes,
      uploadedBytes: typeof totals.uploadedBytes === "number" ? totals.uploadedBytes : 0,
      skipped: typeof totals.skipped === "number" ? totals.skipped : 0,
    },
  }
}

async function 发(
  send: ForkFetch,
  url: string,
  init: RequestInit,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await trySend(send, url, init)
  if (!response) return { status: 0, body: undefined }
  const body = response.status === 204 ? undefined : await readJson(response)
  return { status: response.status, body }
}

export async function listSnapshots(
  projectId: string,
  path = "",
  send: ForkFetch = defaultSend,
): Promise<readonly BackupSnapshot[] | undefined> {
  const 查询 = new URLSearchParams({ projectId, path })
  const res = await 发(send, `${BACKUP_SNAPSHOTS_PATH}?${查询}`, { method: "GET", credentials: "same-origin" })
  if (res.status !== 200 || !isRecord(res.body) || !Array.isArray(res.body.snapshots)) return undefined
  return res.body.snapshots.map(收窄快照).filter((snapshot): snapshot is BackupSnapshot => snapshot !== undefined)
}

export async function backupStatus(
  projectId: string,
  send: ForkFetch = defaultSend,
): Promise<BackupStatus | undefined> {
  const res = await 发(send, `${BACKUP_STATUS_PATH}?${new URLSearchParams({ projectId })}`, {
    method: "GET",
    credentials: "same-origin",
  })
  if (res.status !== 200 || !isRecord(res.body)) return undefined
  const body = res.body
  if (typeof body.usageBytes !== "number" || typeof body.limitBytes !== "number") return undefined
  return {
    activeJob: isRecord(body.activeJob) ? (body.activeJob as unknown as BackupJob) : null,
    lastSnapshot:
      isRecord(body.lastSnapshot) && typeof body.lastSnapshot.id === "string"
        ? {
            id: body.lastSnapshot.id,
            size: typeof body.lastSnapshot.size === "number" ? body.lastSnapshot.size : 0,
            lastModified: typeof body.lastSnapshot.lastModified === "number" ? body.lastSnapshot.lastModified : 0,
          }
        : null,
    usageBytes: body.usageBytes,
    limitBytes: body.limitBytes,
    autoPaused: body.autoPaused === true,
  }
}

export async function snapshotDetail(
  projectId: string,
  snapshotId: string,
  send: ForkFetch = defaultSend,
): Promise<BackupSnapshotDetail | undefined> {
  const res = await 发(send, `${BACKUP_SNAPSHOTS_PATH}/${encodeURIComponent(snapshotId)}?${new URLSearchParams({ projectId })}`, {
    method: "GET",
    credentials: "same-origin",
  })
  if (res.status !== 200 || !isRecord(res.body) || !Array.isArray(res.body.files)) return undefined
  const 快照 = 收窄快照(res.body)
  if (!快照) return undefined
  return {
    ...快照,
    projectId,
    ownerId: typeof res.body.ownerId === "string" ? res.body.ownerId : "",
    files: res.body.files.flatMap((file) =>
      isRecord(file) && typeof file.path === "string" && typeof file.size === "number"
        ? [{ path: file.path, hash: typeof file.hash === "string" ? file.hash : "", size: file.size, mtimeMs: typeof file.mtimeMs === "number" ? file.mtimeMs : 0 }]
        : [],
    ),
    dirs: Array.isArray(res.body.dirs) ? res.body.dirs.filter((dir): dir is string => typeof dir === "string") : [],
    skipped: Array.isArray(res.body.skipped)
      ? res.body.skipped.flatMap((skip) =>
          isRecord(skip) && typeof skip.path === "string" && typeof skip.reason === "string"
            ? [{ path: skip.path, reason: skip.reason }]
            : [],
        )
      : [],
  }
}

export async function backupProject(
  projectId: string,
  path = "",
  allowOverQuota = false,
  send: ForkFetch = defaultSend,
): Promise<{ jobId: string } | { code: string; jobId?: string } | undefined> {
  const res = await 发(send, BACKUP_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, allowOverQuota }),
  })
  if (res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string") return { jobId: res.body.jobId }
  if (res.status === 409 && isRecord(res.body)) {
    return { code: typeof res.body.code === "string" ? res.body.code : "job_running", ...(typeof res.body.jobId === "string" ? { jobId: res.body.jobId } : {}) }
  }
  return undefined
}

export async function previewRestore(
  projectId: string,
  input: { snapshotId: string; path: string },
  send: ForkFetch = defaultSend,
): Promise<string | undefined> {
  const res = await 发(send, BACKUP_PREVIEW_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...input }),
  })
  return res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string" ? res.body.jobId : undefined
}

export async function restoreBackup(
  projectId: string,
  input: { snapshotId: string; path: string; decision: RestoreDecision; decisions?: Record<string, RestoreDecision> },
  send: ForkFetch = defaultSend,
): Promise<string | undefined> {
  const res = await 发(send, BACKUP_RESTORE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...input }),
  })
  return res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string" ? res.body.jobId : undefined
}

export async function deleteSnapshot(
  projectId: string,
  snapshotId: string,
  send: ForkFetch = defaultSend,
): Promise<boolean> {
  const res = await 发(send, `${BACKUP_SNAPSHOTS_PATH}/${encodeURIComponent(snapshotId)}?${new URLSearchParams({ projectId })}`, {
    method: "DELETE",
    credentials: "same-origin",
  })
  return res.status === 200 || res.status === 204
}

export async function taskOf(jobId: string, send: ForkFetch = defaultSend): Promise<BackupJob | undefined> {
  const res = await 发(send, `${BACKUP_JOB_PATH}/${encodeURIComponent(jobId)}`, { method: "GET", credentials: "same-origin" })
  if (res.status !== 200 || !isRecord(res.body) || typeof res.body.id !== "string") return undefined
  return res.body as unknown as BackupJob
}

export async function cancelTask(jobId: string, send: ForkFetch = defaultSend): Promise<boolean> {
  const res = await 发(send, `${BACKUP_JOB_PATH}/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    credentials: "same-origin",
  })
  return res.status === 202 || res.status === 200
}

/** 心跳：失败不报错（最坏只是这个项目这一轮不算活跃）。 */
export async function backupHeartbeat(projectId: string, send: ForkFetch = defaultSend): Promise<boolean> {
  const res = await 发(send, BACKUP_HEARTBEAT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  return res.status === 204
}
```

- [ ] **Step 4: `project-data.ts` 加十个方法**

接口：

```ts
  /** 备份快照列表（`undefined` = 取不到，`[]` = 一个恢复点都没有）。 */
  snapshots(projectId: string, path?: string): Promise<readonly BackupSnapshot[] | undefined>
  /** 一个恢复点的完整清单（下树用它画行）。 */
  snapshotDetail(projectId: string, snapshotId: string): Promise<BackupSnapshotDetail | undefined>
  /** 起一次手动备份；409 时回 `{code:"job_running", jobId}`。 */
  backup(projectId: string, path?: string, allowOverQuota?: boolean): Promise<{ jobId: string } | { code: string; jobId?: string } | undefined>
  /** 备份状态（用量 / 暂停 / 正在跑的任务）。 */
  backupStatus(projectId: string): Promise<BackupStatus | undefined>
  /** 起一次恢复预览任务，回 jobId。 */
  previewRestore(projectId: string, input: { snapshotId: string; path: string }): Promise<string | undefined>
  /** 起一次恢复任务，回 jobId。 */
  restoreBackup(projectId: string, input: { snapshotId: string; path: string; decision: RestoreDecision; decisions?: Record<string, RestoreDecision> }): Promise<string | undefined>
  /** 删一个恢复点（只删 manifest）。 */
  deleteSnapshot(projectId: string, snapshotId: string): Promise<boolean>
  /** 取任务。⚠️ 名字带 `Job` 而不是 `task`：接口上已经有 `files` / `snapshots` 这类复数读口。 */
  job(jobId: string): Promise<BackupJob | undefined>
  cancelJob(jobId: string): Promise<boolean>
  /** 「我还在这个项目里」心跳（自动备份的活跃判定）。 */
  heartbeat(projectId: string): Promise<boolean>
```

实现对象里逐个接 `openhive-backup` 的同名函数。

- [ ] **Step 5: 跑绿 + 提交**

Run: `cd packages/app && bun test src/project/project-data.test.ts`
Expected: PASS。

```bash
git add packages/app/src/project/openhive-backup.ts packages/app/src/project/project-data.ts packages/app/src/project/project-data.test.ts
git commit -m "feat(app): 备份快照客户端与 ProjectData 十个方法

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 14: `minio-backups` 状态 + `minio-bar` 进度与取消

**Files:**
- Modify: `packages/app/src/project/minio-backups.ts`
- Modify: `packages/app/src/project/minio-bar.tsx`
- Test: `packages/app/src/project/minio-bar.test.tsx`

**Interfaces:**
- Consumes: Task 13 的 `BackupSnapshot` / `BackupJob`。
- Produces:
  - `minioBackups` / `backupSnapshots` / `backupSnapshotId` / `backupUsage` / `backupJob` 五个模块级信号与对应 setter
  - `MinioBarProps { count?, usage?, job?, onOpen?, onCancel? }`

- [ ] **Step 1: 写会红的测试**

`minio-bar.test.tsx` 追加：

```ts
test("有任务时出进度条：确定进度按字节算，扫描阶段是不确定态", () => {
  const host = mount(() => (
    <MinioBar
      onOpen={() => {}}
      job={{ id: "j", kind: "backup", state: "uploading", progress: { filesTotal: 3, filesDone: 1, bytesTotal: 100, bytesDone: 50 } }}
    />
  ))
  const 条 = host.querySelector("[role='progressbar']")
  expect(条?.getAttribute("aria-valuenow")).toBe("50")
  expect(条?.getAttribute("aria-valuemin")).toBe("0")
  expect(条?.getAttribute("aria-valuemax")).toBe("100")
})

test("扫描阶段：data-indeterminate 为 true，没有 aria-valuenow", () => {
  const host = mount(() => (
    <MinioBar
      onOpen={() => {}}
      job={{ id: "j", kind: "backup", state: "scanning", progress: { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 } }}
    />
  ))
  const 条 = host.querySelector("[role='progressbar']")
  expect(条?.getAttribute("data-indeterminate")).toBe("true")
  expect(条?.hasAttribute("aria-valuenow")).toBe(false)
})

test("取消钮只在有任务时出现，点了调 onCancel", () => {
  const 点过: string[] = []
  const host = mount(() => (
    <MinioBar
      onOpen={() => {}}
      onCancel={() => 点过.push("cancel")}
      job={{ id: "j", kind: "backup", state: "uploading", progress: { filesTotal: 1, filesDone: 0, bytesTotal: 10, bytesDone: 0 } }}
    />
  ))
  const 钮 = host.querySelector<HTMLButtonElement>("[data-slot='minio-bar-cancel']")
  expect(钮).not.toBeNull()
  钮!.click()
  expect(点过).toEqual(["cancel"])
})

test("用量：超过 80% 进入告警态；暂停自动备份时出提示", () => {
  const host = mount(() => (
    <MinioBar onOpen={() => {}} usage={{ usedBytes: 9, limitBytes: 10, autoPaused: true }} />
  ))
  expect(host.querySelector("[data-slot='minio-bar-usage']")?.getAttribute("data-state")).toBe("warning")
  expect(host.querySelector("[data-slot='minio-bar-paused']")).not.toBeNull()
})
```

同步改既有 6 条：`条(host)` 改成取主按钮 `[data-slot='minio-bar-open']`（结构改造后 `[data-component='minio-bar']` 是外层 div）。

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test src/project/minio-bar.test.tsx`
Expected: FAIL —— `role=progressbar` 找不到。

- [ ] **Step 3: 改 `minio-backups.ts`**

```ts
/**
 * 备份快照的**接入缝**（模块级信号，唯一写入方是 `workspace-entry.tsx`）。
 *
 * 五个信号分工：
 * - `minioBackups`：当前恢复点的**文件路径清单**（下树画行用），三态语义不变
 *   （`undefined` = 还没取到，`[]` = 明确空）；
 * - `backupSnapshots`：恢复点列表；
 * - `backupSnapshotId`：当前选中的恢复点；
 * - `backupUsage`：用量与自动备份暂停态；
 * - `backupJob`：正在跑的任务（进度条 + 取消）。
 */

import { createSignal } from "solid-js"
import type { BackupJob, BackupSnapshot } from "./openhive-backup"

export const [minioBackups, setMinioBackups] = createSignal<readonly string[] | undefined>()
export const [backupSnapshots, setBackupSnapshots] = createSignal<readonly BackupSnapshot[] | undefined>()
export const [backupSnapshotId, setBackupSnapshotId] = createSignal<string | undefined>()
export const [backupUsage, setBackupUsage] = createSignal<
  { readonly usedBytes: number; readonly limitBytes: number; readonly autoPaused: boolean } | undefined
>()
export const [backupJob, setBackupJob] = createSignal<BackupJob | undefined>()
```

- [ ] **Step 4: 改 `minio-bar.tsx`**

外层改 `<div data-component="minio-bar" role="group" class="flex w-full shrink-0 flex-col border-t border-v2-border-border-muted">`，里面：

```tsx
    <div class="flex h-7 w-full items-center gap-1.5 px-2">
      <button
        data-slot="minio-bar-open"
        type="button"
        disabled={props.onOpen === undefined}
        onClick={() => props.onOpen?.()}
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[13px] text-v2-text-text-muted transition-colors hover:text-v2-text-text-base disabled:cursor-default"
      >
        <span data-slot="minio-bar-icon" aria-hidden="true" class={ICON_WRAP}>
          <Icon name="cloud-upload" size="small" />
        </span>
        <span data-slot="minio-bar-label">{LABEL}</span>
        {props.count !== undefined && <span data-slot="minio-bar-count">{`· ${props.count} 项`}</span>}
        <Show when={props.usage}>{(usage) => <span data-slot="minio-bar-usage" data-state={用量态(usage())}>{`${格式(usage().usedBytes)} / ${格式(usage().limitBytes)}`}</span>}</Show>
        <span data-slot="minio-bar-chevron" aria-hidden="true" class={`${ICON_WRAP} ml-auto`}>
          <Icon name="chevron-right" size="small" />
        </span>
      </button>
      <Show when={props.job}>
        {(job) => (
          <button
            data-slot="minio-bar-cancel"
            type="button"
            class="flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => props.onCancel?.()}
          >
            取消
          </button>
        )}
      </Show>
    </div>
    <Show when={props.job}>
      {(job) => (
        <>
          <span
            data-slot="minio-bar-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={百分比(job().progress) ?? undefined}
            data-indeterminate={百分比(job().progress) === undefined ? "true" : "false"}
            aria-label="备份进度"
            class="block h-0.5 w-full bg-v2-overlay-simple-overlay-hover"
          >
            <span class="block h-full bg-v2-text-text-base transition-[width]" style={{ width: `${百分比(job().progress) ?? 8}%` }} />
          </span>
          <span data-slot="minio-bar-stage" class="px-2 py-0.5 text-[12px] text-v2-text-text-faint">
            {阶段(job().state)}
          </span>
        </>
      )}
    </Show>
    <Show when={props.usage?.autoPaused}>
      <p data-slot="minio-bar-paused" class="px-2 pb-1 text-[12px] text-v2-state-fg-danger">
        已超出容量上限，自动备份已暂停（不会自动删旧恢复点）
      </p>
    </Show>
```

几个纯函数放在文件末尾：

```ts
function 百分比(progress: { filesTotal: number; filesDone: number; bytesTotal: number; bytesDone: number }): number | undefined {
  if (progress.bytesTotal > 0) return Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100))
  if (progress.filesTotal > 0) return Math.min(100, Math.floor((progress.filesDone / progress.filesTotal) * 100))
  return undefined
}

function 阶段(state: string): string {
  switch (state) {
    case "queued": return "排队中"
    case "scanning": return "正在扫描…"
    case "hashing": return "正在计算校验值…"
    case "uploading": return "正在上传…"
    case "committing": return "正在写恢复点…"
    case "previewing": return "正在比对…"
    case "restoring": return "正在恢复…"
    case "succeeded": return "完成"
    case "failed": return "失败"
    case "cancelled": return "已取消"
    default: return ""
  }
}

function 用量态(usage: { usedBytes: number; limitBytes: number }): "normal" | "warning" {
  return usage.limitBytes > 0 && usage.usedBytes / usage.limitBytes >= 0.8 ? "warning" : "normal"
}

function 格式(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`
  return `${bytes} B`
}
```

- [ ] **Step 5: 跑绿 + 提交**

Run: `cd packages/app && bun test src/project/minio-bar.test.tsx`
Expected: PASS。

```bash
git add packages/app/src/project/minio-backups.ts packages/app/src/project/minio-bar.tsx packages/app/src/project/minio-bar.test.tsx
git commit -m "feat(app): MinIO 窄条显示进度、阶段、用量与取消；恢复点接入缝扩容

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 15: `dual-file-tree` 拖拽语义改造（原路径 / `minio:` 载荷 / 恢复对话框入口）

**Files:**
- Modify: `packages/app/src/project/dual-file-tree.tsx`
- Test: `packages/app/src/project/dual-file-tree.test.tsx`

**Interfaces:**
- Consumes: Task 13 的 `BackupSnapshot`；Task 14 的接入缝（只读 `props`，不直接读信号）。
- Produces:
  - `DualFileTreeProps` 新增：
    ```ts
    snapshots?: readonly BackupSnapshot[]
    snapshotId?: string
    onSelectSnapshot?: (id: string) => void
    onDeleteSnapshot?: (id: string) => void
    usage?: { usedBytes: number; limitBytes: number; autoPaused: boolean }
    onRestore?: (input: { snapshotId: string; path: string }) => void
    ```
  - 上树 → 下树回调收到**拖源原路径**；下树行载荷 `minio:<path>`。

- [ ] **Step 1: 改写旧语义用例（`LEARNINGS #006-36`：冲突 ⇒ 改写，不是删）**

`dual-file-tree.test.tsx` 里这五条必须改写：

```ts
test("沙箱文件拖到下树：回调收到拖源原路径（不复制到鼠标所在目录）", async () => {
  const 备份的: string[] = []
  const { host } = 挂({ onBackup: (path) => 备份的.push(path) })
  await 全展开上树(host)
  拖到(host, 行(host, "报告.docx"), 槽(host, "minio-tree"))
  expect(备份的).toEqual(["报告.docx"])
})

test("沙箱目录拖到下树：回调收到目录自身路径", async () => {
  const 备份的: string[] = []
  const { host } = 挂({ onBackup: (path) => 备份的.push(path) })
  await 全展开上树(host)
  拖到(host, 行(host, "资金流水"), 槽(host, "minio-tree"))
  expect(备份的).toEqual(["资金流水"])
})

test("沙箱文件拖到下树的某个文件行：仍然按拖源原路径备份（落点不参与）", async () => {
  const 备份的: string[] = []
  const { host } = 挂({ onBackup: (path) => 备份的.push(path) })
  await 全展开上树(host)
  拖到(host, 行(host, "报告.docx"), 行(host, "资金流水/支付宝.xlsx"))
  expect(备份的).toEqual(["报告.docx"])
})

test("下树的行起拖载荷是 minio:<path>；拖回上树 ⇒ onRestore({snapshotId, path})", async () => {
  const 拉回: Array<{ snapshotId: string; path: string }> = []
  const { host } = 挂({ onRestore: (input) => 拉回.push(input), snapshotId: "s-1" })
  const 行元素 = 行(host, "资金流水/支付宝.xlsx")
  const 载荷 = 起拖载荷(host, 行元素)
  expect(载荷).toBe("minio:资金流水/支付宝.xlsx")
  拖到(host, 行元素, 槽(host, "sandbox-tree"))
  expect(拉回).toEqual([{ snapshotId: "s-1", path: "资金流水/支付宝.xlsx" }])
})

test("恢复点未选中时下树不可拖（没有恢复点就没有可拉的东西）", () => {
  const { host } = 挂({ onRestore: () => {}, snapshotId: undefined })
  const 行元素 = 行(host, "资金流水/支付宝.xlsx")
  expect(行元素?.getAttribute("draggable")).not.toBe("true")
})
```

删除这五条旧断言里的「目录行 ⇒ 拼路径」与「空白 ⇒ 取文件名」两类；**不要**删掉「上树行恒可拖」「同树拖不触发备份」这两条（它们与新语义不冲突）。

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test src/project/dual-file-tree.test.tsx`
Expected: FAIL —— 回调收到 `资金流水/报告.docx` / 载荷是 `file:...` / 冲突时弹内联条。

- [ ] **Step 3: 改 `dual-file-tree.tsx`**

① `splitProps` 增加五个名字；`MinioTree` 的 `draggable` 改成 `local.onRestore !== undefined && local.snapshotId !== undefined`。

② `放下`：

```ts
  function 放下(event: DragEvent) {
    if (!可放(event)) return
    event.preventDefault()
    const 源 = 拖源()
    set拖源(undefined)
    if (!源) return
    // 落点**不参与**路径计算（2026-10-18 用户裁定：保持原路径）。
    // 拖到哪个目录行都一样——备份的是被拖的那一项，不是「它到那儿之后的样子」。
    if (源.树 === "sandbox") local.onBackup?.(源.路径)
    else local.onRestore?.({ snapshotId: local.snapshotId!, path: 源.路径 })
  }
```

③ 删除 `拼路径` / `父目录` / `待拉回` / `确认拉回` / 内联确认条整段（`restore-confirm` 从本文件消失，冲突判断改在 `workspace-entry` 起预览任务时做）。

④ `起拖` 的载荷按树分流：

```ts
    const 引用 = 位.类型 === "directory" ? `${位.路径}/` : 位.路径
    event.dataTransfer?.setData("text/plain", 位.树 === "minio" ? `minio:${位.路径}` : `file:${引用}`)
```

⑤ `MinioTree` 标题行加恢复点选择器、删除按钮、用量：

```tsx
        <select
          data-slot="minio-tree-snapshot"
          aria-label="恢复点"
          class="h-6 min-w-0 max-w-[140px] shrink rounded-[4px] bg-transparent text-[12px] text-v2-text-text-muted"
          value={props.snapshotId ?? ""}
          onChange={(event) => props.onSelectSnapshot?.(event.currentTarget.value)}
        >
          <For each={props.snapshots ?? []}>
            {(snapshot) => (
              <option value={snapshot.id}>
                {`${new Date(snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })}（${snapshot.kind === "auto" ? "自动" : "手动"}）`}
              </option>
            )}
          </For>
        </select>
        <button
          data-slot="minio-tree-delete"
          type="button"
          aria-label="删除这个恢复点"
          disabled={props.snapshotId === undefined}
          onClick={() => props.snapshotId && props.onDeleteSnapshot?.(props.snapshotId)}
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-default"
        >
          <Icon name="trash" size="small" class="[--icon-base:currentColor]" />
        </button>
```

（图标名以 `packages/ui/src/icon.tsx` 的实际清单为准；`trash` 不在就换 `close`，并在注释里写明。）

空态三分支：

```tsx
              {props.usage?.autoPaused
                ? EMPTY_PAUSED
                : props.snapshots === undefined
                  ? EMPTY_NO_SOURCE
                  : (props.snapshots?.length ?? 0) === 0
                    ? EMPTY_NONE
                    : EMPTY_PICK}
```

常量：

```ts
const EMPTY_NO_SOURCE = "备份清单未接入"
const EMPTY_NONE = "还没有备份"
const EMPTY_PICK = "选一个恢复点查看文件"
const EMPTY_PAUSED = "已超出容量上限，自动备份已暂停"
```

- [ ] **Step 4: 跑绿**

Run: `cd packages/app && bun test src/project/dual-file-tree.test.tsx`
Expected: PASS。若有旧用例仍断言 `restore-confirm`，按 Step 1 的口径改写（它是「冲突先在树里确认」的旧设计，已被对话框取代）。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/project/dual-file-tree.tsx packages/app/src/project/dual-file-tree.test.tsx
git commit -m "feat(app): 拖拽备份改为保持原路径，下树恢复点选择与 minio: 载荷

【保留的定制 · 同步上游时不要丢】
- 上树→下树回调收到拖源原路径（用户 2026-10-18 裁定）
- 下树行载荷 minio:<path>；冲突处理移到恢复对话框"
```

---

### Task 16: 恢复对话框

**Files:**
- Create: `packages/app/src/project/backup-restore-dialog.tsx`
- Test: `packages/app/src/project/backup-restore-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 13 的 `BackupPreview` / `RestoreDecision`。
- Produces:
  - `RestoreDialog(props: { preview?: BackupPreview; busy?: boolean; onCancel(): void; onConfirm(input: { decision: RestoreDecision; decisions: Record<string, RestoreDecision> }): void })`

- [ ] **Step 1: 写会红的测试**

```tsx
import { expect, test } from "bun:test"
import { mount } from "@solidjs/testing-library"
import { RestoreDialog } from "./backup-restore-dialog"

const 预览 = {
  snapshotId: "s-1",
  scope: "",
  counts: { missing: 1, same: 1, different: 1, "type-mismatch": 0 },
  entries: [
    { path: "新.txt", status: "missing" as const },
    { path: "同.txt", status: "same" as const },
    { path: "改.txt", status: "different" as const },
  ],
  truncated: false,
  localOnly: ["本地才有.txt"],
  localOnlyTruncated: false,
}

test("默认策略是保留两者；点恢复回 {decision:'keep-both', decisions:{}}", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />).container
  expect(host.querySelector<HTMLInputElement>("[data-slot='restore-decision'][value='keep-both']")?.checked).toBe(true)
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: {} }])
})

test("逐条改判：different 的条目改成覆盖，进 decisions", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />).container
  const 选 = host.querySelector<HTMLSelectElement>("[data-slot='restore-entry'][data-path='改.txt']")!
  选.value = "overwrite"
  选.dispatchEvent(new Event("change", { bubbles: true }))
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: { "改.txt": "overwrite" } }])
})

test("missing 与 same 不提供逐条选择（它们没有可选的动作）", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />).container
  expect(host.querySelector("[data-slot='restore-entry'][data-path='新.txt']")).toBeNull()
  expect(host.querySelector("[data-slot='restore-entry'][data-path='同.txt']")).toBeNull()
})

test("显示四类计数与「仅本地」提示", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />).container
  expect(host.querySelector("[data-slot='restore-count-missing']")?.textContent).toContain("1")
  expect(host.querySelector("[data-slot='restore-count-different']")?.textContent).toContain("1")
  expect(host.querySelector("[data-slot='restore-local-only']")?.textContent).toContain("本地才有.txt")
})

test("取消调 onCancel；busy 时两颗钮都禁用", () => {
  const 叫: string[] = []
  const host = mount(() => <RestoreDialog preview={预览} busy onCancel={() => 叫.push("cancel")} onConfirm={() => 叫.push("confirm")} />).container
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-cancel']")!.disabled).toBe(true)
})
```

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test src/project/backup-restore-dialog.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```tsx
/**
 * 从 MinIO 拉回的**恢复对话框**（2026-10-18，spec §6.3）。
 *
 * 为什么不复用树里的内联确认条：恢复现在是一个**预览 + 三选一**的动作，一条内联条装不下
 * 「哪些新增 / 哪些相同 / 哪些冲突 / 哪些只在本地」。旧的内联条已随 `dual-file-tree.tsx`
 * 的拖拽语义改造一起删除。
 *
 * 默认策略是**保留两者**（用户 2026-10-18 裁定）：覆盖会丢用户现写的那份，默认不该是它。
 */

import { For, Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import type { BackupPreview, RestoreDecision } from "./openhive-backup"

export interface RestoreDialogProps {
  readonly preview?: BackupPreview
  readonly busy?: boolean
  readonly onCancel: () => void
  readonly onConfirm: (input: {
    readonly decision: RestoreDecision
    readonly decisions: Record<string, RestoreDecision>
  }) => void
}

const 决策文案: Record<RestoreDecision, string> = {
  overwrite: "覆盖本地",
  "keep-both": "保留两者",
  skip: "跳过",
}

const 按钮 =
  "flex h-6 shrink-0 items-center rounded-[4px] px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-default disabled:opacity-50"

export function RestoreDialog(props: RestoreDialogProps): JSX.Element {
  const [决策, set决策] = createSignal<RestoreDecision>("keep-both")
  const [逐条, set逐条] = createSignal<Record<string, RestoreDecision>>({})

  const 可逐条 = () => (props.preview?.entries ?? []).filter((entry) => entry.status === "different")

  return (
    <div data-component="backup-restore-dialog" class="flex w-full min-w-0 flex-col gap-2 p-3">
      <h2 class="text-[14px] text-v2-text-text-base">从 MinIO 拉回</h2>

      <Show when={props.preview} fallback={<p class="text-[13px] text-v2-text-text-faint">正在比对…</p>}>
        {(preview) => (
          <>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-v2-text-text-muted">
              <span data-slot="restore-count-missing">{`新增 ${preview().counts.missing}`}</span>
              <span data-slot="restore-count-same">{`相同 ${preview().counts.same}`}</span>
              <span data-slot="restore-count-different">{`不同 ${preview().counts.different}`}</span>
              <span data-slot="restore-count-type">{`类型冲突 ${preview().counts["type-mismatch"]}`}</span>
            </div>

            <Show when={preview().localOnly.length > 0}>
              <p data-slot="restore-local-only" class="text-[12px] text-v2-text-text-faint">
                {`只在本地、不会被删除：${preview().localOnly.join("、")}${preview().localOnlyTruncated ? " …" : ""}`}
              </p>
            </Show>

            <div class="flex flex-col gap-1">
              <For each={["keep-both", "overwrite", "skip"] as const}>
                {(value) => (
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="restore-decision"
                      type="radio"
                      name="restore-decision"
                      value={value}
                      checked={决策() === value}
                      onChange={() => set决策(value)}
                    />
                    {决策文案[value]}
                  </label>
                )}
              </For>
            </div>

            <Show when={可逐条().length > 0}>
              <div data-slot="restore-entries" class="flex max-h-48 flex-col gap-1 overflow-y-auto">
                <For each={可逐条()}>
                  {(entry) => (
                    <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                      <span class="min-w-0 flex-1 truncate">{entry.path}</span>
                      <select
                        data-slot="restore-entry"
                        data-path={entry.path}
                        value={逐条()[entry.path] ?? 决策()}
                        onChange={(event) =>
                          set逐条({ ...逐条(), [entry.path]: event.currentTarget.value as RestoreDecision })
                        }
                        class="h-6 shrink-0 rounded-[4px] bg-transparent text-[12px]"
                      >
                        <option value="keep-both">保留两者</option>
                        <option value="overwrite">覆盖本地</option>
                        <option value="skip">跳过</option>
                      </select>
                    </label>
                  )}
                </For>
              </div>
            </Show>

            <Show when={preview().truncated}>
              <p class="text-[12px] text-v2-text-text-faint">条目太多，只列出前 2000 条；上面选中的策略仍对全部条目生效。</p>
            </Show>
          </>
        )}
      </Show>

      <div class="flex items-center justify-end gap-1">
        <button data-slot="restore-cancel" type="button" disabled={props.busy} class={按钮} onClick={() => props.onCancel()}>
          取消
        </button>
        <button
          data-slot="restore-confirm"
          type="button"
          disabled={props.busy || props.preview === undefined}
          class={按钮}
          onClick={() => props.onConfirm({ decision: 决策(), decisions: 逐条() })}
        >
          恢复
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑绿 + 提交**

Run: `cd packages/app && bun test src/project/backup-restore-dialog.test.tsx`
Expected: PASS。

```bash
git add packages/app/src/project/backup-restore-dialog.tsx packages/app/src/project/backup-restore-dialog.test.tsx
git commit -m "feat(app): 恢复预览与三选一对话框（默认保留两者）

【保留的定制 · 同步上游时不要丢】"
```

---

### Task 17: `workspace-entry` 接线（心跳 / 状态轮询 / 备份 / 恢复）

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.tsx`
- Modify: `packages/app/src/workspace/workspace-entry.test.tsx`

**Interfaces:**
- Consumes: Task 13 `ProjectData` 十个方法；Task 14 五个信号；Task 16 `RestoreDialog`。
- Produces: 用户可点、可拖、可恢复的完整链。

- [ ] **Step 1: 写会红的接线测试**

`workspace-entry.test.tsx` 的 `假数据源` 先把 `Pick<ProjectData, ...>` 的键补上十个新方法，并加记录与默认剧本（未给剧本的读口返回 `undefined` / `[]`，写口返回未成功，口径同既有方法）。追加：

```ts
test("进入有项目：发心跳并取恢复点清单，下树显示最新恢复点的文件", async () => {
  const { data, 记 } = 假数据源({
    list: async () => [项目("p-42")],
    heartbeat: async (projectId) => {
      记.心跳.push(projectId)
      return true
    },
    snapshots: async (projectId) => {
      记.恢复点.push(projectId)
      return [{ id: "s-1", kind: "manual", scope: "", createdAt: 1, status: "complete", totals: { files: 1, bytes: 1, uploadedBytes: 1, skipped: 0 } }]
    },
    snapshotDetail: async () => ({ ...快照("s-1"), files: [{ path: "资料/甲.txt", hash: "a".repeat(64), size: 1, mtimeMs: 1 }] }),
  })
  const { host } = 挂(data)
  await 等(() => 记.心跳.length > 0)
  expect(记.心跳).toEqual(["p-42"])
  await 等(() => host.querySelector("[data-slot='minio-tree'] [data-path='资料/甲.txt']") !== null)
})

test("拖沙箱文件到下树 ⇒ 调 backup(projectId, 原路径, false)", async () => {
  const 起过的: Array<[string, string, boolean]> = []
  const { data } = 假数据源({
    list: async () => [项目("p-42")],
    backup: async (projectId, path, allowOverQuota) => {
      起过的.push([projectId, path ?? "", allowOverQuota ?? false])
      return { jobId: "j-1" }
    },
  })
  const { host } = 挂(data)
  await 等(() => 行(host, "报告.docx") !== null)
  await 全展开上树(host)
  拖到(host, 行(host, "报告.docx"), 槽(host, "minio-tree"))
  expect(起过的).toEqual([["p-42", "报告.docx", false]])
})

test("拖下树文件回上树 ⇒ 先起预览；预览回来后弹恢复对话框", async () => {
  const 预览过的: unknown[] = []
  const { data } = 假数据源({
    list: async () => [项目("p-42")],
    snapshots: async () => [{ id: "s-1", kind: "manual", scope: "", createdAt: 1, status: "complete", totals: { files: 1, bytes: 1, uploadedBytes: 1, skipped: 0 } }],
    snapshotDetail: async () => ({ ...快照("s-1"), files: [{ path: "资料/甲.txt", hash: "a".repeat(64), size: 1, mtimeMs: 1 }] }),
    previewRestore: async (projectId, input) => {
      预览过的.push({ projectId, ...input })
      return "job-preview"
    },
    job: async (jobId) => ({
      id: jobId,
      kind: "preview",
      state: "succeeded",
      progress: { filesTotal: 1, filesDone: 1, bytesTotal: 1, bytesDone: 1 },
      result: { preview: { snapshotId: "s-1", scope: "资料/甲.txt", counts: { missing: 1, same: 0, different: 0, "type-mismatch": 0 }, entries: [{ path: "资料/甲.txt", status: "missing" }], truncated: false, localOnly: [], localOnlyTruncated: false } },
    }),
  })
  const { host } = 挂(data)
  await 等(() => 行(host, "资料/甲.txt") !== null)
  拖到(host, 行(host, "资料/甲.txt"), 槽(host, "sandbox-tree"))
  await 等(() => document.querySelector("[data-component='backup-restore-dialog']") !== null)
  expect(预览过的).toEqual([{ projectId: "p-42", snapshotId: "s-1", path: "资料/甲.txt" }])
})
```

（`等` / `项目` / `快照` 是测试文件里已有或本任务补的小 helper：`等(predicate)` 用 `await new Promise((resolve) => setTimeout(resolve, 0))` 循环直到超时。）

- [ ] **Step 2: 跑红**

Run: `cd packages/app && bun test src/workspace/workspace-entry.test.tsx`
Expected: FAIL —— 心跳没发 / 下树没有行 / 拖拽没起备份。

- [ ] **Step 3: 接线**

在 `workspace-entry.tsx` 顶部 import：

```ts
import { RestoreDialog } from "@/project/backup-restore-dialog"
import {
  backupJob,
  backupSnapshotId,
  backupSnapshots,
  backupUsage,
  minioBackups,
  setBackupJob,
  setBackupSnapshotId,
  setBackupSnapshots,
  setBackupUsage,
  setMinioBackups,
} from "@/project/minio-backups"
```

在 `清单重取` 附近加：

```ts
  /**
   * 备份快照（2026-10-18）。
   *
   * 三件事绑在一个 effect 上，键是**当前项目**：
   * ① 进门取一次状态（用量 + 恢复点 + 选中恢复点的文件清单）；
   * ② 60 秒心跳（自动备份的「我还在这个项目里」）；
   * ③ 有任务在跑时 1 秒轮询；任务转入终态时重取状态与清单。
   */
  createEffect(() => {
    const id = currentProject()?.id
    setBackupSnapshots(undefined)
    setBackupSnapshotId(undefined)
    setBackupUsage(undefined)
    setBackupJob(undefined)
    setMinioBackups(undefined)
    if (!id || !projectData) return

    let 作废 = false
    const 取 = async () => {
      const 状态 = await projectData.backupStatus(id)
      if (作废) return
      if (状态) setBackupUsage({ usedBytes: 状态.usageBytes, limitBytes: 状态.limitBytes, autoPaused: 状态.autoPaused })
      setBackupJob(状态?.activeJob ?? undefined)
      const 清单 = await projectData.snapshots(id)
      if (作废) return
      setBackupSnapshots(清单)
      const 选中的 = backupSnapshotId()
      const 目标 = 选中的 && 清单?.some((snapshot) => snapshot.id === 选中的) ? 选中的 : 清单?.[0]?.id
      setBackupSnapshotId(目标)
      if (!目标) {
        setMinioBackups([])
        return
      }
      const 明细 = await projectData.snapshotDetail(id, 目标)
      if (作废) return
      setMinioBackups(明细?.files.map((file) => file.path) ?? undefined)
    }
    void 取()
    void projectData.heartbeat(id)
    const 心跳 = setInterval(() => void projectData.heartbeat(id), 60_000)
    const 轮询 = setInterval(() => {
      if (backupJob() === undefined) return
      void 取()
    }, 1_000)
    onCleanup(() => {
      作废 = true
      clearInterval(心跳)
      clearInterval(轮询)
    })
  })

  /** 起一个任务并等它跑完（预览 / 恢复用）。失败与取消都走同一条「说一句话」的出口。 */
  const 等任务 = async (jobId: string) => {
    for (let i = 0; i < 7_200; i += 1) {
      const job = await projectData?.job(jobId)
      if (job === undefined) return undefined
      setBackupJob(job)
      if (job.state === "succeeded" || job.state === "failed" || job.state === "cancelled") return job
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return undefined
  }

  const 备份 = async (path: string) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    const 起 = await projectData.backup(id, path, false)
    if (起 === undefined) {
      set文件话("备份没能起起来")
      return
    }
    if ("code" in 起) {
      if (起.code === "quota_exceeded") {
        // 超限：让用户自己决定要不要越过上限（spec §8.3 的 allowOverQuota）
        dialog.show(() => (
          <ConfirmDialog
            title="超出容量上限"
            message="这次备份会让项目用量超过 10 GiB。继续备份？（不会自动删旧恢复点）"
            onConfirm={() => void 备份越限(path)}
            onCancel={() => dialog.close()}
          />
        ))
        return
      }
      if (起.code === "job_running") set文件话("已有一个备份任务在跑")
      return
    }
    set文件话(undefined)
  }

  const 备份越限 = async (path: string) => {
    dialog.close()
    const id = currentProject()?.id
    if (!id || !projectData) return
    await projectData.backup(id, path, true)
  }

  const 拉回 = async (input: { snapshotId: string; path: string }) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    const jobId = await projectData.previewRestore(id, input)
    if (jobId === undefined) {
      set文件话("预览没能起起来")
      return
    }
    const job = await 等任务(jobId)
    const preview = job?.result?.preview
    if (preview === undefined) {
      set文件话("预览没取到")
      return
    }
    dialog.show(() => (
      <RestoreDialog
        preview={preview}
        busy={backupJob() !== undefined}
        onCancel={() => dialog.close()}
        onConfirm={async ({ decision, decisions }) => {
          dialog.close()
          const 恢复 = await projectData.restoreBackup(id, { ...input, decision, decisions })
          if (恢复 === undefined) {
            set文件话("恢复没能起起来")
            return
          }
          const 结果 = await 等任务(恢复)
          const body = 结果?.result?.restore
          if (body === undefined) {
            set文件话("恢复没有拿到结果")
            return
          }
          set文件话(
            `恢复完成：恢复 ${body.restored.length}，保留两者 ${body.keptBoth.length}，跳过 ${body.skipped.length}，失败 ${body.failed.length}`,
          )
          拨清单重取()
        }}
      />
    ))
  }

  const 删恢复点 = async (snapshotId: string) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    const 成 = await projectData.deleteSnapshot(id, snapshotId)
    if (!成) {
      set文件话("恢复点没删掉")
      return
    }
    setBackupSnapshotId(undefined)
    拨清单重取()
  }
```

`DualFileTree` 加接线：

```tsx
                        snapshots={backupSnapshots()}
                        snapshotId={backupSnapshotId()}
                        onSelectSnapshot={setBackupSnapshotId}
                        onDeleteSnapshot={(id) => void 删恢复点(id)}
                        usage={backupUsage()}
                        onBackup={(path) => void 备份(path)}
                        onRestore={(input) => void 拉回(input)}
```

`MinioBar` 加：

```tsx
                <MinioBar
                  count={minioBackups()?.length}
                  usage={backupUsage()}
                  job={backupJob()}
                  onCancel={() => {
                    const job = backupJob()
                    if (job) void projectData?.cancelJob(job.id)
                  }}
                  onOpen={() => {
                    setSidebarTab("files")
                    setDualOpen(true)
                  }}
                />
```

> ⚠️ `ConfirmDialog` 是否存在于本仓要以实际为准：若没有，就用 `useDialog().show()` 包一个最小的确认组件（三行文案 + 两颗钮），**不要**引入新依赖。

- [ ] **Step 4: 跑绿 + 门禁**

Run: `cd packages/app && bun test src/workspace/workspace-entry.test.tsx src/project/dual-file-tree.test.tsx src/project/minio-bar.test.tsx src/project/backup-restore-dialog.test.tsx src/project/project-data.test.ts`
Expected: PASS。
Run 仓库根: `bun run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/workspace/workspace-entry.tsx packages/app/src/workspace/workspace-entry.test.tsx
git commit -m "feat(app): 备份/恢复接线——心跳、状态轮询、拖拽起任务与恢复对话框

【保留的定制 · 同步上游时不要丢】"
```

---

## 阶段 P5 · 真栈 e2e

### Task 18: 真栈 e2e（备份 → 改文件 → 拉回）

**Files:**
- Create: `packages/app/e2e/real-stack/backup-snapshot-real.spec.ts`

**Interfaces:**
- Consumes: Task 17 的界面；真栈挂具 `%TEMP%/openhive-real-stack.json`（`kernel` / `front` / `token`）。
- Produces: 一条走完整产品链（点 → 服务端 → 真 MinIO 或假 MinIO）的验收证据。

- [ ] **Step 1: 写 spec**

```ts
import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 文件级备份快照的真栈验收（2026-10-18）。
 *
 * 判据（spec §13.4）：
 * ① 右键「备份到 MinIO」能把选中项拍成恢复点，下树出现这一行；
 * ② 改掉沙箱里的文件后，拖回下树那一行 ⇒ 弹恢复对话框 ⇒ 默认「保留两者」⇒ 沙箱里同时有
 *    改后的原文与新拉回的那份；
 * ③ 「覆盖本地」⇒ 内容回到备份时的那一版。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, { ...init, headers: { Cookie: COOKIE(), ...(init.headers ?? {}) } })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id).toBeTruthy()
  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[]).find((行) => 行.id === id)
  expect(行?.directory).toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

async function 进项目(page: Page, context: BrowserContext, id: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

test.use({ colorScheme: "light" })

test("备份一个文件 → 改原文 → 拖回并「覆盖本地」⇒ 内容回到备份时那一版", async ({ page, context }) => {
  const 甲 = await 建真项目(`备份快照·覆盖·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })
  writeFileSync(path.join(甲.directory, "资料", "甲.txt"), "备份时\n")
  writeFileSync(path.join(甲.directory, "资料", "乙.txt"), "不动\n")

  await 进项目(page, context, 甲.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").first()).toBeVisible({ timeout: 30_000 })

  // ① 右键「备份到 MinIO」→ 等恢复点出现在下树
  await page.locator("[data-slot='sandbox-tree'] [data-path='资料/甲.txt']").click({ button: "right" })
  await page.locator("[data-menu-item='backup-to-minio']").click()
  await page.locator("[data-component='minio-bar']").click()
  await expect(page.locator("[data-slot='minio-tree'] [data-path='资料/甲.txt']")).toBeVisible({ timeout: 60_000 })

  // ② 改掉原文
  writeFileSync(path.join(甲.directory, "资料", "甲.txt"), "改过\n")

  // ③ 拖回上树 ⇒ 恢复对话框 ⇒ 选「覆盖本地」
  await page.locator("[data-slot='minio-tree'] [data-path='资料/甲.txt']").dragTo(
    page.locator("[data-slot='sandbox-tree']"),
  )
  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeVisible({ timeout: 60_000 })
  await page.locator("[data-slot='restore-decision'][value='overwrite']").check()
  await page.locator("[data-slot='restore-confirm']").click()
  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeHidden({ timeout: 60_000 })
  await expect(page.locator("[data-slot='file-op-message']")).toContainText("恢复完成", { timeout: 60_000 })

  // ④ 盘上内容回到备份时那一版
  expect(readFileSync(path.join(甲.directory, "资料", "甲.txt"), "utf8")).toBe("备份时\n")
})
```

- [ ] **Step 2: 跑**

Run（按本机真栈配方，见记忆 `run-real-stack-e2e-on-this-machine`）:

```bash
cd packages/app
E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win/chrome.exe" \
  bunx playwright test e2e/real-stack/backup-snapshot-real.spec.ts
```

Expected: PASS。若真栈没起，按 `docs/superpowers/plans/` 里既有的真栈编排启动（`REAL_STACK_*_PORT` 换端口，**不要杀残留进程**）。

- [ ] **Step 3: 提交**

```bash
git add packages/app/e2e/real-stack/backup-snapshot-real.spec.ts
git commit -m "test(e2e): 文件级备份快照真栈验收（备份→改→拉回覆盖）

【保留的定制 · 同步上游时不要丢】"
```

---

## 阶段 P6 · 文档与收尾

### Task 19: 文档、教训与总门禁

**Files:**
- Modify: `docs/superpowers/specs/2026-10-18-file-backup-snapshot-design.md`（补「实施偏差」一节）
- Modify: `LEARNINGS.md` / `LEARNINGS-full.md`（追加本轮教训）
- Modify: `docs/superpowers/specs/005-project-management/state.md` 或 `006-ai-session/state.md`（按 spec 所属 feature 登记缺口）

- [ ] **Step 1: 全量门禁**

```bash
cd packages/core && bun test
cd ../opencode && bun test
cd ../auth && bun test
cd ../app && bun test src/project src/workspace/workspace-entry.test.tsx
cd ../.. && bun run typecheck
cd packages/opencode && bunx oxlint src/server/openhive/backup*.ts test/server/openhive-backup*.test.ts
cd ../../packages/core && bunx oxlint src/minio.ts test/minio.test.ts
```

Expected：除 `bun run lint` 全仓库退出码天生为 1（`LEARNINGS #001-02`）外，其余全绿。**逐条记录实得数字**（pass / fail / expect 计数分开写，`#005-50`）。

- [ ] **Step 2: 缺口表**

如实写进 state.md：

| 缺口 | 本机能不能验 | 何时补 |
|---|---|---|
| 真 MinIO 的桶策略 / STS / `${aws:username}` | 不能 | D-13 部署时 |
| 多实例下的单飞锁 | 不能 | 上多实例前 |
| win32 无管理员权限时的符号链接不写穿 | 用例自动跳过 | CI 或 Linux 上补 |
| 桶生命周期（`AbortIncompleteMultipartUpload`） | 本版没用 multipart，不适用 | — |
| 5 GB 以上单文件 | 不能（太慢） | 目标环境 |

- [ ] **Step 3: 追加 LEARNINGS**

至少两条，写进 `LEARNINGS-full.md` 顶部并把索引写进 `LEARNINGS.md`：

```markdown
## #007-03 · 2026-10-18 · decision-rethink · 007-file-backup-snapshot
**一句话**：同一份「备份」在两个前缀上各写一份时，「删除项目」要清的是**两个**前缀——
只清归档镜像那一支，快照会变成用户再也看不见、也删不掉的永久孤儿。
**应对**：⑥ 步清点「谁写了这个项目的前缀」时，按**命名空间**列，不按「哪个函数看起来在备份」列。
**应用范围**：任何按项目 / 用户分前缀的对象存储；任何「删除主数据」的收尾。

## #007-04 · 2026-10-18 · pattern · 007-file-backup-snapshot
**一句话**：拖拽的「落点」与「载荷」是两条独立契约——本轮把「复制到鼠标所在目录」改成
「保持原路径」时，真正要改的是 `放下()` 里对**落点**的读，而载荷（`file:` / `minio:`）是另一件事。
**应对**：改拖拽语义时先分别写下「起拖给什么载荷」「放下读不读落点」，再各写一条断言；
两者合在一起测，改对一个、改错另一个也能绿。
**应用范围**：任何拖拽 / 拖放 / 剪贴板落点的语义改造。
```

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-10-18-file-backup-snapshot-design.md LEARNINGS.md LEARNINGS-full.md docs/superpowers/specs/006-ai-session/state.md
git commit -m "docs(backup): 实施偏差、缺口表与本轮教训

【保留的定制 · 同步上游时不要丢】"
```

---

## 自检（写完计划后跑一遍）

### 1. Spec 覆盖

| spec 章节 | 落在哪个任务 |
|---|---|
| §4.1 namespace / 前缀 | Task 1 |
| §4.2 对象布局 | Task 5 |
| §4.3 manifest v1 | Task 3 |
| §4.4 state.json | Task 5、Task 9 |
| §4.5 manifest-last | Task 7 |
| §4.6 快照 id | Task 3 |
| §5.1 触发（右键 / 拖拽 / 自动） | Task 11、Task 15、Task 17 |
| §5.2 四阶段 | Task 7、Task 14 |
| §5.3 排除名单 / 大小上限 / 符号链接 | Task 3、Task 7 |
| §5.4 哈希与去重 | Task 7 |
| §5.5 上传 / 重试 / 超时 | Task 2、Task 7（重试在 Task 7 的 `runPool` 外层，实施时按 spec 补 `withRetry`） |
| §5.6 顺序 | Task 7 |
| §5.7 取消 / 部分失败 | Task 7 |
| §5.8 单飞 / 409 / GC 共用锁 | Task 6、Task 11、Task 12 |
| §5.8 末条 删除前收敛任务（有上限、不强行删） | Task 6（`sharedJobs` / `quiesceProject` ＋ 2 条单测）、Task 12（`handleDelete` + 2 条集成用例：等到收敛才删 / 超时 409 且项目不动） |
| §6.1 两个入口 | Task 15、Task 17 |
| §6.2 预览状态 / 2000 / localOnly | Task 8 |
| §6.3 三选一 | Task 16、Task 8 |
| §6.4 逐文件替换 | Task 8 |
| §6.5 取消不回滚 | Task 8 |
| §7 自动备份 | Task 9、Task 11、Task 17 |
| §8.1 分级保留 | Task 4、Task 9 |
| §8.3 10 GiB / allowOverQuota | Task 11、Task 17 |
| §8.4 GC | Task 9 |
| §8.5 删除恢复点 | Task 11 |
| §9.1 授权顺序 | Task 11 |
| §9.3 审计表 | Task 10、Task 11 |
| §9.5 路径安全 | Task 3、Task 8 |
| §10.1 九个端点 | Task 11 |
| §10.2 任务状态机 | Task 6、Task 11 |
| §13.2–13.4 用例 | Task 3–18 |
| §13.7 完成判据 | Task 19 |
| §13.8 变异清单 | Task 7、Task 8 各做一条；其余逐条在对应任务收尾做 |
| §14.1–14.3 文件清单 | 文件结构表（含刻意拆分说明） |
| §15 分期 | 本计划六个阶段 |

**已知的 spec 缺口（实施时必须补）**：

1. §5.5 的**重试**（3 次，1s/2s/4s，4xx 不重试）在 Task 7 里只写了「上传失败删除 blob」，**没有写 `withRetry`**。实施 Task 7 时必须补：

```ts
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  const delays = [1000, 2000, 4000]
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
      const 不重试 = status !== undefined && status >= 400 && status < 500 && status !== 429
      if (不重试 || attempt >= delays.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
}
```

并把 `deps.store.putBlob(...)` 包成 `withRetry(() => deps.store.putBlob(...))`。对应测试：让 `s3.failOn(500, ...)` 命中第一次上传，断言最终成功且请求了两次。

2. §7.3「写操作标脏」：`scheduler.markDirty` 目前只在心跳里设 `dirty: true`，`checkNow` 并未读 `dirty`。实施 Task 9 时二选一：① 删掉 `dirty` 字段（YAGNI，变化检测已经由 `UnchangedError` 承担）；② 在 `checkNow` 里要求 `entry.dirty === true || lastAutoAt === 0`，拍完置 `dirty = false`。**推荐 ①**，并同步删测试里的相关断言。

3. ~~§9.4 审计「恢复」事件的写入点~~ —— **已补**：Task 11 的 `执行恢复` 在 `finish` 之后、
`markDirty` 旁边写 `recordBackupEvent(..., { action: "restore", detail: {...} })`。实施时不必再找。

### 2. 占位符扫描

本计划没有 `TBD` / `TODO` / 「类似 Task N」；每个代码步骤都带可直接粘贴的实现。唯一需要实施者按实际情况替换的是两处**图标名**（`trash`）与 `ConfirmDialog`（若不存在则用 `useDialog().show()` 包最小确认件）——两处都写明了处置方式。

### 3. 类型一致性

- `runBackup` 的 `RunDeps` 在 Task 7 加了 `projectId` / `ownerId`，Task 11 的调用点已带。
- `store.list()` 在 Task 1 改成 `Entry[]`，`archive.ts` 三处与 `backup-store.ts` 全部按 `entry.path` 取。
- `BackupStore.writeManifest` 接收完整 `Manifest`（含 `projectId` / `ownerId`），Task 7 产出的 manifest 已填。
- `MinioBarProps.job` 与 `backupJob()` 的 `BackupJob` 同形；`progress` 四个字段名逐字一致。
- `DualFileTreeProps.onRestore` 从 `(path: string)` 改成 `(input: { snapshotId; path })`，Task 17 的接线与 Task 15 的测试同步。
