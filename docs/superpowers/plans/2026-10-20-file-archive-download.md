# 文件 Tab 打包下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文件树支持「右键文件夹下载 zip」与「Ctrl/Shift 多选后打包下载选中集」，单文件下载行为逐字不变。

**Architecture:** 服务端新增 `POST /openhive/file/archive`，一次请求内存成包，回 `application/zip` ＋ `Content-Length` ＋ `x-openhive-file-count`；任一坏条目即整包 400、零字节。前端在文件树里按选中集分流：单文件走既有 `onDownload`，文件夹 / 多选走新 `onArchive`；命名由纯函数算好随请求提交；传输弹窗复用 `FileTransferDialog`。

**Tech Stack:** Bun ＋ Effect 4（`HttpRouter` / `HttpServerResponse`）、`@zip.js/zip.js@2.7.62`（已是 `packages/opencode` 直接依赖）、`ignore@7.0.5`；前端 SolidJS 1.9、既有 `fetch` 薄客户端；测试 Bun test ＋ happy-dom ＋ Playwright 真栈。

**Spec:** `docs/superpowers/specs/2026-10-20-file-archive-download-design.md`

**对设计文档的一处修订（Task 4 同步落文档）:** 设计 §7.3 写的接口方法是 `ProjectData.archive(projectId, paths, name, options)`，但同一个接口上 `archive(projectId)` 已经是「归档项目」（见 `packages/app/src/project/project-data.ts` 的 `archive` 方法），两个签名直接冲突。实现统一叫 **`downloadArchive`**；设计文档 §7.3 与 §14 那两行在 Task 4 一并改掉。

## Global Constraints

- **整包失败**：顶层不存在 / 越界 / 项目根 / 根 `.git`、递归遇链接或非普通条目、文件读不出、Windows 非法文件名（`[<>:"|?*\u0000-\u001f]`）、超文件数 / 超字节数 ⇒ **400 ＋ 一句点名的话，不返回任何 zip 字节**。
- **容量默认值**：`OPENHIVE_ARCHIVE_MAX_FILES=5000`、`OPENHIVE_ARCHIVE_MAX_BYTES=536870912`（512 MiB）；走 Effect 配置源（`EffectConfig.number(...).pipe(EffectConfig.withDefault(...))`），**不直接读 `process.env`**；层构造期取、请求期用。
- **不新增依赖、不动 `bun.lock`**：zip.js 与 ignore 已是 `packages/opencode` 直接依赖；`packages/app` 不引入 zip.js。
- **不碰上游文件**：只改 `packages/opencode/src/server/openhive/file.ts`、`packages/app/src/project/*`、`packages/app/src/workspace/workspace-entry.tsx`、fork 自有测试与文档。
- **单文件下载逐字不变**：`downloadFile` / `handleDownload` 的外部行为不变；本次只从 `downloadFile` 里提炼内部读流函数。
- **ignored 口径与文件树一致**：根 `.gitignore` ＋ `.ignore`；项目根 `.git` 永远不进包；**显式选中的顶层条目不看 ignore**（用户点的就是它）。
- **zip 内路径**：单文件夹保留 `${文件夹名}/…`；多选保留相对项目根的完整路径；空目录保留目录条目；路径一律 `/` 分隔。
- **文件名**：单文件不打包；单文件夹 `${末段(path)}.zip`；多选 `${sanitize(项目名)}-${yyyyMMdd-HHmm}.zip`（`sanitize` 把 `\ / : * ? " < > |` 换成 `_`）。
- **前端「下载」入口只有右键菜单**，不加工具栏按钮；单文件仍需 `onDownload` 接线，文件夹 / 多选需 `onArchive` 接线，未接线即禁用。
- **测试纪律**：根目录 `bun test` 禁止；只跑受影响 package。新用例先红后绿；变异验证按 `LEARNINGS #003-03` 如实记录。命令都在**仓库根**执行（`#004-10`）。
- **未知项如实记缺口**（`#002-02`）：win32 上造不出「Windows 非法文件名 / 读不出的文件」夹具；`.git` 递归分支在当前 API 下不可达（只能从顶层防守）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/app/src/project/archive-name.ts` | 新增 | 打包下载文件名的纯函数（无 DOM、无 IO） |
| `packages/app/src/project/archive-name.test.ts` | 新增 | 命名规则：单文件夹 / 多选 / sanitize / 补零 |
| `packages/opencode/src/server/openhive/file.ts` | 修改 | `PATH.archive`、配置、全部守卫、递归遍历、zip 成包 |
| `packages/opencode/test/server/openhive-file-ops.test.ts` | 修改 | `/archive` 的整组用例 ＋ 归档 403 扩一项 |
| `packages/app/src/project/openhive-file-ops.ts` | 修改 | `downloadArchive`、`ArchiveOutcome`、共用读流 / `Content-Length` 读取 |
| `packages/app/src/project/openhive-file-ops.test.ts` | 修改 | 请求形状、成功判据三条、400/401/403/500、进度、abort |
| `packages/app/src/project/project-data.ts` | 修改 | `ProjectData.downloadArchive` ＋ 生产绑定 |
| `packages/app/src/project/project-data.test.ts` | 修改 | 绑定走 `/openhive/file/archive`，体与项目头正确 |
| `packages/app/src/project/file-tree.tsx` | 修改 | `onArchive`、按选中集分流、动态文案、删旧弹窗分支 |
| `packages/app/src/project/file-tree.test.tsx` | 修改 | 重写旧「拦截」一组，新增文件夹 / 多选 / 禁用判据 |
| `packages/app/src/project/file-download-dialog.tsx` | **删除** | 旧「无法下载文件夹」弹窗，本次改动造成的孤儿 |
| `packages/app/src/project/file-move-report-dialog.tsx` | 修改 | 删掉指向已删除文件的失效注释 |
| `packages/app/src/workspace/workspace-entry.tsx` | 修改 | `打包下载`、传输弹窗、`onArchive` 接线 |
| `packages/app/src/workspace/workspace-entry.test.tsx` | 修改 | 假数据源加 `downloadArchive`；成功 / rejected / 取消 |
| `packages/app/e2e/real-stack/zip-entries.ts` | 新增 | 真栈里读 zip（中央目录 ＋ `inflateRawSync`），不引新依赖 |
| `packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts` | 重写 | 文件夹打包、多选打包两条真栈用例 |
| `packages/opencode/.env.example` | 修改 | 两个可选变量 |
| `CONFIG.md` | 修改 | §3 按需配置表加两行 |
| `docs/superpowers/specs/2026-10-20-file-archive-download-design.md` | 修改 | §7.3 / §14 方法名改为 `downloadArchive` 并注明撞名 |
| `docs/superpowers/plans/2026-10-20-file-archive-download.md` | 本文件 | 计划 |

---

### Task 1: 打包文件名的纯函数

**Files:**
- Create: `packages/app/src/project/archive-name.ts`
- Test: `packages/app/src/project/archive-name.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `export type ArchiveKind = "folder" | "selection"`
  - `export function archiveName(projectName: string, paths: readonly string[], kind: ArchiveKind, now: Date): string`

- [ ] **Step 1: 写会红的测试**

创建 `packages/app/src/project/archive-name.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { archiveName } from "./archive-name"

/** 2026-10-20 09:05（本地时区；只喂不透明的 `Date`，函数不自己取时钟）。 */
const 钟 = new Date(2026, 9, 20, 9, 5)

describe("archiveName", () => {
  test("单个文件夹 ⇒ 末段名 + .zip（中文逐字保留）", () => {
    expect(archiveName("8·17专案", ["资料/8·17"], "folder", 钟)).toBe("8·17.zip")
  })

  test("单个文件夹的路径带尾斜杠也能取到末段", () => {
    expect(archiveName("8·17专案", ["资料/8·17/"], "folder", 钟)).toBe("8·17.zip")
  })

  test("多选 ⇒ 项目名-yyyyMMdd-HHmm.zip", () => {
    expect(archiveName("8·17专案", ["资料/话单.csv", "账目.xlsx"], "selection", 钟)).toBe(
      "8·17专案-20261020-0905.zip",
    )
  })

  test("月 / 日 / 时 / 分都补零", () => {
    expect(archiveName("专案", ["a"], "selection", new Date(2026, 0, 2, 3, 4))).toBe("专案-20260102-0304.zip")
  })

  test("项目名里的 Windows 非法字符换成下划线", () => {
    expect(archiveName('专案: A/B\\C*D?E"F<G>H|I', ["a"], "selection", 钟)).toBe(
      "专案_ A_B_C_D_E_F_G_H_I-20261020-0905.zip",
    )
  })

  test("项目名为空 ⇒ 退回「项目」，不产出 `-20261020-0905.zip` 这种没主语的名字", () => {
    expect(archiveName("", ["a"], "selection", 钟)).toBe("项目-20261020-0905.zip")
    expect(archiveName("   ", ["a"], "selection", 钟)).toBe("项目-20261020-0905.zip")
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/archive-name.test.ts
```

Expected: FAIL —— `Cannot find module "./archive-name"`（或 `archiveName is not a function`）。记下实得输出。

- [ ] **Step 3: 最小实现**

创建 `packages/app/src/project/archive-name.ts`：

```ts
/**
 * 打包下载的**文件名**（设计 §4.3 / §7.2）。
 *
 * 纯函数：不读时钟、不碰 DOM、不问项目——`now` 由调用方给，测试才能钉死。
 * 服务端不解析它，只负责把名字清洗进 `Content-Disposition`；落盘用的是**这一份**。
 */

export type ArchiveKind = "folder" | "selection"

/** Windows 解压不出的字符（与内核 `WINDOWS_ILLEGAL` 同集合，但这里只用于「项目名」这一小段）。 */
const ILLEGAL = /[\\/:*?"<>|]/g

function sanitize(name: string): string {
  const 清 = name.replace(ILLEGAL, "_").trim()
  return 清.length > 0 ? 清 : "项目"
}

/** 路径末段：两种分隔符都认，尾斜杠不算一段。 */
function 末段(path: string): string {
  return path.split(/[\\/]/).filter((段) => 段.length > 0).pop() ?? ""
}

const 两位 = (值: number) => String(值).padStart(2, "0")

export function archiveName(
  projectName: string,
  paths: readonly string[],
  kind: ArchiveKind,
  now: Date,
): string {
  if (kind === "folder") {
    const 名 = 末段(paths[0] ?? "")
    return `${名.length > 0 ? 名 : "打包"}.zip`
  }
  const 日 = `${now.getFullYear()}${两位(now.getMonth() + 1)}${两位(now.getDate())}`
  const 时 = `${两位(now.getHours())}${两位(now.getMinutes())}`
  return `${sanitize(projectName)}-${日}-${时}.zip`
}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/archive-name.test.ts
```

Expected: `6 pass`。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/project/archive-name.ts packages/app/src/project/archive-name.test.ts
git commit -m "feat(file-archive): 打包下载的命名纯函数

单文件夹用末段名、多选用项目名+时间戳；Windows 非法字符换下划线。
Refs: #002-06"
```

---

### Task 2: 内核 `POST /openhive/file/archive`

**Files:**
- Modify: `packages/opencode/src/server/openhive/file.ts`
- Modify: `packages/opencode/test/server/openhive-file-ops.test.ts`
- Modify: `packages/opencode/.env.example`
- Modify: `CONFIG.md`

**Interfaces:**
- Consumes: 现有 `gate` / `inside` / `inGit` / `realInside` / `relativePath` / `bodyOf` / `badRequest` / `disposition` / `LINK_ESCAPE` / `GIT_LOCKED`。
- Produces:
  - `PATH.archive === "/openhive/file/archive"`
  - `POST /openhive/file/archive`，body `{ paths: string[]; name: string }`
  - 200：`application/zip` ＋ `content-disposition` ＋ `content-length` ＋ `x-openhive-file-count`
  - 400：`{ error: string }`（零 zip 字节）

- [ ] **Step 1: 写会红的测试**

在 `packages/opencode/test/server/openhive-file-ops.test.ts` 里做**四处**改动。

①文件顶部 import 加 zip.js 的读取器（与已有 `Schema` / `Effect` import 分开、放 `node:path` 之后）：

```ts
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
```

②把现有的 `as` 拆成 `asOn` ＋ `as`（测试要拿**另建的 app** 发请求，而 `as` 写死了 `openApp`）：

```ts
/**
 * 以某人的身份、对**指定的那个 app** 发一个请求。
 *
 * `as` 那半是它的生产替身之外最常见的一支；`asOn` 存在的唯一理由是「换一份配置再建一个 app」
 * （容量闸那两条用例必须这样做：配置在层构造期取，见 `archive.ts` 的实测约束）。
 */
