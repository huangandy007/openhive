# 文件级备份快照设计（「备份到 MinIO」/「从 MinIO 拉回」）

- **日期**：2026-10-18
- **分支**：`multi-tenant`
- **性质**：本仓定制（openhive）。提交信息须标注「这是要保留的定制 · 同步上游时不要丢」。
- **上游约束**：新增代码全部落在 fork 自有文件里（`packages/opencode/src/server/openhive/**`、`packages/app/src/project/**`、`packages/core/src/minio.ts`、`packages/auth/src/migrations/**`）。**不碰** `packages/ui` 与 `packages/session-ui` 的上游源码。对上游文件只做「加一行接线」级别的改动（`server.ts` 的 route layer、`workspace-entry.tsx` 的已有 prop）。
- **来由**：项目文件 Tab 右键菜单里的「备份到 MinIO」「从 MinIO 拉回」自 T008 起一直是灰色。用户 2026-10-18 要求重写需求，并逐步补充了自动备份、按选中项、拖拽、进度条四项要求。
- **关联**：005 FR-007（文件级备份/拉回）、T022（未完成项）；006 项目删除（`dropBackups`）；`005-project-management/minio.md`（桶/键/凭据）；`CONFIG.md`（五个 `OPENHIVE_MINIO_*` 整组配齐才算配）。

---

## 1. 背景与终极目标

### 1.1 今天是什么样（带证据）

| 事实 | 证据 |
|---|---|
| 两个菜单项**禁用**，因为没接回调 | `packages/app/src/project/file-tree.tsx:876-886` 的 `禁用={要对象(props.onBackup)}`；`workspace-entry.tsx:1103-1106` 注释明写「刻意不接」 |
| 跨树拖拽做了，但**备份/拉回那一放不落** | `dual-file-tree.tsx:210-216` 的 `可放` 要求 `onBackup`/`onRestore` 已接 |
| 拖拽落点语义是「复制到鼠标所在文件夹」 | `dual-file-tree.tsx:250-255` 的 `拼路径`，与用户裁定的「保持原路径」冲突 |
| MinIO 下树的行**没有真实数据源** | `minio-backups.ts` 文件头：没有写入方；`minio-bar.tsx` 的 `count` 恒 `undefined` |
| MinIO 下树的行拖出去写的是 `file:` | `dual-file-tree.tsx:227-228`：两棵树共用同一个 payload；拖到会话框会把**云上备份**误当成本地路径引用 |
| 归档链路已有镜像式备份 | `archive.ts` 的 `backupAll`：上传后**收敛删除**不在当前清单里的键 |
| 删除项目会清 MinIO | `archive.ts` 的 `dropBackups`：只清 `{userId}/{projectId}/` |

### 1.2 用户逐条谈定的裁决（2026-10-18）

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 目标高度 | **不怕忘**：不仅手动备份，还要自动快照、状态可见 |
| 2 | 备份语义 | **快照**：保留历史，可回到某一刻；不是跟随本地删除的镜像 |
| 3 | 自动触发 | **有变就拍，最快每小时** |
| 4 | 保留策略 | **分级保留 ＋ 超限告警**（不静默删旧快照） |
| 5 | 拉回冲突 | **智能判断 ＋ 三选一**（覆盖 / 保留两者 / 跳过） |
| 6 | 快照范围 | **含 `.git`，排除临时文件** |
| 7 | 恢复入口 | **先选恢复点，再恢复** |
| 8 | 保留与容量 | **12 周 ＋ 每（用户×项目）10 GB** |
| 9 | 操作范围 | **手动按选中项**（文件或文件夹子树）；**自动按整项目** |
| 10 | 拖拽落点 | **保持原路径**，不复制到鼠标所在文件夹 |
| 11 | 进度 | 要有**分阶段、诚实、可取消**的进度条 |

### 1.3 终极结果与真正需要的结果

**终极结果**：民警误删、改坏、覆盖了一份材料，**不需要找 IT、不需要记得自己什么时候备份过**，在文件 Tab 里点两下就能回到某一个时刻的版本，并且**能证明恢复出来的内容是对的**。

**真正需要的结果**不是「两个菜单项从灰变亮」，而是三件事同时成立：

1. **兜底是自动的**——用户忘了备份，系统也替他拍了；失败不静默。
2. **状态是可见的**——用户随时看得到「上次备份是什么时候、备份了多少、有没有失败」。
3. **恢复是可验证的**——不是「点了恢复、界面说成功」，而是逐字节比对过、失败会明确报错。

### 1.4 验收的终极口径：一次真实的误删恢复演练

本 feature 的最终验收不是「菜单能点」，而是下面这条演练在**真栈**上走通：

1. 建一个真项目，写入若干文件（含嵌套目录、空目录、二进制文件、`.git`）；
2. 触发一次备份；
3. 删除其中几个文件、改写另外几个；
4. 从恢复点拉回；
5. **逐文件比对 sha256 与目录结构**，全部一致；
6. 演练报告落盘（文件数、字节数、耗时、跳过项）。

**这条演练失败，本 feature 就不算完成。** 它也是「客观指标」的最终来源（见 §13.6）。

---

## 2. 范围

### 2.1 v1 做

- 右键「备份到 MinIO」：备份**选中项**（单文件或一整棵目录子树），保持项目相对路径。
- 右键「从 MinIO 拉回」：先选恢复点（快照），预览差异，三选一，再恢复。
- 跨树拖拽：
  - 沙箱 → MinIO 窗口/底部窄条 = 备份选中项，**保持原路径**；
  - MinIO → 沙箱树 = 从**当前显示的恢复点**拉回，**保持原路径**。
- 自动快照：项目活跃期间有变化才拍，最快每小时一次。
- 恢复点列表、快照选择器、恢复点删除（手动快照）。
- 分级保留、容量统计、超限暂停自动备份、GC（无引用 blob 回收）。
- 分阶段进度条、可取消、离开页面可重连、刷新后可接上。
- 审计事件表（谁、何时、哪个项目、哪个路径、多少文件/字节、成功/失败/取消）。
- 用户间物理隔离：每个人只能看/恢复**自己沙箱**的快照；owner 也看不到成员的快照。

### 2.2 v1 不做

- **多选批量拖拽**（一次拖多行）。v1 一次拖一行；多选批量下一期。
- **跨项目恢复**（把 A 项目的快照恢复到 B 项目）。
- **跨用户去重**。每个用户独立 blob 空间；不做全局去重。
- **桶版本化**。blob 与 manifest 本身不可变，不需要版本化；开了只会让删除也留副本、容量翻倍。
- **预签名直读 / 浏览器直传**。所有读写都走服务端；浏览器不拿 MinIO 凭据。
- **客户端加密 / 应用层加密**。v1 依赖内网 MinIO 的传输安全与部署侧 SSE（见 §12 缺口）。
- **单文件 > 5 GB**。S3 `PutObject` 单次上限 5 GB；v1 跳过并记警告，multipart 下一期。
- **符号链接**。不跟随、不备份、不恢复；记警告。
- **ACL / xattr / Windows 安全描述符**。只保留常规权限位（POSIX）与 mtime。
- **恢复时删除本地多余文件**。快照不是镜像，恢复只写快照里有的文件。
- **恢复到一个新路径**。永远回原路径；「保留两者」是唯一的重命名形态。
- **后台常驻扫描所有项目**。自动备份只覆盖「活跃项目」（见 §7.1）。
- **多实例部署的分布式锁**。v1 假设单内核实例（见 §12 缺口）。
- **WebSocket / SSE 推送**。v1 用 1 秒轮询。
- **项目级共享 bare 仓库 `/shared/{projectId}.git` 的备份**。归档链路今天也不搬它；这是既有缺口，不在本 feature 内闭合。

### 2.3 实施方代定（用户未逐条反对，可推翻）

| # | 代定项 | 理由 |
|---|---|---|
| A1 | 自动备份只覆盖**活跃项目**（30 分钟内有心跳） | 服务端不做全量扫描；没有打开的项目的文件不会被应用改动，重新打开时会补拍 |
| A2 | 恢复冲突的**全局默认是「保留两者」** | 默认不删、不覆盖用户现有文件；要覆盖必须显式选 |
| A3 | 手动备份超配额时**要求显式确认**，自动备份**直接暂停** | 用户明确发起的动作不能被静默拒绝；自动行为不能替用户做破坏性选择 |
| A4 | 单文件 > 5 GB **跳过并记警告** | 不引入 multipart 与 `lib-storage` 依赖；用计数流做字节级进度，测试面更小 |
| A5 | 恢复预览本身是一个 **job** | 预览要读本地所有文件算哈希，可能很慢；复用同一套进度/取消机制 |
| A6 | 归档项目上**禁用文件级备份/恢复**，只保留项目找回 | 归档项目沙箱已删，文件级恢复会造出半份沙箱；项目找回是那个状态的正确出口 |
| A7 | 手动快照**不参与自动删除**，但提供「删除恢复点」入口 | 用户主动拍的东西不能悄悄没了；容量管理需要出口 |
| A8 | 自动备份对**未变化文件复用上次哈希**（size + mtime 相同才复用） | 每小时全量重读太贵；手动备份与归档仍全量读，兜住 mtime 被保留的极端情况 |
| A9 | MinIO 下树默认显示**最新恢复点**，顶部可切换 | 大多数时候用户想看「最近一次备份」；切换入口必须显眼 |

---

## 3. 核心语义

### 3.1 快照 ≠ 镜像（与归档的分工）

| | 归档（FR-008/009，已有） | 文件级备份（本 feature） |
|---|---|---|
| 语义 | **镜像**：归档那一刻沙箱的完整副本 | **快照**：某个时刻的副本，历史保留 |
| 本地删除 | 下次归档/收敛会把它从备份里删掉 | **不影响已有快照** |
| 触发 | owner 手动归档 / 超期提醒 | 手动选中项 / 自动整项目 |
| 范围 | 全体成员各自的沙箱 | **只备份调用者自己的沙箱** |
| 键空间 | `{userId}/{projectId}/` | `{userId}/_openhive-backups/{projectId}/` |
| 恢复 | 项目级找回（FR-009） | 文件/子树级拉回 |

**一句话**：归档回答「这个项目最后是什么样」，快照回答「三天前那份材料是什么样」。两者不能共用一个前缀、不能共用一套语义。

### 3.2 作用域

- **手动**：`path` 是用户右键/拖拽的那一项。
  - 文件 ⇒ 快照里只有这一个文件；
  - 目录 ⇒ 快照里是这棵子树的全部文件与目录；
  - 路径在清单里**始终是项目相对路径**（如 `资料/话单/八月.csv`），不是绝对路径。
- **自动**：`path = ""`，即整个项目（调用者自己的沙箱）。
- **恢复**：作用于某个快照内、某个 `path` 子树下的文件；`path` 省略 = 整个快照。

### 3.3 谁的数据

**永远只备份调用者自己的沙箱**。`{userId}` 来自会话身份，客户端给不出、改不了。

- owner 看不到成员的快照；
- 成员看不到 owner 的快照；
- 不做跨用户去重（去重会通过「对象是否存在」泄漏别人有什么文件）。

### 3.4 三个名词

| 名词 | 含义 |
|---|---|
| **恢复点（snapshot）** | 一次备份的完整记录。不可变、有 id、有创建时间、有清单。界面上的「恢复点」就是它。 |
| **清单（manifest）** | 一个 JSON 对象，列出这次快照包含的每个文件（路径、sha256、大小、mtime）与目录。它是快照的唯一真相。 |
| **blob** | 文件内容本身，按 sha256 命名。同一个内容只存一份。 |

