# 资产治理 MCP server（009 T012 / T013 · FR-004 / FR-008）

- **状态**：已落地（T012 提交 / 发布；T013 制作入口）；**尚未下发 / 注册**（归 T014）
- **代码**：`packages/asset-service/src/governance.ts`（工具与协议）、
  `packages/asset-service/src/service.ts` 的 `createDraftAsset`（草稿登记）、
  `packages/asset-service/src/mcp-main.ts`（stdio 入口）
- **适用**：模型代民警执行「登记草稿」「提交审核」「技术发布」三个动作
- **不在本文件**：生命周期与两道关（T008 / T009）、MCP 授权三层与下发（T014）、
  站内信（T010，本 server 经 `transitionAsset` 自动触发）

## 1. 结论

| 项 | 约定 |
|---|---|
| 宿主 | `asset-service` 内部模块，**不进** `packages/opencode/src/mcp/`（那是 MCP **client** 目录，D0-9 的警告） |
| 传输 | stdio（`mcp-main.ts` 挂 `StdioServerTransport`） |
| 工具 | 三个：`create_skill_draft` / `submit_skill_for_review` / `publish_skill` |
| 动作 | 提交 / 发布工具名 → 生命周期动作**写死**（`submit_review` / `publish_tech`），不开放 `action` 参数 |
| 身份 | `_meta["openhive/user"]`；缺 / 用户不存在 / `status != 1` ⇒ 拒绝 |
| 权限 | 流转交给 `transitionAsset` → `authorizeTransition()`：提交需 `write`，发布需 `admin`；建草稿只要求账号有效 |
| 源目录 | 只收相对路径；相对 MCP 进程 cwd 解析后必须仍在 cwd 内 |
| 失败 | 返回 `isError: true` + `错误码：<code>；<message>`；状态 / 文件 / 资产行均不动（判据在副作用之前） |
| 通知失败 | `isError: false`，正文带 `notification: "failed"`——动作已生效，不谎称失败 |

## 2. 为什么放 asset-service，而不是 plan.md 写的 `packages/opencode/src/mcp/`

D0-9 实测：opencode 包只有 MCP **客户端**，`src/mcp/` 是 client 模块目录；把 server 放进去会让
「谁是 client、谁是 server」含混。T012 的推荐路径是独立宿主，本轮选择放在**我们自己的**
`asset-service`：

- 工具实现直接调 `transitionAsset`，**不经过 HTTP**（资产 HTTP 接口今天不存在，见 `state.md`）；
- 单进程内只有一条授权出口（`#005-24`），不需要在 server 里再写一份权限判定；
- 与上游 opencode 零文件交叉，符合「最小化合并冲突」。

代价：`packages/opencode` 今天不依赖 `asset-service`（也不应该加这条边）。所以 **T014 下发时**
由配置把入口写成 `bun run <repo>/packages/asset-service/src/mcp-main.ts`，不需要 import 关系。

## 3. 工具语义

### `create_skill_draft`（T013 制作入口）

```json
{
  "name": "资金流水分析",
  "description": "按账户汇总流水，标出异常进出",
  "category": "intelligence",
  "tags": ["资金", "流水"],
  "visibility": "personal",
  "sourceDirectory": "projects/资金分析/skill"
}
```

1. `sourceDirectory` 与提交同一套边界：相对路径、解析后仍在 cwd 内（`source_outside_workspace`）；
2. 目录里必须有 `SKILL.md`，且 frontmatter 里有非空 `name`（`skill_file_not_found` /
   `skill_frontmatter_invalid`）——**不拿目录名或显示名兜底**，否则一份坏文件也会被登记成资产；
3. 作者姓名 / 部门取 `auth.user` 档案，模型传了也不收（`additionalProperties: false` 只是
   提示，SDK 不替我们校验，所以代码里直接不读 `department`）；
4. `visibility` 默认 `personal`；`category` 必须在 `categories.ts` 的 seed 里；
5. 写元数据走 `createDraftAsset()`：正式校验 + `insertAsset`，**不复制文件**。

