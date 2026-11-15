# 契约 · 唯一写入者 `hgraph-ops`（HTTP）

**文件**：`packages/opencode/src/server/openhive/hgraph-ops.ts`（新）
**前缀**：`/openhive/hgraph`
**挂载**：`packages/opencode/src/server/routes/instance/httpapi/server.ts`，与 `OpenhiveFile.routes` 同一套 `Layer.provide(AnchorWorkspace.Config.layer, OpenhivePg.layer)`。

**职责**：路径闸、成员门、per-path 串行锁、内容哈希版本 CAS、schema/来源硬闸、id 分配、批量原子、幂等、原子写；另含 `init` 与导出许可。**不负责**任何几何（对齐/布局/粘贴偏移由前端算好）。

---

## 1. 端点一览

| 方法 | 路径 | 用途 | 谁用 |
|---|---|---|---|
| `GET` | `/openhive/hgraph/read` | 读文件 + 版本 | 视图打开 / 轮询发现变化后 |
| `POST` | `/openhive/hgraph/init` | 0 字节文件写空骨架（幂等） | 新建后 / 打开 0 字节文件 |
| `POST` | `/openhive/hgraph/ops` | 应用一批操作并原子写回 | 前端所有编辑 + AI 5 个工具（同一函数） |
| `POST` | `/openhive/hgraph/export` | 校验归属 + 留痕 + 发下载许可 | 工具栏 / 文件树右键 |

> AI 工具**不经过 HTTP**：`case-hgraph-tools.ts` 直接调 `hgraph-ops.ts` 导出的 `应用并写回(...)` 核心函数（同一进程）。HTTP 端点只是前端入口。**写入逻辑只有一份**。

---

## 2. 门与顺序（每个端点都一样）

```text
身份(401) → projectId 合法(400) → 成员角色(403) → 请求体形状(400)
→ 路径闸：真实路径在 {root}/{属主}/{projectId} 内(400 LINK_ESCAPE/OUTSIDE_PROJECT)
→ 后缀小写归一 = .hgraph(400 NOT_HGRAPH)
→ [写操作] 串行锁 → 读最新 + 算版本 → 版本 CAS(409) → 校验(400) → 原子写
```

- 项目目录用 `projectDirectory(root, 属主, projectId)`（`packages/auth/src/workspace.ts:108`），属主由 `项目属主`（`project-actor.ts:79`）取——**共享成员写图落到属主目录**。
- 路径闸复用 `inside` / `inGit` / `realInside`（`file.ts:465/520/548`），**不重写**。
- 成员门复用 `成员角色`（`project-actor.ts:43`）；本 feature 不引入属主限制（成员可编辑；导出也只要求成员，FR-043）。

---

## 3. `GET /openhive/hgraph/read`

**入参**：`?projectId=<id>&path=<项目内相对路径>`

**200**：
```jsonc
{ "内容": "<原始 UTF-8 文本>", "版本": "<sha256 前 16 字节 hex>" }
```

**错误**：`401 UNAUTHENTICATED` / `400 BAD_REQUEST` / `403 FORBIDDEN` / `404 NOT_FOUND` / `400 NOT_HGRAPH` / `400 OUTSIDE_PROJECT`。

- 0 字节 ⇒ 返回 `内容: ""`、`版本` 为空文件哈希；前端据此调 `init`。
- 不做 trim、不做编码转换（版本必须对得上原始字节）。

---

## 4. `POST /openhive/hgraph/init`

**入参**：`{ "projectId": "...", "path": "分析/张三资金流向.hgraph" }`

**200**：
```jsonc
{ "内容": "<写入后或既有的内容>", "版本": "...", "写入": true }
```

- 文件不存在 ⇒ `404`（创建由既有 `POST /openhive/file/create` 负责，本端点不造文件）。
- 文件非空 ⇒ **不覆盖**，原样返回现有内容，`写入: false`（幂等，FR：新建后重复触发不清图）。
- 骨架：`格式:1`、`标题`=文件名去后缀、`创建于/更新于`=now、`设置`=默认、`节点/边/文字`=[]。

---

## 5. `POST /openhive/hgraph/ops`（核心）

**入参**：
```jsonc
{
  "projectId": "p1",
  "path": "分析/张三资金流向.hgraph",
  "版本": "<前端读到的版本；AI 工具路径省略>",
  "操作": [ /* 见 §5.2 */ ],
  "批次": "ai-20261115-1",     // 可选
  "幂等键": "7f3a…"            // 可选
}
```

**200**：
```jsonc
{
  "版本": "<写入后的新版本>",
  "结果": {
    "映射": { "tmp1": "n7", "tmp2": "e3" },   // 临时 id → 正式 id
    "复用": ["张三"],                          // 同名同类型被复用的节点名
    "新增": { "节点": 3, "边": 2, "文字": 0 },
    "更新": 1,
    "删除": { "节点": 3, "边": 4 },            // 删节点连带的边算在同一个数里
    "批次": "ai-20261115-1"
  },
  "重放": false                                 // 幂等键命中时为 true
}
```

**错误码**（`{ "error": "<人话>", "code": "<码>" }`）：

