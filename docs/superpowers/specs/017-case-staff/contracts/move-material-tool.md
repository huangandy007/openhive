# 契约 · 案件 MCP 工具 `move_material`（017-case-staff）

**落点**：`packages/opencode/src/server/openhive/case-mcp-server.ts`（`工具名` 数组、`TOOLS` 里的
`inputSchema`、`分发表` 条目——**三处都要加**，缺 `TOOLS` 声明会在 `校验必填` 处折成
`tool_failed`）、`packages/opencode/src/server/openhive/case-mcp-tools.ts`（实现）。
**不改**：`file.ts`、`case-store.ts`、信封校验、预算逻辑、其他工具语义。

---

## 1. 工具定义

| 项 | 值 |
|---|---|
| name | `move_material` |
| 类别 | 写工具（单份文件移动） |
| 谁可用 | 项目成员（**不是**属主专属，与 HTTP `POST /openhive/file/move` 口径一致；MCP 的成员门只认 `auth.project_member` 行——HTTP `过门` 的「老项目回退属主」一支在 MCP 本来就不存在）。⚠️ **既有缺口**：非属主成员经 MCP 网关调用今天恒 `identity_required`——`_meta.directory` 被改写成**属主**目录（`project-location.ts:692` 的落点属主），而 `解析调用身份` 要求 `root/<调用者>/<projectId>`（`012` research 已记，单独跟踪）。本特性**不修**身份门；「按属主拼项目根」那一层由工具层用例覆盖，服务级成员路径不声称可用 |
| 归档项目 | **拒**（`forbidden`）——「归档 = 冻结」（005 FR-010） |
| 计数 | 计入既有 12 次探索预算（不单列豁免）；超限只追加既有「必须收尾」缺口文案，**不拒绝执行** |

### 1.1 inputSchema

```json
{
  "type": "object",
  "properties": {
    "路径": {
      "type": "string",
      "description": "要移动的文件，项目相对路径，必须是「材料/」下的一份普通文件（不搬目录、不搬符号链接），例如 材料/00-待归档/张三建行流水.pdf"
    },
    "目标目录": {
      "type": "string",
      "description": "目标目录，项目相对路径，必须是已存在的「材料/」下子目录，例如 材料/06-话单与资金"
    }
  },
  "required": ["路径", "目标目录"]
}
```

### 1.2 模型可见 description（定稿口径）

> 把 `材料/` 下的一份文件移到另一个已存在的材料子目录。只换位置、不改名、不覆盖同名文件；
> 移动后平台会同步材料路径。什么时候用：收件箱归档、材料放错来源目录需要纠正时（一份一次）。
> 什么时候别用：搬目录、改名、批量移动、移动 `材料/` 以外的文件，删除——都用不上它。

---

## 2. 门与判定顺序（与既有入口一致）

```text
① 解析调用身份（_meta）                → identity_required   [服务级，既有：case-mcp-server.ts:882]
② 校验成员（auth.project_member）       → not_a_member        [服务级，既有：:892]
③ 工具名分发（不在 `写工具名` ⇒ 无属主门） → unknown_tool        [服务级，既有：:913]
④ 校验必填（inputSchema.required）      → bad_input           [服务级，既有：:919]
⑤ 收参数（键白名单 + 类型，未知键拒）      → bad_input           [分发表，既有：:606 起]
⑥ 归档冻结（工具内，新增）               → forbidden
⑦ 参数与路径判定 → 原子不覆盖移动（link+unlink） → 迁移材料路径  → bad_input / tool_failed
```

`分发表` 的条目固定写成 `收参数<Parameters<typeof move_material>[1]>(args, ["路径", "目标目录"], [], [])`
——只有这两个键，没有可选键、没有布尔开关（与既有条目同款）。

`⑥` 是本工具**新增**的判据：MCP 入口没有 HTTP 的 `projectLocationLayer` 中间件，写操作必须自己补。
它落在**工具实现内**（`case-mcp-tools.ts`），因此位置在服务级四门与 `收参数` 之后、**任何文件系统
访问之前**：路径是否存在 / 目标目录在不在，只有过了冻结门才可能被问到。形状错误（缺必填、未知键）
按 ④⑤ 先回 `bad_input`，与未归档项目同一处置，不泄露归档态。

