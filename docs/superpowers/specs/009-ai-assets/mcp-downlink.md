# MCP 授权三层与数据隔离四环（009 T014 · FR-009）

- **状态**：前三环**已落地并实测**；第四环（服务端 RLS）**本仓不实现、不验证**，以接口契约 +
  外部验收清单交付（D0-12 裁定，用户 2026-10-25 确认「前三环 + RLS 契约」）
- **代码**：`packages/asset-service/src/downlink.ts`（下发生成器）、
  `packages/auth/src/builtin-mcp.ts`（内建 server 名单）、
  `packages/core/src/access/session.ts`（第①层的 `builtin` 标记）、
  `packages/opencode/src/server/openhive/access.ts`（`mcpServerNaming`）
- **用例**：`packages/asset-service/src/downlink.test.ts`（17 条）、
  `packages/opencode/test/server/openhive-access-builtin-wiring.test.ts`（3 条）、
  `packages/opencode/test/server/openhive-access-mcp.test.ts`（新增 2 条）
- **不在本文件**：治理 server 的三个工具语义（见 `governance.md`）、授权矩阵（见 `authorization.md`）、
  生命周期（见 `lifecycle.md`）

## 1. 结论

| 环 | 问题 | 本仓落点 | 今天的状态 |
|---|---|---|---|
| ① 授权 | 谁能用 | `role_resource` ＋ `sessionRuleset` | 已落地（T006/T007），T014 加内建放行 |
| ② 下发 | 连到哪 | `buildUserMcpConfig()` | **已落地为纯函数**；写盘/下发在外 |
| ③ 连接带身份 | 以谁的身份 | `mcp.headers` / `mcp.environment` ＋ `_meta` | 已落地并实测 |
| ④ 服务端 RLS | 看得见哪些行 | **外部 MCP server** | 🔴 **本仓未实现、未验证**（§6 契约） |

一句话：**本仓只保证「该下发的人拿到带身份的连接」，不保证「server 拿到身份后真的按身份过滤行」。**
后半句是每个业务 MCP server 的责任，本仓给契约与验收清单。

## 2. 第二环：为什么是纯函数、不写文件

本仓今天**没有**「每用户 `opencode.json` 的写入器」——写到哪、谁触发、并发怎么处理都还没定，
而这些都不是授权/身份问题。所以 T014 只把「这个用户应该拿到哪段配置」算成纯数据：

```ts
buildUserMcpConfig({
  userId: "u_alice",
  grants,                       // GrantRow[]：role_resource 的行
  assets,                       // AssetMetadata[]：资产元数据
  connections,                  // 连接清单：资产 id → { type, url | command, headers?, environment? }
}) // → { [资产 id]: McpServerConfig, "openhive-governance": McpServerConfig }
```

`connections` 是**显式入参**：业务 MCP 的连接清单（url / command / 静态凭据）从哪存取**留成接口**，
本文件不猜存储形态。生产调用方可以从配置表 / 密钥管理 / 部署文件汇总成这份只读映射。

**产出是确定性的**：键按字典序输出。`sessionRuleset` 的规则顺序与 `Config.mcp` 的键序相关，
固定顺序让「同一份授权 → 同一份配置」可复现。

**失败在产出之前**：任何不一致都抛 `McpDownlinkError`（带 `code`），**不返回半份配置**。
`code` 共六个：`invalid_user_id` / `invalid_asset_id` / `duplicate_asset_id` /
`governance_key_conflict` / `connection_missing` / `invalid_connection`。

## 3. 第一环：授权口径 = **显式 read 授权**，不是「空间可见」

浏览可以靠三级空间（全局 / 部门 / 个人）给「读」；但**下发**会把连接详情（含静态凭据、内网地址）
交给用户。所以条件逐条都要满足：

| 条件 | 为什么 |
|---|---|
| `asset.type === "mcp"` | skill 资产不下发连接 |
| `isAssetUsable(status)`（`published` ∨ `iterating`） | 草稿 / 审核中 / 待技术发布 / 已下线 / 已归档不下发；迭代中旧版本继续服务 |
| `role_resource` 里真有 `(mcp, 资产 id, read)` | 空间可见但没显式授权的资产不下发——连接详情不是浏览数据（`#006-10`：一个配置被两用要先分清两个读者） |

`write` / `review` / `admin` **不产下发**：capability 的 mcp 规则只吃 `perm === "read"`
（`core/access/session.ts` 实测），两侧必须同口径。

### 配置键不变式（最重要的接缝）

```
Config.mcp 的键  ≡  资产 id  ≡  role_resource.resource_id
```

