# 资产授权：三级空间 + 四类权限 + 授权组（009 T004 · D0-4）

- **状态**：已落地（T004）
- **代码**：`packages/asset-service/src/authorization.ts`；迁移 `packages/auth/src/migrations/0010_role_type.sql`
- **判定入口**：`effectivePermissions()` / `canReadAsset()`（T011、T017 从这里接；T009 已接，见 `review.md`）
- **不在本文件**：状态机流转（T008）、两道关的流转编排（T009，见 `review.md`）、MCP 三层授权（T014）、收藏排序（T011）

## 1. 结论

| 项 | 约定 |
|---|---|
| 授权组 | `auth.role.role_type = 'group'` 的自定义 role（复用 role / user_role / role_resource） |
| 角色类型闭集 | `normal`（默认）/ `group`；DB CHECK 名 `role_type_check` |
| 三级空间 | `asset.visibility`：`global` 全单位 / `department` 同部门 / `personal` 仅作者 |
| 空间授什么 | **只授「读」**。部门可见 ≠ 部门可写 |
| 四类权限 | `read` / `write` / `review` / `admin`，**每种只蕴含 `read`**，彼此不蕴含 |
| 审 / 管怎么判 | 在资产服务里查授权行；**不进** `core/access/rbac.ts` 的 `resolve()`（它只产 read 的工具规则） |
| 知识库授权 | 只影响**可见性**；009 不做 RAGFlow 执行（D0-10），授权 ≠ 能检索 |
| 部门归属 | `auth.user.dept` 与 `asset.department` 自由文本精确相等（技术债：部门改名会断，F10） |

## 2. 判定规则

### 2.1 权限来源（并集）

```text
effectivePermissions(viewer, asset, grants) =
  作者身份            → read + write
  ∪ 命中的授权行      → read + 该行的 perm
  ∪ 三级空间（仅共享状态）→ read
```

- **命中的授权行**：`resource_type === asset.type` 且 `resource_id === asset.id`，两个条件同时成立。
- **任何授权都附带 `read`**：审核人要看得见才能审；写授权、管授权同理。
- **`write` / `review` / `admin` 互不蕴含**。`admin` 不蕴含 `review`——否则一个人既能审内容
  又能发布，T009 的「业务审核 + 技术发布分离」当场失效（design §3.3 的矩阵：系统管理员只有管）。
- **未知 perm 跳过**（fail-closed）：坏数据不能静默变成一次放行，更不能被猜成 `read`。

### 2.2 状态门

对**非作者、非被授权者**，空间只在共享状态下给读：

| 状态 | 空间可见 | 说明 |
|---|---|---|
| `published` / `iterating` / `offline` | 是 | 已下线仍可见（「不能用」归 T008），使用者收到通知后要能找到它 |
| `draft` / `in_review` / `pending_tech` / `archived` | 否 | 作者始终可见；审核人 / 管理员靠**显式授权**可见 |

不加这道门，作者把草稿的可见范围先设成 `global`，就等于对全单位公开未完成品。

**显式授权不受状态门限制**：给 `in_review` 资产授 `review` 正是让审核人看见它的方式。

### 2.3 三级空间

| 空间 | 读 | 来源 |
|---|---|---|
| 全局 | 全单位 | `visibility = 'global'` |
| 部门 | 同部门 | `asset.department === viewer.department`，两端都非空才比较 |
| 个人 | 仅作者 | 作者身份；其他人只能靠显式授权 |

空部门不与空部门匹配：自由文本的空串代表「未归属」，不是「同一个部门」。

### 2.4 授权组

```text
建组   createAuthorizationGroup(db, { id, name })   → auth.role(role_type='group')
拉人   addGroupMember(db, { groupId, userId })      → auth.user_role
授权   grantAssetToGroup(db, { groupId, assetId, perm }) → auth.role_resource
```

三个刻意的约束：

1. **必须是真的授权组**：`addGroupMember` / `grantAssetToGroup` 先查 `role_type`，
   给普通角色写授权行会被拒。外键只保证角色存在，不保证它是组——放过就会造出
   「看不见的授权组」，只能靠人翻表排查。
2. **`resource_type` 由资产真实类型决定**，调用方不填。让调用方填就有「把 skill 资产授成
   mcp」的口子；那样一行授权看起来完全合法、判定时永远匹配不上。
3. **资产必须存在**：`role_resource.resource_id` 没有外键（它同时承载三类资源），
   不查就能授出一个永远匹配不上的「幽灵权限」。

