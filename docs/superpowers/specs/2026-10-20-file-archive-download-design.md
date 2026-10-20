# 文件 Tab 打包下载设计（文件夹 / 多选）

- 日期：2026-10-20
- 状态：设计已评审，待实现
- 范围：文件 Tab 的「下载」出口；单文件直下保持不变
- 相关代码：`packages/app/src/project/file-tree.tsx`、`packages/app/src/workspace/workspace-entry.tsx`、`packages/app/src/project/openhive-file-ops.ts`、`packages/opencode/src/server/openhive/file.ts`

## 1. 背景与目标

今天文件 Tab 只能下载单个文件。右键文件夹会弹「无法下载文件夹」，一个请求都不发
（`file-tree.tsx` 的 `点下载`、`file-download-dialog.tsx`）。民警要取一整份案卷目录时，只能
逐层打开、逐个下载。

目标：**一次把「选中的文件夹」或「选中的多个条目」打包成一个 zip 下载**。

用户已明确的约束：

- 典型规模是**小批量**：几十个文件、几百 MB 以内。
- 不新增复选框 / 选择模式，**复用已有的 Ctrl/Shift 多选**（2026-10-15 为批量拖拽做的
  `选中集`）。
- 遇到符号链接、读不了的文件、Windows 非法文件名，**整包失败**，不做「跳过坏的、打包好的」。
- 容量默认值：**512 MiB / 5000 个文件**，可通过环境变量调整。

## 2. 现状（已核实）

| 事实 | 位置 |
|---|---|
| 单文件下载是 `GET /openhive/file/download?path=`，回原始字节 + `Content-Disposition` | `packages/opencode/src/server/openhive/file.ts` 的 `handleDownload` |
| 前端不能用 `<a href>` 直接下载：浏览器发请求时不带 `x-openhive-project` 头 | `openhive-file-ops.ts` 文件头「下载为什么不返回一个可以点的 URL」 |
| 前端取回字节 → Blob → `<a download>` 落盘 | `workspace-entry.tsx` 的 `下载`、`存到本地` |
| 文件夹被前端拦下，不开请求 | `file-tree.tsx` 的 `点下载` |
| 多选集、Ctrl/Shift 连选已存在 | `file-tree.tsx` 的 `选中集`、`单选`、`拨一位`、`连选到` |
| 右键**不改变**选中态（既有设计） | `file-tree.tsx` 文件头与 `记对象` |
| 文件树隐藏 ignored 条目与项目根 `.git` | `openhive-files.ts` 的 `walk`、`isGitMetadata` |
| `@zip.js/zip.js@2.7.62` 已是 `packages/opencode` 直接依赖（源码未使用） | `packages/opencode/package.json` |
| `ignore@7.0.5` 已是 `packages/opencode` 直接依赖 | `packages/opencode/package.json` |

结论：服务端打包**不需要新增依赖、不需要动 `bun.lock`**。

## 3. 决策摘要

| 决策 | 结论 |
|---|---|
| 打包位置 | **服务端**一次性成包，回 `application/zip` |
| 接口 | `POST /openhive/file/archive`，body `{ paths, name }` |
| 选择交互 | 复用 Ctrl/Shift；右键已选中的一行 → 「下载选中的 N 项」 |
| 单文件 | 不打包，走原 `onDownload`，行为逐字不变 |
| 单文件夹 | `文件夹名.zip`，包内保留一层 `文件夹名/` |
| 多选 | `项目名-yyyyMMdd-HHmm.zip`，包内保留相对项目根的完整路径 |
| 忽略规则 | 与文件树同口径：ignored 条目、项目根 `.git` 不进包 |
| 部分失败 | **整包失败**，400 点名路径 |
| 容量闸 | `OPENHIVE_ARCHIVE_MAX_FILES`（默认 5000）、`OPENHIVE_ARCHIVE_MAX_BYTES`（默认 512 MiB） |
| 进度 | 服务端内存成包，`Content-Length` 精确，复用 `FileTransferDialog` |