> ⚠️ **命名避让**：上游已有 `packages/opencode/src/snapshot/index.ts`（git 快照）。本 feature 在代码与文档里统一叫 **backup snapshot / 恢复点**，不要 import 上游的 `Snapshot`，避免两个「快照」混在一起。

### 3.5 两个命名空间，必须分开

```
归档镜像：{userId}/{projectId}/...
文件快照：{userId}/_openhive-backups/{projectId}/...
```

**为什么必须分开**：归档的 `backupAll` 在上传完后会**收敛删除**——`list()` 整个 `{userId}/{projectId}/` 前缀，把不在当前文件清单里的键删掉。如果文件快照也写在这个前缀下：

- 一次归档会把所有历史快照删光；
- 一次文件备份写进去的对象，会被下一次归档当成「不在清单里的键」删掉；
- 两者不会报错，只会静默互相删除。

**用结构隔离，而不是靠「记得排除」。**

### 3.6 五条不变量（实现与测试都要围着它们写）

1. **清单最后写**：所有 blob 上传并校验完成，才写 manifest。manifest 不在 = 这次备份不存在。
2. **blob 只增不改**：blob 按内容命名，永不覆盖；删除只发生在 GC（无引用且超过宽限期）。
3. **manifest 不可变**：同一个 snapshot id 永远指向同一份清单。
4. **恢复先校验后替换**：每个文件先写临时文件、算哈希、与清单比对，一致才替换目标。
5. **路径不出项目根**：清单里的每个路径段都要过安全校验；恢复写入前再校验一次。

---

## 4. 对象布局与清单格式

### 4.1 键空间（backup store 的 scope）

`Minio.Scope` 扩展一个可选的 `namespace`：

```ts
interface Scope {
  userId: string
  projectId: string
  /** 省略 = 归档镜像（`{userId}/{projectId}/`）；"_openhive-backups" = 文件快照。 */
  namespace?: string
}
```

前缀计算：

```
无 namespace：  {userId}/{projectId}/
有 namespace：  {userId}/{namespace}/{projectId}/
```

backup store 固定传 `namespace: "_openhive-backups"`。`_openhive-backups` 本身要过 `assertSafeSegment`（每一段都安全）。

### 4.2 项目命名空间内的布局

```
{userId}/_openhive-backups/{projectId}/
  manifests/
    <snapshotId>.json.gz
  blobs/
    <hash[0:2]>/<hash>
  state.json
```

- **`manifests/`**：每个快照一个清单对象。gzip 压缩，`Content-Type: application/json`，`Content-Encoding: gzip`。
- **`blobs/`**：按 sha256 前两位分目录，避免单目录对象过多；S3 本身不要求，但便于排查与列举。
- **`state.json`**：派生索引（快照摘要、用量、自动暂停状态）。**它不是真相**；丢了可以从 manifests 重建。
- **没有 `tmp/`**：v1 用计数流单次 PUT，不需要临时对象。将来上 multipart 时再加。

### 4.3 manifest 格式（version 1）

```json
{
  "version": 1,
  "id": "20261018T140305123Z-a1b2c3",
  "projectId": "p-42",
  "ownerId": "u-7",
  "kind": "manual",
  "scope": "资料/话单",
  "createdAt": 1760796185123,
  "createdBy": "u-7",
  "source": "sandbox",
  "timezone": "Asia/Shanghai",
  "status": "complete",
  "files": [
    {
      "path": "资料/话单/八月.csv",
      "hash": "<64 位小写十六进制>",
      "size": 12345,
      "mtimeMs": 1760796000000,
      "mode": 420
    }
  ],
  "dirs": [
    "资料",
    "资料/话单",
    "资料/空目录"
  ],
  "skipped": [],
  "totals": {
    "files": 128,
    "dirs": 3,
    "logicalBytes": 1234567,
    "uploadedBytes": 234567
  }
}
```

字段约束：

| 字段 | 约束 |
|---|---|
| `version` | 必须为 `1`；读到别的版本 ⇒ 拒绝（fail-closed） |
| `id` | `YYYYMMDDTHHMMSSmmmZ-<6 位十六进制>`，UTC、字典序即时间序 |
| `projectId` / `ownerId` | 必须与当前 store 的 scope 一致，否则拒绝 |
| `kind` | `manual` / `auto` |
| `scope` | 项目相对路径；`""` = 整项目。不得以 `/` 开头、不得含 `..` / 反斜杠 / 盘符 / NUL |
| `createdAt` | 毫秒时间戳 |
| `timezone` | 服务器本地时区（IANA 名），保留策略按它分日/周 |
| `status` | `complete` / `partial`。`partial` 时 `skipped` 非空 |
| `files[].path` | 项目相对路径，每个路径段都要安全；排序后写入（确定性） |
| `files[].hash` | 64 位小写十六进制 |
| `files[].size` | 非负整数 |
| `files[].mtimeMs` | 非负整数；自动备份的变化检测用它 |
| `files[].mode` | 可选；POSIX 权限位；win32 可省略 |
| `dirs[]` | 作用域内**全部目录**（含非空与空目录），排序后写入；恢复时 `mkdir -p` |
| `skipped[]` | `{ path, reason, detail? }`；`reason` 见 §5.3 |
| `totals.logicalBytes` | 所有文件大小之和（去重前） |
| `totals.uploadedBytes` | 本次实际新上传的 blob 字节数（去重后） |

**为什么 `dirs` 记录全部目录而不是只记空目录**：MinIO 下树要能画出空目录（`buildProjectFileTreeModel` 认尾分隔符），恢复时也要重建目录；只记空目录会让两份代码各判一次「哪些是空目录」。

### 4.4 `state.json`

```json
{
  "version": 1,
  "usageBytes": 3456789,
  "lastGcAt": 1760796000000,
  "autoPaused": { "reason": "quota", "since": 1760796000000 },
  "snapshots": [
    {
      "id": "20261018T140305123Z-a1b2c3",
      "kind": "manual",
      "scope": "资料/话单",
      "createdAt": 1760796185123,
      "createdBy": "u-7",
      "files": 128,
      "dirs": 3,
      "logicalBytes": 1234567,
      "uploadedBytes": 234567,
      "status": "complete"
    }
  ]
}
```

- `snapshots` 按 `createdAt` 降序；列表接口直接读它，不逐个读 manifest。
- `usageBytes` = 该项目命名空间下所有 blob 大小 + 所有 manifest 大小之和。
- `state.json` 写失败**不让备份失败**：manifest 已经写成功，快照就是有效的；记警告，下次状态查询重算。
- `state.json` 丢失/损坏：列 `manifests/` 与 `blobs/` 重建。重建逻辑只写一处。

### 4.5 压缩与外部可读性

- manifest 用 gzip；外部对账命令：

```bash
mc cat openhive/<userId>/_openhive-backups/<projectId>/manifests/<id>.json.gz | gunzip | jq .
mc cat openhive/<userId>/_openhive-backups/<projectId>/blobs/<ab>/<hash> | sha256sum
```

- 不用二进制私有格式：民警项目的规模（通常几千个文件）不需要；JSON 让外部工具能直接核。

### 4.6 快照 id 的生成

```
YYYYMMDDTHHMMSSmmmZ-<6 位随机十六进制>
```

- 前段是 UTC 时间，保证字典序 = 时间序；
- 后段防同毫秒碰撞；
- 同一 (user, project) 有单飞锁，正常不会并发产生两个 id。

---

## 5. 备份流程

### 5.1 触发与范围解析

| 入口 | 范围 | kind |
|---|---|---|
| 右键「备份到 MinIO」 | 右键那一项（文件或目录子树） | `manual` |
| 沙箱行拖到 MinIO 窗口/窄条 | 拖源那一项 | `manual` |
| 自动调度 | 整项目（`scope: ""`） | `auto` |

范围解析规则：

- 目录 ⇒ 遍历该子树；快照里的 `scope` 就是该目录路径。
- 文件 ⇒ 只处理该文件；`scope` 是该文件的父目录？还是文件本身？
  - **取文件本身**。`scope` 记录「用户选的是哪个路径」，列表过滤时按路径相交判断。
- 路径校验：每一段过 `assertSafeSegment`（拒绝空段、`.`、`..`、反斜杠、盘符、绝对路径、NUL）。
- 路径不存在 / 不是普通文件或目录 ⇒ 400，文案「要备份的文件或目录不存在」。

### 5.2 四个阶段

| 阶段 | 做什么 | 进度形式 |
|---|---|---|
| ① 扫描 | 递归遍历、记录目录与文件、排除临时文件、收集 size/mtime | **不确定**（总数未知），显示「正在扫描文件…」+ 已发现数 |
| ② 哈希 | 逐个文件流式 sha256；stat 前后比对，发现被改动就跳过 | **确定**：`已校验 45/128 · 1.2/3.4 GB` |
| ③ 上传 | 只上传「blob 不存在」的文件；4 并发、3 次重试 | **确定**：`正在备份 45/128 · 1.2/3.4 GB` |
| ④ 收尾 | 写 manifest、更新 `state.json`、写审计、触发保留/GC | **不确定**，文案「正在写入恢复点…」 |

- ② 与 ③ 是两遍读盘：先算哈希知道去重结果，再决定上传哪些。代价是读两遍；换来的是「上传前就知道总字节数」和「不会把已存在的 blob 重传」。
- 阶段之间进度**不倒退**：每个阶段有自己的 `bytesTotal`；UI 在同一次任务里把已完成阶段按权重折算成总进度，但文字始终显示当前阶段的分子/分母。
- 预计剩余时间：速度稳定 5 秒后才显示；波动大就只显示速度，不猜。

### 5.3 扫描与排除规则

递归 `readdir(withFileTypes)`：

- 记录**每一个目录**（含空目录）到 `dirs`；
- 普通文件进 `files`；
- **符号链接跳过**（目录本身是链接、条目是链接，都跳过），计入警告；
- 目录不存在 ⇒ 400「项目目录不存在」；自动备份静默跳过；
- 排除名单（单一来源 `backup-exclude.ts`，测试与运行共用）：

| 排除项 | 理由 |
|---|---|
| `.git/index.lock`、`.git/**/*.lock` | git 锁文件，备份它没有意义且可能阻塞恢复 |
| `.git/objects/pack/tmp_*` | git 临时包 |
| `*.tmp`、`*.swp`、`*.swo`、`*~` | 编辑器临时文件 |
| `.DS_Store`、`Thumbs.db`、`desktop.ini` | 系统垃圾 |
| `~$*` | Office 打开文档时的锁文件 |
| `.openhive-restore-*`、`.openhive-old-*` | 本 feature 自己的临时文件 |

- **不排除 `.git` 本身**；`.git` 内部除上述锁/临时文件外全部备份。
- 单个文件 > 5 GB ⇒ 跳过，`reason: "too-large"`。
- 读不了（EACCES / EBUSY / 被 Office 独占）⇒ 重试 3 次，仍失败则跳过，`reason: "unreadable"`。
- 任何跳过都让快照 `status: "partial"`，并在 UI 列出。

### 5.4 哈希与去重

- 流式 `sha256`（`createHash("sha256")`），不把大文件读进内存。
- 哈希前 `stat`，哈希后再次 `stat`；`size` 或 `mtimeMs` 变了 ⇒ 放弃这个文件，`reason: "changed-during-backup"`。**不备份半截文件。**
- 去重：
  - 先 `list({ prefix: "blobs/" })` 拿到现有 blob 的 `{hash, size}` 集合（分页走完）；
  - 哈希等于集合里已有的 ⇒ 不传，计入 `uploadedBytes` 的 0；
  - 同一个快照内多个文件内容相同 ⇒ 只传一次。