`role_type` 只回答「这是不是一个授权组」，**不参与** `grantsFor()` 的判定——判定只看
`user_role` / `role_resource`。别把标记当权限，也别用 `role.name` 做字符串约定（改名即静默失效）。

## 3. 与内核侧的分工

| 动作 | 内核（`core/access/rbac.ts`） | 资产服务（本文件） |
|---|---|---|
| `read` | 可投影成工具规则（`resolve()` 只产 read 的 allow） | 判定可见性 / 可用性 |
| `write` / `review` / `admin` | **没有出口**（不是工具调用） | 唯一判定处 |

`resolve()` 本次**未改动**。把 review/admin 塞进它会凭空发明两条没人请求的工具断言，
且它们根本不是工具。

## 4. 验证记录

### RED（先写用例，实得）

- `packages/asset-service`：`Cannot find module './authorization'` ⇒ **0 pass / 1 fail / 1 error**。
- `packages/auth`：`SyntaxError: Export named 'ROLE_TYPES' not found` ⇒ **0 pass / 1 fail / 1 error**。

### GREEN 门禁

- `bun test`（`packages/asset-service`）：**88 pass / 0 fail / 215 expect()**
  （新增 `authorization.test.ts` 26 条 / 51 expect）。
- `bun test`（`packages/auth`）：**286 pass / 3 skip / 0 fail / 524 expect()**
  （新增 4 条 role_type 用例；跳过的 3 条与本次无关）。
- 真 PG（`bun run --filter @opencode-ai/auth test:real-pg`）：**2 pass / 0 fail / 8 expect**——
  0010 在真实例上建列、中文注释落库、记账完整、二次运行 no-op。
- `bun run typecheck`（asset-service / auth）：退出 0。
- oxlint（改动 5 个文件）：**0 warning / 0 error**。

### 变异验证（逐条拆掉，实得变红条数与用例名）

| 拆掉什么 | 实得 |
|---|---|
| `spaceAllowsRead` 的状态门（`if (!SHARED_STATUSES.has(...)) return false`） | 恰红 1：`草稿 / 审核中 / 待技术发布 / 已归档：作者之外不可读` |
| 让 `admin` 蕴含 `review` | 恰红 1：`管授权：读 + 管，不带来写 / 审` |
| `grantAssetToGroup` 里的 `assertAuthorizationGroup` | 恰红 2：`授给普通角色 ⇒ 拒绝`、`授权组不存在 ⇒ 拒绝` |
| `matchedGrantPerms` 的 `resourceType` 匹配 | 恰红 1：`resourceType 不匹配的授权不生效` |

### 用例覆盖的判据

- 三级空间三档 + 空部门 + 状态门（含作者始终可见）；
- 四类权限的蕴含关系（写/审/管各自只带 read）；
- 授权按「资产 id + 资源类型」精确命中，不串资产、不串类型、未知 perm 被忽略；
- 授权组端到端：跨部门组员读到**个人**资产，组外同部门仍不可见（T004 的出参）；
- 建组/拉人/授权的失败路径：普通角色、组不存在、资产不存在、未知 perm、空白输入、悬空成员；
- 闭集镜像：`role_resource` 的 `resource_type` / `perm` CHECK ⇔ `ASSET_TYPES` / `ASSET_PERMS`；
  `role_type` CHECK ⇔ `ROLE_TYPES`（auth 侧）。

## 5. 未覆盖 / 后续

- **`listAssets` 尚不接收 viewer**：它今天是「数据源」，不是「已授权的视图」。可见性过滤在
  T005 的投影出口 / T017 的「无权资产不可见」接上；在那之前，调用方不能把它的结果直接当
  「这人能看什么」用。
- **没有撤销授权 / 移出组 / 删组的 API**：T004 的出参只要「可定向授权」；治理后台（T010）
  需要撤销时再补，届时同样要过 `assertAuthorizationGroup` 那一关。
- **`is_admin` 未接入资产权限**：D0-4 把它保留为治理后台总开关（F10），不是资产审核权。
- **review / admin 不进 `resolve()`**：这是设计边界，不是缺口；它们由 T009 直接查本文件。
- **knowledge_base 授权只影响可见性**：执行侧（RAGFlow）归 010；内核侧
  `TOOL_OF` 对 `knowledge_base` 仍是零映射（`core/access/rbac.ts` 自认的缺口）。
- **部门 id 化**：自由文本精确匹配，部门改名 / 合并会让授权与可见范围断开，等 F10 的组织架构表。