## 4. 用户可见语义

### 4.1 触发点

| 用户动作 | 结果 |
|---|---|
| 右键一个文件夹 → 下载 | 打包成 `文件夹名.zip` |
| Ctrl/Shift 选中多项，右键其中**已选中**的一行 → 「下载选中的 N 项」 | 整个选中集打成一个 zip |
| 右键一行，但该行**不在**选中集里（或选中集只有它） | 只作用于这一行：文件直下、文件夹打 zip |
| 右键空白处 | 不出现下载项（与今天一致） |

不在工具栏新增下载按钮；入口统一走右键菜单。若真机反馈「找不到」，再单独评估。

### 4.2 打包范围与去重

- 选中项存在祖先—后代关系时，**只保留祖先**；后代本来就在祖先的递归结果里。
- 去重**只在服务端做**（单一真相）。前端菜单里的「N 项」是选中集原始条数，不做去重。
- 文件夹递归展开；空目录保留为空目录条目。
- 排除 `.gitignore` / `.ignore` 判定为 ignored 的条目，以及项目根 `.git`
  ——与文件树「看得见才下得到」同一口径。

### 4.3 名字与内部结构

| 选中 | 下载文件名 | zip 内结构 |
|---|---|---|
| 1 个文件 | 原文件名，不打包 | — |
| 1 个文件夹 | `${末段(path)}.zip` | 根下保留 `文件夹名/…` |
| 多个条目 | `${sanitize(项目名)}-${yyyyMMdd-HHmm}.zip` | 相对项目根的完整路径 |

单文件夹保留一层根目录，避免解压时把文件直接倒进当前目录；多选保留完整相对路径，避免丢来源结构。

### 4.4 完整性优先

遇到以下任一情况，**整包 400，不返回任何字节**：

- 选中的顶层条目不存在、越界、落在项目根 `.git` 内；
- 递归过程中遇到符号链接或非普通文件（socket / FIFO 等）；
- 文件读不出来；
- 文件名含 Windows 解压不出的字符（如 `:`）；
- 文件数或原始总字节超过上限。

消息里点名路径或写清「这次多少 / 上限多少」。理由：对办案材料，「看起来完整、实际缺件」比
「下载失败」危险得多。

### 4.5 进度与完成态

复用 `FileTransferDialog`：

- 运行中：zip 文件名 + 真百分比（`Content-Length` 来自服务端）；
- 完成态：「N 个文件 · X MB」，N 来自 `x-openhive-file-count`，X 用实际取回字节数；
- 取消：abort，服务端请求断开，不落临时文件（本来就不落）。

## 5. 接口契约

```
POST /openhive/file/archive
Header: x-openhive-project: <projectId>
Content-Type: application/json
Body:   { "paths": ["资料", "账目.xlsx"], "name": "资料.zip" }

200:
  Content-Type: application/zip
  Content-Disposition: attachment; filename="..."; filename*=UTF-8''...
  Content-Length: <精确字节数>
  x-openhive-file-count: <包内普通文件数>
  body: zip 原始字节

400:
  Content-Type: application/json
  { "error": "<给人看的一句话>" }

401: 空体（由 `gate` 统一返回）
403: 已归档项目（由项目定位中间件统一返回）
```

约定：

- 用 POST 不是因为写，而是多选路径列表可能很长，放 URL 不可靠。
- `paths` 是相对项目根；`""`（项目根）拒绝——界面没有「下载整个项目」的入口，API 也不留。
- `name` 由前端算好并提交；服务端只做头注入清洗。前端落盘用自己那份名字，
  **不解析 `Content-Disposition`**（与今天单文件下载同一口径）。
- `paths.length > OPENHIVE_ARCHIVE_MAX_FILES` 直接 400，不进入遍历。

## 6. 服务端实现

### 6.1 新增路由与配置