| HTTP | code | 何时 |
|---|---|---|
| 409 | `VERSION_CONFLICT` | 带了 `版本` 且 ≠ 当前；响应体另带 `最新版本` |
| 400 | `FACTS_NEED_SOURCE` / `INFERENCE_NEEDS_BASIS` / `INFERENCE_NEEDS_CONFIDENCE` | 来源硬闸（与 AI 工具**同一个函数**） |
| 400 | `BAD_REQUEST` | 请求形状不对（`projectId` 非法、`path` 为空、`操作` 不是数组、`版本`/`批次`/`幂等键` 类型不对、`版本: null`） |
| 400 | `BAD_JSON` / `BAD_VERSION` / `BAD_SHAPE` | 文件解析失败 / 缺 `格式` / 结构不对（含缺必填字段） |
| 400 | `NEWER_VERSION` | 文件 `格式` 高于本服务 ⇒ 只读，不写 |
| 400 | `BAD_CITATION` / `DANGLING_EDGE` / `BAD_OP` | 操作不合法 |
| 400 | `TOO_MANY` | 一次批量 > 50（工具入口；T012 实现） |
| 400 | `LINK_ESCAPE` / `GIT_LOCKED` | 路径越界（链接/junction 逃出项目目录） / 目标在 `.git` 内 |
| 404 | `NOT_FOUND` | 图文件或项目目录不存在 |
| 500 | `DUPLICATE_ID` | 图上 id 重复 —— **内部错误**（维护人员排查），不是用户输入问题 |
| 500 | `WRITE_FAILED` | 原子写失败：`EBUSY/EPERM/EACCES` 按 50/150/450ms 退避重试后仍失败，临时文件已清理 |

> `BUSY` **不单列**：进程内 per-path 串行不会产生「文件被占用」；跨进程占用在重试耗尽后同样落 `WRITE_FAILED`。
> 单列一个永不出现的码只会让调用方去分支一条死路。

**校验范围（关键）**：全量校验只作用于**本批新增或改过的对象**。文件里既有的、陈年不规范的对象
不会因为一次「改备注」被挡死 —— 否则老图永远改不动。读路径仍按格式闸拒 `BAD_JSON` / `BAD_VERSION` / `NEWER_VERSION`。

**空批**：`操作: []` ⇒ 返回当前版本、**不写文件**；因为不写，也不解析文件（`NEWER_VERSION` 或 `BAD_JSON`
的文件带空批请求同样回 `200`）。前端据此可以在「没有待发」时安全地做一次版本探测。

**版本语义（关键）**：

- **前端**必须带 `版本`。不一致 ⇒ 409，**不写、不合并、不替用户选**；前端按 §「重新载入？」处理，重载后清撤销栈（FR-012 / US6 场景 5）。
- **AI 工具**省略 `版本` ⇒ 在锁内**以盘上最新为基线**做增量写。理由：AI 没有「打开之后」这个时刻，让它因某个页面开着而失败是错的；它的写入是操作增量，不会覆盖别人的坐标（08 §6.1「两者不相交」）。

**原子性与幂等**：

- 先全量校验、再一次性写临时文件 + `rename`；任一操作不合格 ⇒ 文件字节不变（V-13）。
- 同 `幂等键` 重复调用 ⇒ 返回上次结果（`重放: true`），不重复写（10 分钟窗口，进程内）。
- 同一路径的「读→算→写」在 per-path promise 链上串行（`hgraph-lock.ts`）。

---

## 6. `POST /openhive/hgraph/export`

**入参**：`{ "projectId": "...", "path": "分析/张三资金流向.hgraph" }`

**200**：
```jsonc
{ "允许": true, "文件名": "专案A-张三资金流向-20261115-1003.png" }
```

行为：

1. 门（身份 → projectId → 成员 → 路径闸 → `.hgraph`）；非成员 `403`。
2. 生成文件名（`<项目名>-<图名>-<YYYYMMDD-HHmm>.png`；同名撞车时前端不覆盖——文件名带分钟，同分钟多次导出由前端追加 `-2`、`-3`）。
3. **写留痕**（内核日志一行，`data-model.md` §10）：人 / 项目 / 图路径 / 时间 / 文件名。
4. 返回许可。**服务端不产出图片**：PNG 由前端 canvas 渲染后按 blob 下载（08 §8.1 定位：可追溯，不是禁止）。

**错误**：`403 FORBIDDEN`（非成员）/ `400 NOT_HGRAPH` / `404 NOT_FOUND`。

---

## 7. 与既有出口的关系（防重复造轮子的显式声明）

| 既有出口 | 本契约的态度 |
|---|---|
| `POST /openhive/file/write` | **不复用**：trim/CRLF/非原子/无锁/版本口径不同（research R1）。本 feature 让它对 `.hgraph` 返回 `HGRAPH_READONLY` |
| `POST /openhive/file/create` | **复用**：新建先走它（`{flag:"wx"}`，不覆盖），再 `init` |
| `GET /openhive/file/stat` | **复用**：轮询只比 `mtime/size`，变了才 `read` |
| `GET /openhive/case/entities` / `entity` / `facts` / `graph` | **复用**：从库加入、快照、角标、关系页，全部只读调用，不新增检索接口 |
| MCP `case-mcp-server.ts` | **复用**门（身份/成员/属主）与留痕格式；5 个图工具只加实现（见 `mcp-tools.md`） |
