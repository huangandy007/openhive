# AI 资产 · MCP 全流程设计

> **状态**：设计稿，待评审（2026-11-02）
> **用户裁定**：① 第 5 步用「全局一份配置 + 只按授权开门」；② 第 4 步用 **A（发布即可用）**，且 A 中必须包含「授权个人 / 多人」——理由是 MCP 能直接取数据，必须严格控到人。
> **关联**：`009-ai-assets/spec.md`、`009-ai-assets/mcp-downlink.md`、`2026-10-26-governance-mcp-single-process-design.md`、`2026-11-01-skill版本迭代-design.md`
> **面向**：实现者。每个 batch 开工前先按仓库 CLAUDE.md 的六步轨道走；本文件给的是**判据**（什么命令跑出什么结果算完成），不是实现细节的最终写法。

---

## 0. 一句话

把 MCP 从「内核自带的一项能力」补成**一件真正的资产**：管理员能建、能审、能授权到人；系统能把连接送到内核；民警在项目里看得见、用得上；每一次调用都能追溯。

今天这条链只通了后半截（内核连接 / 权限 / 身份），前半截（建、存、审、授权、下发）是断的。

---

## 1. 范围

### 1.1 本设计要做

| 编号 | 内容 | 对应缺口 |
|---|---|---|
| W1 | 配置来源收口：`mcp` 只认服务端权威配置；关闭运行期动态加 server | G6、G7 |
| W2 | 授权口径改为「可见即可用」；`targeted` 支持**选人（可多选）** | G8 |
| W3 | 新建 MCP 资产（草稿）+ 连接规格存储 + MCP 走通状态机（不搬文件） | G1、G2 |
| W4 | 发布前试连（含 local）；发布弹窗能选组 / 选人；允许「个人」档 | G3 |
| W5 | 配置同步器：资产库 → 全局配置（键 = 资产 id） | G4、G5 |
| W6 | capability 按可见性放行 MCP server（与 skill 同源） | A 的落地 |
| W7 | 使用记录与允许侧审计 | G10、G11 |
| W8 | 真栈端到端验收 | G12 |

### 1.2 不做（本设计的非目标）

- **每人一份 MCP 配置**：留到 Phase 2。Phase 1 用全局一份 + capability 过滤；代价写在 §9。
- **工具级授权**：仍是整台 server 开关。要分「只让查、不让改」，就拆成两台 server。
- **服务端 RLS**：仍按 `mcp-downlink.md` §6 的契约交付，本仓不实现、不验证。
- **凭据加密 / KMS**：连接规格以明文存 PG（访问受限），API 一律遮罩。加密留作后续缺口。
- **OAuth 形态的 MCP**：Phase 1 只支持 `local` / `remote` 两种。
- **知识库资产**：本文只谈 MCP；知识库走它自己的设计。
- **MCP server 自身**：业务 server 由外部团队交付，本仓只负责登记、下发、鉴权、带身份。

---

## 2. 用户旅程（八步，标出今天与目标）

| # | 步骤 | 今天 | 目标 | 批次 |
|---|---|---|---|---|
| 1 | 建 · 录入 MCP 资产 | 只能建 skill（`createDraftAsset` 写死 `type:"skill"`） | 治理后台建 `type:"mcp"` 草稿，填连接规格 | 2 |
| 2 | 存 · 连接规格 | 无存储；`AssetMetadata` 无连接字段 | 新表 `auth.asset_mcp_connection`；API 读回时遮罩 | 2 |
| 3 | 审 · 审核 + 发布前试连 | 状态机可复用；无试连 | 技术发布前真连一次、拉一次 `tools/list`；失败阻断 | 3 |
| 4 | 授权 · 谁能用 | 只认显式 `(mcp, id, read)`；指定人员只能选组 | **可见即可用**；`targeted` 可选组 + 选人（多人） | 1、3 |
| 5 | 下发 · 送到内核 | `buildUserMcpConfig` 无生产调用方 | 同步器把已发布 MCP 写进**全局配置**，键 = 资产 id | 4 |
| 6 | 连 · 内核接线 | 已有 | 不变（`mcp/index.ts`） | — |
| 7 | 权 · 整台开关 | 已有，但只看授权行 | capability 并入「读者可读的已发布 MCP」名单 | 1 |
| 8 | 用 · 调用 + 留痕 | `_meta` 身份已通；无 MCP 使用记录 | 每次调用记一条事实；拒绝侧照旧留审计 | 4 |

---

## 3. 架构

### 3.1 数据模型

#### 3.1.1 不改 `auth.asset`