在 `file.ts` 的 `PATH` 表增加 `archive: "${PREFIX}/archive"`，并在 `routes` 里注册一行：

```ts
yield* router.add("POST", PATH.archive, (request) => handleArchive(request, root, limits))
```

请求体沿用现有的 `bodyOf` + `Schema` 口径：

```ts
const ArchiveBody = Schema.Struct({
  paths: Schema.Array(Schema.String),
  name: Schema.String,
})
```

`paths` 为空、或长度超过 `OPENHIVE_ARCHIVE_MAX_FILES`，直接 400，不进入遍历。

容量闸走 Effect 配置源（与 `archive.ts` 的 `MinioConfig` 同款，**不直接读 `process.env`**）：

```ts
const maxFiles = yield* EffectConfig.number("OPENHIVE_ARCHIVE_MAX_FILES").pipe(
  EffectConfig.withDefault(5000),
)
const maxBytes = yield* EffectConfig.number("OPENHIVE_ARCHIVE_MAX_BYTES").pipe(
  EffectConfig.withDefault(512 * 1024 * 1024),
)
```

新增变量同步写入 `packages/opencode/.env.example` 与仓库根 `CONFIG.md`。

### 6.2 守卫链

对每个显式选中的顶层路径，逐条复用单文件下载那串守卫、同序：

```
gate（项目在不在 / 冻没冻）
→ inside（越界）
→ inGit（项目根 .git）
→ lstat（不跟链接）+ 必须是文件或目录
→ realInside（真身在项目内）
```

递归展开时：

- `readdir(current, { withFileTypes: true })`；
- `Dirent.isSymbolicLink()` 或其他非目录/非普通文件 ⇒ 400；
- 目录递归并写入目录条目；
- 普通文件读字节写入；
- 每个条目都做 `realInside(project, dirname(abs))` 或对目录自身做 `realInside`
  （防中间层是链接）；
- 忽略规则与上游 `handlers/file.ts` 的 `list` **同一份实现**：
  `ignore()` + 项目根 `.gitignore` / `.ignore`，判
  `relative(project, abs) + (目录 ? "/" : "")`；
- 另排除项目根 `.git`（与 `openhive-files.ts` 的 `isGitMetadata` 同口径：只看第一段）。

### 6.3 去重与排序

1. 先把每个 `paths` 经 `inside()` 解析成**绝对路径**；
2. 按路径段数升序，若某路径落在已接受路径之下（`relative(accepted, candidate)` 不是 `..`
   开头、不是绝对路径、且不为空），丢弃；
3. zip 条目按**规范化后的相对路径**排序，保证同一次选择产出稳定顺序（便于测试与排查）。

### 6.4 成包

- `@zip.js/zip.js` 的 `ZipWriter` + `Uint8ArrayWriter`（版本 2.7.62）。
- 条目名：`relative(project, abs).replaceAll("\\", "/")`；目录条目以 `/` 结尾。
- UTF-8 文件名由 zip.js 写 UTF-8 标志位；中文名在 Windows 资源管理器里应正确解出。
- 压缩方式用默认 deflate；512 MiB 上限内不启用 ZIP64。
- 响应头用现有 `disposition(name)`，再补
  `content-length: String(zip.byteLength)` 与 `x-openhive-file-count`。

### 6.5 错误

统一走现有 `badRequest(message)`，不为每个分支发明机器码。前端只需要「把这句话显示出来」。

## 7. 前端实现

### 7.1 文件树

`FileTreeProps` 新增：

```ts
onArchive?: (paths: readonly string[], kind: "folder" | "selection") => void
```

保留 `onDownload`。类型判断仍在本层（它有 `节点表`）：

```text
目标集合 = 右键行在选中集且 size > 1 ? [...选中集] : [右键行]
若 目标集合.size === 1 且 节点类型是 file → onDownload(path)
否则 → onArchive(目标集合, size === 1 ? "folder" : "selection")
```