判据**不新写 SQL、不新写规则**：
1. `archiveStatesOf(db, [projectId])`（`@opencode-ai/auth/project-member`，导出点
   `packages/auth/src/project-member.ts:295`）取 `archived`；**没有行 = 未归档**，不补默认结论；
2. 判定交给核心的 `ProjectMembership.frozen(archived)`（`@opencode-ai/core/project/membership`，
   `packages/core/src/project/membership.ts:173`）——与 HTTP 侧同一判据，不写第二份 `archived === true`。

HTTP 侧的现行调用点：`.../httpapi/middleware/project-location.ts:458-459`。
**不把该判据扩到其他 MCP 写工具**（既有缺口，另行处理）。

本工具**不加入** `写工具名` 集合（`case-mcp-server.ts:764`）：HTTP 的移动/改名是成员级，
加入会成为「UI 能移、AI 不能移」的第二套口径。⚠️ `写工具名` 的注释写着「新增写工具时必须在这里
加一行」——本工具是**有意的例外**，理由就这一条；改那一行注释不是本特性的活，实现时在工具实现处
留一行同样理由的注释，避免后来人「顺手补上」。

---

## 3. 执行语义

1. 项目根**恒按属主**拼（与图工具同一裁定，`hgraph-ops.ts:293`、`case-hgraph-tools.ts:128`）：
   `属主 = await 项目属主(ctx.db, 身份.userId, 身份.projectId)`（`./project-actor.ts:79`）→
   `项目根 = projectDirectory(ctx.workspaceRoot, 属主, 身份.projectId)`
   （`@opencode-ai/auth/workspace`，`packages/auth/src/workspace.ts:108`）。
   **不自己 `join(workspaceRoot, userId, projectId)`**：共享项目的文件在**属主**沙箱里，
   按调用者拼会让成员永远找不到材料。身份门（`解析调用身份`）要求 `_meta.directory` 落在
   **调用者本人**沙箱内，两者不冲突——一个判「你是谁」，一个判「文件在哪」。
   `ctx.workspaceRoot === undefined` ⇒ 抛普通 `Error`（折成 `tool_failed`），不拿空根拼路径
   ——与 `case-hgraph-tools.ts:113` 的 `沙箱根` 同款判据（那个函数是私有的，这里照写三行，
   不为它去改图工具模块）。
2. `源 = inside(项目根, 路径)`；`目标目录绝对 = inside(项目根, 目标目录)`；任一 `undefined`
   ⇒ `bad_input`（文案沿用 HTTP：源「源路径越出项目目录」、目标「目标目录越出项目目录」）。
3. 顶层目录必须是 `材料`：`relative(项目根, 绝对).split(/[\\/]/)[0] === 材料目录名`（源与目标
   目录各判一次；分隔符不分平台，写法同 `file.ts:526` 的 `inGit`；常量复用
   `case-parseable.ts:18` 的 `材料目录名`）。
4. 拒：`inGitOf(项目根, 源)` 或 `inGitOf(项目根, 目标目录绝对)`（`.git` 元数据），文案 `GIT_LOCKED`。
5. 拒：源就是 `材料/` 根或 `材料/00-材料登记表.md`（台账是材料目录内唯一可写文件，不得被移走）。
6. `lstat(源)`（**不跟链接**）：不存在 ⇒ `bad_input("源文件不存在")`；不是**普通文件**（含符号链接、
   目录）⇒ `bad_input("移动只能对普通文件做")`。**本工具只搬文件**：设计 §6.3 的归档是「移动文件」，
   FR-028 逐份；不搬目录 ⇒ 不需要 HTTP 的 `ROOT_UNMOVABLE` / `INTO_ITSELF` 两条守卫。