- **手动备份全量哈希**；自动备份对 `(path, size, mtimeMs)` 与上一份 manifest 完全相同的文件**复用上次哈希**，其余重新哈希（A8 的代价见 §12）。
- 去重只在**同一用户同一项目**内生效，不跨用户。

### 5.5 上传与重试

- 每个缺失 blob 一次 `PutObject`：
  - `Body` 是文件流（`createReadStream`），`ContentLength = size`；
  - 边读边计数，回调 `onProgress(bytesDelta)`；progress 更新节流 200ms；
  - 上传过程中再次算哈希：**与预期哈希不一致**（文件在哈希与上传之间被改）⇒ 删除刚上传的对象（避免污染），跳过该文件，`reason: "changed-during-backup"`；
  - 设置 `ContentType`（按扩展名，取不到就 `application/octet-stream`）。
- 重试：网络错误、5xx、429 ⇒ 最多 3 次，退避 1s / 2s / 4s；4xx（除 429）不重试，直接按失败处理。
- 超时：流式读写用**空闲超时**（30 秒没有新数据 ⇒ abort），不是总时长；另设 6 小时总上限兜底。
- 并发：4 个上传槽。任一文件最终失败 ⇒ 记入 `skipped`，快照仍可落 `partial`。

### 5.6 清单最后写

顺序写死：

```
扫描 → 哈希 → 上传（全部成功或已记 skipped）→ 写 manifest → 更新 state.json → 审计
```

- 到 `写 manifest` 之前，MinIO 里只有 blob；`list snapshots` 看不到这次备份。
- manifest 写失败 ⇒ 任务失败，**没有快照**；已上传的 blob 成为孤儿，由 GC 在 24 小时后回收。
- `state.json` 写失败 ⇒ 不影响快照有效性；记警告，下次状态查询重建。
- 审计写失败 ⇒ 记日志，不让备份失败（manifest 已经落了，此时报失败会让用户以为没备份）。

### 5.7 取消与失败

| 情况 | 行为 |
|---|---|
| 用户取消 | 置 `cancelRequested`；在文件之间检查；当前流 abort；**不写 manifest**；任务终态 `cancelled`；提示「已取消，未生成恢复点」 |
| 部分文件失败 | 重试后仍失败 ⇒ 写 `partial` manifest，`skipped` 列出原因；UI 标「部分完成」并列出跳过项 |
| manifest 写失败 | 任务 `failed`；无快照；可重试 |
| 进程崩溃 / 服务重启 | 无 manifest ⇒ 无快照；不会有假成功；UI 只看到上次成功的恢复点 |
| 项目被删除 | 删除流程先取消/等待该项目的任务，再清命名空间（见 §9.3） |

**为什么取消不写 partial manifest**：取消是用户的明确意图；写一个「部分快照」会让恢复点列表里出现一个用户以为自己取消了的东西。部分失败则不同——那是系统尽力后的结果，必须让用户看见缺了什么。

### 5.8 并发与单飞

- 锁的粒度：`(userId, projectId)`。
- 同一时刻只允许一个 job（backup / restore / preview）在该项目上跑。
- 第二个手动请求 ⇒ **409** `{ code: "job_running", jobId }`；UI 直接接上正在跑的那个，不新起一个。
- 自动备份遇到锁 ⇒ 跳过本轮，下个周期再试。
- 预览与恢复也走同一把锁：备份期间不恢复，恢复期间不备份（否则会拍到半恢复状态）。
- 项目删除要拿同一把锁；若锁被一个长任务占着，删除流程先请求取消并等待其收敛（有上限，超时则报错，不强行删）。

---

## 6. 恢复流程

### 6.1 入口与恢复点选择

两个入口：

1. **右键「从 MinIO 拉回」**：打开恢复对话框。对话框顶部是恢复点选择器，默认选中：
   - MinIO 下树当前显示的那个恢复点（如果有）；
   - 否则最新恢复点。
   - 选择器按 `path` 过滤：只列出**与所选路径相交**的恢复点（`scope` 是 `path` 的祖先、或 `path` 是 `scope` 的祖先、或相等）。
2. **从 MinIO 树拖到沙箱**：直接使用**当前显示的恢复点**和拖源路径，先跑预览：
   - 全部是 `missing` / `same` ⇒ 无需确认，直接恢复；
   - 存在 `different` / `type-mismatch` ⇒ 打开恢复对话框，路径预填，只显示该项。

### 6.2 预览（diff）

预览是一个 job（`kind: "preview"`），因为要对本地文件算哈希。

对快照内、`path` 子树下的每个文件：

| 本地状态 | 判定 |
|---|---|
| 不存在 | `missing` ⇒ 直接恢复 |
| 是目录（快照里是文件） | `type-mismatch` |
| 大小不同 | `different`（不必算哈希） |
| 大小相同 | 算本地 sha256：相同 ⇒ `same`；不同 ⇒ `different` |

同时统计 `localOnly`：本地有、快照里没有的文件。**它们不会被删除**，只在对话框里提示数量（最多列 100 条）。

结果：

```json
{
  "counts": { "missing": 3, "same": 120, "different": 2, "typeMismatch": 0, "localOnly": 5 },
  "entries": [
    { "path": "资料/话单/八月.csv", "status": "different", "localSize": 12000, "snapshotSize": 12345 }
  ],
  "localOnly": ["资料/新写的.txt"],
  "truncated": false
}
```

- `entries` 最多返回 2000 条；超出置 `truncated: true`，未列出的按**全局决策**处理。
- 预览任务可取消；关闭对话框即取消。
- 预览结果**不是承诺**：真正恢复前会对每个文件重新校验（预览与恢复之间用户可能改了文件）。

### 6.3 三选一与批量决策

对话框提供**全局决策**，默认「保留两者」（A2）：

| 决策 | 行为 |
|---|---|
| **覆盖** | 用快照版本替换本地文件；被替换的旧内容不保留 |
| **保留两者** | 本地文件不动；快照版本写成同目录下的新名字 |
| **跳过** | 本地文件不动，也不写新文件 |

- 每个冲突行可以单独改决策（覆盖全局）。
- `missing` 不受决策影响，总是恢复。
- `same` 总是跳过。
- `type-mismatch`（文件↔目录）只提供「覆盖」与「跳过」；「保留两者」禁用并说明原因（无法把一份内容同时变成文件与目录）。
- **保留两者的命名**：
  - 原名 `八月.csv` ⇒ `八月 (MinIO 2026-10-18 14-03-05).csv`；
  - 没有扩展名 ⇒ `报告 (MinIO 2026-10-18 14-03-05)`；
  - 目标已存在 ⇒ 追加 ` (2)`、` (3)`……直到不冲突；
  - 时间取快照的本地时间，精确到秒。
- 恢复前先创建 `dirs` 里的全部目录（`mkdir -p`）。

### 6.4 写盘次序与原子替换

每个文件：

1. 在目标同目录写临时文件 `.openhive-restore-<uuid>.tmp`；
2. 边写边算 sha256；
3. 写完与 manifest 的 `hash` 比对：
   - 不一致 ⇒ 删除临时文件，该文件失败（`blob-corrupt`）；
   - blobs 读不到 ⇒ 该文件失败（`blob-missing`）；
4. `fsync` 临时文件；
5. 若目标存在：先 rename 目标为 `.openhive-old-<uuid>`；
6. rename 临时文件到目标；
7. 删除 `.openhive-old-*`；
8. 第 6 步失败：尝试把 `.openhive-old-*` rename 回去，报错；
9. POSIX 上 `chmod` 到 manifest 的 `mode`；各平台 `utimes` 到 manifest 的 `mtimeMs`。

**为什么两步 rename**：Windows 上 `rename` 到已存在的目标会失败；先移走旧文件再 rename 新文件，失败时还能把旧文件移回来。其他平台同样安全。

- 并发 4 个文件。
- 目录先建；空目录也要建（`dirs` 里有）。
- **不写穿符号链接**：目标路径的任一中间段或目标本身是符号链接 ⇒ 跳过该文件（`reason: "symlink"`），不写。
- 恢复 `.git` 内部路径时，对话框额外提示「恢复 .git 内部文件可能让仓库状态不一致」；用户确认后才继续。

### 6.5 取消与部分完成

- 取消在文件之间检查；当前文件若还在写临时文件，abort 后删除临时文件。
- **已经替换成功的文件保留**，不回滚（回滚删除比保留更危险）。
- 结果逐条列出：`restored` / `overwritten` / `keptBoth` / `skipped` / `failed` / `dirsCreated`。
- UI 在取消后显示「已恢复 8 个文件，其余未动」，并列出失败的路径。

### 6.6 恢复不做什么

- **不删除**快照里没有、本地有的文件（`localOnly` 只提示）。
- **不移动**文件到别的目录（始终原路径）。
- **不恢复**符号链接。
- **不恢复** ACL / xattr / Windows 安全描述符。
- **不跨项目**：快照的 `projectId` 必须与请求一致。

---

## 7. 自动备份

### 7.1 触发模型：活动驱动

服务端维护一个内存里的活跃项目表：

```
active: Map<"<userId>/<projectId>", { lastSeenAt: number, lastAutoAt: number }>
```

- 前端在文件 Tab / 项目打开期间，每 **60 秒**调一次 `POST /openhive/project/backup/heartbeat`。
- 服务端定时器每 **60 秒**扫一遍：
  - `now - lastSeenAt > 30 分钟` ⇒ 视为不活跃，移出表；
  - 活跃 且 `now - lastAutoAt >= 1 小时` 且未被暂停 ⇒ 进入「检查是否有变化」。
- 文件写操作（建/改/删/上传/复制/移动/恢复）成功后，把该项目标记为「脏」，让下一次检查提前（但仍受 1 小时冷却约束）。
- 项目打开时也立即做一次检查：如果上次快照超过 1 小时且有变化，几秒内拍一张。

**为什么不做全量扫描**：服务端不知道所有用户的沙箱有多大；每 15 分钟扫所有项目会把磁盘打满。活动驱动只覆盖「正在干活的项目」，而没打开的项目不会通过本应用产生新变化；重新打开时会补拍。

### 7.2 变化检测

对活跃项目：

1. 选**最近一份整项目快照**（`scope: ""`）作为基线；没有任何整项目快照时，退回最新一份快照，并把该快照 scope 之外的路径一律视为「有变化」；
2. 读基线 manifest 的 `files`，建 `Map<path, {size, mtimeMs}>`；
3. 递归走一遍目录（只 stat，不读内容），与 map 比对：
   - 路径集合不同、size 不同、mtimeMs 不同 ⇒ 有变化；
4. 无变化 ⇒ 更新 `lastAutoAt`，不写新快照；
5. 有变化 ⇒ 跑一次 `kind: "auto"`、`path: ""` 的备份。

- 自动备份对未变化文件**复用上次哈希**（A8），只重新哈希变化的文件；这让每小时检查的成本接近一次目录遍历。
- 手动备份与归档链路**始终全量读**，兜住「内容变了但 mtime 没变」的极端情况。

### 7.3 单飞与冷却

- 自动备份与手动备份共用 `(userId, projectId)` 单飞锁。
- 手动备份成功也会更新 `lastAutoAt`，避免刚手动拍完又自动拍一张。
- 恢复成功后也标记为脏；下一次自动快照会记录恢复后的状态（这通常正是用户想要的）。
- 自动备份被取消 / 失败：更新 `lastAutoAt` 为「现在」还是「不更新」？
  - 失败 ⇒ **不更新**，下个周期重试；
  - 取消 ⇒ 更新，避免用户取消后每分钟又被弹一次。