菜单文案动态化：

```text
右键行在选中集且 size > 1 → 「下载选中的 N 项」
否则 → 「下载」
```

菜单禁用判据：

```text
目标是单个文件 → 需要 onDownload 接线
其余（文件夹 / 多选）→ 需要 onArchive 接线
```

删除 `FileDownloadDialog` 的 import 与 `点下载` 里的拦截分支；删除 `file-download-dialog.tsx`
（本次改动造成的孤儿）。

### 7.2 命名纯函数

新增 `packages/app/src/project/archive-name.ts`：

```ts
export function archiveName(
  projectName: string,
  paths: readonly string[],
  kind: "folder" | "selection",
  now: Date,
): string
```

- `folder` → `${末段(paths[0])}.zip`
- `selection` → `${sanitize(projectName)}-${yyyyMMdd-HHmm}.zip`
- `sanitize` 把 `\ / : * ? " < > |` 换成 `_`
- `now` 作为参数传入，测试可钉死

### 7.3 `ProjectData` 与下载客户端

`openhive-file-ops.ts` 新增：

```ts
export type ArchiveOutcome =
  | { kind: "done"; blob: Blob; files: number; bytes: number }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

export async function downloadArchive(
  projectId: string,
  paths: readonly string[],
  name: string,
  options?: DownloadOptions,
): Promise<ArchiveOutcome>
```

- 请求：`POST PATH.archive`，`credentials: "same-origin"`，`x-openhive-project`，
  `content-type: application/json`，body `{ paths, name }`，带 `signal`。
- 401 → `rejected` + `SESSION_EXPIRED`；400/403 → 读 `{ error }` 原样交回；
  其余非 2xx → `failed`。
- 成功判据三条**全要**：
  1. `content-disposition` 存在；
  2. `content-type` 是 `application/zip`；
  3. `x-openhive-file-count` 是有限数字。
  任何一条不满足 → `failed`。这是「出口没挂上时 UI 兜底回 200 + HTML」的唯一防线。
- 读流、报进度、abort 的逻辑与 `downloadFile` 共用：从 `downloadFile` 里提一个内部函数，
  两条下载链都调它，不写第二份。

`ProjectData` 接口增加 `downloadArchive(projectId, paths, name, options)`，`PROJECT_DATA` 接
`downloadArchive`；`project-data.test.ts` 逐项钉住接线（防止 `downloadArchive` 接到 `download`）。

⚠️ **不叫 `archive`**：同一个接口上 `archive(projectId)` 已经是「归档项目」
（`project-data.ts:99`），两个签名直接冲突。实现与文档统一用 `downloadArchive`。

### 7.4 `workspace-entry`

新增：

```ts
async function 打包下载(paths: readonly string[], kind: "folder" | "selection")
```

流程：

```text
id / projectName 取自 currentProject()
zip 名 = archiveName(projectName, paths, kind, new Date())
开传输（action: "下载"，name: zip 名，progress {0,0}）
await projectData.downloadArchive(id, paths, zip 名, { signal, onProgress })
取消 → 直接返回（弹窗已由收传输关掉）
done → 存到本地(blob, zip 名)；完成态 { files, bytes: blob.size }
rejected / failed → 收传输(false)；set文件话(message)
```

接线：

```tsx
onDownload={(path) => void 下载(path)}
onArchive={(paths, kind) => void 打包下载(paths, kind)}
```

与 `onDownload` 同一口径（不并 `有项目()`，由 `打包下载` 自己查 id）。

## 8. 错误与边界

| 场景 | 结果 |
|---|---|
| 选中集里某条已在盘上被删 | 服务端 400「文件不存在」，整包失败 |
| 选中项是项目根 `""` | 400「不能打包项目根」 |
| 文件夹里有符号链接 / 读不了的文件 | 400 点名路径，整包失败 |
| 超过容量闸 | 400 写清「这次多少 / 上限多少」 |
| 旧内核没有 `/archive` 出口 | 响应是 200 + HTML；三条成功判据拦下，报「打包下载失败」 |
| 用户取消 | abort，不落盘，不报错 |
| 并发多个打包请求 | 当前不做并发闸；各请求独立占内存。登记为缺口 |