const asOn = (app: ReturnType<typeof realApp>, subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* app(url, { ...init, headers })
  })

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  asOn(openApp, subject, url, init)
```

③在 `出口` 表末尾（`write` 之后）加：

```ts
  /** 2026-10-20 第十个出口：把选中的文件夹 / 多选条目打成**一个** zip（设计 §5）。 */
  archive: "/openhive/file/archive",
```

④在 `send` 之后加打包专用助手；在 `出错` 之后加 `读包`；在 `重置文件` 之后加打包夹具。**这些是新代码，不是替换**：

```ts
/** 发一次打包请求；`project` 默认就是 ALPHA（本组九成用例都带它）。 */
const 送打包 = (subject: TokenSubject, body: unknown, project: string | undefined = ALPHA) =>
  send(subject, 出口.archive, body, project)

/** 换一份配置建的 app 也能发打包请求（容量闸那两条要用）。 */
const 送打包On = (
  app: ReturnType<typeof realApp>,
  subject: TokenSubject,
  body: unknown,
  project: string | undefined = ALPHA,
) =>
  asOn(app, subject, 出口.archive, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(project === undefined ? {} : { [PROJECT_HEADER]: project }),
    },
    body: JSON.stringify(body),
  })
```

```ts
interface 解开的包 {
  bytes: Uint8Array
  entries: Array<{ name: string; directory: boolean; text: string }>
}

/**
 * 把响应体当 zip 读回来。**先立前提再判果**：状态码不是 200 时直接把体带进异常，
 * 免得后面每一条断言都红在一句「entries 是空的」上（`#004-14`）。
 */
async function 读包(response: Response): Promise<解开的包> {
  if (response.status !== 200) throw new Error(`不是 zip：${response.status} ${await response.text()}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entries = await reader.getEntries()
    return {
      bytes,
      entries: await Promise.all(
        entries.map(async (entry) => ({
          name: entry.filename,
          directory: entry.directory === true,
          text: entry.directory === true ? "" : await entry.getData!(new TextWriter()),
        })),
      ),
    }
  } finally {
    await reader.close()
  }
}
```

```ts
/**
 * 打包那一组的夹具：两层目录、一个空目录、中文名、另一个顶层目录（设计 §9.2）。
 *
 * 不并进 `重置文件`：它只服务这一组，而 `重置文件` 是**整个文件**共用的那份——
 * 往里加东西等于给其余两百多条用例改前提（`#006-17`）。
 */
function 造打包夹具() {
  mkdirSync(path.join(项目根, "资料", "8·17"), { recursive: true })
  mkdirSync(path.join(项目根, "资料", "空"), { recursive: true })
  mkdirSync(path.join(项目根, "账目"), { recursive: true })
  writeFileSync(path.join(项目根, "资料", "8·17", "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(项目根, "账目", "报销.xlsx"), "假装的表格")
}
```

⑤在文件末尾追加一整组（放在归档 403 那一组**之后**；该组会单独扩一条，见 Step 1⑥）：

```ts
describe("打包下载（POST /openhive/file/archive）", () => {
  it.live(
    "单个文件夹：目录条目、空目录、中文名、计数与 Content-Length 都对",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造打包夹具()

        const response = yield* 送打包(ALICE, { paths: ["资料"], name: "资料.zip" })
        const { bytes, entries } = yield* Effect.promise(() => 读包(response))

        // 被测属性（包内容）在前，状态码在后（`#004-14`）。
        expect(entries.map((e) => e.name).sort()).toEqual(
          ["资料/", "资料/8·17/", "资料/8·17/话单.csv", "资料/空/"].sort(),
        )
        expect(entries.find((e) => e.name === "资料/8·17/话单.csv")?.text).toBe("主叫,被叫\n138,139\n")
        expect(entries.find((e) => e.name === "资料/8·17/话单.csv")?.directory).toBe(false)
        expect(entries.find((e) => e.name === "资料/空/")?.directory).toBe(true)

        // 头的契约（设计 §5）。
        expect(response.headers.get("content-type")).toContain("application/zip")
        expect(response.headers.get("x-openhive-file-count")).toBe("1")
        expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength)
        const disposition = response.headers.get("content-disposition") ?? ""
        expect(decodeURIComponent(disposition.split("''")[1] ?? "")).toBe("资料.zip")
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  it.live(
    "多选两个不同目录的文件：包内保留相对项目根的完整路径",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造打包夹具()

        const response = yield* 送打包(ALICE, {
          paths: ["资料/8·17/话单.csv", "账目/报销.xlsx"],
          name: "8·17专案-20261020-0905.zip",
        })
        const { entries } = yield* Effect.promise(() => 读包(response))

        expect(entries.map((e) => e.name).sort()).toEqual(["账目/报销.xlsx", "资料/8·17/话单.csv"].sort())
        expect(entries.find((e) => e.name === "账目/报销.xlsx")?.text).toBe("假装的表格")
        expect(response.headers.get("x-openhive-file-count")).toBe("2")
      }),
    30_000,
  )

  it.live(
    "祖先 + 后代同时选中：后代只出现一次",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造打包夹具()

        const response = yield* 送打包(ALICE, {
          paths: ["资料", "资料/8·17/话单.csv"],
          name: "资料.zip",
        })
        const { entries } = yield* Effect.promise(() => 读包(response))

        expect(entries.filter((e) => e.name === "资料/8·17/话单.csv")).toHaveLength(1)
        expect(response.headers.get("x-openhive-file-count")).toBe("1")
      }),
    30_000,
  )

  it.live(
    ".gitignore / .ignore 按项目根相对路径匹配：同名的另一个文件不被误伤",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        mkdirSync(path.join(项目根, "甲"), { recursive: true })
        mkdirSync(path.join(项目根, "乙"), { recursive: true })
        writeFileSync(path.join(项目根, "甲", "忽略.txt"), "该被跳过")
        writeFileSync(path.join(项目根, "乙", "忽略.txt"), "不该被跳过")
        writeFileSync(path.join(项目根, "乙", "别的.txt"), "该被 .ignore 跳过")
        writeFileSync(path.join(项目根, ".gitignore"), "甲/忽略.txt\n")
        writeFileSync(path.join(项目根, ".ignore"), "乙/别的.txt\n")

        const response = yield* 送打包(ALICE, { paths: ["甲", "乙"], name: "全部.zip" })
        const { entries } = yield* Effect.promise(() => 读包(response))
        const 名字 = entries.map((e) => e.name)

        // 判别力在「同名但不同目录」：只按末段匹配的实现会把 `乙/忽略.txt` 一起丢掉。
        expect(名字).not.toContain("甲/忽略.txt")
        expect(名字).toContain("乙/忽略.txt")
        expect(名字).not.toContain("乙/别的.txt")
        expect(名字).toContain("甲/")
        expect(名字).toContain("乙/")
      }),
    30_000,
  )

  it.live(
    "项目根方向的一批坏顶层：根 / 越界 / 不存在 / 空列表，各自 400 且零 zip 字节",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 根 = yield* 送打包(ALICE, { paths: [""], name: "x.zip" })
        const 越界 = yield* 送打包(ALICE, { paths: [`../${OTHER}/密件.txt`], name: "x.zip" })
        const 没有 = yield* 送打包(ALICE, { paths: ["没有这个文件.txt"], name: "x.zip" })
        const 空 = yield* 送打包(ALICE, { paths: [], name: "x.zip" })

        // 先钉「一个 zip 都没成形」，再逐条读那句给人看的话。
        expect([根, 越界, 没有, 空].map((r) => r.headers.get("content-disposition"))).toEqual([
          null,
          null,
          null,
          null,
        ])
        expect((yield* json(出错, 根)).error).toBe("不能打包项目根")
        expect((yield* json(出错, 越界)).error).toBe("路径越出项目目录")
        expect((yield* json(出错, 没有)).error).toContain("没有这个文件.txt")
        expect((yield* json(出错, 空)).error).toBe("打包需要至少一个路径")
        expect([根.status, 越界.status, 没有.status, 空.status]).toEqual([400, 400, 400, 400])
      }),
    30_000,
  )

  it.live(
    "项目根的 .git：400，且不回 zip 字节",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* 送打包(ALICE, { paths: [".git"], name: "x.zip" })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect((yield* json(出错, response)).error).toBe(
          "项目里的 .git 是版本库的元数据，不许查看或改动",
        )
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "经过目录链接的路径：400，不读兄弟项目的文件",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* 送打包(ALICE, { paths: ["link/密件.txt"], name: "x.zip" })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect((yield* json(出错, response)).error).toBe(
          "这个位置经过链接指向了项目外面（链接不算项目内的路径）",
        )
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "文件夹里混着文件符号链接：400 点名那个路径，整包失败",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        mkdirSync(path.join(项目根, "资料"), { recursive: true })
        symlinkSync(文件.密, path.join(项目根, "资料", "链到密件.txt"), "file")

        const response = yield* 送打包(ALICE, { paths: ["资料"], name: "资料.zip" })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect((yield* json(出错, response)).error).toContain("资料/链到密件.txt")
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "顶层是符号链接：400，不跟随",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        symlinkSync(文件.密, path.join(项目根, "链到密件.txt"), "file")

        const response = yield* 送打包(ALICE, { paths: ["链到密件.txt"], name: "x.zip" })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect((yield* json(出错, response)).error).toContain("链到密件.txt")
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "超过 OPENHIVE_ARCHIVE_MAX_FILES：400，消息含实际值与上限（原始列表 / 遍历两处都拦）",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        mkdirSync(path.join(项目根, "多"), { recursive: true })
        writeFileSync(path.join(项目根, "多", "1.txt"), "1")
        writeFileSync(path.join(项目根, "多", "2.txt"), "2")
        writeFileSync(path.join(项目根, "多", "3.txt"), "3")
        const 小 = realApp({ ...OPEN, OPENHIVE_ARCHIVE_MAX_FILES: "2" })

        const 列表 = yield* 送打包On(小, ALICE, { paths: ["多", "a.txt", "sub/b.txt"], name: "x.zip" })
        const 遍历 = yield* 送打包On(小, ALICE, { paths: ["多"], name: "多.zip" })

        expect([列表.status, 遍历.status]).toEqual([400, 400])
        expect((yield* json(出错, 列表)).error).toContain("超过上限 2")
        expect((yield* json(出错, 遍历)).error).toContain("3")
        expect((yield* json(出错, 遍历)).error).toContain("2")
      }),
    30_000,
  )

  it.live(
    "超过 OPENHIVE_ARCHIVE_MAX_BYTES：400，消息含实际字节与上限",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        writeFileSync(path.join(项目根, "大.txt"), "0123456789abcdefghij") // 20 字节
        const 小 = realApp({ ...OPEN, OPENHIVE_ARCHIVE_MAX_BYTES: "10" })

        const response = yield* 送打包On(小, ALICE, { paths: ["大.txt"], name: "大.zip" })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect((yield* json(出错, response)).error).toContain("20")
        expect((yield* json(出错, response)).error).toContain("10")
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "匿名请求：401 空体（打包也是项目出口，身份先于一切）",
    () =>
      Effect.gen(function* () {
        // `openApp` 回的是 **Effect**（不是 Promise）——直接 `yield*`，别再包一层 `Effect.promise`。
        const response = yield* openApp(出口.archive, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: ["a.txt"], name: "x.zip" }),
        })

        expect(yield* Effect.promise(() => response.text())).toBe("")
        expect(response.status).toBe(401)
      }),
    30_000,
  )
})
```

⑥把归档 403 那条用例扩成**五扇门**：在 `const 下载 = ...` 之后加

```ts
        const 打包 = yield* send(ALICE, 出口.archive, { paths: ["a.txt"], name: "a.zip" }, 冻结的项目)