资产元数据保持「描述它是什么」，不混「它怎么连」。理由：连接规格是**运行期接线**，生命周期与元数据不同（下线、归档、迁移都可能单独动它），混进同一行会让每次读资产都带着凭据。

#### 3.1.2 新表 `auth.asset_mcp_connection`（迁移 `0029`）

字段与内核 `ConfigMCPV1.Info` **一一对应**，同步器只做投影，不做翻译：

```sql
CREATE TABLE auth.asset_mcp_connection (
  asset_id      text PRIMARY KEY REFERENCES auth.asset(id) ON DELETE CASCADE,
  transport     text NOT NULL,
  url           text,
  command       text[],
  cwd           text,
  headers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  environment   jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  timeout_ms    integer,
  -- 最近一次「技术发布」时的连接规格快照；草稿期 / 迭代期改的是上面那组工作列
  published_config jsonb,
  -- 发布前试连的结果（只做展示与排障，不作为运行期判据）
  checked_at    integer,
  check_ok      boolean,
  check_error   text NOT NULL DEFAULT '',
  tool_count    integer,
  created_at    integer NOT NULL,
  updated_at    integer NOT NULL,
  CONSTRAINT asset_mcp_connection_transport_check CHECK (transport IN ('local', 'remote')),
  CONSTRAINT asset_mcp_connection_shape_check CHECK (
    (transport = 'remote' AND url IS NOT NULL AND command IS NULL)
    OR (transport = 'local' AND command IS NOT NULL AND url IS NULL)
  ),
  CONSTRAINT asset_mcp_connection_fields_check CHECK (
    (transport = 'remote' AND environment = '{}'::jsonb)
    OR (transport = 'local' AND headers = '{}'::jsonb)
  ),
  CONSTRAINT asset_mcp_connection_timeout_check CHECK (timeout_ms IS NULL OR timeout_ms > 0)
);
```

补充约束（用注释写清，不在 DDL 里硬塞）：

- 跨形态字段由 `asset_mcp_connection_fields_check` 与形状约束一起拒绝：remote 不能有 `command` / `environment`，local 不能有 `url` / `headers`。
- `ON DELETE CASCADE`：连接是资产的子明细，资产没了连接就没有意义。这与 `owner_id` 的 RESTRICT 取向不同，理由不同（一个是归属丢失，一个是明细残留）。
- 凭据（`headers` / `environment` 的值）**不出现在任何读接口的响应里**：`GET` 只返回键名与「是否已设置」，值一律 `"***(已设置)"`。

#### 3.1.3 个人授权不建表：复用 `role_resource`

见 §3.2.3。

#### 3.1.4 MCP 的生命周期：同一套状态，跳过文件步骤

**现状（实测）**：`transitionAsset()` 看见 `asset.type !== "skill"` 直接抛 `unsupported_asset_type`（`service.ts:542-547`），注释写明「MCP / 知识库的简化生命周期未在本任务实现」。而整条流转的文件步骤是目录搬移（`copy_to_pending` / `move_pending_to_publish` / `copy_publish_to_workspace` / `move_publish_to_archive`），MCP 没有内容目录。

**本设计的做法（最小改动）**：

1. 去掉 `unsupported_asset_type` 这道硬拒；
2. 在 `prepareStorageStep()` 开头：`asset.type === "mcp"` ⇒ 返回 `undefined`（**所有 storage intent 一律不落文件**）；
3. 状态机本身**不新建**一套：MCP 仍走 `draft → in_review → pending_tech → published → iterating → offline → archived`。

**为什么保留业务审核（与 009 FR-004 的「仅技术审核」有偏差）**：MCP 能直接取数据，多一道「用途与必要性」的业务审核与用户「严格控到人」的取向一致；而且零新动作、零新状态、API 与前端全部复用。若后续裁定要砍掉业务审核，只需在转移表里把 MCP 的 `submit_review` 目标改成 `pending_tech`（一处）。

**迭代**：MCP 的 `start_iteration` 不复制工作副本（`iterationWorkspace` 为 `null`）；作者在详情页直接编辑连接规格，再走 `submit_iteration → publish_iteration`（技术发布，重新试连）。`abort_iteration` 回退版本号，与 skill 同语义。

**连接规格的编辑窗口**：只有 `draft` / `iterating` 两个状态允许改连接（作者或管理员）。`in_review` / `pending_tech` 禁止——否则等于绕开审核改内容。

**已发布快照与工作副本（必须分开，否则迭代等于绕过审核）**：