### 7.4 与归档的关系

- 归档项目不做文件级自动备份：归档的 `backupAll` 已经是那个时刻的全量镜像。
- 归档时**不额外拍文件快照**：镜像与快照语义不同，多拍一份只会占空间。
- 归档后文件级备份/恢复禁用（A6）；项目找回（FR-009）是那个状态的出口。
- 项目从归档找回后，文件级快照仍然在；重新打开项目时可以继续看/恢复。

### 7.5 单实例假设

- 调度器与单飞锁都在**进程内存**里。
- 部署必须是**单内核实例**。多实例会出现两个调度器同时拍、两把锁互不知情。
- 多实例是明确缺口（§12），不在 v1 用 PG 咨询锁/队列去解决。

---

## 8. 保留、容量与回收

### 8.1 分级保留（只作用于 `kind: "auto"`）

按服务器本地时区（manifest 的 `timezone`）分桶：

| 年龄 | 保留 |
|---|---|
| 最近 24 小时 | 每个**小时**保留最新一张 |
| 1–30 天 | 每个**日**保留最新一张 |
| 31–84 天（12 周） | 每个**ISO 周**保留最新一张 |
| 超过 84 天 | 删除 |

补充规则：

- **永远保留最新一张自动快照**，即使它超过 84 天（否则长期不用的项目会一张不剩）。
- 手动快照**永远不参与自动删除**。
- 保留在每个快照成功后跑一次；另每天跑一次（处理「再也不拍新快照」的项目）。

### 8.2 手动恢复点

- 手动快照一直保留，直到用户显式删除。
- 每个恢复点在 MinIO 窗口的头部有「删除这个恢复点」入口（垃圾桶图标 + 确认框）。
- 删除只删 manifest（以及更新 `state.json`），blob 由 GC 回收。
- 删除写审计事件。

### 8.3 容量上限与暂停

- 上限：**每（用户×项目）10 GiB**（`10 * 1024 * 1024 * 1024`）。
- 用量 = 该命名空间下所有 blob 大小 + 所有 manifest 大小（`state.json` 可忽略）。
- 备份前估算：
  - 已知现有 blob 集合与大小；
  - 新字节 = 缺失 blob 的大小之和 + 预计 manifest 大小（`logicalBytes / 20` 的粗估，向上取整）。
- `usage + 新字节 > 上限`：
  - **自动**：跳过，写 `state.json.autoPaused = {reason: "quota"}`，UI 显示「自动备份已暂停：超出容量上限」；
  - **手动**：返回 **409** `{ code: "quota_exceeded", usageBytes, limitBytes, requiredBytes }`；UI 弹确认「本次备份将超出 10 GB 上限，自动备份会暂停，是否继续？」；用户确认后带 `allowOverQuota: true` 重试。
- **绝不为了腾空间自动删旧快照**。要腾空间只能：等分级保留按年龄删、或用户手动删恢复点。
- 恢复成功后如果用量仍超限，保持暂停；用量降回上限以下时，下一次自动检查自动解除暂停（`autoPaused` 清空）。

### 8.4 GC（无引用 blob 回收）

触发：每次保留删除了 manifest 之后；每天一次定时；项目删除时不需要（整命名空间删）。

算法：

1. 列出 `manifests/`，逐个读 manifest，收集全部 `hash` 到引用集合；
2. 列出 `blobs/`（带 `lastModified`）；
3. 对每个 blob：不在引用集合 且 `lastModified < now - 24 小时` ⇒ 删除；
4. 更新 `state.json.usageBytes` 与 `lastGcAt`；
5. 写审计（删了多少、释放多少字节）。

- **24 小时宽限期**：正在跑的备份可能已经传了 blob、还没写 manifest；GC 不能把它们当孤儿删掉。
- **fail-closed**：任一 manifest 读不了 / 校验不过 ⇒ **跳过本轮，不删任何 blob**。宁可留下孤儿，也不能把还被引用的内容删掉。
- GC 与备份/恢复**共用单飞锁**；有活跃任务时跳过本轮。
- GC 失败不影响快照有效性；记日志，下次再跑。

### 8.5 删除恢复点

- 删除 manifest → 从 `state.json.snapshots` 移除 → 更新用量 → 触发 GC（异步）。
- 删除是幂等的：manifest 已经不在了 ⇒ 返回成功。
- 删除手动快照前必须确认；自动快照也可以手动删（用于腾空间），同样确认。

---

## 9. 权限、隔离与审计

### 9.1 授权

每个备份/恢复/预览/取消请求：

1. 有会话身份，否则 401；
2. `projectId` 是合法路径段；
3. 调用者是该项目 `project_member` 的成员，否则 **403**（文案不区分「不是成员」与「项目不存在」，避免信息泄漏）；
4. 项目未归档，否则 **403**「项目已归档，请使用项目找回」；
5. MinIO 已配置，否则 **503**（授权检查在配置检查之前，避免未授权者读出部署状态）；
6. 任务/快照的 `userId` 必须等于调用者，否则 **404**（不是 403，避免泄漏存在性）。

### 9.2 物理隔离

- 键前缀的 `{userId}` 永远等于**沙箱归属者**，不是「发起请求的人」。
- 文件级备份只由用户为自己的沙箱触发，因此发起者 = 归属者。
- owner 不能替成员拍文件快照，也不能读成员的快照。
- 桶策略仍以 `${aws:username}/*` 为最终防线；应用层的 scope 构造是第二道。

> ⚠️ 服务端静态凭据可以写任意前缀（D-13 未裁定）。文件级备份没有扩大这个缺口，但也没有闭合它；最终凭据模型仍归 D-13。

### 9.3 审计表

新增迁移 `packages/auth/src/migrations/0007_project_backup_event.sql`：

```sql
CREATE TABLE IF NOT EXISTS auth.project_backup_event (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  project_id   TEXT        NOT NULL,
  action       TEXT        NOT NULL, -- backup / restore / preview / delete_snapshot / gc
  snapshot_id  TEXT,
  scope        TEXT        NOT NULL DEFAULT '',
  kind         TEXT,                 -- manual / auto / null
  files        INTEGER     NOT NULL DEFAULT 0,
  bytes        BIGINT      NOT NULL DEFAULT 0,
  result       TEXT        NOT NULL, -- ok / partial / failed / cancelled
  error_code   TEXT,
  duration_ms  INTEGER     NOT NULL DEFAULT 0,
  created_at   BIGINT      NOT NULL
);
CREATE INDEX IF NOT EXISTS project_backup_event_project_time
  ON auth.project_backup_event (project_id, created_at DESC);
```

- 只记路径/大小/哈希统计，**不记文件内容**。
- 自动备份的 `user_id` 是沙箱归属者。
- 审计写失败：记日志，不让业务失败（见 §5.6）。

### 9.4 日志与指标

每次备份/恢复记录：

- `logicalBytes`（逻辑大小）、`uploadedBytes`（实际上传）、`dedupSavedBytes = logical - uploaded`；
- 各阶段耗时（扫描/哈希/上传/收尾）；
- `files`、`dirs`、`skipped`、`warnings`；
- 恢复：`restored` / `overwritten` / `keptBoth` / `skipped` / `failed`。

这些指标用于回答两个问题：

1. **空间有没有失控**（去重率、用量增长）；
2. **恢复是不是真的**（文件数、字节数、失败数）。

### 9.5 路径与清单安全

- 客户端传来的 `path`：每一段过 `assertSafeSegment`；拒绝绝对路径、`..`、`.`、反斜杠、盘符、NUL、空段。
- 从 MinIO 读到的 manifest 视为**不可信输入**：逐条校验 `version` / `projectId` / `ownerId` / 每个路径段 / 每个 hash；不合法 ⇒ 拒绝整个快照（`manifest-invalid`），不部分恢复。
- 恢复写盘前再次校验路径，并用 `join(projectDirectory, ...segments)` 拼接；**不对用户输入做 `resolve`**。需要比较「是否还在项目根内」时，两边先统一 `realpath` 再比（win32 长短名 / 8.3 短名问题，`LEARNINGS #006-23`）。
- 不跟随符号链接；目标路径的任一中间段或目标本身是符号链接 ⇒ 拒绝写入。
- 写入的临时文件名固定前缀 `.openhive-restore-`，不会与用户文件冲突（同时被排除名单挡在备份外）。

---

## 10. 接口

### 10.1 端点表

全部挂在 `/openhive/project` 下（复用 `PREFIX`，不重抄字面量）。

| 方法 | 路径 | 作用 | 成功 |
|---|---|---|---|
| POST | `/backup` | 启动手动备份 `{projectId, path?, allowOverQuota?}` | 202 `{jobId}` |
| POST | `/backup/heartbeat` | 标记项目活跃 `{projectId}` | 204 |
| GET | `/backup/status?projectId=` | 当前任务 + 上次快照 + 用量 + 暂停状态 | 200 |
| GET | `/backup/snapshots?projectId=&path=` | 恢复点摘要列表（按时间降序） | 200 `{snapshots, truncated}` |
| GET | `/backup/snapshots/{snapshotId}?projectId=` | 单个恢复点的文件/目录清单 | 200 |
| DELETE | `/backup/snapshots/{snapshotId}?projectId=` | 删除一个恢复点 | 200 `{deleted}` |
| POST | `/backup/restore/preview` | 启动预览 `{projectId, snapshotId, path?}` | 202 `{jobId}` |
| POST | `/backup/restore` | 启动恢复 `{projectId, snapshotId, path?, decisions}` | 202 `{jobId}` |
| GET | `/backup/jobs/{jobId}` | 查任务进度/结果 | 200 |
| POST | `/backup/jobs/{jobId}/cancel` | 请求取消 | 202 `{cancelling}` |

> 注意：`projectId` 出现在查询串与请求体，不出现在 URL 路径段。与现有 fork 出口一致（没有 `:id` 路由先例），也避免路径穿越。

### 10.2 任务模型与状态机

```ts
interface Job {
  id: string
  projectId: string
  userId: string
  kind: "backup" | "restore" | "preview"
  path: string
  snapshotId?: string
  state:
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
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  currentPath?: string
  speedBytesPerSec?: number
  etaSeconds?: number
  startedAt: number
  updatedAt: number
  finishedAt?: number
  error?: { code: string; message: string }
  result?: unknown
  cancelRequested: boolean
}
```

- 备份：`queued → scanning → hashing → uploading → committing → succeeded`；
- 预览：`queued → previewing → succeeded`；
- 恢复：`queued → restoring → succeeded`；
- 任一活动态 → `failed` / `cancelled`。
- 任务在内存里；完成后再保留 **10 分钟**供 UI 取结果，然后淘汰。持久记录是 manifest 与审计表。
- `GET`/`cancel` 校验 `job.userId === 调用者`；否则 404。

### 10.3 错误码

| 状态 | `code` | 场景 |
|---|---|---|
| 400 | `bad_request` | 缺 projectId / 路径不合法 / 路径不存在 |
| 401 | — | 没有会话 |
| 403 | `forbidden` | 不是成员 / 项目已归档 |
| 404 | `not_found` | 快照/任务不存在，或不属于调用者 |
| 409 | `job_running` | 同项目已有任务，附 `jobId` |
| 409 | `quota_exceeded` | 手动备份超出上限且未确认 |
| 503 | `minio_unconfigured` | 五个变量没配齐 |
| 500 | `internal` | 其他 |

- 错误响应统一 `{ error: string, code: string, ...detail }`。
- 503 的文案与既有归档一致：「MinIO 未配置，备份不可用」。

