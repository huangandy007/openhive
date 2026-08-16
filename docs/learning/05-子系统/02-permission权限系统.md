# 05 · 子系统 · permission 权限系统

> 权限系统是 opencode 的「安全闸门」——决定 AI 能不能改某个文件、跑某条命令。理解它，才能理解「为什么 build 能动手、plan 只能看」。

---

## 一、为什么需要权限

AI 编程助手要替你改文件、跑命令，但你不希望它删库、改生产配置。权限系统就是**在 AI 每次「动手」之前，先问一句「这个操作允许吗？」**，答案有三档：

- `allow` —— 直接放行
- `deny` —— 直接拒绝
- `ask` —— 弹出来问你，你决定

---

## 二、关键：代码里有两套权限系统

| | PermissionV1 | PermissionV2 |
|---|---|---|
| 模型位置 | `packages/schema/src/v1/permission.ts` | `packages/schema/src/permission.ts` |
| 运行时 | `packages/opencode/src/permission/index.ts` | `packages/core/src/permission.ts` |
| 持久化 | **内存**（重启即失） | **落库** `permission` 表 |
| 状态 | 当前 CLI 实际走这套 | 较新，server/HTTP 侧 |

> **注意**：当前 `opencode` CLI 工具执行链路实际走的是 **V1 内存权限**；V2 + 落库目前挂在 server/HTTP API 侧。两套概念映射也不同：V1 用 `permission`(=动作) + `pattern`(=资源)；V2 用 `action` + `resource` + `effect`。

---

## 三、权限模型：action 和 resource 是什么

### V1 模型
- `Action = "allow" | "deny" | "ask"`（`v1/permission.ts:16`）
- `Rule = { permission, pattern, action }`（`:19-22`）
  - `permission` = 动作类别（如 `read`、`edit`、`bash`、`task`、`webfetch`…）
  - `pattern` = 资源匹配串（文件 glob 如 `src/**/*.ts`、命令前缀如 `git commit *`、或 `*`）

内置的权限键（`v1/config/permission.ts:17-35`）：
`read, edit, glob, grep, list, bash, task, external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop, skill`

> 通俗理解：`permission` 是「什么类型的动作」，`pattern` 是「针对什么对象」，`action` 是「允不允许」。

### 通配匹配
`packages/core/src/util/wildcard.ts:3` 的 `Wildcard.match(input, pattern)` 支持 `*`/`?`，做路径规范化。

---

## 四、权限判断流程

核心函数在 `packages/opencode/src/permission/index.ts`：

**`evaluate(permission, pattern, ...rulesets)`（`:28-38`）**：
- 把所有 ruleset 扁平化后 `findLast`（**后写的规则优先**）
- 用 `Wildcard.match` 匹配 `permission` 和 `pattern`
- 未命中则返回默认 `{ action: "ask" }`（**默认是询问**，安全第一）

**`ask(input)`（`:67-107`）**：逐个 pattern `evaluate`，`deny` 抛错、`allow` 跳过、否则进入 pending 并阻塞等待用户回复。

**`reply(input)`（`:109-167`）**：用户回复 `reject`（拒绝并级联）、`once`（本次放行）、`always`（记住放行）。

### 一次工具调用如何走权限（V1 链路）

```
工具 execute 里调 ctx.ask({ permission, patterns, always })
  → session/tools.ts:81 把 agent ruleset + session ruleset 合并
  → Permission.ask → evaluate 逐 pattern 判断
  → deny 抛错 / allow 放行 / ask 弹窗阻塞
  → 用户 reply → once/always/reject
```

例如：编辑工具 `tool/edit.ts:102` 声明 `permission: "edit", patterns: [相对路径]`；shell 工具 `tool/shell.ts:263` 声明 `bash` + `external_directory` 权限，`always` 用 `BashArity.prefix(tokens)` 计算「人类可读的命令前缀」（如 `git commit *`，见 `permission/arity.ts:24-161`）。

---

## 五、agent 权限差异（build vs plan）

每个 agent 本质是一个 `Permission.Ruleset`，由 `defaults` + agent 专属 + `user` 三段合并（`agent/agent.ts`）：

| agent | 权限特点 |
|---|---|
| **build**（默认） | `defaults + { question: allow, plan_enter: allow }` —— 全功能，能改能跑 |
| **plan**（只读） | `defaults + { edit: deny（除 plans 目录）, task: general deny, plan_exit: allow }` —— 禁止编辑，只允许写 plans 目录 |

`defaults` 基线（`agent.ts:119-136`）包括：`*: allow`、`doom_loop: ask`、`external_directory: ask`、`question: deny`、`read` 对 `*.env` 文件为 `ask` 等。

> 这解释了 `02-产品认知` 里说的「build = 全能工程师，plan = 只读顾问」——它们的差异就体现在这里，是**代码里硬编码的规则集**。

---

## 六、权限如何配置

配置 Schema 在 `packages/core/src/v1/config/permission.ts`，写在 `opencode.json`：

```jsonc
{
  "permission": {
    "bash": "allow",                          // 整类 allow
    "edit": { "src/**": "allow", "*": "ask" }, // 按 pattern 细分
    "todowrite": "deny",
    "external_directory": { "/tmp/*": "allow" }
  }
}
```

也可用顶层字符串 `"permission": "allow"` 表示 `{ "*": "allow" }`。

环境变量：`OPENCODE_PERMISSION`（JSON）、`OPENCODE_TOOLS`（per-tool allow/deny）会 mergeDeep 进配置。

---

## 七、持久化（「记住用户选择」）

- **V1**：`approved` 数组存在内存里（`InstanceState`），进程退出即清空。UI 文案明说「This will allow … until OpenCode is restarted.」
- **V2**：`reply === "always"` 且有 `save` 时，`saved.add(...)` 写入 `permission` 表（`core/src/permission/saved.ts:54-69`，`onConflictDoNothing` 去重），下次通过 `savedRules()` 读取合并进判定。

> 如果想给 openhive 做「跨会话记住用户授权」的能力，落点就是 V2 的 `PermissionSaved` + `reply("always" → saved.add)`，或把 V1 的 `approved` 从内存换成库表。这是改造时的一个具体机会点。

---

## 八、小结

```
工具声明权限（permission + patterns）
  → 合并 agent + session 规则集
  → evaluate（findLast + wildcard 匹配）
  → allow / deny / ask
  → ask 时阻塞等待用户 reply（once/always/reject）
  → always 可持久化到 permission 表（V2）
```

权限系统的核心思想：**默认询问（ask），规则可配置，后写优先，agent 决定基线**。