- 可编辑的 `transport / url / command / headers / environment / timeout_ms` 是**工作副本**；
- `published_config`（jsonb）是最近一次技术发布时的快照，**同步器只读它**；
- `publish_tech` / `publish_iteration`：先试连工作副本 → 成功后把工作副本写进 `published_config` → 再改状态；
- `start_iteration`：什么都不用做（快照已是线上那份），线上继续服务；
- `abort_iteration`：把 `published_config` 写回工作副本，丢弃未发布的修改；
- 效果与 skill 的「发布目录 ↔ 工作副本」同构：**迭代中改坏了，线上不受影响**。

### 3.2 授权口径（用户裁定 A）

#### 3.2.1 一句话

**一份已发布（或迭代中）的资产，谁能「看见」，谁就能「用」。** 不再要求额外的 `(mcp, id, read)` 显式授权行。

#### 3.2.2 四档可见范围的实际含义

| 可见范围 | 谁能读 | MCP 含义 |
|---|---|---|
| `global` | 全单位 | 全单位可用 |
| `department` | 同部门（非空部门） | 本部门可用 |
| `targeted` | 作者 + 授权行命中的人 / 组 | **只给名单里的人和组** |
| `personal` | 仅作者 | **MCP 允许停在这一档**（2026-11-02 裁定）：发布后只有作者可读可用，其他人连能力清单里都看不到。skill / 知识库仍按原规则在发布时要求转共享档——它们有共享目录，MCP 没有 |

`targeted` 是「严格控到人」的正确档位。产品口径：**MCP 默认建议 `targeted`；只有确实全单位都该用的（例如查法规）才发布 `global`。** 这句写进发布弹窗的提示与审核清单，不是代码约束。

#### 3.2.3 「授权个人 / 多人」怎么落

现有判据**已经天然支持按人授权**，这是本设计最重要的一条事实：

- `grantsFor()`（`packages/auth/src/rbac.ts:101`）只 `join auth.user_role`，**不看 `role_type`**；
- `readableAssetCondition()`（`packages/asset-service/src/readable-sql.ts:76`）同样只 join，没有 `role_type = 'group'` 条件；
- `role_type` 的注释自己写明「它只是标记，不是判定输入」（`rbac.ts:39`）。

所以实现方式是**私有角色**：

| 项 | 约定 |
|---|---|
| 角色 id | `personal:<userId>`（前缀就是标记） |
| 角色名 | `个人授权：<显示名>·<userId>`（`role.name` 有 UNIQUE，不能只用显示名） |
| `role_type` | `normal`（**不加新值、不做迁移**） |
| 授权行 | 该资产该给什么权限就写什么权限；MCP 只需要 `read` |
| 撤销 | 删 `auth.user_role` 一行即可，天然按人撤销 |
| 离职 / 调岗 | 按 `user_id` 一次清空该用户所有私有角色成员关系 |

**为什么不是新表**：新表要在 `canReadAsset()`（内存）和 `readableAssetCondition()`（SQL）**两处**各加一条分支，还要改 `grantsFor()` 的取数——判据仍然只有一份，但投影面扩大到三处，`#010-06`（两套来源各判一次）的风险显著上升。私有角色**零改动**通过现有两条判据。

**为什么不是「把个人塞进一个组」**：组是共享容器，撤销一个人要改组；而且发布重设时 `setAssetReadGroups` 会按组整体清掉，个人授权会被误伤。私有角色与组是**两条独立渠道**。

#### 3.2.4 写入与重设

新增两个函数（`packages/asset-service/src/authorization.ts`）：

```ts
grantAssetToUser(db, { userId, assetId, perm })   // 找不到私有角色就建，再写 role_resource
setAssetReaders(db, { assetId, groupIds, userIds }) // 先验后删后写，替代 setAssetReadGroups
```

`setAssetReaders` 的重设范围：

- 删：**该资产**的 `read` 行中，`role_id` 属于组（`role_type = 'group'`）**或**属于私有角色（`role_id like 'personal:%'`）的那些；
- 不删：运维直配的普通角色行（既有的「另一条渠道」口径不变）；
- 至少一个组或一个人，否则拒绝（现有 `授权组清单()` 的提示改为「至少要一个授权组或一个人」）。

**顺序仍是先验后删后写**（`assertAssetReadGroups` 先跑完），保证「有一个人写错」时一条都不删（`#004-09`：门在副作用之前）。

#### 3.2.5 与发布状态的关系

- 授权行不受状态门限制（现有语义）：给 `in_review` 的资产授 `review` 仍是让审核人看见它的方式。
- 但 **MCP 只有 `published` / `iterating` 才进下发名单**（`isAssetUsable`），所以「审核中就能用」不存在。

### 3.3 配置来源与同步（B5）