### 10.4 轮询与重连

- 任务活动时 UI 每 **1 秒** `GET /jobs/{jobId}`。
- 页面刷新 / 切换项目回来：先 `GET /backup/status`，若 `activeJob` 非空就接上同一个 `jobId`。
- 任务完成后：刷新 `GET /backup/snapshots` 与 `GET /backup/status`。
- 任务已被淘汰（404）：UI 退回「刷新恢复点列表」，不显示假的进度。

### 10.5 为什么是 job 而不是一次长请求

- 备份/恢复/预览都可能跑几分钟；
- 需要**进度、取消、离开页面后继续**；
- HTTP 长请求在反代/浏览器上都有超时；job + 轮询是最稳的形状；
- 取消是协作式的，不是断开连接（断开不代表用户想取消）。

---

## 11. 界面

### 11.1 右键菜单

- `file-tree.tsx`：
  - `onBackup(path)` 接到 `workspace-entry`，点击后**立即启动**备份，不弹确认；底部窄条变成进度条。
  - `onRestore(path)` 接到 `workspace-entry`，点击后**打开恢复对话框**（选恢复点 → 预览 → 决策）。
  - 两项的禁用判据保持「没接线 / 没作用对象就禁用」。
- 右键目录也允许备份/恢复整棵子树（现有注释已说明服务端会拒非法情况，这里由服务端决定）。

### 11.2 双树与恢复点选择器

MinIO 下树从「扁平路径清单」升级为「某个恢复点的文件树」：

- 头部新增恢复点选择器（原生 `<select>`，v1 用原生控件，避免再引入一套浮层）：

```
☁ MinIO 备份  [ 整项目 · 2026-10-18 14:03 · 自动 · 128 个文件 ▾ ]  [🗑] [✕]
```

- 选项文案：
  - `整项目 · 2026-10-18 14:03 · 自动 · 128 个文件`
  - `资料/话单 · 2026-10-18 13:10 · 手动 · 24 个文件`
- 默认选最新恢复点（A9）。
- 选中某个恢复点后，下树显示它的 `files` + `dirs`（空目录用尾 `/` 喂给 `buildProjectFileTreeModel`）。
- 空态三态：
  - `undefined` = 还没加载/没接数据源 ⇒「备份清单未接入」；
  - `[]` = 明确没有恢复点 ⇒「还没有备份」；
  - 选中了恢复点但它没有文件 ⇒「这个恢复点里没有文件」。
- 头部显示用量：「已用 3.2 / 10 GB」；超限暂停时显示警告图标 + 文案。
- 删除按钮：垃圾桶图标，确认框，删除当前选中恢复点。

### 11.3 拖拽矩阵

| 拖源 | 落点 | 动作 | 载荷 |
|---|---|---|---|
| 沙箱文件/目录 | MinIO 窗口任意位置 / 底部窄条 | 备份**拖源本身**，保持原路径 | `text/plain: file:<path>`（沿用现有，供会话框引用） |
| MinIO 文件/目录 | 沙箱树任意位置 | 从**当前恢复点**拉回**拖源本身**，保持原路径 | `text/plain: minio:<path>`（**新**） |
| 沙箱文件 | 会话输入框 | 插入路径引用（现有） | `file:<path>` |
| 本地电脑 | 沙箱树 | 上传（现有） | 文件 |
| 沙箱 | 本地电脑 | 下载（现有，挂账） | — |

实现要点：

- **删掉 `拼路径`**：拖拽落点不再决定目标目录；`onBackup(path)` / `onRestore({path, snapshotId})` 收到的就是拖源路径。
- MinIO 行起拖写 `minio:`，不再写 `file:`；会话框只认 `file:`，于是云上备份不会被误插成本地引用。
- 底部窄条是独立落点（它在 `DualFileTree` 之外）：`MinioBar` 自己接 `onDragOver`/`onDrop`，从 `dataTransfer` 读 `file:` 载荷并回调 `onBackup`。
- 多选拖拽 v1 不做；一次只拖一行。
- **没有选中恢复点时，MinIO → 沙箱不可放**（光标显示禁止，提示「还没有备份」）；「从 MinIO 拉回」菜单项同样禁用，不打开一个空对话框。
- 拖到沙箱时有冲突 ⇒ 走恢复对话框（预填拖源路径）；无冲突 ⇒ 直接恢复。

### 11.4 恢复对话框

新组件 `packages/app/src/project/backup-restore-dialog.tsx`，复用现有 `Dialog`：

1. **恢复点**：下拉选择（按路径过滤）。
2. **预览中**：进度条 + 「正在比对本地文件…」，可取消。
3. **预览结果**：
   - 摘要：`缺失 3 · 相同 120 · 不同 2 · 类型冲突 0`；`本地另有 5 个文件不在恢复点里（不会删除）`。
   - 冲突列表（可滚动，最多 2000 行，超出提示「只显示前 2000 条，其余按全局决策」）。
   - 每行：路径、本地/快照大小、决策下拉。
4. **全局决策**：覆盖 / 保留两者（默认）/ 跳过。
5. **开始恢复**：按钮；点击后对话框切到进度视图。
6. **进度**：阶段、`已恢复 8/20`、当前文件、取消按钮。
7. **结果**：成功/失败/保留两者清单；失败的逐条列出；对话框可关闭，窄条接管。

关闭对话框不取消正在跑的恢复（进度转到窄条）；若还在预览阶段，关闭即取消预览。

### 11.5 进度条与底部窄条

底部窄条是**主要进度面**（常驻、跨 tab 可见）：

```
空闲：  ☁ MinIO 备份 · 上次 3 分钟前 · 128 项
备份中：☁ MinIO 备份 · 正在备份 45/128 · 1.2/3.4 GB        [取消]
校验中：☁ MinIO 备份 · 正在校验 45/128 · 1.2/3.4 GB        [取消]
扫描中：☁ MinIO 备份 · 正在扫描文件…（已发现 87 个）        [取消]
收尾：  ☁ MinIO 备份 · 正在写入恢复点…                      [取消]
失败：  ☁ MinIO 备份 · 上次备份失败 · 2 个文件被跳过        [查看]
暂停：  ☁ MinIO 备份 · 自动备份已暂停：超出 10 GB 上限
```

- 窄条顶部一条 **2px 进度线**：确定时按百分比；不确定时来回滑动（不是假百分比）。
- **HTML 结构要改**：现在的窄条整体是一个 `<button>`；进度态里要放「取消」按钮，不能嵌套 `<button>`。改成：
  - 外层 `<div data-component="minio-bar" role="group">`；
  - 主区域是一个 `<button>`（点它展开双树）；
  - 可选取消按钮是兄弟 `<button>`；
  - 进度线是一个 `<span role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow=...>`。
- MinIO 窗口头部显示更详细的信息：当前阶段、当前文件、速度、可选 ETA、取消。
- 自动备份：窄条显示「自动备份中…」，不弹窗、不抢焦点；失败时显示警告图标，点开看详情。
- 完成：窄条回到空闲态；若 MinIO 窗口开着，刷新恢复点列表并选中新恢复点。
- **不用 toast**：本仓 toast 有 v1/v2 两套渲染（`LEARNINGS #005-39`），且备份是长动作，toast 会消失。窄条 + 窗口足够。

### 11.6 空态、错误与文案

| 场景 | 文案 |
|---|---|
| MinIO 未配置 | 「MinIO 未配置，备份不可用」 |
| 项目已归档 | 「项目已归档，请使用项目找回」 |
| 没有恢复点 | 「还没有备份」 |
| 没有数据源 | 「备份清单未接入」 |
| 任务已在跑 | 「这个项目正在备份，已接上当前进度」 |
| 配额超限（手动） | 「本次备份将超出 10 GB 上限，自动备份会暂停，是否继续？」 |
| 配额超限（自动） | 「自动备份已暂停：超出 10 GB 上限」 |
| 取消备份 | 「已取消，未生成恢复点」 |
| 取消恢复 | 「已恢复 8 个文件，其余未动」 |
| 部分完成 | 「部分完成 · 2 个文件被跳过」+ 列表 |
| 恢复校验失败 | 「文件校验失败：<path>（blob 与清单不一致）」 |
| 网络/服务不可达 | 「备份服务连不上，请重试」 |
| `.git` 内部恢复 | 「恢复 .git 内部文件可能让仓库状态不一致，是否继续？」 |

### 11.7 无障碍

- 进度线/进度条：`role="progressbar"`、`aria-valuemin`、`aria-valuemax`、`aria-valuenow`（不确定时省略 `aria-valuenow`）、`aria-label`。
- 取消按钮：`aria-label="取消备份"` / `"取消恢复"`。
- 恢复点选择器：`aria-label="选择恢复点"`；每个选项的可读文案包含时间、类型、文件数。
- 对话框：焦点陷阱由现有 Dialog 组件负责；标题、描述、按钮均有可读名。
- 状态变化（任务完成/失败）用 `role="status"` 或 `role="alert"`，不要只靠颜色。
- 键盘：菜单项、选择器、取消按钮都可 Tab 到达。

---

## 12. 失败边界与缺口（不藏着）

| # | 缺口/边界 | 影响 | 处置 |
|---|---|---|---|
| 1 | 本机没有真实 MinIO（`minio.md` 文件头） | 真实桶策略、STS、跨用户写权限**验不了** | 本机用 `fake-s3` 验请求形状；真实环境验证明细落 D-13 |
| 2 | 多实例部署 | 两个调度器 / 两把锁互不知情，可能重复备份；**删除也只取消本进程可见的任务**（别的实例上的任务照常跑） | v1 假设单实例；缺口登记，后续用 PG 咨询锁或任务队列 |
| 3 | 服务重启 | 内存里的 job 丢失；备份中断 | 无 manifest ⇒ 无快照，不会假成功；UI 显示上次成功时间，用户重试 |
| 4 | 单文件 > 5 GB | 跳过，快照 `partial` | v1 明确提示；后续用 multipart |
| 5 | 符号链接 | 不备份、不恢复 | 警告计数；不假装覆盖 |
| 6 | ACL / xattr / Windows 安全描述符 | 不保留 | 只保留常规权限位与 mtime；登记 |
| 7 | 无客户端加密；SSE 默认不开 | 内网 MinIO 之外的对象存储不可直接用 | 部署侧开启 SSE；登记 |
| 8 | 不做跨用户去重 | 同一份文件每个用户各存一份 | 物理隔离的代价；接受 |
| 9 | 自动备份只覆盖活跃项目 | 关闭应用后项目不再自动拍 | 重新打开时补拍；归档镜像兜底 |
| 10 | 自动备份的 mtime 缓存 | 内容变了但 size/mtime 都没变的文件可能漏拍 | 手动备份/归档全量读；恢复演练兜底；登记 |
| 11 | `/shared/{projectId}.git` 不备份 | 共享 bare 仓库不在任何人的快照里 | 既有缺口（归档也不搬它）；不在本 feature 闭合 |
| 12 | 预览结果可能过期 | 预览与恢复之间用户改了文件 | 恢复时逐文件重新校验；结果里标 `changed-since-preview` |
| 13 | 任务结果只在内存保留 10 分钟 | 超时后 UI 取不到结果 | 持久记录是 manifest 与审计表；UI 刷新恢复点列表 |
| 14 | 恢复点列表最多 200 条 | 手动快照极多时列表截断 | 返回 `truncated`；用户删除旧恢复点 |
| 15 | 没有跨项目恢复 | 只能回原项目 | 明确不做 |
| 16 | 进度是轮询，不是推送 | 1 秒粒度 | 对民警场景足够；不引入 SSE |
| 17 | 服务端不校验文件内容是否敏感 | 备份内容与沙箱一致 | 权限与桶策略负责；不做内容扫描 |
| 18 | 已退出成员的 `_openhive-backups` 命名空间永久保留 | 删除只遍历当前 `project_member` ⇒ 退出成员的快照前缀不被清、也没人再能看到它 | **既有缺口、本 feature 未扩大未闭合**（与 007 spec §11 缺口 20 同源） |