第①层拿 `resource_id` 与 `Config.mcp` 的键比对；第②层用资产 id 做键。**两边必须是同一把钥匙**，
否则出现「配置里有、capability 却拒」或反过来的裂缝——不报错、不变红，只是功能时灵时不灵。
用例直接断言 `Object.keys(config)` 等于资产 id（`downlink.test.ts` 第一条）。

派生：**任何资产 id 都不能占用内建 server 的名字**（`governance_key_conflict`）——哪怕它今天
不可用。键空间是保留的，否则某天它变成可用时会悄悄覆盖治理入口。

## 4. 第三环：身份的两条通道

| 时机 | 通道 | 谁注入 | 落点 |
|---|---|---|---|
| 连接时 | remote `headers["X-User-ID"]` | `buildUserMcpConfig` | `downlink.ts` 的 `withIdentity` |
| 连接时 | local `environment["USER_ID"]` | 同上 | 同上 |
| 调用时 | `_meta["openhive/user"]` | opencode（004 已落地） | `packages/opencode/src/mcp/openhive-identity.ts` |

- **连接清单里的同名值一律覆盖**，包括大小写变体（HTTP 头名大小写不敏感，留着旧值就可能与注入值
  并存 ⇒ 服务端读到哪个取决于实现）。用例钉着大小写两种伪造。
- **不改动入参、不共享数组引用**：`command` 复制一份，`environment` / `headers` 展开成新对象——
  同一份连接清单会被多个用户复用，就地改会串身份。
- 服务端**应当以 `_meta` 为准**（它更细：同一连接上的每次调用都带，且由可信侧逐调用注入）；
  连接头用于「建连时就要认人」的 server（例如给 RLS 会话设置变量）。**两者不一致时按拒绝处理**。

### 信任边界（写清楚，别当成凭证）

| 通道 | 是不是凭证 | 前提 |
|---|---|---|
| `_meta["openhive/user"]` | 否（由 opencode 侧注入，模型看不到也改不了） | 信任 opencode 进程未被篡改 |
| `X-User-ID`（MCP remote） | **不是**，是**断言** | MCP server 只对可信网络 / opencode 开放；对外暴露必须再加认证 |
| `USER_ID`（MCP local） | **不是** | 同上；且本地进程由配置拉起 ⇒ 能改配置 = 能起任意进程 |

`X-User-ID` 是断言不是凭证，这条与 003 的勘误一致（明文头可用于冒充）：网关在 HTTP 侧
**剥掉并重注入**它，但这条保护**不延伸到 MCP server**——MCP 连接由 opencode 直接发起，
中间没有网关门。所以业务 server 暴露到网络时必须自己认证。

## 5. 治理 server：注册为**内建**（唯一例外）

治理 server 不是资产，没有资产 id 可授；而第①层只能做 **server 级**过滤。若照资产型 server
那样「无 `(mcp, <id>, read)` 授权就 deny」，它会对**所有人**不可见（包括管理员）。

处理：

1. 共享常量 `GOVERNANCE_MCP_SERVER = "openhive-governance"` 与名单 `BUILTIN_MCP_SERVERS`
   放在 `packages/auth/src/builtin-mcp.ts`（opencode 与 asset-service 都依赖 auth，
   禁止跨边依赖）；
2. `mcpServerNaming()` 只对名单里的**精确名字**打 `builtin: true`，不做前缀匹配——
   `openhive-governance-copy` 仍走授权行（对照用例钉着）；
3. `sessionRuleset` 见到 `builtin === true` ⇒ 该 server 的工具与资源两条规则**恒 allow**；
   **动作级**判定仍在第③层（`governance.ts` → `authorizeTransition`：提交需 `write`、
   发布需 `admin`）；
4. `buildUserMcpConfig` **恒下发**治理条目（零授权也下发），命令 =
   `["bun", "run", "<asset-service>/src/mcp-main.ts"]`，身份走 `USER_ID`。

信任边界：名单是**代码常量**、不是配置。若改成可配置，配置可写就等于可放行任意 server——
而那已经等于任意本地进程执行（详见 `builtin-mcp.ts` 文件头）。

### 5.1 验收清单（形态已变，2026-10-26）

- [x] 治理 server 的配置**不再**由 `buildUserMcpConfig()` 下发，改由内核监督器 upsert 全局配置
      （`mcp.openhive-governance` 是保留键；管理员手工改会在下次启动被覆盖）。
      `buildUserMcpConfig()` 仅为**业务 MCP 资产**保留，本次未接调用方（spec §9）。

上面第 4 条描述的是 `buildUserMcpConfig()` 作为**纯函数**的输出口径（stdio 形态）；生产已不走它，
改由单进程 HTTP 形态（见 `../../2026-10-26-governance-mcp-single-process-design.md`）。