#### 3.3.1 决策：全局一份

- 所有业务 MCP server 写在**内核全局配置**（`D:\openhive-stack-state\config\opencode\opencode.jsonc` 所在的同一份）的 `mcp` 段；
- 键 = 资产 id；
- 每个用户的差异**不在配置文件里**，而在 capability 规则集里（§3.4）。

这条选择的代价（明写）：不该有的人也会**连上**这台 server（连接在实例启动时按配置建立），只是工具被 capability 拒掉。Phase 2 改「每人一份配置」时再消除。

#### 3.3.2 闭合 G6：`mcp` 是受保护键

现状（实测）：`config.ts:412-424` 先合并全局配置，再把项目目录里的 `.opencode/opencode.json(c)` 合并进来（`mergeDeep`，**后到胜**）。用户沙箱里的这份文件是民警可写的 ⇒ 可以把已授权 server 的配置键改指到自己的本地进程，工具名前缀不变，capability 照旧放行 ⇒ **整条授权被静默绕过**。

修法（additive，不引入新依赖）：

> 在 `Config` 加载完成**所有**合并之后，把 `mcp` 恢复成「全局来源」的那一份快照。

- **快照**：全局配置（`config.ts:412-413`）与 `OPENCODE_CONFIG`（:415-418）合并之后、项目级文件（:420-424）与 `.opencode` 目录（:438-448）合并之前，把 `result.mcp` 存一份；
- **恢复**：上述两个项目级合并块都跑完之后、`load` 返回之前，把 `result.mcp` 写回快照；
- 语义：项目级配置**不能新增、不能覆盖、不能删除**任何 MCP server。其它键（agent / mode / plugin / instructions）行为不变。
- 不采用 `OPENCODE_DISABLE_PROJECT_CONFIG`：它会一并关掉项目级 agent / 指令 / 插件，副作用远大于本问题。

不改上游文件结构，只在 fork 里加一段「恢复快照」+ 注释标明「这是要保留的定制」，符合「最小化与官方合并冲突」。

#### 3.3.3 闭合 G7：关闭运行期动态加 server

`POST /mcp` 只写 `InstanceState`、不回写配置，capability 名单里没有它 ⇒ 它的工具落回上游 `ask`（可自批）；它还能加 `type:"local"`（任意进程）。

Phase 1 处理：**该端点返回 403**，并在响应体说明「MCP server 只能由资产发布流程登记」。理由：保留它等于保留一条不受资产库约束的旁路。若将来确需动态加载，必须同时满足「写权威配置 + 走资产登记」两个条件，另开设计。

#### 3.3.4 同步器

新增模块 `packages/opencode/src/server/openhive/mcp-config-sync.ts`。

**输入**（纯读，来自 `auth` 库）：

```sql
select a.id, c.published_config
from auth.asset a
join auth.asset_mcp_connection c on c.asset_id = a.id
where a.type = 'mcp'
  and a.status in ('published', 'iterating')
  and c.published_config is not null
```

**输出**：`Record<assetId, ConfigMCPV1.Info>`，从 `published_config` 1:1 投影（**不读工作副本**，见 §3.1.4 I7）。`enabled` 取快照里的值。

**写入**：新增 `Config.replaceGlobalMcp(entries)`（`config.ts` 内、与 `updateGlobal` 同级）：

- 读全局配置文件 → 把 `mcp` 键**整体替换**为 `entries ∪ 受保护键`（受保护键 = `BUILTIN_MCP_SERVERS`，当前只有 `openhive-governance`，其值从现存配置原样保留）；
- 复用现有 jsonc 解析 / 序列化与 `invalidate()`；
- 直接写文件（沿用 `updateGlobal` 的写法），不做 `mergeDeep`；删除条目靠整段替换，不靠「写 `null`」（`patchJsonc` 不支持删除）。

**为什么必须整体替换**：只做合并的话，资产下线 / 归档后旧的连接（含凭据）会永远留在配置里。整体替换让「配置 ≡ 已发布资产集合」成为不变式。

**由此产生的行为，要写在部署文档里**：全局配置的 `mcp` 段从此是**派生数据**——除 `BUILTIN_MCP_SERVERS` 外，手工写进去的 server 会在下一次同步时被清掉。要加一台 server，唯一入口是资产库（建 MCP 资产 → 发布）。

**触发时机**：

1. 内核启动、第一个实例建立之前（保证新会话的 `Config.mcp` 已就绪）；
2. 资产生命周期流转成功后（`publish` / `offline` / `archive` 的 HTTP 出口末尾）；
3. 每 60 秒一次兜底重扫（防止 2 的触发丢失或进程重启间隙）。
4. 上述三处共用**一个**串行写入器（进程内锁），避免与治理监督器的就绪写入互相覆盖。治理监督器改为走同一个写入器。