```

并把副作用 / 状态码断言改成

```ts
        expect(打包.headers.get("content-disposition")).toBe(null)
        expect((yield* json(Frozen, 打包)).error).toBe(FROZEN_MESSAGE)
        expect([复制.status, 移动.status, 上传.status, 下载.status, 打包.status]).toEqual([
          403, 403, 403, 403, 403,
        ])
```

同时把该用例的标题与上面那段注释里的「四个出口」改成「五个出口」。

- [ ] **Step 2: 跑红**

```bash
cd packages/opencode
bun test --timeout 30000 --only-failures test/server/openhive-file-ops.test.ts
```

Expected: FAIL。新那组会落在 `不是 zip：404 …` 或 200＋HTML（出口没挂上），归档那条会红在 `403` 数组最后一位。记下实得输出。

- [ ] **Step 3: 改内核**

在 `packages/opencode/src/server/openhive/file.ts` 里逐项改：

①import 改成（保留原有全部）：

```ts
import { User } from "@opencode-ai/core/user"
import { Config as EffectConfig, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { access, copyFile, constants, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import ignore from "ignore"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
```

②`PATH` 表末尾（`remove` 之后）加：

```ts
  /** 2026-10-20（第十个出口）：把选中的文件夹 / 多选条目打成**一个** zip（设计 §5）。 */
  archive: `${PREFIX}/archive`,
```

③`WriteBody` 之后加请求体与容量闸的常量 / 消息：

```ts
/** 打包的请求体：`paths` 是相对项目根的选中集（去重与展开都在服务端做），`name` 由前端算好。 */
const ArchiveBody = Schema.Struct({
  paths: Schema.Array(Schema.String),
  name: Schema.String,
})

interface ArchiveLimits {
  maxFiles: number
  maxBytes: number
}

const ARCHIVE_EMPTY = "打包需要至少一个路径"
const ARCHIVE_ROOT = "不能打包项目根"
const ARCHIVE_FALLBACK = "打包.zip"
/** Windows 解压不出的字符。**不带 `g`**：带 `g` 的 `RegExp.test` 会带 `lastIndex` 状态。 */
const WINDOWS_ILLEGAL = /[<>:"|?*\u0000-\u001f]/

const 超文件数 = (actual: number, limit: number) =>
  `这次要打 ${actual} 个文件，超过上限 ${limit}（OPENHIVE_ARCHIVE_MAX_FILES）`
const 超字节数 = (actual: number, limit: number) =>
  `这次要打 ${actual} 字节，超过上限 ${limit}（OPENHIVE_ARCHIVE_MAX_BYTES）`
const 不是普通条目 = (path: string) => `「${path}」不是普通文件或文件夹（链接、设备文件不进包）`
const 读不出来 = (path: string) => `「${path}」读不出来`
const 名字解不出 = (path: string) => `「${path}」的名字在 Windows 上解压不出来（含 : * ? " < > | 等字符）`

/**
 * 整条相对路径里任何一段命中 Windows 非法字符 ⇒ 解压不出来。
 *
 * 判**整条**而不是末段：顶层直接选中的文件可能带几层没被单独遍历过的父目录名。
 */
const 解不开 = (path: string) => path.split("/").some((段) => WINDOWS_ILLEGAL.test(段))
```

④`routes` 里、`const root = config.root` 之后加配置（**构造期取**）：

```ts
    // 打包下载的两道容量闸（设计 §6.1）。必须与其它配置**同一时点**取——请求期取不到
    // app 层配置（`archive.ts` 记过的实测约束）。
    const 打包上限: ArchiveLimits = {
      maxFiles: yield* EffectConfig.number("OPENHIVE_ARCHIVE_MAX_FILES").pipe(EffectConfig.withDefault(5000)),
      maxBytes: yield* EffectConfig.number("OPENHIVE_ARCHIVE_MAX_BYTES").pipe(
        EffectConfig.withDefault(512 * 1024 * 1024),
      ),
    }
```

并在 `write` 那行之后加路由：

```ts
    // 2026-10-20（第十个出口）：打包下载。整包失败、零字节（设计 §4.4）。
    yield* router.add("POST", PATH.archive, (request) => handleArchive(request, root, 打包上限))
```

⑤在 `handleDownload` 之后加 handler（顺序照「读 → 写」排，打包是读出口的批量版）：

```ts
/**
 * 打包下载：把选中的顶层条目递归成一个 zip（设计 §4–§6）。
 *
 * ## 守卫链与 `handleDownload` 逐条同序
 *
 * `gate` → `inside` → 项目根 → `inGit` → `lstat`（**不跟链接**）→ `realInside`。
 * 多出来的只有三样：容量闸、去重、递归。
 *
 * ## 三条容易写错的判据
 *
 * ① **顶层显式选中的不看 ignore**：用户点的是它，跳过它等于「点了却说没有」。
 *    ignore 只作用于**递归出来的子项**（与文件树「看得见才下得到」同口径）。
 * ② **`lstat` 不是 `stat`**：`stat` 会跟随最后一段的链接，等于把项目外的文件读进包。
 * ③ **整包失败**：任何一条坏条目都直接 400 返回，**不跳过**。对办案材料，
 *    「看起来完整、实际缺件」比「下载失败」危险得多（设计 §4.4）。
 *
 * ⚠️ `.git` 的递归守卫在当前 API 下**不可达**（顶层 `.git` 已被 `inGit` 拒，而 `inGit` 只认
 * 相对项目根的第一段；子目录里的 `.git` 是用户自己的普通目录，放行）。留着它是纵深防御，
 * 不是一条已覆盖的分支（`#002-02`）。
 */
function handleArchive(
  request: HttpServerRequest.HttpServerRequest,
  root: string,
  limits: ArchiveLimits,
) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const parsed = yield* bodyOf(request, ArchiveBody)
    if (Option.isNone(parsed)) return badRequest("请求体格式不对")
    const { paths, name } = parsed.value
    if (paths.length === 0) return badRequest(ARCHIVE_EMPTY)
    if (paths.length > limits.maxFiles) return badRequest(超文件数(paths.length, limits.maxFiles))

    // ── 顶层：一次一条，逐条复用单文件下载那串守卫 ──────────────────────────────
    const 候选 = new Map<string, string>()
    for (const path of paths) {
      const target = inside(project, path)
      if (target === undefined) return badRequest("路径越出项目目录")
      if (target === project) return badRequest(ARCHIVE_ROOT)
      if (inGit(project, target)) return badRequest(GIT_LOCKED)

      const info = yield* Effect.promise(() => lstat(target).catch(() => undefined))
      if (info === undefined) return badRequest(`「${path}」不存在`)
      if (!info.isFile() && !info.isDirectory()) return badRequest(不是普通条目(path))
      if (!(yield* realInside(project, dirname(target)))) return badRequest(LINK_ESCAPE)

      // Map 去重：同一个相对路径选两次只打一次（`paths` 可能从上一次的选中集原样带来）。
      候选.set(relativePath(project, target), target)
    }

    // ── 去重：祖先与后代同时选中时只留祖先（设计 §4.2） ────────────────────────
    const 排序后 = [...候选].sort((左, 右) => {
      const 深 = 左[0].split("/").length - 右[0].split("/").length
      return 深 !== 0 ? 深 : 左[0].localeCompare(右[0])
    })
    const 顶层: Array<{ 相对: string; 绝对: string }> = []
    for (const [相对, 绝对] of 排序后) {
      if (顶层.some((已选) => 相对.startsWith(`${已选.相对}/`))) continue
      顶层.push({ 相对, 绝对 })
    }

    // ── ignore：与上游 `handlers/file.ts` 同口径（根 `.gitignore` ＋ `.ignore`） ──
    const 忽略 = ignore()
    for (const 规则文件 of [".gitignore", ".ignore"]) {
      const 文本 = yield* Effect.promise(() => readFile(join(project, 规则文件), "utf8").catch(() => undefined))
      if (文本 !== undefined) 忽略.add(文本)
    }

    const writer = new ZipWriter(new Uint8ArrayWriter(), { useCompressionStream: true })
    let files = 0
    let bytes = 0

    /** 递归一条。回 `undefined` ＝ 通过；回字符串 ＝ 那句要原样交给民警的话。 */
    const 走 = (相对: string, 绝对: string): Effect.Effect<string | undefined> =>
      Effect.gen(function* () {
        const info = yield* Effect.promise(() => lstat(绝对).catch(() => undefined))
        if (info === undefined) return 读不出来(相对)
        // 链接（最后一段）在 `lstat` 下既不是 file 也不是 directory ⇒ 从这里出局。
        if (!info.isFile() && !info.isDirectory()) return 不是普通条目(相对)

        if (info.isFile()) {
          if (解不开(相对)) return 名字解不出(相对)
          if (files + 1 > limits.maxFiles) return 超文件数(files + 1, limits.maxFiles)
          const data = yield* Effect.promise(() => readFile(绝对).catch(() => undefined))
          if (data === undefined) return 读不出来(相对)
          if (bytes + data.byteLength > limits.maxBytes) return 超字节数(bytes + data.byteLength, limits.maxBytes)
          yield* Effect.promise(() => writer.add(相对, new Uint8ArrayReader(data)))
          files += 1
          bytes += data.byteLength
          return undefined
        }

        if (解不开(相对)) return 名字解不出(相对)
        // 目录自身也要验真身：顶层可能是 junction（词法在项目内、真身在外面）。
        if (!(yield* realInside(project, 绝对))) return LINK_ESCAPE
        yield* Effect.promise(() => writer.add(`${相对}/`, undefined, { directory: true }))

        const 小孩 = yield* Effect.promise(() => readdir(绝对, { withFileTypes: true }).catch(() => undefined))
        if (小孩 === undefined) return 读不出来(相对)
        const 排好 = [...小孩].sort((左, 右) => 左.name.localeCompare(右.name))
        for (const 项 of 排好) {
          const 孩子相对 = `${相对}/${项.name}`
          const 孩子绝对 = join(绝对, 项.name)
          if (inGit(project, 孩子绝对)) continue
          // 判据是**项目根相对**的整条路径（上游 `handlers/file.ts` 同口径）。只喂末段的话，
          // `甲/忽略.txt` 这种带目录的规则永远匹配不上，而别处的同名文件反被误伤。
          if (忽略.ignores(`${孩子相对}${项.isDirectory() ? "/" : ""}`)) continue
          const 失败 = yield* 走(孩子相对, 孩子绝对)
          if (失败 !== undefined) return 失败
        }
        return undefined
      })

    for (const { 相对, 绝对 } of 顶层) {
      const 失败 = yield* 走(相对, 绝对)
      if (失败 !== undefined) return badRequest(失败)
    }

    const zip = yield* Effect.promise(() => writer.close())
    return HttpServerResponse.uint8Array(zip, {
      contentType: "application/zip",
      headers: {
        "content-disposition": disposition(name.length > 0 ? name : ARCHIVE_FALLBACK),
        "x-openhive-file-count": String(files),
      },
    })
  })
}
```

⑥同步文档：

`packages/opencode/.env.example` 的「按需：身份 / 沙箱 / 配额」块里，`OPENHIVE_BACKUP_QUIESCE_TIMEOUT_MS` 之后加两行：

```text
# OPENHIVE_ARCHIVE_MAX_FILES=<打包下载最多文件数；默认 5000>
# OPENHIVE_ARCHIVE_MAX_BYTES=<打包下载原始字节上限；默认 536870912（512 MiB）>
```

`CONFIG.md` §3「按需配置」表，`OPENHIVE_BACKUP_QUIESCE_TIMEOUT_MS` 那行之后加两行：

```markdown
| `OPENHIVE_ARCHIVE_MAX_FILES` | `packages/opencode/src/server/openhive/file.ts`（`routes` 内） | 打包下载最多文件数，默认 **5000**；超过 ⇒ 400「这次要打 N 个文件，超过上限 M」 |
| `OPENHIVE_ARCHIVE_MAX_BYTES` | 同上 | 打包下载原始字节上限，默认 **536870912**（512 MiB）；超过 ⇒ 400「这次要打 N 字节，超过上限 M」 |
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/opencode
bun test --timeout 30000 --only-failures test/server/openhive-file-ops.test.ts
```

Expected: 全部通过；新那组 **12 pass**，归档那条扩成五扇门后仍 pass。

- [ ] **Step 5: 变异验证（拆掉修复，必须红）**

1. 把去重块整个换成 `const 顶层 = 排序后.map(([相对, 绝对]) => ({ 相对, 绝对 }))` ⇒ 「祖先 + 后代」那条必红（同名条目出现两次）。记下红在哪条断言。
2. 删掉顶层那行 `if (!(yield* realInside(project, dirname(target)))) return badRequest(LINK_ESCAPE)` ⇒ 「经过目录链接」那条必红（要么 200 带出兄弟项目的文件，要么报了别的话）。记下实得。
3. 把 `走` 里的 `lstat` 换成 `stat` ⇒ 「文件夹里混着文件符号链接」那条必红（链接被跟随、打进包）。记下实得。

跑法与 Step 4 相同；每次只改一处、验完还原。把三类结论按 `LEARNINGS #003-03` 写进提交信息。

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/server/openhive/file.ts packages/opencode/test/server/openhive-file-ops.test.ts packages/opencode/.env.example CONFIG.md
git commit -m "feat(file-archive): 内核 POST /openhive/file/archive（整包失败 + 容量闸）