## 6. 第四环：服务端 RLS 的接口契约

🔴 **本仓没有业务 MCP server，也没有任何 RLS 落地与验证。** 本节的每一条都**不是**
「已覆盖」，而是交给 F6/F7（资金 / 话单分析）与任何后续业务 MCP server 的**契约**。
契约底稿是 `packages/auth/src/rls.ts`（004 T008 的身份通道表与策略模板）；T014 在它之上
补了**连接时身份**这一条通道。

### 6.1 契约

| # | 要求 |
|---|---|
| C1 | **身份只从两个通道取**：每次调用的 `_meta["openhive/user"]`、连接时的 `X-User-ID` / `USER_ID`。**绝不从工具参数取**，也不从请求体/查询串取 |
| C2 | 缺身份 ⇒ **拒绝**（fail-closed），不得退回服务账号 / 全局角色，也不得返回全部行 |
| C3 | `_meta` 与连接身份**同时存在但不一致** ⇒ 拒绝（视为链路被改写） |
| C4 | 每个查询在**同一事务内** `SET LOCAL ROLE <受限账号>` ＋ `set_config('openhive.user_id', <id>, true)`；事务结束自动复位，池化连接不串身份 |
| C5 | 受限账号**不是**表 owner、不是 superuser、无 `BYPASSRLS`；业务表 `ENABLE` + **`FORCE`** `ROW LEVEL SECURITY` |
| C6 | 策略写成 `current_setting('openhive.user_id', true)`（PG GUC 名）——**不是** `openhive/user`（MCP `_meta` 键）。两者故意不同名：转义/命名规则不同，写成同一个是假镜像（`#003-05`） |
| C7 | 写路径另行授权（`GRANT INSERT/UPDATE`），不靠「读得到就能写」 |
| C8 | `X-User-ID` / `USER_ID` 只作为**断言**；server 暴露在网络上时必须另有认证（§4 信任边界） |

### 6.2 外部验收清单（在真 PG + 真业务库上做，本仓做不了）

1. **无身份**：不传 `_meta`、也不带连接身份 ⇒ 错误或零行，**不是全表**；
2. **正面**：用户 A 调用 ⇒ 结果与「以 A 的 GUC 直接 SQL 查」逐行相等；
3. **反面**：用户 B 调用、并在参数里显式写 A 的 id ⇒ 仍看不到 A 的行；
4. **角色检查**：服务端 `current_user` 不是 owner、`rolsuper = false`、`rolbypassrls = false`；
5. **池化串身份**：同一条连接先 A 后 B，B 的结果里没有 A 的行（验证 C4 的事务边界）；
6. **通道冲突**：`_meta` 说 A、连接身份说 B ⇒ 拒绝（C3）；
7. **网络暴露面**：从不可信网段直连，`X-User-ID: <管理员>` ⇒ 无法通过（要么连不上、要么认证失败）；
8. **审计**：能回答「这次查询以哪个 PG 角色、哪个用户 id 运行」。

### 6.3 为什么本仓不做

- 业务库、业务表、受限账号**全部归 F6/F7**（`spec.md:137`：本 feature 定义权限机制）；
- 本仓没有业务库的迁移目录（auth 的 `src/migrations/` 是 auth schema 的，两个库）；
- 在这里建一张示意表 + 策略 = 投机结构（D0-3 的反面），且会让「RLS 已覆盖」成为一句假话。

## 7. 用例与变异验证（实测）

### 7.1 用例

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `downlink.test.ts` | 17 | 授权过滤 7、连接与身份 3、治理注册 1、失败面 5、fixture 真进程 1 |
| `openhive-access-builtin-wiring.test.ts` | 3 | 精确名字打标、`-copy` 不算内建、空配置 → 空名单 |
| `openhive-access-mcp.test.ts`（新增） | 2 | 内建零授权 ⇒ allow，其它 server 仍 deny；同名无标记 ⇒ deny |

fixture（`test-fixtures/identity-server.ts`）只验「身份到达」：拉起**真子进程**，server 回答
`{ envUserId, metaUserId }`，证明连接时的 `USER_ID` 与调用时的 `_meta["openhive/user"]`
都真的到达了。它**不实现 RLS**，也不冒充 RLS 覆盖。

### 7.2 变异（拆完即还原）