---

## 13. 测试与验收

### 13.1 分层

| 层 | 位置 | 验什么 |
|---|---|---|
| 存储层 | `packages/core/test/minio.test.ts`（扩展） | 前缀形状、`head`、`list({prefix})`、流式 put/get、进度回调、超时、路径守卫 |
| 服务层 | `packages/opencode/test/server/openhive-backup.test.ts`（新） | 备份/恢复/预览/保留/GC/配额/审计/权限/单飞 |
| 组件层 | `packages/app/src/project/*.test.tsx`（扩展/新增） | 菜单、拖拽载荷、原路径、恢复对话框、恢复点选择器、进度条、窄条结构、空态、无障碍 |
| 真栈 | `packages/app/e2e/real-stack/backup-snapshot-real.spec.ts`（新） | 端到端：备份 → 删改 → 拉回 → 逐字节比对；拖拽；进度；取消 |

### 13.2 服务端用例（每条走红→绿，变异验证）

**存储层**

1. backup store 的键前缀是 `{userId}/_openhive-backups/{projectId}/...`；归档 store 不变。
2. `head` 对存在的键回 true，对 `NoSuchKey` 回 false；403/500 上抛。
3. `list({prefix: "manifests/"})` 只返回清单；分页超过 1000 条时走完。
4. `list()` 返回 `{path, size, lastModified}`。
5. 流式 `put` 的 `onProgress` 单调递增，总和等于 size。
6. 流式 `get` 在空闲 30 秒后 abort，不无限挂起。
7. `assertSafeSegment` 拒绝空段、`.`、`..`、NUL、反斜杠、盘符、绝对路径。

**备份**

8. 备份单文件：manifest 只含该文件；blob 键是 `blobs/<前2位>/<hash>`。
9. 备份目录：manifest 只含该子树；路径是项目相对路径；空目录进 `dirs`。
10. 快照语义：备份 → 删本地文件 → 再备份；第一份 manifest 仍含该文件，blob 仍在。
11. 去重：两份快照含同一文件；第二次 `uploadedBytes = 0`，blob 只 PUT 一次。
12. 清单最后写：manifest PUT 失败 ⇒ 快照列表为空，无法恢复。
13. 取消：上传中途取消 ⇒ 无 manifest，快照列表不变。
14. 部分失败：一个文件读不了 ⇒ 写 `partial` manifest，`skipped` 含该文件。
15. 哈希前后 stat 变化 ⇒ 跳过该文件，不写半截 blob。
16. 排除名单：`.git/index.lock`、`~$报告.docx`、`.DS_Store` 不进 manifest。
17. `> 5 GB` 文件跳过并记 `too-large`（用 mock/稀疏文件或把上限注入成小值）。
18. 路径不存在 ⇒ 400；路径含 `..` ⇒ 400。
19. 单飞：同项目第二个 backup ⇒ 409 带 `jobId`。
20. 另一用户不能 GET/cancel 该 job ⇒ 404。

**恢复**

21. `missing` 恢复；`same` 跳过；`different` 按全局决策覆盖/保留两者/跳过。
22. `keep-both` 生成 `名 (MinIO 时间).扩展`；再冲突追加 ` (2)`。
23. `type-mismatch` 只允许覆盖/跳过；覆盖时旧文件被移走并报告。
24. 恢复不删除 `localOnly`。
25. 空目录恢复。
26. blob 内容与 manifest 哈希不一致 ⇒ 该文件失败，目标不被替换。
27. manifest 含 `..` 路径 ⇒ 拒绝整个快照，不写任何文件。
28. 恢复中途取消 ⇒ 已完成的文件保留，结果列出。
29. 恢复时目标文件被占用（win32）⇒ 重试后失败，旧文件不丢。
29a. 目标路径的中间段或目标本身是符号链接 ⇒ 跳过该文件（`symlink`），不写穿。

**自动/保留/GC/配额/审计/删除**

30. 自动检查：无变化不拍；有变化拍；1 小时冷却。
30a. 变化检测以最近一份整项目快照为基线；最新快照是单文件/单目录时，scope 外的路径视为变化。
31. 未变化文件复用哈希（测试注入可观测的“是否读过内容”计数）。
32. 保留：构造跨 24 小时/30 天/12 周的快照，跑保留，断言保留集合。
33. 手动快照不参加保留删除。
34. 配额：自动超限 ⇒ `autoPaused`；手动超限未确认 ⇒ 409；确认后成功。
35. GC：无引用且超 24 小时的 blob 删除；有引用保留；新孤儿保留。
35a. GC 遇到读不了 / 校验不过的 manifest ⇒ 跳过本轮，不删任何 blob（fail-closed）。
36. 删除恢复点：manifest 删除、列表更新、可重入。
37. 审计：备份/恢复/取消/失败各写一行，字段正确。
38. 项目删除：清归档前缀 + 备份前缀；再删一次不报错；MinIO 未配时仍可删项目。
39. 归档项目：备份/恢复 ⇒ 403。

### 13.3 前端用例

40. 沙箱行起拖载荷是 `file:<path>`；MinIO 行起拖载荷是 `minio:<path>`（**钉住现有缺陷**）。
41. 沙箱 → MinIO 放下：回调收到**拖源原路径**，不是鼠标所在目录拼出来的路径。
42. MinIO → 沙箱放下：回调收到 `{path: 拖源路径, snapshotId: 当前选择的恢复点}`。
43. 旧内联「确定覆盖？」条不再出现；有冲突时打开恢复对话框。
44. 恢复点选择器切换 ⇒ 下树文件列表更新。
45. 下树空态三态各自正确。
46. 窄条：进度态显示 `role="progressbar"`、`aria-valuenow` 在 0–100；取消按钮可点；结构与主按钮**不是嵌套按钮**。
47. 窄条是有效拖放落点：拖入 `file:` 载荷触发备份回调。
48. 恢复对话框：预览中 → 结果 → 决策 → 恢复进度；关闭预览取消任务。
49. 无障碍：进度条 label、取消按钮 label、选择器 label。
50. 归档项目的 MinIO 树：恢复入口禁用并显示归档文案。

### 13.4 真栈 e2e（`backup-snapshot-real.spec.ts`）

用真内核 + 一个 `Bun.serve` 的假 S3 端点（真 AWS SDK 发请求）配置 `OPENHIVE_MINIO_*`：

1. 建项目、写文件（含嵌套、空目录、二进制、`.git`）。
2. 打开文件 Tab → 右键目录 → 备份到 MinIO。
3. 断言窄条出现进度、`aria-valuenow` 从 0 走到 100；假 S3 收到 `{userId}/_openhive-backups/{projectId}/blobs/...` 与 `manifests/...`。
4. MinIO 窗口出现恢复点，文件树正确。
5. 删除/改写本地文件。
6. 从恢复点拉回：预览、选择「覆盖」、恢复。
7. 通过内核文件接口逐字节比对内容。
8. 拖拽：把文件拖到 MinIO 窗口的**另一个目录行**上，断言备份路径仍是原路径。
9. 冲突：本地同名不同内容 → 选择「保留两者」→ 两个文件都在。
10. 取消：用限速钩子让上传变慢，点取消 → 无新恢复点。
11. 刷新页面 → 窄条接上正在跑的任务（或显示上次结果）。

### 13.5 外部工具对账（部署环境）

本机没有真实 MinIO，以下步骤写在部署验收清单里：

```bash
# 1. 对象都在
mc ls --recursive openhive/<userId>/_openhive-backups/<projectId>/

# 2. 清单可读
mc cat openhive/<userId>/_openhive-backups/<projectId>/manifests/<id>.json.gz | gunzip | jq '.totals'

# 3. blob 内容与清单哈希一致
mc cat openhive/<userId>/_openhive-backups/<projectId>/blobs/<ab>/<hash> | sha256sum
# 输出应为 <hash>  -

# 4. 外部对账：rclone
rclone check /path/to/restored openhive:openhive/<userId>/_openhive-backups/<projectId>/blobs --size-only
```

### 13.6 验收标准

| ID | 判据 |
|---|---|
| **AC-F5-01** | 备份单个文件：恢复点只含该文件，blob 键按内容寻址。 |
| **AC-F5-02** | 备份目录子树：只含子树内文件；路径全是项目相对路径；空目录出现在 `dirs`。 |
| **AC-F5-03** | 删除本地文件后，**旧恢复点仍能恢复它**（快照不是镜像）。 |
| **AC-F5-04** | 恢复不删除本地新增文件；对话框明确提示「不会删除」。 |
| **AC-F5-05** | 相同内容跨快照只存一份；第二次备份未变化文件的 `uploadedBytes` 为 0。 |
| **AC-F5-06** | manifest 写失败 ⇒ 恢复点列表不出现这次备份，无法恢复。 |
| **AC-F5-07** | 冲突三选一：覆盖、保留两者、跳过各自的结果可观测且正确。 |
| **AC-F5-08** | 恢复前校验 sha256；blob 损坏 ⇒ 明确失败，不写坏文件。 |
| **AC-F5-09** | manifest 里的 `..` / 绝对路径被拒；不在项目目录外写任何文件。 |
| **AC-F5-10** | 备份中途取消 ⇒ 无新恢复点；窄条显示「已取消」。 |
| **AC-F5-11** | 恢复中途取消 ⇒ 已恢复文件保留；结果逐条列出；不删本地文件。 |
| **AC-F5-12** | 进度单调；大文件有字节级中间态；不确定阶段不显示假百分比。 |
| **AC-F5-13** | 离开文件 Tab / 刷新页面后能接上正在跑的任务。 |
| **AC-F5-14** | 拖到 MinIO 任意位置都保持原路径；MinIO 行载荷是 `minio:`，不会被会话框误认成本地文件。 |
| **AC-F5-15** | 自动备份有变化才拍、最快每小时一次、不打断用户。 |
| **AC-F5-16** | 分级保留正确；手动快照不被自动删；超限只暂停、不静默删。 |
| **AC-F5-17** | 用户 A 看不到/恢复不了用户 B 的快照；owner 看不到成员的快照。 |
| **AC-F5-18** | 删除项目清备份命名空间且可重入；MinIO 未配时项目仍可删。 |
| **AC-F5-19** | 备份/恢复/取消/失败各写审计行，字段正确。 |
| **AC-F5-20** | 恢复演练：生成树 → 备份 → 删改 → 恢复 → 逐字节一致。 |
| **AC-F5-21** | 恢复点选择器切换后下树正确更新；三种空态正确。 |
| **AC-F5-22** | 进度条/取消按钮/选择器/对话框有可读的无障碍名。 |

### 13.7 完成判据（命令 + 实得输出）

在仓库根或受影响 package 内跑（根目录 `bun test` 被脚本禁止）：

```bash
# 存储层
cd packages/core && bun test test/minio.test.ts

# 服务层
cd packages/opencode && bun test test/server/openhive-backup.test.ts

# 前端组件
cd packages/app && bun test src/project/dual-file-tree.test.tsx src/project/minio-bar.test.tsx src/project/backup-restore-dialog.test.tsx

# 真栈
cd packages/app && bunx playwright test e2e/real-stack/backup-snapshot-real.spec.ts

# 门禁
bun run typecheck
bun run lint
```