守卫链复用 handleDownload；ignore 与文件树同口径；链接不跟随；
任一坏条目 400 零字节。变异验证：去重 / 顶层真身 / lstat 三处各拆一次。
Refs: #002-06 #004-09 #004-14 #002-02 #003-03"
```

---

### Task 3: 前端 `downloadArchive` ＋ 共用读流

**Files:**
- Modify: `packages/app/src/project/openhive-file-ops.ts`
- Test: `packages/app/src/project/openhive-file-ops.test.ts`

**Interfaces:**
- Consumes: `PATH`、`PROJECT_HEADER`、`trySend`、`readJson`、`isSessionExpired`、`SESSION_EXPIRED`、`messageOf`、`TransferProgress`、`DownloadOptions`。
- Produces:
  - `export type ArchiveOutcome`
  - `export async function downloadArchive(projectId: string, paths: readonly string[], name: string, options?: DownloadOptions): Promise<ArchiveOutcome>`
  - 内部 `readBlobWithProgress` / `declaredLength`（不导出）

- [ ] **Step 1: 写会红的测试**

在 `packages/app/src/project/openhive-file-ops.test.ts` 的 import 里加 `downloadArchive`，并在 `附件流` 之后加打包响应助手：

```ts
/** 打包成功那条的形状：zip 字节 ＋ 三个承诺过的头（设计 §5）。 */
const 压缩包 = (内容 = "PKZIP", files = 2) =>
  new Response(内容, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="资料.zip"`,
      "x-openhive-file-count": String(files),
      "content-length": String(new TextEncoder().encode(内容).byteLength),
    },
  })

/** 同形，但体是分块流——进度那条要用它。 */
const 压缩包流 = (块: readonly string[], contentLength?: string) => {
  const 编码 = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const 段 of 块) controller.enqueue(编码.encode(段))
        controller.close()
      },
    }),
    {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="资料.zip"`,
        "x-openhive-file-count": "2",
        ...(contentLength === undefined ? {} : { "content-length": contentLength }),
      },
    },
  )
}
```

在 `downloadFile` 那组之后追加：

```ts
describe("downloadArchive", () => {
  const 路径们 = ["资料/话单.csv", "账目/报销.xlsx"]

  test("发 POST /openhive/file/archive，带项目头、JSON 体与 signal", async () => {
    const { send, sent } = stub(() => 压缩包())
    const 控 = new AbortController()

    await downloadArchive(PROJECT, 路径们, "资料.zip", { send, signal: 控.signal })

    expect(sent).toEqual([
      {
        url: "/openhive/file/archive",
        method: "POST",
        project: PROJECT,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ paths: 路径们, name: "资料.zip" }),
      },
    ])
  })

  test("成功 ⇒ done，带字节、文件数与字节数；进度先报 0 再逐块报", async () => {
    const 进度: TransferProgress[] = []

    const 结果 = await downloadArchive(PROJECT, 路径们, "资料.zip", {
      send: async () => 压缩包流(["PK", "ZIP"], "5"),
      onProgress: (项) => 进度.push(项),
    })

    expect(结果.kind).toBe("done")
    if (结果.kind !== "done") return
    expect(await 结果.blob.text()).toBe("PKZIP")
    expect(结果.files).toBe(2)
    expect(结果.bytes).toBe(5)
    expect(进度).toEqual([
      { loaded: 0, total: 5 },
      { loaded: 2, total: 5 },
      { loaded: 5, total: 5 },
    ])
  })

  /**
   * 成功判据三条**全要**（设计 §7.3）。缺任何一条都可能是「出口没挂上、UI 兜底回 200＋HTML」，
   * 而 `Response.blob()` 对 HTML 一样成功 ⇒ 不拦的话会把一个网页存成 `资料.zip`。
   */
  test("缺 Content-Disposition / content-type 不是 zip / 缺文件数 ⇒ 一律 failed", async () => {
    const 缺处置 = new Response("PKZIP", {
      headers: { "content-type": "application/zip", "x-openhive-file-count": "2" },
    })
    const 不是zip = new Response("PKZIP", {
      headers: { "content-disposition": 'attachment; filename="资料.zip"', "x-openhive-file-count": "2" },
    })
    const 缺计数 = new Response("PKZIP", {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="资料.zip"',
      },
    })

    for (const response of [缺处置, 不是zip, 缺计数]) {
      const 结果 = await downloadArchive(PROJECT, 路径们, "资料.zip", { send: async () => response })
      expect(结果).toEqual({ kind: "failed", message: "打包下载失败" })
    }
  })

  test("200 + HTML 兜底页（出口没挂上）⇒ failed", async () => {
    const 结果 = await downloadArchive(PROJECT, 路径们, "资料.zip", { send: async () => 兜底页() })

    expect(结果).toEqual({ kind: "failed", message: "打包下载失败" })
  })

  test("400 ⇒ rejected，服务端那句话原样交回", async () => {
    const 结果 = await downloadArchive(PROJECT, 路径们, "资料.zip", {
      send: async () => 拒绝(400, "「资料/链到密件.txt」不是普通文件或文件夹（链接、设备文件不进包）"),
    })

    expect(结果).toEqual({
      kind: "rejected",
      message: "「资料/链到密件.txt」不是普通文件或文件夹（链接、设备文件不进包）",
    })
  })

  test("403 ⇒ rejected（已归档那道门）；401 ⇒ rejected 且是会话过期那句话", async () => {
    const 归档 = await downloadArchive(PROJECT, 路径们, "资料.zip", {
      send: async () => 拒绝(403, "项目已归档，请先找回"),
    })
    const 过期 = await downloadArchive(PROJECT, 路径们, "资料.zip", { send: async () => new Response(null, { status: 401 }) })

    expect(归档).toEqual({ kind: "rejected", message: "项目已归档，请先找回" })
    expect(过期.kind).toBe("rejected")
    if (过期.kind !== "rejected") return
    expect(过期.message).toContain("登录")
  })

  test("500 ⇒ failed；网络抛 ⇒ failed", async () => {
    const 五百 = await downloadArchive(PROJECT, 路径们, "资料.zip", {
      send: async () => new Response("坏了", { status: 500 }),
    })
    const 抛: FileOpsFetch = async () => {
      throw new Error("连不上")
    }
    const 断 = await downloadArchive(PROJECT, 路径们, "资料.zip", { send: 抛 })

    expect(五百).toEqual({ kind: "failed", message: "打包下载失败" })
    expect(断).toEqual({ kind: "failed", message: "打包下载失败" })
  })

  test("读到一半取消 ⇒ failed；信号真的交给了传输层", async () => {
    const 控 = new AbortController()
    let 送出的信号: AbortSignal | null | undefined
    let 流控!: ReadableStreamDefaultController<Uint8Array>
    const 流 = new ReadableStream<Uint8Array>({
      start(controller) {
        流控 = controller
        controller.enqueue(new TextEncoder().encode("PK"))
      },
    })
    const send: FileOpsFetch = async (_input, init) => {
      送出的信号 = init?.signal
      return new Response(流, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="资料.zip"',
          "x-openhive-file-count": "2",
          "content-length": "5",
        },
      })
    }

    const 结果 = downloadArchive(PROJECT, 路径们, "资料.zip", { send, signal: 控.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    控.abort()
    流控.error(new DOMException("Aborted", "AbortError"))

    expect(await 结果).toEqual({ kind: "failed", message: "打包下载失败" })
    expect(送出的信号).toBe(控.signal)
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/openhive-file-ops.test.ts
```

Expected: FAIL —— `downloadArchive is not a function` / 模块没有导出它。记下实得输出。

- [ ] **Step 3: 提取共用读流 ＋ 加 `downloadArchive`**

在 `openhive-file-ops.ts` 里：

①`PATH` 表末尾加：

```ts
  /** 2026-10-20（第 10 个出口）：打包下载（内核 `file.ts` 的 `handleArchive`）。 */
  archive: `${PREFIX}/archive`,
```

②把 `downloadFile` 的 try 块换成调用共用函数：

```ts
  try {
    const total = await downloadTotal(response, projectId, path, send)
    return await readBlobWithProgress(response, total, { onProgress, signal })
  } catch {
    return undefined
  }
```

③在 `downloadFile` 之后加共用读流函数（把原循环逐字搬进来）：

```ts
/**
 * 把响应体读成 Blob，边读边报进度。**两条下载链共用这一份**（单文件 / 打包）。
 *
 * 返回值 `undefined` 只有一种来源：`signal` 在读的中途响了。调用方那边「取消」的判据是
 * `signal.aborted`，所以这里**不另造一个字**（避免同一件事长出两种说法）。
 */
async function readBlobWithProgress(
  response: Response,
  total: number,
  options: { onProgress?: (progress: TransferProgress) => void; signal?: AbortSignal },
): Promise<Blob | undefined> {
  const { onProgress, signal } = options
  // 先报一次 `{ loaded: 0, total }`：弹窗要**当场**拿到总量才知道画不画百分比。
  onProgress?.({ loaded: 0, total })

  // `body` 为 `null` 只出现在无体响应（204 之类）；成功时必有体，保底当空文件。
  if (response.body === null) return await response.blob()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel()
      return undefined
    }
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.({ loaded, total })
  }
  // 拼成一块**自己的** `Uint8Array` 再交 Blob：TS 5.8 起 `Uint8Array<ArrayBufferLike>` 不是
  // `BlobPart`（可能挂在 `SharedArrayBuffer` 上），而 `new Uint8Array(长度)` 是 `ArrayBuffer` 背板。
  const 全部 = new Uint8Array(loaded)
  let 位移 = 0
  for (const 块 of chunks) {
    全部.set(块, 位移)
    位移 += 块.byteLength
  }
  return new Blob([全部])
}
```

④把 `downloadTotal` 拆出 `declaredLength`：

```ts
/** 这次响应自己声明的字节数；没有 / 不是有限非负数 ⇒ `undefined`。 */
function declaredLength(response: Response): number | undefined {
  const declared = response.headers.get("content-length")
  if (declared === null) return undefined
  const size = Number(declared)
  return Number.isFinite(size) && size >= 0 ? size : undefined
}