## 9. 测试策略

### 9.1 纯函数

`archive-name.test.ts`：

- 单文件夹命名；
- 多选命名与时间格式；
- 项目名含 Windows 非法字符时的清洗；
- 同一输入 + 同一 `now` 输出稳定。

### 9.2 内核

加在 `packages/opencode/test/server/openhive-file-ops.test.ts` 同族（真 HTTP app + 临时目录）：

- 单文件夹：响应字节用 `ZipReader` 读回，条目包含 `资料/`、`资料/8·17/`、`资料/8·17/话单.csv`；
- 多选两个不同目录的文件：条目保留相对路径；
- 祖先 + 后代同时选中：后代只出现一次；
- 空目录：zip 里有目录条目；
- 中文文件名：读回的条目名逐字相同；
- `.git` 与 ignored 文件不在条目里；
- 符号链接：400，且响应里点名路径；
- 越界 `../`、项目根 `""`、不存在的路径：各自 400；
- 超过 `MAX_FILES` / `MAX_BYTES`：400，消息含实际值与上限；
- `Content-Length` 等于响应实际字节数；
- `x-openhive-file-count` 等于普通文件数（目录条目不计数）。

### 9.3 前端

- `openhive-file-ops.test.ts`：请求方法/路径/头/body；三种结果的映射；成功三判据各缺一条时
  `failed`；进度回调；abort。
- `file-tree.test.tsx`：
  - 右键单个文件 → 只喊 `onDownload`；
  - 右键单个文件夹 → 只喊 `onArchive(paths, "folder")`；
  - 多选后右键已选中行 → 文案「下载选中的 N 项」、喊 `onArchive(paths, "selection")`；
  - 多选后右键**未选中**行 → 只作用于该行；
  - 未接线时菜单项禁用。
- `workspace-entry.test.tsx`：打包成功的弹窗状态与落盘调用；rejected 的文案落到 `文件话`；
  abort 不落盘。

### 9.4 真栈

重写 `packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts`：

- 建真项目 + 子目录 + 中文文件；
- 右键文件夹下载 → 数到 `POST /openhive/file/archive`（不再是「0 个请求」）；
- 落盘 zip 用 `ZipReader` 读回，校验 `资料/8·17/话单.csv`；
- 另加一条多选两个文件 → 下载 zip 的用例。

旧用例的断言（拦截弹窗 + 一个请求都不发）必须删除，否则正确行为会被报成回归。

## 10. 实现顺序与门禁

1. `archive-name` 纯函数 + 测试；
2. 内核 `/archive`：守卫、遍历、忽略、zip、配置、测试；
3. 前端 `downloadArchive` + 共用进度读取 + 测试；
4. 文件树分支、动态文案、删除旧弹窗 + 测试；
5. `workspace-entry` 接线 + 传输弹窗 + 测试；
6. 重写真栈 E2E；
7. `CONFIG.md` / `.env.example`；
8. 门禁：受影响 package 的 typecheck + 测试 + oxlint（在仓库根跑，`LEARNINGS #004-10`）。

## 11. 风险与实现前必须验证的前提

1. **zip.js 在 Bun 服务端的写入路径**：`ZipWriter` + `Uint8ArrayWriter` 是否直接可用。
   风险低（纯 JS），但实现第一步先跑最小用例。
2. **压缩是否走异步 Web API**：若 Bun 的 `CompressionStream` 不可用、zip.js 退回纯 JS
   deflate，512 MiB 的包会**阻塞内核事件循环**。实现第一步量一次 100 MB 的耗时与主线程
   可用性；若确实阻塞，则下调默认上限，或把压缩放到阻塞线程池（Effect 的
   `Effect.blocking` / worker），不能装作没这回事。
