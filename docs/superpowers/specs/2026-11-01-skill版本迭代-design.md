# skill 版本迭代（P1）设计

> 日期：2026-11-01　状态：待用户审阅
> 前置：`docs/superpowers/specs/009-ai-assets/state.md`（2026-11-01 写闸门那节）
> 教训命中：`#010-05`（同名 skill 后到覆盖）、`#010-04`（路径进了库就得连库一起搬）、
> `#005-24`（接在所有出口都过的那一层）、`#004-09`（门在副作用之前）、`#002-06`

## 0. 用户已拍板的两条

1. **迭代不再过业务审核**：iterating → published 只走技术发布一道关。
2. **作者发起迭代后，改的是项目里的工作副本**（方案 A）：服务端把线上内容复制到作者选定的项目里，
   作者在那份副本上改，改完提交，管理员发布。

## 1. 现状与缺口（全部有出处）

| 事实 | 出处 |
|---|---|
| 状态机里 `start_iteration` / `publish_iteration` 都已定义，`iterating` 在可见、可送达、可用三条路径上均已放行 | `lifecycle.ts:93-108`、`readable-sql.ts:43`、`asset-link-fanout.ts:34`、`lifecycle.ts:235` |
| `start_iteration` 在 `asset-service` 之外**零调用者**；`publish_iteration` 只有治理台白名单与前端按钮 | `governance-assets.ts:117-121`、`app/src/governance/asset-governance.tsx:88-89` |
| 治理台路由**显式拒绝**作者动作 | `governance-assets.ts:288-294`、`:534` |
| 使用面只有列表与内容 PATCH，无任何流转出口 | `assets.ts:90-93` |
| 元数据只有 `version`，**没有变更说明** | `metadata.ts:87-88` |
| 迁移在 auth 包；最新 `0026_asset_content_fields.sql`；表名单数 `auth.asset` | `auth/src/migrate.ts:6`、`migrations/0009_asset.sql:19` |
| drizzle 模型是表的第二处真相（有防漂移测试） | `asset-service/src/asset.ts:53-68` |
| 详情页「版本」Tab 已有空态「暂无变更说明」 | `app/src/ai-assets/asset-detail.tsx:442-460` |
| 内核扫描 `.opencode/{skill,skills}`、`.claude/skills`、`.agents/skills` | `skill/index.ts:23-25,254` |
| 写工具已被闸门拦住「顺着链接改共享资产」 | 提交 `24aaa2a9ba`、`tool/shared-assets.ts` |
| 治理台前端已在 `iterating` 时显示「发布新版本」 | `app/src/governance/asset-governance.tsx:89` |

**缺口一句话**：进入 `iterating` 的唯一方式是 `start_iteration`，而它没有出口；即便有，作者也**没有可写的
地方**——线上那份在资产根里（闸门拦），项目里那条是指向它的链接（也拦）。所以 P1 必须同时补上
「出口」「工作副本」「变更说明」三件事，缺一个流程就断。

## 2. 完整流程（六步）

```
作者：点「发起新版本」，填变更说明，选目标项目
  ↓ ① POST /openhive/assets/:id/iteration  {note, projectId}
服务端：published → iterating；version+1；记 note；
        把 <资产根>/…/skills/<id> 复制到 <沙箱>/<用户>/<项目>/.openhive/iterations/<id>/
  ↓ ② 右栏收到一句指令（跨栏传送带），AI 开始在工作副本上改
作者：改完点「提交新版本」
  ↓ ③ POST /openhive/assets/:id/iteration/submit
服务端：工作副本 → <资产根>/pending/<id>（copyDirectory replace）
  ↓ ④ 管理员在治理台看到「v3 待发布 · 变更说明：…」，点「发布新版本」
服务端：pending → 发布目录；iterating → published；清空工作副本记录（pending 被搬走）
作者：任何时候可以点「放弃本次迭代」
  ↓ ⑤ POST /openhive/assets/:id/iteration/abort
服务端：iterating → published；version-1；删 pending 副本；**不删**项目里的工作副本
```

**为什么没有第 ⑥ 步**：`iterating` 期间线上仍是旧版（`publishDirectory` 对 `iterating` 返回发布目录，
`service.ts:79-82`），民警不受影响；发布那一刻才切换。

## 3. 数据

新增迁移 `packages/auth/src/migrations/0027_asset_iteration.sql`（配套 `.down.sql`）：

```sql
ALTER TABLE auth.asset ADD COLUMN iteration_note text NOT NULL DEFAULT '';

--> statement-breakpoint

ALTER TABLE auth.asset ADD COLUMN iteration_workspace text;
```

- `iteration_note`：本次迭代的变更说明。发布后**保留**（作为当前版本的说明），下次发起时覆盖。
  **发起的那一刻，上一版留下的说明就没了**；放弃迭代则清空（不恢复）——因为这一列描述的是
  「最近一次发起」的意图，留着一条被放弃的说明会让已发布资产显示错误的注解。