7. 目标目录必须**存在且是目录**（`stat`，跟链接）⇒ 否则 `bad_input("目标目录不存在")`。
8. 拒：`realInside(项目根, dirname(源))` 或 `realInside(项目根, 目标目录绝对)` 为假 ⇒
   `bad_input(LINK_ESCAPE)`。**调用方式**：`realInside` 返回 `Effect`，这里
   `await Effect.runPromise(realInside(...))`（先例 `hgraph-ops.ts:323`），
   不在工具层重写 realpath 判据。
9. 目标 = `join(目标目录绝对, basename(源))`；已存在 ⇒ `bad_input("目标位置已经有同名文件")`
   （**不改名、不覆盖**，FR-029）。这条预检**保留**，但只为文案；预检与真写之间的竞态
   由第 10 步的原子原语兜住。
10. 不覆盖移动：`link(源, 目标)` → `unlink(源)`。原子的是**判据**——`link` 对已存在的目标抛
    `EEXIST`，这才是「不覆盖」的原子保证；移动由 link → unlink 两步完成，崩在中间只会留下
    两份硬链接（内容不丢），重试会被第 9 步的同名预检拒掉。**不用 `rename(2)`**——POSIX 与
    win32 上目标已存在时它都静默替换（不抛错，目标被源覆盖、源消失）。前提：源与目标同卷，
    `realInside` 已保证同一项目树。
    `link` 的 `EEXIST`/`ENOENT` ⇒ `bad_input("目标位置已经有同名文件，或源已经不在原处")`
    （与 HTTP `file.ts:724` 逐字一致；`ENOENT` 也覆盖「源已不在原处」）；其他错误 ⇒ `tool_failed`。
    `unlink(源)` 失败：`ENOENT` ⇒ 源已在 link 后被外部删除，**目标保留**（移动终态），直接成功；
    其它错误 ⇒ 尽力回滚目标名（`unlink(目标).catch(() => {})`，内容仍在源），原错误照抛。
11. `迁移材料路径(ctx.db, { projectId: 身份.projectId, 旧相对, 新相对, 作业目录: `${属主}/${身份.projectId}` })`
    ——`作业目录` 是**沙箱根相对**前缀（`case-store.ts:197`），按属主拼（与 HTTP 侧
    `file.ts:629` 的 `项目标识` 同一形状）。`旧相对`/`新相对` 由 `relative(项目根, 绝对)`
    取得并用 `/` 归一。
    失败**不回滚**：文件已移动，把原因写进 `缺口`（与 `file.ts:629` 的 WARN 语义一致）。

**不做**：批量移动（一份一次，FR-028 逐份进行）；搬目录；改名（那是另一个能力，本期不暴露）；
跨项目移动；移动非 `材料/` 文件。

---

## 4. 返回（七字段信封）

成功示例：

```json
{
  "摘要": "已移动 1 份：材料/00-待归档/张三建行流水.pdf → 材料/06-话单与资金",
  "数据": [
    {
      "旧路径": "材料/00-待归档/张三建行流水.pdf",
      "新路径": "材料/06-话单与资金/张三建行流水.pdf",
      "材料路径已同步": true
    }
  ],
  "口径": "只移动、不改名；材料路径由服务端迁移，未登记过的文件（非可解析扩展名）没有可迁移的行",
  "缺口": [],
  "空原因": null,
  "出处": [{ "事实": "已移动 1 份", "代表": "材料/06-话单与资金/张三建行流水.pdf", "可下钻": null }],
  "下一步": [
    {
      "工具": "（无）",
      "参数": {},
      "为什么": "把材料登记表的当前路径与状态更新为 已归档，属证据的同时写 E 行"
    }
  ]
}
```

库迁移失败时：

```json
{
  "摘要": "已移动 1 份：…",
  "数据": [{ "旧路径": "…", "新路径": "…", "材料路径已同步": false }],
  "口径": "同上",
  "缺口": ["材料路径未同步（<错误类型名>）：下次解析会按新路径自愈"],
  "空原因": null,
  "出处": [{ "事实": "已移动 1 份", "代表": "…", "可下钻": null }],
  "下一步": [{ "工具": "search_materials", "参数": { "关键词": "<文件名>" }, "为什么": "确认平台是否已按新路径登记" }]
}
```