async function downloadTotal(
  response: Response,
  projectId: string,
  path: string,
  send: FileOpsFetch,
): Promise<number> {
  const declared = declaredLength(response)
  if (declared !== undefined) return declared
  return (await statProjectFile(projectId, path, send)) ?? 0
}
```

⑤在 `downloadTotal` 之后加：

```ts
const ARCHIVE_FAILED = "打包下载失败"

/**
 * 打包下载的结论。**三种**，比单文件那两态多一个 `rejected`：服务端拒绝时那句话点名了
 * 是哪一条不合格（链接 / 读不出 / 超限），民警要照着它去处理，不能被兜底文案吃掉。
 */
export type ArchiveOutcome =
  | { kind: "done"; blob: Blob; files: number; bytes: number }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

/** 服务端承诺的包内普通文件数（`x-openhive-file-count`）；不是有限非负整数 ⇒ `undefined`。 */
function archiveCount(response: Response): number | undefined {
  const raw = response.headers.get("x-openhive-file-count")
  if (raw === null) return undefined
  const count = Number(raw)
  return Number.isInteger(count) && count >= 0 ? count : undefined
}

/**
 * 把选中的文件夹 / 多选条目打成**一个** zip 取回来（设计 §5 / §7.3）。
 *
 * ## 成功判据**三条全要**
 *
 * ① `content-disposition` 在；② `content-type` 是 `application/zip`；③ `x-openhive-file-count`
 * 是有限数字。三条都是本出口承诺过的头，也是「出口没挂上 ⇒ UI 兜底回 200＋HTML」的唯一防线：
 * `Response.blob()` 对 HTML 一样成功，少一条就会把网页存成 `.zip`。
 *
 * ## 进度只用 `Content-Length`
 *
 * 打包出口**承诺**它（内存成包、长度精确）；不再退到 `stat`——那条路问的是**单个文件**的大小，
 * 对着一次打包请求问不出东西。拿不到就按「总量未知」画不确定态。
 */
export async function downloadArchive(
  projectId: string,
  paths: readonly string[],
  name: string,
  options: DownloadOptions = {},
): Promise<ArchiveOutcome> {
  const { send = defaultSend, onProgress, signal } = options
  const response = await trySend(send, PATH.archive, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", [PROJECT_HEADER]: projectId },
    body: JSON.stringify({ paths, name }),
    signal,
  })

  if (!response) return { kind: "failed", message: ARCHIVE_FAILED }
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }

  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    return { kind: "rejected", message: messageOf(body) ?? ARCHIVE_FAILED }
  }
  if (!response.ok) return { kind: "failed", message: ARCHIVE_FAILED }

  const files = archiveCount(response)
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase()
  if (response.headers.get("content-disposition") === null) return { kind: "failed", message: ARCHIVE_FAILED }
  if (contentType !== "application/zip") return { kind: "failed", message: ARCHIVE_FAILED }
  if (files === undefined) return { kind: "failed", message: ARCHIVE_FAILED }

  try {
    const blob = await readBlobWithProgress(response, declaredLength(response) ?? 0, { onProgress, signal })
    if (blob === undefined) return { kind: "failed", message: ARCHIVE_FAILED }
    return { kind: "done", blob, files, bytes: blob.size }
  } catch {
    return { kind: "failed", message: ARCHIVE_FAILED }
  }
}
```

- [ ] **Step 4: 跑绿（含单文件下载回归）**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/openhive-file-ops.test.ts
```

Expected: `downloadArchive` 那组 8 pass（Step 1 实际列了 8 条）；`downloadFile` 那组原样全绿（提炼读流没改行为）。

- [ ] **Step 5: 变异验证**

把成功判据里的 `contentType !== "application/zip"` 一行删掉 ⇒「缺 content-type」那条必红（把 HTML 当 zip 收下）。记下实得。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/project/openhive-file-ops.ts packages/app/src/project/openhive-file-ops.test.ts
git commit -m "feat(file-archive): 客户端 downloadArchive 与共用读流

成功判据三条（ disposition / zip / 文件数）；400/403 原话交回。
downloadFile 改为调用同一份 readBlobWithProgress，行为不变。
Refs: #002-06 #003-03"
```

---

### Task 4: `ProjectData.downloadArchive` ＋ 设计文档改名 ＋ 假数据源

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-file-archive-download-design.md`
- Modify: `packages/app/src/project/project-data.ts`
- Modify: `packages/app/src/project/project-data.test.ts`
- Modify: `packages/app/src/workspace/workspace-entry.test.tsx`（只改假数据源，避免类型检查断掉）

**Interfaces:**
- Consumes: `downloadArchive`、`ArchiveOutcome`（Task 3）。
- Produces: `ProjectData.downloadArchive(projectId: string, paths: readonly string[], name: string, options?: DownloadOptions): Promise<ArchiveOutcome>`。

- [ ] **Step 1: 先改设计文档（这处修订不能只活在计划里）**

`docs/superpowers/specs/2026-10-20-file-archive-download-design.md` 两处：

§7.3 把

```text
`ProjectData` 接口增加 `archive(projectId, paths, name, options)`，`PROJECT_DATA` 接
`downloadArchive`；`project-data.test.ts` 逐项钉住接线（防止 `archive` 接到 `download`）。
```

改成

```text
`ProjectData` 接口增加 `downloadArchive(projectId, paths, name, options)`，`PROJECT_DATA` 接
`downloadArchive`；`project-data.test.ts` 逐项钉住接线（防止 `downloadArchive` 接到 `download`）。

⚠️ **不叫 `archive`**：同一个接口上 `archive(projectId)` 已经是「归档项目」
（见 `project-data.ts` 里的 `archive` 方法），两个签名直接冲突。实现与文档统一用 `downloadArchive`。
```

§7.4 流程里

```text
await projectData.archive(id, paths, zip 名, { signal, onProgress })
```

改成

```text
await projectData.downloadArchive(id, paths, zip 名, { signal, onProgress })
```

§14 表格里

```text
| `packages/app/src/project/project-data.ts` | fork 自有 | 新增 `archive` |
```

改成

```text
| `packages/app/src/project/project-data.ts` | fork 自有 | 新增 `downloadArchive`（不叫 `archive`：与「归档项目」撞名） |
```

- [ ] **Step 2: 写会红的测试**

在 `project-data.test.ts` 的 `download` 那条之后加：

```ts
  /**
   * 打包下载（2026-10-20）。
   *
   * 失效方式与 `download` 只差一个出口：接成下载那条 ⇒ 一次打包变成一次单文件下载
   * （还必然 400），类型上完全合法。所以这条**钉到 URL、方法与体**三样。
   */
  test("downloadArchive 走打包那条出口，把 zip 字节与文件数交回来", async () => {
    const 发出 = 假服务({
      "/openhive/file/archive": new Response("PKZIP", {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="资料.zip"`,
          "x-openhive-file-count": "2",
        },
      }),
    })

    const 结果 = await PROJECT_DATA.downloadArchive("p1", ["资料", "账目.xlsx"], "资料.zip")

    expect(结果.kind).toBe("done")
    if (结果.kind !== "done") return
    expect(await 结果.blob.text()).toBe("PKZIP")
    expect(结果.files).toBe(2)
    expect(结果.bytes).toBe(5)
    expect(发出.map((r) => [r.method, r.url, r.项目头, r.体])).toEqual([
      [
        "POST",
        "/openhive/file/archive",
        "p1",
        JSON.stringify({ paths: ["资料", "账目.xlsx"], name: "资料.zip" }),
      ],
    ])
  })
```

- [ ] **Step 3: 跑红**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/project-data.test.ts
```

Expected: FAIL —— `PROJECT_DATA.downloadArchive is not a function`。记下实得输出。

- [ ] **Step 4: 接上接口与绑定**

`project-data.ts`：

①import 那组加 `downloadArchive` 与 `ArchiveOutcome`：

```ts
import {
  copyFile,
  createEntry,
  downloadArchive,
  downloadFile,
  moveFile,
  removeEntry,
  renameEntry,
  uploadFile,
  type ArchiveOutcome,
  type DownloadOptions,
  type UploadOptions,
} from "./openhive-file-ops"
```

②`ProjectData` 接口里、`download` 那条之后加：

```ts
  /**
   * 把选中的文件夹 / 多选条目打成**一个** zip（2026-10-20）。
   *
   * ⚠️ **不叫 `archive`**：同一个接口上 `archive(projectId)` 已经是「归档项目」（见上方），
   * 两个签名直接冲突。`downloadArchive` 与 `download` 并排，名字也说得清它返回的是什么。
   */
  downloadArchive(
    projectId: string,
    paths: readonly string[],
    name: string,
    options?: DownloadOptions,
  ): Promise<ArchiveOutcome>
```

③`PROJECT_DATA` 绑定里、`download` 那行之后加：

```ts
  downloadArchive: (projectId, paths, name, options) => downloadArchive(projectId, paths, name, options),
```

- [ ] **Step 5: 假数据源加 `downloadArchive`（否则 typecheck 当场断）**

`packages/app/src/workspace/workspace-entry.test.tsx`：

①`假数据源` 的 `Pick<ProjectData, ...>` 名单里、`"download"` 之后加 `| "downloadArchive"`。

②`记` 对象里、`下的: [] as Array<[string, string]>,` 之后加：

```ts
    // `[项目, 选中集（原样）, 包名]`。选中集存成数组：断言要**逐项**比顺序。
    打包的: [] as Array<[string, readonly string[], string]>,
```

③`download:` 那条之后加：

```ts
    downloadArchive: async (projectId, paths, name, options) => {
      记.打包的.push([projectId, [...paths], name])
      return 剧本.downloadArchive
        ? await 剧本.downloadArchive(projectId, paths, name, options)
        : { kind: "failed", message: "没有剧本" }
    },
```

- [ ] **Step 6: 跑绿**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/project-data.test.ts
```

Expected: 新增那条 pass；该文件其余与基线一致。⚠️ 本机已知基线红：`project-data.test.ts` 有 2 条既有失败（`upload 走上传那条出口…` / `download 走下载那条出口…`），在**未改动的 `multi-tenant` HEAD** 上用同一 Bun 1.4.3 同样复现，与本 feature 无关；不修，判据是「既有红不增加」。

顺带做一次受影响 package 的类型检查（`workspace-entry.test.tsx` 的假数据源必须已经满足接口）：

```bash
cd packages/app
bun run typecheck
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add docs/superpowers/specs/2026-10-20-file-archive-download-design.md packages/app/src/project/project-data.ts packages/app/src/project/project-data.test.ts packages/app/src/workspace/workspace-entry.test.tsx
git commit -m "feat(file-archive): ProjectData 接 downloadArchive