**为什么入口没有前端控件**：FR-008 / design §5.1 明确「入口 = 右栏 AI 对话，无需专门入口」。
文件由模型在工作区里用普通写工具生成；本工具补的是模型做不了的两件事——按身份落作者 /
部门、把元数据写进资产库。今天它要等 T014 注册 / 下发后才出现在模型的工具清单里；在那之前
「对话生成文件」已经可用，「登记资产」这一半要等 T014 打通。

**为什么草稿不走 `storeAsset`**：`storeAsset` 是「复制沙箱 → 共享根 + 写元数据」。草稿的
存储约定相反：停在作者沙箱，`assetLocation("draft")` 明确返回 `undefined`。硬套会先造一份
没人读取的共享目录，再让提交时的源目录出现两份。`createDraftAsset` 仍走资产服务的正式
校验与写入路径，不手拼 SQL、不伪造元数据。

### `submit_skill_for_review`

```json
{ "assetId": "asset_1", "sourceDirectory": "projects/资金分析" }
```

1. `sourceDirectory` 必须是**相对路径**；`resolve(cwd, value)` 后 `relative(cwd, resolved)`
   不得以 `..` 开头，也不得是绝对路径（`source_outside_workspace`）；
2. 调 `transitionAsset(action = "submit_review")`：文件复制到 `pending/`，元数据 `draft → in_review`；
3. 站内信推给持有 `review` 授权的人（T010 矩阵）。

### `publish_skill`

```json
{ "assetId": "asset_1" }
```

`pending_tech → published`：`pending/` 移入发布目录；只有 `admin` 能调（`review` 不蕴含 `admin`，
作者身份也不派生管理权——各有用例钉住）。

### 为什么只开放这三个工具

设计里的 `list_my_skills()` 没有进 T012 / T013（任务清单只列了这些）。流转工具的输入是
**资产 id**，描述里明确写「不是 skill 显示名」——避免模型拿名字猜 id、猜错就提交了别人的
资产。按名字列资产的能力留给后续工具（需要先想清楚按谁过滤、是否过 `canReadAsset`）。

## 4. 身份与 capability 的分层

| 层 | 位置 | 今天的状态 |
|---|---|---|
| ① 工具清单过滤 | opencode capability（`AccessSession.sessionRuleset`） | 已有机制；治理 server **尚未注册**，模型今天看不到这两个工具（T014） |
| ② 工具执行守卫 | opencode 侧执行器 | 同上 |
| ③ server 内硬拦 | 本文件 | 已落地：无身份 / 停用 / 无权限都在**副作用之前**拒绝 |

第③层是 T012 真正交付的东西。它不依赖前两层是否可靠：即使模型幻觉出一次调用，
也会拿到 `actor_not_allowed`，资产状态与文件都不动。

**部门从库里取**（`auth.user.dept`），不听参数——否则调用方可以自报部门去蹭部门空间。

## 5. 已知残差

| 项 | 现状 | 后续 |
|---|---|---|
| 注册 / 下发 | 没有任何 `opencode.json` 把本 server 写进 `mcp` 段；`create_skill_draft` 模型今天也看不见 | T014（MCP 授权三层：授权 / 下发 / 身份） |
| stdio 入口未测 | `mcp-main.ts` 需要真进程 + 真 PG；PGlite 夹具不允许同实例第二个客户端 | 真 PG 环境冒烟；缺口按 `#002-02` 记 |
| 重复登记 | 同一源目录调两次 `create_skill_draft` 会得到两份草稿（资产表没有「同作者同名」约束） | 产品定「同名覆盖 / 并存」后再加约束，不在这里猜 |
| 建草稿的权限门槛 | 只要求账号有效（`status = 1`）；没有「作者角色」总闸——`write` 今天是**按资产**授予的，资产还不存在时无处可判 | 若要限制，先定义全局创作权限；发布仍由 `admin` 把住 |
| frontmatter 判据 | 只做最小解析（首个 `---` 块里的 `name:`），不引 YAML 依赖；权威解析仍是内核的 `ConfigMarkdown.parse` | 两套解析的口径若漂移（例如上游改规则），这里可能放行内核不认的文件 |
| 按名字列资产 | 只有 `assetId` 入参 | 后续工具，先定过滤口径 |
| 审计 | 只有站内信，没有「谁在什么时候调了哪个工具」的独立审计 | 010 审计日志 |
| 停用判定 | 只查 `auth.user.status`，不查会话 / token 是否已撤销 | 与统一身份中间件对齐 |