| # | 拆掉什么 | 红在哪 | 条数 |
|---|---|---|---|
| A | core：`naming.builtin === true \|\|` → `false \|\|` | 内建零授权 ⇒ allow | 1 |
| B | `access.ts`：`builtin: BUILTIN_MCP_SERVERS.includes(server)` → `false` | 精确名字打标（helper 首条） | 1 |
| C | 去掉 `hasMcpReadGrant` 过滤 | 无授权不下发、只有 write 不下发、授权行指向别的资源类型 | 3 |
| D | 去掉 `isAssetUsable` 过滤 | 不可用状态（草稿等五种）不下发 | 1 |
| E | `withIdentity(...)` → `assertConnection(...)` | 首条下发（断言含身份头）、remote 覆盖、local 覆盖、fixture 真进程 | 4 |

`#003-03` 归类：A / B / D 是「拆掉判据」类（单条精确定位）；C 是「拆掉过滤」类（同一依据下
三条一起红，据实记录）；E 是「拆掉变换」类（凡断言产出含身份的用例一起红，4 条）。

## 8. 门禁实测（2026-10-25）

| 项 | 命令 | 实得 |
|---|---|---|
| asset-service 全量 | `cd packages/asset-service && bun test` | **187 pass / 0 fail**（12 文件） |
| auth | `cd packages/auth && bun test` | **286 pass / 3 skip / 0 fail** |
| core access | `cd packages/core && bun test test/access` | **25 pass / 0 fail** |
| opencode（三个文件） | `bun test test/server/openhive-access-{mcp,builtin-wiring,naming}.test.ts` | **16 pass / 2 fail**；两条 fail 都是**既有**环境问题：`openai@6.39.1` 缺 `version.mjs`（`Unhandled error between tests`），与本轮改动无关 |
| typecheck ×4 | 各包 `bun run typecheck`（`tsgo --noEmit`） | 0 errors |
| oxlint | 9 个改动文件 | 0 warnings / 0 errors |
| 锁文件 | `git diff --stat bun.lock` | 空 |

## 9. 已知缺口（按 `#002-02` 记，不算已覆盖）

| 缺口 | 现状 | 后续 |
|---|---|---|
| **RLS 未在本仓验证** | 第四环只有契约与验收清单（§6）；本仓无业务 MCP server | F6/F7 落地时按 §6.2 清单验收 |
| 无 `opencode.json` 写入器 | `buildUserMcpConfig` 只产数据；写到哪、谁触发、并发未定 | 部署侧接线 |
| 整应用接线测试被环境挡住 | 「真应用里配置 → capability」的端到端用例（`openhive-access-mcp-wiring.test.ts`）跑不起来（`openai` 缺 `version.mjs`），本轮以纯函数用例替代（`builtin-wiring`） | 修好依赖后补 |
| `mcp-main.ts` 真进程未测 | 需真进程 + 真 PG；PGlite 夹具不允许同实例第二个客户端 | 真 PG 冒烟（同 `governance.md` §5） |
| 业务连接清单无常存储 | `connections` 是入参，没有配置表 / 管理端写入路径 | 定存储形态后实现 |
| `X-User-ID` 非凭证 | 明文头可冒充；本仓的保护只在 HTTP 网关那一层 | server 侧认证 / 网络策略 |
| `_meta` 键无自动防漂移 | `openhive/user` 在 opencode（注入侧）与 `governance.ts` / fixture（消费侧）各有一份，跨包无法 import；契约已写进 §4 | 若要防漂移，需在 auth 提一个共享常量（本轮未做，避免扩大改动面） |

## 10. 同类落点（grep 记录，`#002-06`）

| 落点 | 结论 |
|---|---|
| `McpServerNaming` 的构造点 | 生产只有 `access.ts:mcpServerNaming` 一处（带 `builtin`）；core 自己的测试各自构造，不传 `builtin` |
| `sessionRuleset` 的调用点 | 生产只有 `access.ts:131` 一处传 `mcp`；`src/session/prompt.ts` 只在注释里提到，不构造名单 |
| `headers` / `environment` 里注入身份 | 生产只有 `downlink.ts:withIdentity` 一处（grep `headers:.*User` / `environment:.*USER_ID` 零其它命中） |
| 硬编码 `"openhive-governance"` | 只剩 `access.ts` 注释里的反例（`-copy` 不算内建），逻辑里零硬编码 |
| `governance.ts:439` 的 server 自报名 `"openhive-asset-governance"` | **不是配置键**：工具名前缀由 `Config.mcp` 的键（= `GOVERNANCE_MCP_SERVER`）决定，MCP `Server({name})` 只是握手元数据。两者不同不影响授权，但别把自报名当成键 |
| 内核 `Config.mcp` 的键 | 第①层与第②层都按「键 = 资产 id」；第三处读者（`/mcp` 动态端点）不在名单里，见 `004/state.md` 挂账 |