不叫 archive：同接口上 archive(projectId) 已是「归档项目」，签名冲突；
设计文档 §7.3 / §14 同步改名。假数据源补方法，typecheck 不断。
Refs: #002-06"
```

---

### Task 5: 文件树分流（文件夹 / 多选）＋ 删旧弹窗

**Files:**
- Modify: `packages/app/src/project/file-tree.tsx`
- Modify: `packages/app/src/project/file-tree.test.tsx`
- Delete: `packages/app/src/project/file-download-dialog.tsx`
- Modify: `packages/app/src/project/file-move-report-dialog.tsx`（只删失效注释）

**Interfaces:**
- Consumes: `ArchiveKind`（Task 1）。
- Produces: `FileTreeProps.onArchive?: (paths: readonly string[], kind: ArchiveKind) => void`。

- [ ] **Step 1: 写会红的测试（整组替换旧「下载：文件夹 ⇒ 弹窗终止」describe）**

在 `file-tree.test.tsx` 里找到 `describe("下载：文件夹 ⇒ 弹窗终止；单个文件 ⇒ 发行下载（2026-10-11 用户下达）", ...)`，**整组删掉**，换成：

```tsx
    describe("下载：单文件发行下载；文件夹 / 多选走打包（2026-10-20）", () => {
      /** 右键菜单里「下载」那一项的文案（动态：多选时带 N）。 */
      const 下载文案 = () => 菜单项("download")?.textContent?.trim()

      test("右键**单个文件** ⇒ 只喊 onDownload，onArchive 一次都不喊", async () => {
        const 单: string[] = []
        const 包: Array<[readonly string[], string]> = []
        const host = mount(() => (
          <FileTree
            paths={树("材料/话单.csv")}
            onDownload={(path) => 单.push(path)}
            onArchive={(paths, kind) => 包.push([paths, kind])}
          />
        ))
        动作(host, "expand-all")?.click() // 默认全收缩（`#005-36`）

        右键(行按名(host, "话单.csv"))
        expect(有菜单()).toBe(true)
        expect(下载文案()).toBe("下载")
        点菜单项("download")
        await 歇一拍()

        expect(单).toEqual(["材料/话单.csv"])
        // 单文件不许被打包。
        expect(包).toEqual([])
      })

      test("右键**文件夹** ⇒ 只喊 onArchive([路径], \"folder\")，onDownload 一次都不喊", async () => {
        const 单: string[] = []
        const 包: Array<[readonly string[], string]> = []
        const host = mount(() => (
          <FileTree
            paths={树("材料/话单.csv")}
            onDownload={(path) => 单.push(path)}
            onArchive={(paths, kind) => 包.push([paths, kind])}
          />
        ))

        右键(行按名(host, "材料"))
        expect(有菜单()).toBe(true)
        expect(下载文案()).toBe("下载")
        点菜单项("download")
        await 歇一拍()

        expect(包).toEqual([[["材料"], "folder"]])
        // 文件夹不许走单文件下载。
        expect(单).toEqual([])
      })

      test("Ctrl 选中两项后右键**已选中**的行 ⇒ 文案「下载选中的 2 项」，交出整个选中集", async () => {
        const 单: string[] = []
        const 包: Array<[readonly string[], string]> = []
        const host = mount(() => (
          <FileTree
            paths={树("甲.csv", "乙.csv")}
            onDownload={(path) => 单.push(path)}
            onArchive={(paths, kind) => 包.push([paths, kind])}
          />
        ))

        点行(host, "甲.csv")
        点行(host, "乙.csv", { ctrl: true })
        右键(行按名(host, "甲.csv"))
        expect(有菜单()).toBe(true)
        expect(下载文案()).toBe("下载选中的 2 项")
        点菜单项("download")
        await 歇一拍()

        expect(包).toEqual([[["甲.csv", "乙.csv"], "selection"]])
        expect(单).toEqual([])
      })

      test("选中两项后右键**未选中**的那一行 ⇒ 文案仍是「下载」，只作用于右键那一行", async () => {
        const 单: string[] = []
        const 包: Array<[readonly string[], string]> = []
        const host = mount(() => (
          <FileTree
            paths={树("甲.csv", "乙.csv", "丙.csv")}
            onDownload={(path) => 单.push(path)}
            onArchive={(paths, kind) => 包.push([paths, kind])}
          />
        ))

        点行(host, "甲.csv")
        点行(host, "乙.csv", { ctrl: true })
        右键(行按名(host, "丙.csv"))
        expect(下载文案()).toBe("下载")
        点菜单项("download")
        await 歇一拍()

        expect(单).toEqual(["丙.csv"])
        // 未选中的行不许把别人的选中集带上。
        expect(包).toEqual([])
      })

      test("文件夹没接 onArchive ⇒ 「下载」置灰（点了没反应的项是对用户的谎）", () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} onDownload={() => {}} />)

        右键(行按名(host, "材料"))

        expect(项禁用("download")).toBe(true)
      })

      test("单文件没接 onDownload ⇒ 「下载」置灰", () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} onArchive={() => {}} />)
        动作(host, "expand-all")?.click()

        右键(行按名(host, "话单.csv"))

        expect(项禁用("download")).toBe(true)
      })

      test("旧「无法下载文件夹」弹窗不再可达（连 import 都不在了）", async () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} onArchive={() => {}} />)

        右键(行按名(host, "材料"))
        点菜单项("download")
        await 歇一拍()

        expect(document.body.querySelector("[data-slot='file-download-dialog']")).toBe(null)
      })
    })
```

⚠️ `挂全开` / `树` 的既有 helper 保持不动；新组只用 `树`、`动作`、`右键`、`点行`、`菜单项`、`点菜单项`、`有菜单`、`项禁用`、`歇一拍`、`行按名`。

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-tree.test.tsx
```

Expected: 新组 **7 条中 4 红**（文件夹仍开旧弹窗；多选文案与交出选中集不成立；文件夹未接 `onArchive` 时未置灰；旧弹窗仍可达）。另外 3 条（单文件、右键未选中行、单文件未接 `onDownload`）改动前**已是绿**——它们钉的是「单文件行为不变」，红绿都不许变。记下实得输出。

- [ ] **Step 3: 改组件**

`file-tree.tsx`：

①删掉 import：

```ts
import { FileDownloadDialog } from "@/project/file-download-dialog"
```

②导入类型：

```ts
import type { ArchiveKind } from "@/project/archive-name"
```

③`FileTreeProps` 里、`onDownload?: (path: string) => void` 之后加：

```ts
  /**
   * 打包下载（2026-10-20）：交出去的是**选中集**，不是单个路径。
   *
   * `kind` 由本层判（它手里有 `节点表`）：`folder` ＝ 右键的就是一个文件夹；`selection` ＝ 右键的
   * 是选中集里的一行、且选中集大于 1。接收方只负责算名字与发请求。
   */
  onArchive?: (paths: readonly string[], kind: ArchiveKind) => void
```

④`节点表` 之后加分流函数（放在 `要对象` 之前）：

```ts
  /**
   * 「点下载」这一次到底作用于什么。
   *
   * 规则（设计 §4.1 / §7.1）：
   * - 右键的行**在选中集里**且选中集 > 1 ⇒ 整个选中集（`selection`）；
   * - 否则只看右键这一行：文件 ⇒ `file`（走原单文件下载）；文件夹 ⇒ `folder`。
   *
   * ⚠️ 判据是「右键行在不在选中集里」，不是「选中集大小」：选中两项后右键第三行，
   * 用户要的是**第三行**，不是那两项（`#006-31` 同族：别拿另一份状态替换这一次的对象）。
   */
  const 判下载目标 = (
    path: string,
  ):
    | { kind: "file"; path: string }
    | { kind: "folder"; paths: readonly string[] }
    | { kind: "selection"; paths: readonly string[] } => {
    const 批 = 选中集()
    if (批.size > 1 && 批.has(path)) return { kind: "selection", paths: [...批] }
    if (节点表().get(path)?.type === "file") return { kind: "file", path }
    return { kind: "folder", paths: [path] }
  }

  /** 菜单文案：只有「右键行在选中集里且多选」时才带 N。 */
  const 下载文案 = () => {
    const path = 菜单对象()
    const 批 = 选中集()
    return path !== undefined && 批.size > 1 && 批.has(path) ? `下载选中的 ${批.size} 项` : "下载"
  }

  /** 菜单禁用：单文件看 `onDownload`，其余看 `onArchive`。 */
  function 要下载() {
    const path = 菜单对象()
    if (!path) return true
    if (判下载目标(path).kind === "file") return !props.onDownload
    return !props.onArchive
  }
```

⑤菜单项改成：

```tsx
            <菜单项
              action="download"
              文案={下载文案()}
              禁用={要下载()}
              onSelect={() => 点下载(菜单对象())}
            />
```

⑥把 `点下载` 整段替换成：

```ts
  /**
   * 点「下载」——**先判目标，再决定喊谁**（2026-10-20）。
   *
   * 单文件仍走 `onDownload`（行为逐字不变）；文件夹与多选走 `onArchive`。
   * 类型判断只在本层做得了：`节点表` 长在这里，而接线那头只有一份扁平清单。
   *
   * ⚠️ 未接线时菜单项已被 `要下载` 置灰；这里再判一次是兜底，不让「点了没反应」变成静默空转。
   */
  function 点下载(path: string | undefined) {
    if (!path) return
    const 目标 = 判下载目标(path)
    if (目标.kind === "file") {
      props.onDownload?.(目标.path)
      return
    }
    props.onArchive?.(目标.paths, 目标.kind)
  }
```

⑦三处注释同步（**只改这几句，别顺手重排**）。

`要文件` 的 doc 里：

```text
   * 拒掉，界面据此报一句）；下载 2026-10-11 起改走 `点下载` 那条**前端拦截**（目录连请求都不发、
   * 当场弹窗说「只能下载单个文件」，见该函数）；而复制在界面上会先弹一个「搬到哪儿」的面板
```

改成：

```text
   * 拒掉，界面据此报一句）；下载 2026-10-20 起由 `要下载` 单独判（单文件看 `onDownload`、
   * 文件夹 / 多选看 `onArchive`，见该函数）；而复制在界面上会先弹一个「搬到哪儿」的面板
```

文件头「右键菜单的接线状态」那段：

```text
 * 复制 / 移动 / 上传 / 下载走 T020 的四个回调。**只剩备份 / 拉回**没有接收方（T011/T012），
```

改成：

```text
 * 复制 / 移动 / 上传走 T020 的回调；下载 2026-10-20 起按目标分两路（单文件 `onDownload`、
 * 文件夹 / 多选 `onArchive`）。**只剩备份 / 拉回**没有接收方（T011/T012），
```

⑧删除文件。**删之前先 grep 全部同类落点**（`#002-06`：找「谁还在引用它」）：

```bash
grep -rn "file-download-dialog\|FileDownloadDialog" packages/app/src packages/app/e2e
```

Expected: 无输出（① 已删掉唯一那处 import）。**有输出就不能删**——先按输出逐个处理，再执行：

```bash
git rm packages/app/src/project/file-download-dialog.tsx
```

⑨修掉失效注释：`file-move-report-dialog.tsx:36` 那句

```text
 * prop 形态落不成 DOM 属性，判据钉不住（同 `file-download-dialog.tsx`）。
```

改成：

```text
 * prop 形态落不成 DOM 属性，判据钉不住。
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-tree.test.tsx
```

Expected: 新组 7 pass；该文件其余全绿（尤其「下载仍亮着」那条已被新组取代，不应残留旧断言）。

- [ ] **Step 5: 变异验证**

把 `判下载目标` 的 `批.has(path)` 删掉（只留 `批.size > 1`）⇒「右键未选中行」那条必红（它会把选中集交出去，`单` 里收不到 `丙.csv`）。记下实得。

- [ ] **Step 6: 提交**

```bash
git add -A packages/app/src/project/file-tree.tsx packages/app/src/project/file-tree.test.tsx packages/app/src/project/file-move-report-dialog.tsx
git commit -m "feat(file-archive): 文件树按选中集分流下载 / 打包

单文件照旧 onDownload；文件夹与多选走 onArchive；文案带「选中的 N 项」。
删除旧「无法下载文件夹」弹窗（本次改动造成的孤儿）。
Refs: #002-06 #006-31 #003-03"
```

---