## 6. 用例与变异验证

- 用例：`governance.test.ts` **18 条**（协议 2、制作入口 7、提交 6、发布 3）。走**真 MCP
  客户端 / 服务器**（`InMemoryTransport`），不是直接调 handler。
- 覆盖：工具清单与必填字段；制作入口的身份 / 元数据 / 路径 / SKILL.md 判据 + 与提交串成
  一条链；提交复制 + 状态流转 + 源目录保留；无身份 / 未知用户 / 停用账号；无写权限拒绝且
  **文件目录不存在**；绝对路径与 `..` 越界；缺参 / 资产不存在 / 非 skill；管理员发布
  （`pending/` 移走）；只有 `review` 不能发布；作者本人不能发布。
- 门禁实测（2026-10-25）：`packages/asset-service` **170 pass / 0 fail**；
  `tsgo --noEmit` 0 errors；oxlint（三个改动文件）0 warnings / 0 errors；
  `bun.lock` 未改动（T013 零新依赖）。
- 变异（拆完即还原；T012 三条 + 共用边界一条 + T013 五条）：

| 拆掉什么 | 红在哪 | 条数 |
|---|---|---|
| `userIdOf` 恒返回 `"u1"`（忽略 `_meta`） | 未知/停用被拒、无写权限被拒、管理员发布 | 3 |
| 调用 `transitionAsset` 时注入假的 `admin` 授权 | review 不能发布、作者不能发布 | 2 |
| 去掉源目录边界检查 | 提交越界 + 制作者越界（共用出口） | 2 |
| `publish_skill` 映射成 `approve_business` | 管理员发布、review 不能发布 | 2 |
| `skillNameOf` 不读文件、直接返回目录名 | 制作成功用例（`skillName` 不符）+ SKILL.md / frontmatter 拒绝 | 2 |
| 制作入口忽略 `_meta`、恒用 `"u1"` | 身份缺失 / 未知 / 停用 | 1 |
| 建草稿时收模型自报的 `department` | department 可见范围的部门 | 1 |
| 草稿状态写成 `published` | 制作成功用例 + 制作 → 提交链 | 2 |
| 去掉业务分类 seed 校验 | 元数据不合法（未知分类被放行） | 1 |

> `#003-03` 第②类的两处：`userIdOf` 恒返回 `"u1"`（3 条）与 `skillNameOf` 返回目录名
> （2 条）——变异把「依据」整个换掉，依赖同一依据的多条一起红，据实记录。

## 7. 同类落点（grep 记录）

| 落点 | 处理 |
|---|---|
| `packages/opencode/src/mcp/openhive-identity.ts` 的 `USER_META_KEY` | server 侧**必须逐字一致**；本文件 `governance.ts` 另导出同名常量并注明来源（跨包无法 import，未加自动防漂移测试——缺口） |
| `packages/auth/src/rls.ts` 的身份通道表 | 那是业务库（F6/F7）；资产库走特权连接 + `authorizeTransition`，不套 RLS |
| `session/tools.ts` 的 MCP 调用注入 | 本 server 只消费 `_meta`，不重复实现注入 |
| `notify.ts` 收件人矩阵 | 提交 / 发布经 `transitionAsset` 自动通知，本次未改 |
| `service.ts` 的 `storeAsset` / `insertAsset` | 生产创建路径只有 `createDraftAsset`（草稿）与生命周期流转；`storeAsset` 今天仍只有测试调用，未接生产入口——T013 未硬套它，理由见 §3 |
| `categories.ts` 的 seed | `create_skill_draft` 的 `category` 必须命中 seed；新增分类只改 seed，不在工具里另列一份 |
| 内核 `ConfigMarkdown.parse` | 权威 skill 解析在内核；本文件的 `frontmatterName` 只做「有没有 name」的最小判据（残差见 §5） |
| `governance.test.ts` 的 `tools/list` 断言 | T013 把「两个工具」改成「三个工具」；新增工具必须同时改常量、`TOOLS`、用例三处 |