`下一步` 里的 `工具` 必须是真实存在的工具名或 `（无）`——不许编造工具（与既有纪律一致）。

---

## 5. 错误码

| code | 触发 | 模型可见文案（要点） |
|---|---|---|
| `identity_required` | 缺 `_meta` / 目录不在自己沙箱 | 缺调用身份 |
| `not_a_member` | 不是项目成员 | 看不到该项目 |
| `forbidden` | 项目已归档 | 项目已归档，不能改动 |
| `bad_input` | 越界 / 非 `材料/` / 源不存在 / 源不是普通文件 / 目标目录不存在 / 同名冲突 / 移动登记表 | 具体到哪一条判据 |
| `tool_failed` | 其他异常 | 固定一句「工具执行失败，已记入服务端日志」 |

`bad_input` 文案**不回显**绝对路径与 SQL；`tool_failed` 的原文只进留痕
（复用 `case-mcp-server.ts` 的 `原文()` 与 `默认留痕`）。

---

## 6. 用例（TDD，`packages/opencode/test/server/openhive-case-mcp-move.test.ts`）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 属主（服务级）移动 `材料/00-待归档/a.txt` → `材料/01-接报案` | 文件在新位置、旧位置无、`数据[0].材料路径已同步=true` |
| 2 | 平台有该文件材料行（可解析扩展名） | 移动后 `case_material.path` = 新相对路径 |
| 3 | 目标已有同名文件 | `bad_input`，两处文件都在，登记表不动 |
| 4 | 源不在 `材料/` 下 | `bad_input`，零副作用 |
| 5 | 目标目录不存在 | `bad_input` |
| 6 | 源为 `材料/00-材料登记表.md` | `bad_input` |
| 7 | 非成员 | `not_a_member`，零副作用 |
| 8 | 已归档项目 | `forbidden`，零副作用 |
| 9 | 目标目录是链接逃逸 | `bad_input(LINK_ESCAPE)`，零副作用 |
| 10 | 库迁移抛错 | 移动成功、`材料路径已同步=false`、`缺口` 非空、返回仍 ok |
| 11 | 参数含白名单外的键 | `bad_input("不认识的参数：…")`（`收参数` 的既有行为，停在第 ⑤ 门） |
| 12 | 留痕 | 每次调用一行，成功/失败都有 |
| 13 | 源是一个目录（`材料/99-其他/包/`） | `bad_input("移动只能对普通文件做")`，零副作用 |
| 14 | 源是符号链接（指向材料外的文件） | `bad_input`，零副作用，链接与目标都不动 |

**「按属主拼」的探针**（用例 1 的对照，**工具层**）：直接以 `{ db, 身份: { userId: 成员, projectId }, workspaceRoot }`
调工具实现（不经服务入口 ⇒ 绕开身份门），项目文件在**属主**目录、材料行也属该项目 ⇒ 必须成功。
若实现误用 `join(root, 调用者, projectId)`，这里会拿到「源文件不存在」。
⚠️ **不走 MCP 网关**：非属主成员经网关今天恒 `identity_required`（§1「谁可用」的既有缺口），
写一条网关用例只会红在身份门，证明不了本工具——那是「把测不了的写成已覆盖」（TR-013）。

**变异验证**（TR-008 成对拆）：
- 拆掉「走 `迁移材料路径`」→ 用例 2 必须红；
- 拆掉「目标同名拒」→ 用例 3 必须红；
- 拆掉「归档冻结」→ 用例 8 必须红；
- 拆掉「`材料/` 限制」→ 用例 4 必须红。

**真栈**（TR-007，`packages/app/e2e/real-stack/case-staff-move-real.spec.ts`）：
真实服务 + 真 PGlite（非远端 PG）+ 真实 MCP 子进程；从监督器写入的全局配置读出 `openhive-case` 的 URL，
带 `_meta` 发一次 `tools/call`，断言盘上路径与 `auth.case_material.path` 同时变化（**不依赖模型**）。