### Task 6: 工作台 `打包下载` 接线与传输弹窗

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.tsx`
- Modify: `packages/app/src/workspace/workspace-entry.test.tsx`

**Interfaces:**
- Consumes: `ProjectData.downloadArchive`（Task 4）、`archiveName` / `ArchiveKind`（Task 1）、`FileTransferDialog`。
- Produces: 文件树 `onArchive` 接线；用户可见的「运行中 / 完成 / 失败」三态。

- [ ] **Step 1: 写会红的测试**

在 `workspace-entry.test.tsx` 的「文件动作接进工作台（T020 出参）」describe 里，找到 `test("下载中点「取消」⇒ 中断、不存盘、不报错", ...)`，在它**之后**、describe 结束之前追加：

```tsx
  /**
   * 打包下载（2026-10-20）。
   *
   * 两条判据缺一不可：**交给数据源的是什么**（项目 id / 选中集 / 包名）与**结果怎么落到界面**。
   * 只验后者的话，一个「包名算错、zip 内容也对不上」的实现照样绿。
   */
  test("右键文件夹点「下载」⇒ 打包下载：包名、选中集、落盘与完成摘要都对", async () => {
    const { host, 假 } = await 开({
      downloadArchive: async () => ({
        kind: "done",
        blob: new Blob(["abcd"]),
        files: 2,
        bytes: 4,
      }),
    })
    const 存下来的: Array<{ href: string; download: string }> = []
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 只替换与还原，不调用原函数。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同上；`click` 靠 `this`。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = function () {
      存下来的.push({ href: this.href, download: this.download })
    }
    try {
      右键行(host, "资料")
      点菜单项("download")

      // 前置：这一枪真的走到了数据源（否则后面的摘要可能在「没发请求」的实现上也绿）。
      await 等到(() => 假.打包的.length === 1)
      await 等到(() => 文本在页("file-transfer-title") === "下载完成")

      expect(假.打包的).toEqual([["p1", ["资料"], "资料.zip"]])
      expect(存下来的).toEqual([{ href: "blob:openhive-test", download: "资料.zip" }])
      expect(文本在页("file-transfer-summary")).toBe("2 个文件 · 4 B")
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }
  })

  test("Ctrl 选中两项后右键已选中的行 ⇒ 交出去的是整个选中集，包名是项目名+时间戳", async () => {
    const { host, 假 } = await 开全({
      downloadArchive: async () => ({ kind: "done", blob: new Blob(["a"]), files: 2, bytes: 1 }),
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = () => {}
    try {
      // `开全` 已展开整棵树；`点树行` 是本节既有助手（`行按路径` 找不到会抛）。
      点树行(host, "资料/话单.csv")
      点树行(host, "档案/旧件.csv", { ctrl: true })

      右键行(host, "话单.csv")
      expect(菜单项("download")?.textContent?.trim()).toBe("下载选中的 2 项")
      点菜单项("download")

      await 等到(() => 假.打包的.length === 1)
      const [项目, 选中集, 名] = 假.打包的[0]!
      expect(项目).toBe("p1")
      expect(选中集).toEqual(["资料/话单.csv", "档案/旧件.csv"])
      expect(名).toMatch(/^8·17专案-\d{8}-\d{4}\.zip$/)
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }
  })

  test("整包被拒 ⇒ 关窗、服务端那句话落到内联红字、一个文件都不落盘", async () => {
    const { host } = await 开({
      downloadArchive: async () => ({
        kind: "rejected",
        message: "「资料/链到密件.txt」不是普通文件或文件夹（链接、设备文件不进包）",
      }),
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "资料")
      点菜单项("download")
      await 等到(() => text(host, "file-op-message") !== undefined)

      expect(text(host, "file-op-message")).toContain("链到密件.txt")
      expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
      expect(存了).toBe(0)
    } finally {
      URL.createObjectURL = 原create
    }
  })

  test("打包中点「取消」⇒ 中断、不存盘、不报错", async () => {
    let 信号: AbortSignal | undefined
    const { host } = await 开({
      downloadArchive: async (_id, _paths, _name, options) => {
        信号 = options?.signal
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
        return { kind: "failed", message: "打包下载失败" }
      },
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "资料")
      点菜单项("download")
      await 等到(() => 信号 !== undefined)

      页面槽("file-transfer-cancel")?.click()

      expect(信号?.aborted).toBe(true)
      expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
      expect(text(host, "file-op-message")).toBeUndefined()
      expect(存了).toBe(0)
    } finally {
      URL.createObjectURL = 原create
    }
  })
```

⚠️ `file-transfer-name` 只在**运行态**渲染；完成态用 `file-transfer-title` 与 `file-transfer-summary` 判，别为了多钉一条去改弹窗。

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx
```

Expected: 新 4 条全红（`onArchive` 还没接到 `打包下载`，右键文件夹点下载在数据源上什么都不会发生）。记下实得输出。

- [ ] **Step 3: 接上工作台**

`workspace-entry.tsx`：

①import 加：

```ts
import { archiveName, type ArchiveKind } from "@/project/archive-name"
```

（放在既有 `@/project/...` import 那一组里，按现有排序。）

②`下载` 函数之后加：

```ts
  /**
   * 打包下载：文件夹 / 多选 → 一个 zip（2026-10-20）。
   *
   * 与 `下载` 同一套弹窗与取消语义；差别只在数据源那一枪与结果形状：
   * - 包名在**这一刻**由纯函数算好（`now` 在这里给），服务端不解析它；
   * - 完成态的 `files` 来自响应的 `x-openhive-file-count`，`bytes` 用**实际取回**的 blob 大小。
   *
   * ⚠️ 取消判据仍看 `signal.aborted`，不看返回值：数据源在中断时可能回 `failed`
   * （它不知道用户是主动取消还是网络断），而界面对「用户取消」的处理是**什么都不说**。
   */
  async function 打包下载(paths: readonly string[], kind: ArchiveKind) {
    const 项目 = currentProject()
    if (!项目 || !projectData) return
    set文件话(undefined)
    const 控 = new AbortController()
    const 名 = archiveName(项目.name, paths, kind, new Date())
    开传输({ kind: "running", action: "下载", name: 名, progress: { loaded: 0, total: 0 } }, 控)

    const 结果 = await projectData.downloadArchive(项目.id, paths, 名, {
      signal: 控.signal,
      onProgress: (项) => {
        if (控.signal.aborted) return
        set传输({ kind: "running", action: "下载", name: 名, progress: 项 })
      },
    })
    // 取消 ⇒ 不报错、不落盘（弹窗已由 `收传输` 收掉）。
    if (控.signal.aborted) return
    if (结果.kind !== "done") {
      收传输(false)
      set文件话(结果.message)
      return
    }
    存到本地(结果.blob, 名)
    set传输({ kind: "done", action: "下载", files: 结果.files, bytes: 结果.blob.size })
  }
```

③`onDownload` 那行之后接线：

```tsx
                        onArchive={(paths, kind) => void 打包下载(paths, kind)}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx
```

Expected: 新 4 条 pass；该文件其余全绿。

- [ ] **Step 5: 变异验证**

删掉 `if (控.signal.aborted) return` 这一行 ⇒「打包中点取消」那条必红（关窗之后还会落一句 `failed` 的话/存盘）。记下实得。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/workspace/workspace-entry.tsx packages/app/src/workspace/workspace-entry.test.tsx
git commit -m "feat(file-archive): 工作台打包下载接线与传输弹窗

包名由 archiveName 当场算；完成态用服务端文件数与实际字节；取消不报错。
Refs: #002-06 #003-03"
```

---

### Task 7: 重写真实栈 E2E（文件夹 / 多选）

**Files:**
- Create: `packages/app/e2e/real-stack/zip-entries.ts`
- Rewrite: `packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts`

**Interfaces:**
- Consumes: 已实现的内核出口与前端接线。
- Produces: `readZipEntries(file: string): ZipEntry[]`、`readZipText(file: string, name: string): string`。

- [ ] **Step 1: 先写 zip 读取器（不引新依赖）**

创建 `packages/app/e2e/real-stack/zip-entries.ts`：

```ts
import { readFileSync } from "fs"
import { inflateRawSync } from "zlib"

/**
 * 真栈里读 zip 的最小实现（2026-10-20）。
 *
 * ## 为什么不用 zip.js
 *
 * `packages/app` **不依赖** `@zip.js/zip.js`（只有 `packages/opencode` / `desktop` 有）。为一条
 * E2E 往 app 里加依赖，会动 `bun.lock`——那是本项目第一号约束明令避免的冲突面。
 * 中央目录是公开格式，读几个字段比加依赖便宜。
 *
 * ## 只读两样
 *
 * 条目名（相对路径）与内容正文。压缩方法只支持 store(0) / deflate(8)：内核用 zip.js 的
 * `useCompressionStream`，产的正是 deflate。
 */

export interface ZipEntry {
  name: string
  directory: boolean
  size: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

function 找中央目录(view: DataView) {
  const 最短 = 22
  const 下限 = Math.max(0, view.byteLength - 最短 - 0xffff)
  for (let 位 = view.byteLength - 最短; 位 >= 下限; 位--) {
    if (view.getUint32(位, true) === EOCD) {
      return { 条数: view.getUint16(位 + 10, true), 偏移: view.getUint32(位 + 16, true) }
    }
  }
  throw new Error("不是 zip：找不到中央目录结束记录（EOCD）")
}

export function readZipEntries(file: string): ZipEntry[] {
  const bytes = readFileSync(file)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { 条数, 偏移 } = 找中央目录(view)
  const 解码 = new TextDecoder("utf-8")
  const entries: ZipEntry[] = []
  let 位 = 偏移
  for (let i = 0; i < 条数; i++) {
    if (view.getUint32(位, true) !== CENTRAL) throw new Error(`第 ${i} 条中央目录记录签名不对`)
    const 名长 = view.getUint16(位 + 28, true)
    const 附加长 = view.getUint16(位 + 30, true)
    const 注释长 = view.getUint16(位 + 32, true)
    const 大小 = view.getUint32(位 + 24, true)
    const name = 解码.decode(bytes.subarray(位 + 46, 位 + 46 + 名长))
    entries.push({ name, directory: name.endsWith("/"), size: 大小 })
    位 += 46 + 名长 + 附加长 + 注释长
  }
  return entries
}

/** 读一条非目录条目的正文。 */
export function readZipText(file: string, name: string): string {
  const bytes = readFileSync(file)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { 条数, 偏移 } = 找中央目录(view)
  const 解码 = new TextDecoder("utf-8")
  let 位 = 偏移
  for (let i = 0; i < 条数; i++) {
    const 名长 = view.getUint16(位 + 28, true)
    const 附加长 = view.getUint16(位 + 30, true)
    const 注释长 = view.getUint16(位 + 32, true)
    const 方法 = view.getUint16(位 + 10, true)
    const 压缩长 = view.getUint32(位 + 20, true)
    const 本地偏移 = view.getUint32(位 + 42, true)
    const 条目名 = 解码.decode(bytes.subarray(位 + 46, 位 + 46 + 名长))
    if (条目名 === name) {
      if (view.getUint32(本地偏移, true) !== LOCAL) throw new Error(`「${name}」本地头签名不对`)
      const 本地名长 = view.getUint16(本地偏移 + 26, true)
      const 本地附加长 = view.getUint16(本地偏移 + 28, true)
      const 数据起 = 本地偏移 + 30 + 本地名长 + 本地附加长
      const 压缩 = bytes.subarray(数据起, 数据起 + 压缩长)
      if (方法 === 0) return 解码.decode(压缩)
      if (方法 === 8) return 解码.decode(inflateRawSync(压缩))
      throw new Error(`不支持的压缩方法 ${方法}`)
    }
    位 += 46 + 名长 + 附加长 + 注释长
  }
  throw new Error(`zip 里没有「${name}」`)
}
```

- [ ] **Step 2: 重写 spec（旧断言整份删掉）**

把 `packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts` 整体替换为：

```ts
import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { readZipEntries, readZipText } from "./zip-entries"

/**
 * 2026-10-20 · **打包下载**的真栈回归（文件夹 / 多选）。
 *
 * ## 为什么必须落真栈
 *
 * 这条路上有三件事只有真栈证得了：
 * ① 服务端真的产出了一个**可解压的 zip**（组件测试只到 Blob 为止）；
 * ② `Content-Length` / `x-openhive-file-count` 与真实字节对得上；
 * ③ 浏览器真的按 `Content-Disposition` 给出的名字落盘（`<a download>` 那一跳）。
 *
 * ## zip 用本地读取器解析
 *
 * `packages/app` 不依赖 zip.js；为此加依赖会动 `bun.lock`。见 `zip-entries.ts` 文件头。
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
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
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
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
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

const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 数**真发出去**的打包请求（判端口：页面同源打前门，内核自己也有一份同名出口）。 */
function 数打包请求(page: Page) {
  const 请求: Array<{ method: string; body: string | null }> = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.port === String(readStack().front) && u.pathname.endsWith("/openhive/file/archive")) {
      请求.push({ method: r.method(), body: r.postData() })
    }
  })
  return 请求
}