**失败处理**：DB 读失败 / 写盘失败 ⇒ 记 error 日志，**保留上一份配置不变**（不写半份）。会话照常可用，只是新 server 不出现。

**连接生效时机（如实写）**：内核的 MCP 连接在**实例启动**时建立（`InstanceState` 按项目目录缓存）。同步器改的是配置，已开着的项目要等实例重建；与 `mcp/index.ts` 现有语义一致，不额外做热重连。

### 3.4 capability 规则集（B6）

#### 3.4.1 新增「读者可读的已发布 MCP server」名单

在 `packages/opencode/src/server/openhive/` 新增（或并入 `skill-availability.ts`）：

```ts
scanUsableMcpServers(db, viewer): Promise<{ names: string[]; skipped: { id: string; reason: string }[] }>
```

- 查询：`select id from auth.asset where type = 'mcp' and status in ('published','iterating') and <readableAssetCondition(viewer)>`；
- **判据复用 `readableAssetCondition()`，不另写一套**（`#004-02` / `#010-06`）；
- `names` 就是资产 id，也就是配置键。

#### 3.4.2 `sessionRuleset` 加第四个入参

`packages/core/src/access/session.ts`：

```ts
export function sessionRuleset(
  grants: readonly AccessRbac.Grant[],
  mcp?: readonly McpServerNaming[],
  skillNames?: readonly string[],
  mcpVisible?: readonly string[],
): PermissionV1.Ruleset
```

② 段每台 server 的判定改为：

```ts
const granted =
  naming.builtin === true ||
  grants.some(...) ||                      // 授权行命中（保留：非资产来源的直配）
  visible.has(naming.server)               // 新增：读者可读的已发布资产（资产 id = 配置键）
```

**仍然每台 server 恰好两条规则**（工具前缀 + 资源 pattern），保持现有不变式和测试形状。`mcpVisible` 省略时行为与今天逐字相同（兼容既有调用点）。

#### 3.4.3 三个出口同源

| 出口 | 落点 | 判据 |
|---|---|---|
| 工具清单（看不见整台） | `tool/registry.ts:285` 的 `Permission.visibleTools` | 同一个 ruleset |
| 系统提示词里的 server 说明书 | `session/system.ts` 的 `mcp()` | 同一个 ruleset |
| 执行期 `ask` | `session/tools.ts:413` | 同一个 ruleset |

这条不变式由现有矩阵测试守着，B6 只改「ruleset 怎么算出来」，不改这三个出口。

### 3.5 调用与身份（复用 009，不改）

- 每次调用 `_meta` 贴 `openhive/user` / `openhive/directory`（`mcp/openhive-identity.ts`）；
- 连接的 `X-User-ID` / `USER_ID` 通道保留给「建连时就要认人」的 server，Phase 1 不在全局配置里注入（全局一份，注入就成了「所有人的身份相同」）；
- 服务端必须自己按 `_meta` 做行级隔离（契约见 `mcp-downlink.md` §6）。

---

## 4. 不变式（实现期必须被测试钉住）

| # | 不变式 | 钉法 |
|---|---|---|
| I1 | `Config.mcp` 的键 ≡ 已发布 MCP 资产的 id | 同步器单测：期望对象键集等于 fixture 资产 id 集 |
| I2 | 项目级配置不能新增 / 覆盖 / 删除任何 MCP server | 构造「全局有 A、项目有 A→本地命令、项目新增 B」三种输入，断言最终只剩全局 A |
| I3 | `targeted` 资产的可读性只来自作者 + 授权行 | `readableAssetCondition` 双投影相等断言（既有） |
| I4 | 「个人授权」与「授权组」互不误伤 | 重设 `setAssetReaders` 时，组 A 的授权被替换、个人 P 保留与否按入参，运维直配行始终保留 |
| I5 | 每台 MCP server 在 ruleset 里恰好两条规则，且动作一致 | 既有矩阵测试 + 新增「可见但无授权行 ⇒ 两条 allow」 |
| I6 | 配置里出现、但不在资产库的 server ⇒ 恒 deny | 新增用例：手工塞一个键，零授权会话两条 deny |
| I7 | 迭代中的工作副本改不动线上 | 改工作副本后同步器产出不变；`publish_iteration` 后才变；`abort_iteration` 后回到快照 |

---

## 5. 安全

### 5.1 信任边界（与 009 一致，新增一条）