3. **内存峰值**：源文件逐条读取后释放，但 zip 本身常驻内存；不可压缩文件（xlsx / jpg）
   下峰值接近原始总字节。512 MiB 上限是原始字节上限，峰值需实测后记录。
4. **并发**：多个打包请求会各自占内存；本轮不做并发闸，登记为缺口。
5. **ignored 口径**：与文件树一致的代价是「盘上存在但界面看不见的文件不会进包」。
   对民警数据目录通常无影响；若将来需要「连隐藏的也打包」，另起出口，不在这里改默认。

## 12. 备选方案与为什么没选

### 12.1 浏览器内打包

前端递归列目录 + 逐文件调用现有单文件下载 + 前端 zip.js 成包。

- 优点：内核零改动；每个文件天然走既有守卫；单文件失败可「成了 8 个、失败 2 个」报告。
- 不选原因：N+M 次请求；**忽略规则与遍历要在前端再写一份**，与文件树/服务端形成第二份真相；
  `packages/app` 要新增 zip 依赖并动 `bun.lock`；原始字节与压缩包同时占浏览器内存。

### 12.2 服务端临时包 + 一次性令牌 URL

- 优点：真正的边压边落盘，几个 GB 不占浏览器内存；可用浏览器原生下载 UI。
- 不选原因：多一套令牌签发/校验/过期/清理，安全面变大；与现有传输弹窗（取消、进度、
  完成态）接不上；当前规模下是明显过度设计。若将来出现 GB 级需求，本方案的接口形状
  （路径列表 → zip 流）可以不变，只把「内存成包」换成「流式写出」。

## 13. 验收标准

1. 右键文件夹 → 下载得到 `文件夹名.zip`，包内保留 `文件夹名/…` 结构。
2. Ctrl/Shift 选中两个文件，右键已选中行 → 菜单显示「下载选中的 2 项」，得到包含两个文件的 zip。
3. 同时选中文件夹与其子文件 → zip 内该子文件只出现一次。
4. 空文件夹 → zip 内有对应的空目录条目。
5. 中文文件名在 Windows 资源管理器解压后逐字正确。
6. 项目根 `.git` 与 ignored 条目不出现在 zip 里。
7. 符号链接 / 读不了的文件 / 超限 → 400，界面显示点名的原因，不落盘。
8. 取消 → 不落盘、不报错；服务端请求断开。
9. 单个文件下载行为逐字不变；「无法下载文件夹」弹窗不再可达。
10. 不修改上游文件；`bun.lock` 无变动。
11. 受影响 package 的 typecheck、测试、oxlint 全绿。

## 14. 上游冲突面

| 文件 | 性质 | 改动 |
|---|---|---|
| `packages/opencode/src/server/openhive/file.ts` | fork 自有 | 新增 `PATH.archive`、配置、`handleArchive` |
| `packages/app/src/project/openhive-file-ops.ts` | fork 自有 | 新增 `downloadArchive`，提炼共用读流函数 |
| `packages/app/src/project/file-tree.tsx` | fork 自有 | 新增 `onArchive`、动态文案、删拦截分支 |
| `packages/app/src/project/workspace-entry.tsx` | fork 自有 | 新增 `打包下载` 与接线 |
| `packages/app/src/project/project-data.ts` | fork 自有 | 新增 `downloadArchive`（不叫 `archive`：与「归档项目」撞名） |
| `packages/app/src/project/archive-name.ts` | 新增 | 命名纯函数 |
| `packages/app/src/project/file-download-dialog.tsx` | fork 自有 | 删除（本次造成孤儿） |
| `packages/app/e2e/real-stack/file-tree-download-folder-real.spec.ts` | fork 自有 | 重写 |
| `CONFIG.md` / `packages/opencode/.env.example` | fork 文档 | 补两个环境变量 |

不触碰上游文件，不新增依赖。