/** 右键某一项、点菜单里的「下载」（按文案定位；`data-slot` 会被覆盖，`#005-22`）。 */
async function 右键点下载(page: Page, 路径: string, 文案 = "下载") {
  await 行(page, 路径).click({ button: "right" })
  await page.locator("[role='menuitem']", { hasText: 文案 }).first().click()
}

/** 等下载事件并返回它——调用前先建 promise，别在点击之后才等（事件可能已经过去）。 */
const 等下载 = (page: Page) => page.waitForEvent("download", { timeout: 30_000 })

test("右键**文件夹**点「下载」⇒ 得到 `资料.zip`，包内结构与正文逐字正确", async ({ page, context }) => {
  const 甲 = await 建真项目(`打包下载·文件夹·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料", "8·17"), { recursive: true })
  writeFileSync(path.join(甲.directory, "资料", "8·17", "话单.csv"), "主叫,被叫\n138,139\n")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/8·17/话单.csv")).toBeVisible({ timeout: 30_000 })

  const 请求 = 数打包请求(page)
  const 下载事件 = 等下载(page)
  await 右键点下载(page, "资料")
  const 下载 = await 下载事件

  // ── 请求形状：一次 POST，带着选中集与包名 ──
  await expect.poll(() => 请求.length, { timeout: 15_000 }).toBe(1)
  expect(请求[0]!.method).toBe("POST")
  expect(JSON.parse(请求[0]!.body ?? "{}")).toEqual({ paths: ["资料"], name: "资料.zip" })

  // ── 落盘文件名 ──
  expect(下载.suggestedFilename()).toBe("资料.zip")

  // ── 包内容 ──
  const 包 = await 下载.path()
  expect(包, "浏览器应当给出一个临时文件路径").toBeTruthy()
  const entries = readZipEntries(包!)
  expect(entries.map((e) => e.name).sort()).toEqual(
    ["资料/", "资料/8·17/", "资料/8·17/话单.csv"].sort(),
  )
  expect(entries.find((e) => e.name === "资料/8·17/话单.csv")?.directory).toBe(false)
  expect(readZipText(包!, "资料/8·17/话单.csv")).toBe("主叫,被叫\n138,139\n")

  // ── 传输弹窗：停在完成态，摘要用服务端文件数与实际字节 ──
  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输.locator("[data-slot='file-transfer-title']")).toHaveText("下载完成", { timeout: 15_000 })
  await expect(传输.locator("[data-slot='file-transfer-summary']")).toHaveText(/^1 个文件 · /)
})

test("Ctrl 选中两个文件后右键已选中的行 ⇒ `下载选中的 2 项`，包内保留完整相对路径", async ({
  page,
  context,
}) => {
  const 乙 = await 建真项目(`多选打包${Date.now()}`)
  mkdirSync(path.join(乙.directory, "资料"), { recursive: true })
  mkdirSync(path.join(乙.directory, "账目"), { recursive: true })
  writeFileSync(path.join(乙.directory, "资料", "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(乙.directory, "账目", "报销.xlsx"), "假装的表格")

  await 进项目(page, context, 乙.id)
  await expect(行(page, "资料"), "顶层行应当在树上").toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/话单.csv")).toBeVisible({ timeout: 30_000 })
  await expect(行(page, "账目/报销.xlsx")).toBeVisible({ timeout: 30_000 })

  await 行(page, "资料/话单.csv").click()
  await 行(page, "账目/报销.xlsx").click({ modifiers: ["Control"] })

  const 请求 = 数打包请求(page)
  const 下载事件 = 等下载(page)
  await 行(page, "资料/话单.csv").click({ button: "right" })
  const 菜单项 = page.locator("[role='menuitem']", { hasText: "下载选中的 2 项" })
  await expect(菜单项).toBeVisible()
  await 菜单项.click()
  const 下载 = await 下载事件

  await expect.poll(() => 请求.length, { timeout: 15_000 }).toBe(1)
  const 体 = JSON.parse(请求[0]!.body ?? "{}") as { paths: string[]; name: string }
  expect(体.paths).toEqual(["资料/话单.csv", "账目/报销.xlsx"])
  expect(体.name).toMatch(/^多选打包\d+-\d{8}-\d{4}\.zip$/)
  expect(下载.suggestedFilename()).toBe(体.name)

  const 包 = await 下载.path()
  expect(包, "浏览器应当给出一个临时文件路径").toBeTruthy()
  const entries = readZipEntries(包!)
  expect(entries.map((e) => e.name).sort()).toEqual(["账目/报销.xlsx", "资料/话单.csv"].sort())
  expect(readZipText(包!, "资料/话单.csv")).toBe("主叫,被叫\n138,139\n")
  expect(readZipText(包!, "账目/报销.xlsx")).toBe("假装的表格")

  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输.locator("[data-slot='file-transfer-summary']")).toHaveText(/^2 个文件 · /)
})
```

⚠️ 旧 spec 里「拦截弹窗」常量、`existsSync` 断言与「0 个请求」判据**全部删除**——它们现在守的是旧行为，留着会把正确实现报成回归。

- [ ] **Step 3: 类型检查（e2e 有独立 tsconfig）**

```bash
cd packages/app
bun run typecheck:e2e
```

Expected: 通过。

- [ ] **Step 4: 跑真栈（本机配方见 memory `run-real-stack-e2e-on-this-machine`）**

```bash
cd packages/app
REAL_STACK_KERNEL_PORT=4712 REAL_STACK_FRONT_PORT=3011 \
E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
bunx playwright test --config e2e/real-stack/playwright.config.ts e2e/real-stack/file-tree-download-folder-real.spec.ts
```

Expected: `2 passed`。若端口被残留栈占住，换 `REAL_STACK_*_PORT`，**别杀进程**。把实际输出贴进交付说明。

- [ ] **Step 5: 提交**

```bash
git add packages/app/e2e/real-stack/zip-entries.ts packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts
git commit -m "test(file-archive): 真栈重写文件夹 / 多选打包下载

删掉旧「拦截弹窗 + 0 请求」断言；用本地中央目录读取器校验 zip 结构
与正文，不新增依赖、不动 bun.lock。
Refs: #006-11 #006-31 #005-36"
```

---

### Task 8: 门禁、锁文件与缺口对账

**Files:**
- 无新增；只跑门禁、核对 diff。

- [ ] **Step 1: 根 typecheck**

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck
```

Expected: 全绿。把最后几行实得输出贴进交付说明。

- [ ] **Step 2: 内核测试（受影响文件）**

```bash
cd packages/opencode
bun test --timeout 30000 --only-failures test/server/openhive-file-ops.test.ts
```

Expected: 全绿（含新 12 条打包用例与五扇门那条）。

- [ ] **Step 3: 前端单测 ＋ 组件测试**

```bash
cd packages/app
bun test --conditions=solid --only-failures --preload ./happydom.ts src/project/archive-name.test.ts src/project/openhive-file-ops.test.ts src/project/project-data.test.ts
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-tree.test.tsx src/workspace/workspace-entry.test.tsx
```

Expected: 两条命令都与基线一致。⚠️ 已知基线红 2 条（`project-data.test.ts` 的 upload / download 绑定），在未改动的 HEAD 上同样复现（Bun 1.4.3）；判据是「新增用例全绿、既有红不增加」。其余文件必须全绿。

- [ ] **Step 4: oxlint（两条都跑）**

```bash
cd "$(git rev-parse --show-toplevel)"
bun run lint
bun run lint:openhive
```

Expected: 0 error。若 `lint:openhive` 对新文件报 `no-unsafe-type-assertion` 之类，按既有写法改（`instanceof` 收窄 / 去掉断言），**不要**加 disable 掩盖。

- [ ] **Step 5: 锁文件核对**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --stat bun.lock
git status --short
```

Expected: `bun.lock` **无 diff**；`git status` 只有本计划列出的文件（外加可能的测试产物，确认后删掉）。

- [ ] **Step 6: 上游文件核对**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --name-only upstream/dev -- . ':!docs' ':!packages/app/src/project' ':!packages/app/src/workspace' ':!packages/opencode/src/server/openhive' ':!packages/opencode/test' ':!CONFIG.md' ':!packages/opencode/.env.example'
```

Expected: 空输出（除 `bun.lock` 外没有上游文件被改）。若 `upstream/dev` 不在本地，跳过这条并在缺口表写明。

- [ ] **Step 7: 缺口对账（写进交付说明，不写进代码）**

逐条按 `LEARNINGS #002-02` 记：

- **Windows 非法文件名（`:` 等）没有用例**：win32 上造不出这样的文件（NTFS 拒绝 `:`），只能靠 Windows 保留名之外的方式验证；本轮改由「项目名」那侧单测覆盖 sanitize。
- **「文件读不出来」没有用例**：win32 上很难稳定造出「有元信息但读不出」的文件（需要 ACL/占用），故只保留了代码分支，未宣称覆盖。
- **递归里的 `.git` 守卫不可达**：顶层 `.git` 被拒、子目录 `.git` 按设计放行；该分支是纵深防御。
- **并发打包不设闸**：多个请求各自占内存，登记为已知缺口（设计 §11.4）。
- **内存峰值未实测**：本机只验了 50 MB 压缩不阻塞事件循环；512 MiB 峰值待真机大数据集实测（设计 §11.3）。

- [ ] **Step 8: 最终提交（若 Step 1–4 产生格式 / lint 修补）**

```bash
git add -A
git commit -m "chore(file-archive): 门禁与缺口对账

typecheck / 内核测试 / 前端单测与组件测试 / oxlint 全绿；
bun.lock 无 diff；未覆盖项按缺口记录（非法文件名、读不出、并发、峰值）。
Refs: #002-02 #004-10"
```

若 Step 1–4 无改动，跳过本步。

---

## Self-Review

**1. 规格覆盖（对照设计 §4–§14）**

| 设计要求 | 落在哪 |
|---|---|
| 右键文件夹 → `文件夹名.zip`、保留根目录 | Task 2 单文件夹用例；Task 5 folder 分流；Task 6 命名/落盘；Task 7 第一条 E2E |
| 多选 → `项目名-yyyyMMdd-HHmm.zip`、保留完整相对路径 | Task 1；Task 2 多用例；Task 5 selection；Task 6 第二条；Task 7 第二条 |
| 祖先 + 后代去重 | Task 2「祖先 + 后代」用例 ＋ 变异 1 |
| 空目录保留 | Task 2 单文件夹用例（`资料/空/`） |
| 中文名逐字正确 | Task 1；Task 2 中文夹具；Task 7 真栈 |
| `.git` / ignored 不进包 | Task 2 `.git` 用例、ignore 用例（用「同名不同目录」钉住按项目根相对路径匹配） |
| 链接 / 读不出 / 非法名 / 超限 → 400 点名、不落盘 | Task 2 链接 ×2、容量 ×2；非法名与读不出记缺口 |
| 取消不落盘、不报错 | Task 3 客户端 abort；Task 6 取消用例；弹窗沿用既有语义 |
| 单文件行为逐字不变 | Task 3 保留 `downloadFile` 对外行为并跑回归；Task 5 单文件用例 |
| 头契约（`content-type` / `disposition` / `length` / `count`） | Task 2 头断言；Task 3 成功判据三条；Task 7 真栈摘要 |
| 不碰上游、不动锁文件 | Task 8 Step 5–6 |
| 配置走 Effect、两处文档 | Task 2 Step 3⑥ 与 Step 4 |

**2. 占位符扫描**：全文没有 TBD / TODO / 「类似 Task N」；每个代码步骤都给了可直接粘贴的实现或测试。

**3. 类型一致性**：`ArchiveKind`（Task 1）→ `onArchive(paths, kind)`（Task 5）→ `打包下载(paths, kind)`（Task 6）同名同型；`ArchiveOutcome`（Task 3）→ `ProjectData.downloadArchive` 返回型（Task 4）→ `结果.kind` 分支（Task 6）；`PATH.archive` 内核与客户端两侧都是 `"/openhive/file/archive"`。