- 每条判据报告**实得输出**（pass 数、fail 数、关键断言值）。
- `bun run lint` 的全局退出码天生为 1（`LEARNINGS #001-02`），只报受影响文件是否有新增 error/warning。
- `bun install` 后必须 `git diff --stat bun.lock` 为空（本设计**不新增依赖**）。

### 13.8 变异验证清单（④ 步）

| 变异 | 应红 |
|---|---|
| 把 manifest 写入挪到上传之前 | AC-F5-06 的用例 |
| 去掉 blob 去重（总是上传） | AC-F5-05 的用例 |
| 去掉恢复前的哈希校验 | AC-F5-08 的用例 |
| 把恢复写成“先删本地再写” | AC-F5-04 的用例 |
| 把 `minio:` 载荷改回 `file:` | 前端拖拽载荷用例 |
| 把 `拼路径` 恢复回来 | AC-F5-14 的用例 |
| 去掉单飞锁 | AC-F5-19 的 409 用例 |
| 去掉用户校验 | AC-F5-17 的用例 |
| 把保留策略改成“按数量删” | AC-F5-16 的用例 |
| 去掉 24 小时 GC 宽限 | GC 用例 |

变异记录按 `LEARNINGS #003-03` 三类据实写：恰红、假绿（并说明原因）、红得比预期多（并说明射程）。

---

## 14. 落点清单（文件级）

### 14.1 新增

| 文件 | 作用 |
|---|---|
| `packages/opencode/src/server/openhive/backup.ts` | 备份/恢复/预览/保留/GC/配额/审计的核心服务与 HTTP 出口 |
| `packages/opencode/test/server/openhive-backup.test.ts` | 服务层测试 |
| `packages/auth/src/migrations/0007_project_backup_event.sql` | 审计表（按 `migrations/README.md`：语句之间用 `--> statement-breakpoint`；不写 `CONCURRENTLY`） |
| `packages/auth/src/migrations/0007_project_backup_event.down.sql` | 回滚：`DROP TABLE IF EXISTS auth.project_backup_event` |
| `packages/app/src/project/openhive-backup.ts` | 前端 HTTP 客户端（backup/restore/snapshots/jobs/heartbeat） |
| `packages/app/src/project/backup-restore-dialog.tsx` | 恢复对话框 |
| `packages/app/src/project/backup-restore-dialog.test.tsx` | 对话框测试 |
| `packages/app/e2e/real-stack/backup-snapshot-real.spec.ts` | 真栈 e2e |

### 14.2 修改

| 文件 | 改什么 |
|---|---|
| `packages/core/src/minio.ts` | `Scope.namespace`；`head`；`list({prefix})` 返回 `{path,size,lastModified}`；`putStream`/`getStream` + 进度；流式空闲超时；`assertSafeSegment` 补 NUL/`.`/空段 |
| `packages/core/test/minio.test.ts` | 上述存储层用例 |
| `packages/opencode/src/server/openhive/archive.ts` | `dropBackups` 增加备份命名空间的清理（保持可重入；MinIO 未配跳过） |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | **加一段** `OpenhiveBackup.routes.pipe(...)`，供 `MinioConfig` / `OpenhivePg` / `AnchorWorkspace.Config`（照 `OpenhiveArchive` 的形状） |
| `packages/app/src/project/minio-backups.ts` | 从“路径清单”升级为“恢复点状态”（快照列表 + 当前选择 + 文件/目录 + 任务状态）；保留 `undefined` / `[]` 三态语义 |
| `packages/app/src/project/minio-bar.tsx` | 进度态、取消按钮、拖放落点、结构从 `<button>` 改成 `<div>` + 主按钮 |
| `packages/app/src/project/minio-bar.test.tsx` | 进度态、取消回调、拖放落点、结构合法性（已有的窄条用例一并扩展） |
| `packages/app/src/project/minio-bar.stories.tsx` | 新增 props 的 story（进度态 / 失败态 / 暂停态） |
| `packages/app/src/project/dual-file-tree.tsx` | 恢复点选择器；MinIO 行载荷 `minio:`；删掉 `拼路径`；`onRestore` 改签名；旧内联确认换成对话框入口；空态 |
| `packages/app/src/project/dual-file-tree.test.tsx` | 拖拽载荷、原路径、恢复点切换、冲突对话框入口 |
| `packages/app/src/project/file-tree.tsx` | 只接线 `onBackup`/`onRestore`（菜单项本体已存在） |
| `packages/app/src/project/project-data.ts` | 把备份相关方法加进 `ProjectData` 与 `PROJECT_DATA` 生产绑定（保持 `workspace-entry` 的 prop 数量不变） |
| `packages/app/src/project/project-data.test.ts` | 补 `PROJECT_DATA` 新方法的绑定用例（拦请求形状，照现有 harness） |
| `packages/app/src/workspace/workspace-entry.tsx` | 接线：启动备份、打开恢复对话框、轮询任务、心跳、刷新恢复点、写入接入缝 |
| `packages/app/src/workspace/workspace-entry.test.tsx` | 接线测试：启动备份、轮询、心跳、恢复点刷新 |
| `docs/superpowers/specs/005-project-management/state.md` | 把 T022 从缺口改为已落地；登记本 spec 的缺口 |
| `docs/superpowers/specs/005-project-management/tasks.md` | T022 勾选并指向本 spec |

### 14.3 明确不改

- `packages/ui/**`、`packages/session-ui/**` 的上游源码。
- `packages/opencode/src/project/project.ts` 的 `ProjectTable` 语义。
- 归档链路的 `backupAll` / `restoreAll`（除了 `dropBackups`）。
- 桶版本化、生命周期策略。

---

## 15. 分期与实施顺序

| 期 | 内容 | 完成标志 |
|---|---|---|
| **P1 存储层** | `minio.ts` 扩展、前缀、流式、守卫、测试 | 存储层用例全绿；归档链路不回归 |
| **P2 备份/恢复服务** | manifest、blob、预览、恢复、保留、GC、配额、审计、权限 | 服务层用例全绿；fake-s3 可观测 |
| **P3 HTTP 与接线** | `backup.ts` 路由、`server.ts` 一层、`dropBackups` 扩展 | 路由测试全绿；项目删除可重入 |
| **P4 前端** | 客户端、接入缝、菜单、双树、选择器、拖拽、对话框、进度条 | 组件测试全绿；空态/无障碍 |
| **P5 自动与收尾** | 心跳、调度器、变化检测、保留定时、端到端 | 真栈 e2e 全绿；恢复演练报告 |
| **P6 文档与对账** | `state.md` / `tasks.md`、部署验收清单、LEARNINGS | 缺口表与对账完成 |

每期单独提交，提交信息写清「保留的定制 · 同步上游时不要丢」。P4 与 P5 可以按「先手动、后自动」拆成两个提交。

---

## 16. 与其它文档的关系

| 文档 | 关系 |
|---|---|
| `005-project-management/spec.md` FR-007 | 本 spec 是 FR-007 的落地设计；补齐了“快照 vs 镜像”“自动备份”“进度”“拖拽” |
| `005-project-management/minio.md` | 桶、键、凭据、五个 env 的上位约定；本 spec 只增加 `_openhive-backups` 命名空间 |
| `005-project-management/tasks.md` T022 | 本 spec 落地后勾选；原 T022 的“文件级备份出口”由本 spec 承担 |
| `2026-09-11-项目管理-design.md` §5 | 双树与拖拽的原始视觉设计；本 spec 修正“拼路径”与 `file:` 载荷两处 |
| `2026-10-16-project-rename-delete-design.md` | 删除项目的 `dropBackups` 扩展点；本 spec 的备份命名空间必须一并清 |
| `2026-10-15-file-tree-multi-select-move-design.md` | 多选移动的既有行为；本 spec 明确多选拖拽 v1 不做 |
| `CONFIG.md` | 五个 `OPENHIVE_MINIO_*` 的配置位置与“整组才算配”的口径 |
| `.specify/memory/constitution.md` | 物理隔离、权限下沉、两条轴；本 spec 的 per-user scope 与审计遵循它 |

---

## 17. 自检记录（写完即查）

- **占位符**：无 `TBD` / `TODO` / “待定”。
- **内部一致性**：
  - 快照与镜像的分工在 §3.1、§7.4、§14.3 三处一致；
  - 命名空间在 §3.5、§4.1、§9.3、§14.2 一致；
  - 进度阶段在 §5.2、§10.2、§11.5 一致；
  - 取消语义在 §5.7、§6.5、§10.5、AC-F5-10/11 一致。
- **范围**：v1 做/不做边界明确；多选、跨项目、multipart、多实例都显式排除。
- **歧义**：
  - “保留两者”的命名规则、默认决策、类型冲突的三选一限制都写死；
  - “自动备份只覆盖活跃项目”与“1 小时冷却”都写死；
  - “手动超配额需确认、自动暂停”写死；
  - “归档项目禁用文件级恢复”写死。
- **安全**：客户端不传 userId；manifest 当不可信输入；路径逐段校验；不跟随符号链接；审计不含内容。

---

## 18. 实施偏差与缺口（2026-10-18 收尾）

> 本节按 Task 19 派单裁决（`task-19-brief-amend.md` A-2/A-3）落在设计稿自身，不另建 state.md。
> 证据来源：`.superpowers/sdd/2026-10-18-file-backup-snapshot/progress.md` 与各 `task-N-report.md`。
> 口径：「计划」指 `docs/superpowers/plans/2026-10-18-file-backup-snapshot.md`；「实际」以代码与本轮实得为准。

### 18.1 实施偏差