| 通道 | 是不是凭证 | 前提 |
|---|---|---|
| `_meta["openhive/user"]` | 否 | 信任内核进程未被篡改 |
| `X-User-ID` / `USER_ID` | **不是**（断言） | server 只对可信网络开放；对外必须自己认证 |
| 全局配置的 `mcp` 段 | — | **只有服务端可写**；民警沙箱里的同名键一律被 I2 丢弃 |

### 5.2 凭据

- 存：明文进 `auth.asset_mcp_connection`（PG 访问受限）；
- 读：任何 HTTP / MCP 读接口都不返回值，只返回键名与「已设置」；
- 显：发布弹窗只显示「已配置 N 个请求头」，不显示内容；
- **已知缺口**：静态凭据无加密、无轮换。记入 §9，不假装已覆盖。

### 5.3 谁能建 MCP 资产

**只有管理员**（治理后台）。普通民警的「让 AI 帮我建资产」入口只开放 skill。理由：`local` 形态等于在内核宿主上执行任意命令，`remote` 形态等于向任意地址发请求。

### 5.4 试连风险

发布前试连会真的拉起 `command`（`local`）或访问 `url`（`remote`）。因此：

- 只有管理员能触发发布；
- 试连超时 5 秒（可由连接规格覆盖，上限 30 秒），超时即杀子进程树；
- 试连失败**阻断发布**，错误原文进 `check_error` 供排障。

---

## 6. 失败模式

| 场景 | 行为 | 用户看到 |
|---|---|---|
| 连接规格非法（缺 url / 缺 command / 跨形态字段） | 建草稿时 400，不落库 | 表单字段错误 |
| 发布前试连失败 | 流转拒绝，`check_error` 落库 | 「连不上：<原因>」 |
| 同步器写盘失败 | 保留上一份配置，日志 error | 新 server 不出现；旧的不受影响 |
| server 启动时连不上 | 内核标 failed，会话可用（既有） | 那台 server 的工具不可见 |
| server 的工具名与另一台撞前缀 | 建会话失败（既有） | 明确报「server 名互相覆盖」 |
| 资产下线 / 归档 | 同步器整体替换后该键消失；已开实例等重建 | 新会话不可见 |
| 个人被撤销 | 删 `user_role` 一行；下一个会话按新规则集 | 新会话不可用 |
| DB 不可达 | capability 建会话失败（既有 fail-closed） | 不造出可自批的会话 |

---

## 7. 分四批推进（每批独立可发布）

### 批次 1 · 地基：配置收口 + 授权口径

**交付**

1. `Config` 的 `mcp` 快照恢复（§3.3.2）；
2. `POST /mcp` 关闭（§3.3.3）；
3. `grantAssetToUser` / `setAssetReaders` + 私有角色（§3.2.4）；
4. `scanUsableMcpServers` + `sessionRuleset` 第四入参（§3.4）；
5. `capabilityFor` 传入名单（`access.ts:167`）。

**完成判据**

```bash
cd packages/opencode && timeout 300 bun test test/config/openhive-mcp-authoritative.test.ts
# 期望：I2 三条断言全绿；去掉快照恢复后必红

cd packages/opencode && timeout 300 bun test test/server/openhive-access-mcp.test.ts
# 期望：既有全绿；新增「可见但无授权行 ⇒ allow」「配置有、资产无 ⇒ deny」全绿

cd packages/asset-service && timeout 300 bun test src/authorization.test.ts
# 期望：个人授权写入 / 撤销 / setAssetReaders 不误伤三组用例全绿

cd packages/core && timeout 300 bun test test/access
# 期望：全绿；mcpVisible 省略时与旧行为逐字相同
```

外加：受影响 package 的 `bun run typecheck` 0 error、改动文件 `bunx oxlint` 0 warning。

### 批次 2 · 建与存

**交付**

1. 迁移 `0029_asset_mcp_connection`；
2. `createMcpDraft`（`packages/asset-service/src/service.ts`）+ 连接读写模块（读遮罩）；
3. `POST /openhive/assets/draft` 接受 `type:"mcp"`，管理员限定；
4. `transitionAsset` 支持 MCP：去掉硬拒，`prepareStorageStep` 对 mcp 一律返回 `undefined`（§3.1.4）；
5. 治理后台「新建 MCP 资产」表单（名称 / 描述 / 分类 / 可见范围 / 传输方式 / url 或 command）；
6. 资产详情页 MCP 分支：显示传输方式、工具数、试连结果、请求头键名（值遮罩）；
7. 连接编辑接口 `PATCH /openhive/assets/:id/connection`：仅 `draft` / `iterating`、仅作者或管理员。