- `iteration_workspace`：工作副本相对**用户沙箱根**的路径（如
  `550e8400-…/6db1717a-…/.openhive/iterations/asset_xxx`）。存相对路径而不是绝对路径——
  换落盘根时不用搬库（`#010-04`）。三层同步：SQL、drizzle 模型 `asset.ts:53-68`、
  行映射与 `AssetMetadata`（`metadata.ts`）。

**P1 没有版本历史**：只有「当前的说明」一列，看不到 v1/v2 的历史说明。历史要配快照，归 P2。

## 4. 状态机（`lifecycle.ts`）

| 动作 | from | to | actors | storage | 说明 |
|---|---|---|---|---|---|
| `start_iteration`（改） | published | iterating | author | **`copy_publish_to_workspace`**（新） | 加 `requiresReason: true`（变更说明必填） |
| `submit_iteration`（新） | iterating | iterating | author | `copy_to_pending` | 工作副本 → pending；可重复提交（覆盖） |
| `abort_iteration`（新） | iterating | published | author, system_admin | `discard_pending`（新） | 版本号回退 + 清空 `iteration_note` / `iteration_workspace` |
| `publish_iteration`（改） | iterating | published | system_admin | `move_pending_to_publish` | `gates` 改为 `["technical_publish"]` |

补充：

- **版本号回退**：`abort_iteration` 进新的 `VERSION_REVERTING_ACTIONS`，`service.ts:472` 处 `version - 1`
  （守卫：`version >= 2`）。不改 `VERSION_BUMPING_ACTIONS` 的既有语义。
- **`gates` 字段今天全仓无人消费**（`transitionAsset` 不读它）。把 `publish_iteration` 的 gates 改成
  只剩技术关只是**声明与决策对齐**，不改运行时行为；本轮不把它接成真门禁。
- **`submit_iteration` 之前不许发布**：`publish_iteration` 增加前置判据——pending 目录不存在或为空 ⇒
  `iteration_not_submitted`（新错误码）。理由：管理员点发布时若作者还没交，搬的是一个不存在的目录。

## 5. 存储（`service.ts` 的 `prepareStorageStep`）

新增两个存储意图：

| 意图 | 动作 | 行为 | 回滚 |
|---|---|---|---|
| `copy_publish_to_workspace` | `start_iteration` | 发布目录 → 工作副本；**目标已存在则 `replace: true`**（再次发起迭代时以线上为准，工作副本里未提交的改动会被覆盖——界面上要警告） | 删工作副本 |
| `discard_pending` | `abort_iteration` | `rm -rf pending/<id>`，`force` | 无（删了就是删了；pending 是临时区） |

**工作副本路径**：`<workspaceRoot(env)>/<userId>/<projectId>/.openhive/iterations/<assetId>`

- 由服务端计算并校验落在该用户沙箱内（复用 `assertWithinRoot` 与 `sandboxDirectoryOf` 同一条口径）。
- **必须放在内核扫不到的目录**：`.opencode/{skill,skills}`、`.claude/skills`、`.agents/skills` 都在
  扫描范围内（`skill/index.ts:23-25,254`）。工作副本若放进这些目录，会和链接的那份**同名 skill**打架
  （`#010-05` 的「后到覆盖、赢家在项目内外漂」）。`.openhive/` 不在任何扫描模式里。
- 复制的是**发布目录**（`publishDirectory` 对 `published` 的返回值），不是链接路径。

## 6. HTTP 接口（新，`packages/opencode/src/server/openhive/assets.ts`）

三个端点，全部挂在已有的使用面路由器上（不放治理台——`governance-assets.ts:27` 已划定这属作者）：

| 方法 | 路径 | 请求体 | 成功 | 主要失败 |
|---|---|---|---|---|
| POST | `/openhive/assets/:id/iteration` | `{note: string, projectId: string}` | `{assetId, status, version, workspace}` | 401 无身份 / 403 非作者 / 409 状态不是 published / 400 note 空 / 400 projectId 不属于我 |
| POST | `/openhive/assets/:id/iteration/submit` | 无 | `{assetId, status, version}` | 403 / 409 状态不是 iterating / 409 工作副本不存在 |
| POST | `/openhive/assets/:id/iteration/abort` | 无 | `{assetId, status, version}` | 403 / 409 状态不是 iterating |

鉴权：`ownerId === userId ⇒ write`（`authorization.ts:292-295`）+ `TRANSITION_REQUIRED_PERMS.author = "write"`
（`review.ts:43-47`）。**授权排在读请求体之前**（`#004-09`，与 `governance-assets.ts:271-277` 同序）。

