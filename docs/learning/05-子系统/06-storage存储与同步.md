# 05 · 子系统 · storage 存储、快照与同步

> 这一篇把「数据怎么存」讲完整。opencode 其实有**四套**与「存储」相关的机制，职责各不相同。表结构已在 `00-规划/01-学习规划.md` 第四节详列，这里聚焦机制本身。

---

## 一、全景：四套机制各司其职

| 机制 | 代码位置 | 存什么 | 用途 |
|---|---|---|---|
| **SQLite（Drizzle）** | `packages/core/src/**/sql.ts` | 结构化数据（session/message/event/permission…） | V2 主存储 |
| **JSON 文件 Storage** | `packages/opencode/src/storage/storage.ts` | 大对象/历史数据 | legacy KV，带迁移 |
| **snapshot（git 快照）** | `packages/opencode/src/snapshot/index.ts` | 文件系统 git 状态 | **撤销 AI 改动（revert）** |
| **sync（事件溯源）** | `packages/opencode/src/sync/` | 会话事件日志 | **跨设备同步** |

---

## 二、SQLite（Drizzle）—— 结构化主存储

- 库：`drizzle-orm` + `bun:sqlite`（原生驱动），经 `effect-drizzle-sqlite` 接入 Effect
- 数据库文件：`Global.Path.data/opencode.db`（`database.ts:43-54`，可用 `OPENCODE_DB` 覆盖）
- 关键 PRAGMA（`database.ts:27-32`）：`journal_mode=WAL`（写不阻塞读）、`synchronous=NORMAL`、`busy_timeout=5000`、`foreign_keys=ON`、`cache_size=-64000`（64MB）
- 并发：`sqlite.bun.ts` 用 `Semaphore.make(1)` 串行化写

> 表结构见 `00-规划/01-学习规划.md` 第四节（18 张表全景），这里不重复。

---

## 三、JSON 文件 Storage —— legacy 大对象存储

`packages/opencode/src/storage/storage.ts` 是一个基于 JSON 文件的 KV 存储：

- **key → 路径**：`key: string[]` 映射成 `{dir}/key0/key1/key2.json`（`file()` 函数）
- **接口**：`read / write / update / list / remove`（`Interface`，`:53-59`）
- **并发**：`TxReentrantLock`（读写锁）+ `RcMap`（每文件一把锁）
- **迁移**：`MIGRATIONS` 数组（`:81-211`），从旧 JSON 目录结构逐步搬移，用 `migration` 标记文件记录进度

> 这套是 V1 时代留下的，现在主要承担「历史数据兼容 + 大对象（diff 等）」的职责。新数据走 SQLite。

---

## 四、snapshot —— git 快照与「撤销」

`packages/opencode/src/snapshot/index.ts` 是 opencode 的**回滚能力**，底层直接调 git 命令：

核心接口（`Interface`，`:36-45`）：

- `track()`：记录当前 git hash（AI 动手前调用，记下「起点」）
- `patch(hash)`：生成相对某 hash 的补丁
- `restore(snapshot)` / `revert(patches)`：恢复/回滚
- `diff(hash)` / `diffFull(from, to)`：生成 diff

实现细节（`:23-27`）：`prune = "7.days"`（快照保留 7 天）、`limit = 2MB`，用 `git` 命令（`core.longpaths`、`core.autocrlf=false` 等配置保证跨平台一致）。

> 这就是数据流里 `runner/llm.ts:217` 的 `snapshots.capture()`（起始快照）对应的机制——**每次 provider turn 前记下 git 状态，之后 AI 改错了可以一键回滚**。`session` 表的 `revert` 字段（JSON）存的就是这个回滚状态。

---

## 五、sync —— 事件溯源与跨设备同步

`packages/opencode/src/sync/` 是**事件溯源（Event Sourcing）**的抽象，目标（README）是：

> 「允许一个设备控制/修改会话，多个其他设备通过**重放事件日志**来同步会话数据。」

### 核心设计

- **单写者模型**：只有一个设备写，所以不需要分布式时钟——用简单的递增序号 `seq` 实现全序
- **`SyncEvent`**：低层事件抽象，带 `type` / `id` / `seq` / `aggregateID` / `data` 字段，`SyncEvent.run(...)` 触发（`:86`）
- **projector（投影器）**：事件在 mutation 之前发出，投影器处理事件、执行 mutation（这就是数据流里 `SessionInput.projectAdmitted` 的由来）
- **向后兼容**：sync event 自动重新发布为 bus event，`Bus` 仍是监听单个事件的统一抽象

### sync event vs bus event

| | SyncEvent | BusEvent |
|---|---|---|
| 形状 | `{ type, id, seq, aggregateID, data }` | `{ type, properties }` |
| 用途 | 事件溯源、可记录可重放 | 进程内事件分发 |
| 关系 | 自动重发为 bus event | sync 的低层基础 |

> 这套机制呼应 `04-数据流` 里看到的 `event` / `event_sequence` 表——那正是事件溯源的落库。理解了 sync，你就理解了 opencode 未来「多端无缝同步」的技术底座。

---

## 六、小结

```
结构化数据   → SQLite（Drizzle + WAL）
大对象/历史  → JSON 文件 Storage（legacy）
撤销改动     → snapshot（git 快照 + revert）
跨设备同步   → sync（事件溯源 + projector）
```

四套机制覆盖了 opencode 数据面的四个维度：**存、兼、撤、同步**。至此「层 4 子系统」全部完成。