**完成判据**

```bash
cd packages/asset-service && timeout 300 bun test src/mcp-connection.test.ts
# 期望：DDL 约束、跨形态字段拒绝、读遮罩、级联删除 全绿

cd packages/asset-service && timeout 300 bun test src/mcp-lifecycle.test.ts
# 期望：MCP 全状态流转不碰文件系统（用「根目录不存在也不失败」钉住）；
#       非 draft/iterating 改连接被拒；skill 行为不变

cd packages/opencode && timeout 300 bun test test/server/openhive-assets-mcp-draft.test.ts
# 期望：非管理员被拒；合法草稿成功且 type=mcp；非法连接规格被拒且不落库

cd packages/asset-service && bun run typecheck   # 0 error
```

真库迁移只在**用户批准**后对远端 PG 执行；本地用 PGlite 夹具跑 DDL。

### 批次 3 · 审与发

**交付**

1. 发布前试连（`probeMcpConnection`，**local / remote 都强制**；结果落 `checked_at/check_ok/check_error/tool_count`；local 超时杀整个进程树）；
2. `publish_tech` / `publish_iteration` 流转前置调用试连，失败阻断；成功后把工作副本写进 `published_config`；`abort_iteration` 把快照写回工作副本；
3. 发布弹窗「指定人员」支持选组 + 选人（多选）；
4. 服务端入参 `groupIds` + `userIds`，走 `setAssetReaders`；
5. 发布提示：「MCP 默认建议指定人员；全单位可用才选全局」；
6. `personal` 档对 MCP 放行：`withPublishScope` 的个人拒绝只对**有共享目录的类型**生效（§3.2.2）。

**完成判据**

```bash
cd packages/asset-service && timeout 300 bun test src/mcp-probe.test.ts
# 期望：remote 正常 / 超时 / 拒绝连接；local 正常 / 命令不存在 / 超时杀进程树 全绿

cd packages/asset-service && timeout 300 bun test src/authorization.test.ts src/review.test.ts
# 期望：试连失败阻断流转；选人发布后个人可读、组外不可读；
#       MCP 以 personal 发布成功且只有作者可读；skill 以 personal 发布仍被拒 全绿

cd packages/app && bun run typecheck && bun test src/governance
# 期望：弹窗提交带 userIds；取消勾选后重设不残留
```

### 批次 4 · 下发与观测

**交付**

1. `Config.replaceGlobalMcp` + `mcp-config-sync.ts` + 单写者锁；
2. 治理监督器改走同一写者；
3. 生命周期出口触发同步 + 60 秒兜底；
4. `downlink.ts` 口径更新：显式 read 判据退役，`withIdentity` 保留（Phase 2 复用），注释与 `mcp-downlink.md` §3 同步修订；
5. 使用记录：`asset_usage_event` 加 `kind` / `tool_name`（迁移 `0030`），抽取器识别 MCP 工具；无法唯一归因的工具名跳过并告警；
6. 真栈端到端验收。

**完成判据**

```bash
cd packages/opencode && timeout 300 bun test test/server/openhive-mcp-config-sync.test.ts
# 期望：I1 键集相等；I7 迭代中改工作副本不影响产出；下线后键消失；
#       写失败保留上一份；治理键不被覆盖 全绿

cd packages/opencode && timeout 300 bun test test/server/openhive-asset-usage.test.ts
# 期望：MCP 调用归因到资产 id；歧义工具名不归因（skipped 有记录）全绿

cd packages/asset-service && timeout 300 bun test src/downlink.test.ts
# 期望：身份注入用例保留；显式 read 判据相关用例按新口径改写后全绿
```

**真栈验收（用户实操）**：

1. 管理员建一台测试 MCP（remote，指向本地 fixture server）→ 提交 → 发布（`targeted`，只选张三）；
2. 张三新开会话：工具清单里有 `<assetId>_*`；李四新开会话：没有；
3. 张三调用成功，服务端收到 `_meta` 身份正确；使用记录出现一条；
4. 管理员把张三撤掉、改授权李四：张三**新会话**不可用，李四可用；
5. 资产下线：同步器移除配置键；新会话工具消失。

---

## 8. 测试与变异验证计划

按 CLAUDE.md 六步轨道，每个 batch 的每条改动都要：

1. 先红：新用例在改前跑，记录实得值；
2. 再绿；
3. **变异验证**：拆掉修复那一行，记录哪几条红（按 `#003-03` 三类据实记）；
4. 门禁：受影响 package 的 typecheck + 测试 + oxlint；
5. `grep` 同类落点逐个打勾（`#002-06`）。