`projectId` 必须属于调用者：查 `auth.project_member`，不是成员 ⇒ 400（不是 404，避免探测他人项目）。

## 7. 前端（`packages/app/src/ai-assets/`）

详情页「版本」Tab（`asset-detail.tsx:442-460`）按状态分三态：

| 状态 | 显示 |
|---|---|
| published 且我是作者 | `v{n}` + `[发起新版本]` 按钮 → 弹窗：变更说明（必填）+ 选择项目（默认当前项目） |
| iterating 且我是作者 | 「**v{n} 迭代中**（线上仍是 v{n-1}）」+ 变更说明 + `[提交新版本]` `[放弃迭代]` |
| iterating 但我不是作者 | 「v{n} 迭代中（作者正在修订，线上仍是 v{n-1}）」+ 变更说明，无按钮 |
| 其他 | 今天的样子 |

- 点「发起新版本」成功后：把一句指令经跨栏传送带（`ai-session/send-to-session.ts`，`方式: "替换"`）塞进右栏：
  「这是 `<名字>` v{n-1} 的工作副本：`<workspace 绝对路径>`。请在这里改，改完我点『提交新版本』。」
  —— 与详情页「▶ 让 AI 助手执行此 skill」同一条通道，不新建接缝。
- 「再次发起」时工作副本会被线上内容覆盖 ⇒ 弹窗里明写「项目里那份副本会被线上版本覆盖」。

治理台（`app/src/governance/asset-governance.tsx`）：`iterating` 的行/详情里显示 `iteration_note`；
作者还没提交（pending 不存在）时「发布新版本」按钮禁用并提示「作者尚未提交」。

## 8. 测试（TDD，先红后绿）

**服务层**（`packages/asset-service`）
1. 作者对自己的 published 资产 `start_iteration` ⇒ 状态 iterating、version+1、note 落库、发布目录内容被复制到工作副本，**发布目录一个字没变**
2. 非作者 ⇒ `actor_not_allowed`
3. note 为空 ⇒ `reason_required`
4. 已发布但 version=1 的资产发起后 abort ⇒ 回到 published、version 回到 1
5. `submit_iteration` ⇒ pending 里是工作副本的内容（改了哪个字就是哪个字）
6. 未提交就 `publish_iteration` ⇒ `iteration_not_submitted`，发布目录不变
7. `abort_iteration` ⇒ pending 被删、`iteration_workspace` 清空、工作副本**仍在**
8. 工作副本路径计算：始终落在该用户沙箱内；`projectId` 里带 `..` / 分隔符 ⇒ 拒绝

**路由层**（`packages/opencode`）
9. 非作者 POST ⇒ 403，且**响应体未读**（`#004-09`：授权在副作用的读之前）
10. 他人 projectId ⇒ 400，且**没有**创建任何目录（断言沙箱里没有新目录）
11. 状态不对 ⇒ 409，元数据未变

**迁移**
12. 迁移跑完后两列存在；防漂移测试（drizzle 模型 vs SQL）绿

**前端**（`packages/app` 组件测试）
13. published + canWrite ⇒ 出现「发起新版本」；iterating ⇒ 出现两个按钮且文案含「线上仍是」
14. 点「发起新版本」成功后右栏收到的那句指令（经 `订阅会话输入` 替身断言）

## 9. 不做（明确留给后面）

- **版本历史 / 快照 / 回滚**（P2）：`versions/` 目录今天存在但无写入者。
- **通知**（P3）：发布/驳回已有 `AssetNotificationError` 通道，迭代不新增通知。
- **把 `gates` 接成真门禁**：`gates` 仍是纯声明。
- **`shell` 绕过写闸门**（L2/L3）：与本 feature 无关，另议。
- **迭代期间工作副本的自动清理**：abort / publish 都不删项目里的副本（删用户文件是不可逆动作）。
- **「启用」口径**：`project-assets.ts:655` 仍只认 `published`，本 feature 不改。

## 10. 风险与残留（写进 state.md）

1. **再次发起迭代会覆盖项目里的工作副本**：未提交的改动会丢。UI 必须明示；这是「以线上为准」的代价。
2. **发布后 `iteration_note` 留着当本版说明**：下次发起即覆盖 ⇒ **P1 没有历史说明**。
3. **工作副本不进内核扫描目录** ⇒ 作者只能用「把路径告诉 AI」的方式试跑新版本，不能在会话里当 skill 加载。
   这是刻意换来的：避免与链接那份同名 skill 打架（`#010-05`）。
4. **真栈验收**：需重启内核后由用户实操（发起 → AI 改 → 提交 → 管理员发布）；单测不覆盖跨进程落盘。
5. **并发**：两个标签页同时点「发起」会各复制一次工作副本，最后写库的赢。`transitionAsset` 已有
   `expectedStatus` 条件更新（`concurrent_transition`），这里沿用，不另加锁。