| 任务 | 计划怎么写 | 实际怎么做 | 为什么 |
|---|---|---|---|
| Task 2 | 流式上传 stall 时 `await iterator.return()` | 不 await，直接 abort in-flight 请求 | `return()` 自身可能挂在同一个坏连接上；abort 才能保证退出。另有 `requestChecksumCalculation: WHEN_REQUIRED`（SDK 默认会多算一遍校验和） |
| Task 3 | `isExcluded` 的精确名单只比较完整路径 | 精确名单同时比较 `path` 与 `name` | 计划自带用例要求 `资料/Thumbs.db` 为 true；只扩大 `.DS_Store` / `Thumbs.db` / `desktop.ini` 三项系统垃圾名，不含业务数据类 |
| Task 4 | 保留按 fall-through：先落小时桶，满了再往大桶丢 | 按年龄严格分层（小时 / 天 / 周互斥） | fall-through 会让同一小时的多条快照被丢进天桶「复活」；变异实得 `["b","a"]`。用例 `now` 由 12:00Z 改 12:30Z，避开上海时区上一小时桶 |
| Task 5 | `readState` 用 `Uint8Array#toString("utf8")`；`blobs()` 切片不剥分片目录；实现 `useSSL` | 改 `TextDecoder`；切片补剥分片目录；不实装 `useSSL` | 前者是计划片段里的真 bug；`endpoint` 已由 `endpointOf` 归一，唯一生产调用点不传 `useSSL` |
| Task 7 | 上传失败直接抛；排序用 `localeCompare`；`totals.bytes` 取扫描总量；`runBackup` 自己写 manifest | 按 spec §5.5 记 `upload-failed`、落 partial、同 hash 一并跳过；排序 pin `Intl.Collator("zh-CN")`；`totals` 按留存 files 求和；不写 manifest（调用方 Task 11 写） | 直接抛会让 `upload-failed` 成为死枚举；`localeCompare` 随宿主 locale 漂移、违反「确定性」；总量与剔除失败项后的文件自相矛盾；manifest-last 是提交阶段的性质。**§5.5 的 3 次重试 + 1s/2s/4s 退避仍未实现**（见缺口表） |
| Task 8 | keep-both 把旧文件 `rename` 成新名字；只校验最后一段链接；第二次 rename 失败不回滚；type-mismatch 一律失败；失败码 `hash-mismatch` | 先搬走旧文件再写新名字；预览 / 恢复 / `scanScope` 根都拒绝中间段符号链接；第二次 rename 失败回滚 + 3 次 EBUSY/EPERM 重试；type-mismatch 提供「覆盖」并记 `overwritten`；失败码统一 `blob-corrupt`；`RestoreResult` 补 `overwritten` / `dirsCreated` | 原 rename 目标已存在 ⇒ ENOENT（计划片段真 bug）；`lstat` 只不跟随最后一段，中间段是链接会写穿沙箱（spec §6.4 明文）；不回滚会让用户原路径消失；spec §6.3/§6.5 明确要求 |
| Task 9 | 活跃项带 `dirty`，`checkNow` 读它 | 删除 `dirty`，`markDirty` 保留为文档化 no-op；`lastAutoAt` 初始化为 `now() - 冷却`；补 `noteBackup`、`AutoBackupCancelled`、`isBusy`、GC 末尾回写 state | `dirty` 无读者，变化检测已由 `UnchangedError` 承担（YAGNI）；初值 0 会让首拍检查不成立；手动备份成功后必须刷新冷却（spec §7.3） |
| Task 10 | 把 `scope/kind/files/bytes/result/error_code/duration_ms` 压进 `detail JSONB`，action 用连字符 | 按 spec §9.3 改成 12 列 typed 表，action 用下划线集，`result` 必填；原地改迁移 0007 | spec 是权威；AC-F5-19「取消 / 失败各写一行」需要列承载。0007 尚未在任何环境应用，不新增 0008 |
| Task 11 | 自动备份只检查、不占单飞锁；删除恢复点不幂等；配额暂停后不自动解除 | 自动备份也 `jobs.start`；二次 DELETE 返回 200 并 `syncState` + GC；`usageBytes <= 上限` 时清 `autoPaused`；抽 `prepareBackup` 供预检与备份共用；读端点对归档项目 200；`jobs.start` 后 `contextStatus` 抛错先 `finish` 再 rethrow | spec §7.3「自动与手动共用单飞锁」、§8.5 幂等、§8.3 解除暂停、§11.1 #50 归档只读可见；锁提前后新增的永久占锁路径是本次修复自带的缺陷，必须一并堵住 |
| Task 12 | 项目删除只 `quiesce`，不持锁 | `JobRegistry` 加令牌式 `hold` / `isHeld`；`start` 返回 `job \| undefined`；对全体成员逐个 hold，`Effect.ensuring` 释放；`server.ts` 的 `createRoutes` 加测试用第二参数；删恢复点出口也补 `isHeld` | spec §5.8 要求「拿同一把锁」；锁粒度是用户×项目、任务可能属任一成员；删恢复点与项目删除并发可在清空后的命名空间重造孤儿 `state.json` |
| Task 13 | 测试骨架按 `{状态,体}` 序列写；`cancel` mock 用 204 | 新写本地 `假备份`（方法 + pathname 精确匹配）；cancel mock 用 202；`activeJob` 保持 `\| null` | 仓库真 `假服务` 返回体本身、恒 200；服务端 `cancel` 回 ACCEPTED（202），204 会让客户端判 false；wire 契约是 `null`，收窄成 `undefined` 是替身 / 生产形状漂移 |
| Task 14 | 窄条根从 `<button>` 改 `<div>`；进度线在底部、不确定态给 8%；hashing 阶段只递增文件数 | 同步改两处 e2e 的点击目标；进度线顶部 2px、不确定态不加假百分比、阶段文案带数量；hashing 成功 / skip 两支都累加 `bytesDone` | 点 div 不会触发内层 `onOpen`，不改 e2e 则用例静默失效；spec §11.5 要求真实字节文案。`uploading` 阶段只计新上传 blob（增量备份到不了 100%）裁定为可接受语义并登记 |
| Task 15 | 拖到 MinIO 目录行时「复制到鼠标所在目录」；`onRestore` 直接改签名 | 拖拽保持原路径、走 `onRestoreSnapshot`；`onRestore` 保留旧签名并转发给上树 `FileTree`；删除快照的确认框移到 Task 17 | spec 明确「保持原路径」；拖拽语义与普通 `onRestore` 是两条契约；确认框需要接线层才能弹 |
| Task 16 | 未提 `.git` 路径 | 涉 `.git` 时渲染警告 + 勾选确认，确认钮门控；`.git` 判定按路径段 `split("/").includes(".git")` | spec §6.4「用户确认后才继续」；只匹配根级 `.git` 会漏掉嵌套仓库 |
| Task 17 | 只提「项目代次」；异步回包直接写当前项目；删除恢复点无确认 | 拆成项目代次 + 请求代次；`跟备份任务` / `备份越限` 在第一行捕获项目并在调用点传入，await 后再校验；删除恢复点先弹确认；恢复框由接线层套 `DialogV2` | 只捕获「项目」不捕获「代次」挡不住旧项目回包写进同名新项目；await 后再读当前项目会让旧任务把旧 snapshotId 写进新项目；spec §8.5/§11.2 要求删除前确认 |
| Task 18 | 真栈用例假定恢复框可直接点 | 在接线点（`workspace-entry.tsx` 的 `拉回`）套 `DialogV2`，`RestoreDialog` 本体不动；挂具先等自动备份跑完；`E2E_BROWSER` 指向 `chromium-1234`，端口改 3011/4712 | 裸 `div` 落在 `pointer-events: none` 的弹窗层里，真浏览器整块不可点（产品缺陷，非挂具问题）；进项目心跳的自动备份在跑时手动备份会按设计落 `job_running`；3010/4711 被残留栈占用 |

### 18.2 缺口表

> 「本机能否验」= 本机现有工具链（假 S3 / 组件测 / Playwright 真栈）能否在不改产品代码的前提下补出判据。

| 来源 | 缺口 | 本机能否验 | 何时补 |
|---|---|---|---|
| Task 2 | 非超时源错误不 abort，挂在 6 小时兜底；stall 用例已静默 SDK 告警但覆盖薄 | 部分（需故障注入） | 后续加固轮 / 真实网络故障复盘时 |
| Task 3 | `validateManifest` 其余拒绝分支（version / id 形状 / kind / scope / status / dirs / skipped / totals）无独立判据；`ownerId` 半条守卫无独立用例 | 能（纯补测） | 下次触碰 manifest 校验时 |
| Task 5 | `fake-s3.seed` 只收字符串并重编码 ⇒ 二进制（gzip）经它种入会被破坏；`rebuildSnapshots` 零覆盖；`manifests()` 静默跳过坏条目 | 能（改挂具 / 补测） | 下一次改 store 或挂具时 |
| Task 7 | spec §5.3/§5.5 的「3 次重试 + 1s/2s/4s 退避」**仍未实现**；§5.7「取消时 abort 当前流」只在 blob 之间检查；symlink / too-large / unreadable / changed-during-backup / 自动复用哈希无用例；排序 pin 了 `zh-CN` Collator | 重试与取消需改产品代码（本机可验）；其余能补测 | **部署前必须补重试**（§5.5 明文）；取消改造与其余用例随加固轮 |
| Task 8 | M1 取消不 abort 当前流；M2 恢复串行（spec 写并发 4）；M3 `reason` 直取 message；M4 兜底清理范围偏大；M5–M8 弱断言 / 缺用例；**C2 PARTIAL**：`scope=""` 且项目根整体缺失时标签不准、不重建根 | 部分能；C2 生产不可达（内核启动期要求沙箱根存在） | C2 已 park；其余随整支复审 / 下次恢复改造 |
| Task 9 | M9 静默 catch 无日志（Task 11 已补审计，仍需说明）；M11 分桶时区取自调用方而非 manifest；GC 的 state 读写在删除之后、坏 / 无 state 无用例；`isBusy` 是快照式查询 | 能（补测 / 小改接口） | 加固轮 |
| Task 11 | 每日清扫 `isBusy` 无 HTTP 可达路径；`/status`、`/cancel`、手动 409 `quota_exceeded` + `allowOverQuota`、恢复冲突分支无 HTTP 用例 | 能（补 HTTP 用例） | 加固轮 |
| Task 12 | 多实例不共享单飞锁；hold 与 quiesce 的先后次序无直接判据（单线程造不出窗口） | 多实例不能；次序判据需并发挂具 | 上多实例前（PG 咨询锁 / 任务队列）；次序判据随并发测试挂具 |
| Task 13 | 客户端拒绝态（400 / 401 / 403 / 404 / 5xx）无契约断言 | 能 | 界面接线补齐 / 加固轮 |
| Task 14 | `previewing` / `restoring` 数量未知时无省略号；skip 分支 `bytesDone += file.size` 无用例守护；uploading 阶段 `bytesDone` 只计新上传 blob（增量备份到不了 100%，已裁定为可接受语义） | 前两项能补测；第三项为语义裁定 | 加固轮；第三项不补 |
| Task 15 | 真栈布局未量；组件测 `歇一拍` 固定 5ms | 真栈主链两条已由 Task 18 验；布局细节与其他交互仍可补 e2e | 后续 e2e 扩展 |
| Task 16 | `preview` 变化不重置决策 / 勾选（接线层每次新开，既定裁定） | 语义接受，不补 | — |
| Task 17 | **N-4** 空闲期发现不了自动备份（1s 轮询被「在跑」短路、心跳 204 无体）⇒「自动备份中…」窄条态当前不可达；60s 心跳周期 / 取消 / `job_running` 只有组件层判据；**O-1** `备份越限` 失败文案可写到新项目中栏（请求本身正确）；**O-2** `file-op-message` 某条断言在变异下恒真（核心缺陷由 `:4725` 守住） | N-4 需设计改动；O-1 / O-2 能补 | 加固轮 |
| Task 18 | spec §13.4 第 3 / 8 / 10 / 11 条与第 1 条的二进制 / 空目录 / `.git` 未覆盖；真实桶策略、多实例、跨用户隔离、删除项目清命名空间、审计行未验；自动备份的触发 / 去重 / 每小时一次未作为判据 | 部分能（补 e2e）；部署级不能 | e2e 扩展；部署级随 D-13 |

### 18.3 「本机验不了」清单

| 项 | 为什么本机验不了 | 何时 / 在哪补 |
|---|---|---|
| 真 MinIO 的桶策略 / STS / `${aws:username}` | 本机 MinIO 的桶策略与生产不同，STS 未配置 | D-13 部署验收 |
| 多实例下的单飞锁 | 本机只跑单进程，两把内存锁互不可见 | 上多实例前（PG 咨询锁或任务队列） |
| win32 无管理员权限时的符号链接不写穿 | 本机当前账户可建符号链接；用例在无权限环境会自动跳过 | CI 或 Linux 上补 |
| 桶生命周期（`AbortIncompleteMultipartUpload`） | 本版不使用 multipart | 不适用（引入 multipart 时再补） |
| 5 GB 以上单文件 | 造数与上传耗时过长，本机不现实 | 目标环境（部署验收） |

补充：Task 18 真栈在修复后实得 `2 passed (51.1s)`（备份 → 改 → 拉回覆盖；恢复对话框可点并落盘）。真栈**已验**的部分只到这两条主链；上表中标「部署级不能」的项仍以 Task 18 报告为准，不得当作已覆盖。