预置变异点（实现时逐条做）：

| 变异 | 期望红 |
|---|---|
| 去掉 `Config` 的 mcp 快照恢复 | I2 三条 |
| `sessionRuleset` 的 `visible.has(...)` → `false` | 「可见但无授权行 ⇒ allow」及相关能力测试 |
| 私有角色前缀判断 `like 'personal:%'` 去掉 | I4「个人行被误删 / 不留」 |
| 同步器写盘失败时改成「写半份」 | 「写失败保留上一份」 |
| `setAssetReaders` 去掉「先验后删」的顺序 | 「有一个人写错时一条都不删」 |
| 试连失败不阻断流转 | 发布失败用例 |

---

## 9. 已知缺口（不写成已覆盖）

| 缺口 | 现状 | 后续 |
|---|---|---|
| **Phase 1 的连接是全员建立** | 全局配置里所有已发布 server，所有用户实例都会连 | Phase 2：每人一份配置 + 连接级身份 |
| **个人档 MCP 也会被全员建连** | 只有作者能调工具，但连接（含凭据）对宿主上所有实例可见 | Phase 2 按用户下发后消除 |
| **凭据明文** | PG 内明文，API 遮罩 | 加密 / KMS / 轮换 |
| **RLS 不在本仓** | 只交付契约与外部验收清单 | 业务 server 验收 |
| **工具级授权** | 整台开关 | 拆 server 或改权限模型 |
| **本地 server 在宿主执行** | 管理员可发布任意 `command` | 只允许白名单命令 / 容器化 |
| **配置同步有窗口期** | 发布后最多 60 秒才写进配置 **＋ 实例重建**才生效（`MCP.state` 按目录缓存，不重读） | 事件推送 + 热重连 |
| **`POST /mcp` 关闭** | 已关；若外部客户端依赖此端点会失败 | 另开设计 |
| **使用归因歧义** | 工具名前缀无法唯一映射时不归因；`抽取()` 返回 `ambiguous` 计数并 WARN 一次（**不落库**） | 需要审计时再落 `skipped` 明细表；或给资产 id 定更严的格式 |

---

## 10. 决策记录

| # | 决策 | 理由 | 反悔成本 |
|---|---|---|---|
| D-1 | Phase 1 全局一份配置 | 零内核改动、最快端到端；服务端权威配置源可控 | 中：迁移到每人一份涉及下发器与连接身份 |
| D-2 | A：可见即可用 | 与 skill 同一条产品主路径，判据只有一份 | 低：把显式授权判据加回来是一处分支 |
| D-3 | 个人/多人授权用私有角色 | 现有两条判据零改动；撤销按人干净 | 低：将来可迁到 `role_type='personal'` 或独立表 |
| D-4 | 连接规格独立表 | 连接生命周期与元数据不同；不把凭据混进每次读资产 | 低 |
| D-5 | `mcp` 是受保护键 + 关闭 `POST /mcp` | 用户沙箱可写的配置能静默绕过整条授权 | 低 |
| D-6 | 同步器整体替换 `mcp` 段 | 「配置 ≡ 已发布集合」可断言；避免凭据残留 | 低 |
| D-7 | MCP 建资产仅管理员 | `local` = 任意命令执行 | 低 |
| D-8 | 发布前试连**包含 local**（用户 2026-11-02 裁定） | 连接规格写错时，宁可发布前就失败，也不要发布后全员连不上 | 低 |
| D-9 | **允许 MCP 用「个人」档**（用户 2026-11-02 裁定） | MCP 没有共享目录，个人档在语义上成立；个人服务器只给作者自己用 | 低 |
| D-10 | 使用记录明细沿用「仅系统管理员」（用户 2026-11-02 裁定） | 与 skill 同一口径，不新开口子 | 低 |
| D-11 | MCP 复用 7 状态机、保留业务审核、跳过全部文件步骤 | 零新动作 / 新状态；MCP 能取数，多一道必要性审核与「严格控制」一致 | 低（改一处转移目标即可砍掉业务审核） |

---

## 11. 已裁定（2026-11-02）

| # | 问题 | 裁定 |
|---|---|---|
| Q1 | 发布前试连是否包含 `local` | **包含**。`local` 与 `remote` 一视同仁，超时杀进程树 |
| Q2 | 是否允许 MCP 资产用「个人」可见范围 | **允许**。发布后只有作者可读可用；skill / 知识库保持原规则 |
| Q3 | 使用记录明细给谁看 | **仅系统管理员**，沿用 skill 口径 |

以上三条已并入 §3.1.4、§3.2.2、§7 的交付与判据。
