# 授权 vs 收藏分离（009 T011 · FR-007）

- **状态**：已落地（T011）
- **代码**：`packages/asset-service/src/preferences.ts`（收藏 / 使用记录 / 抽屉排序）、
  `notify.ts`（下线 / 重新上线收件人接收藏者）、
  `packages/auth/src/migrations/0012_asset_preferences.sql`
- **适用**：个人收藏、最近使用、右栏「更多 skill」抽屉排序、下线 / 上线通知使用者
- **不在本文件**：浏览可见性过滤（T017）、收藏按钮与抽屉接线（等资产 HTTP 接口，见 §5）、
  授权判定本身（T004 / `authorization.md`）

## 1. 结论

| 项 | 约定 |
|---|---|
| 收藏是什么 | **个人偏好**：只影响右栏抽屉排序，**不是**权限、不是「启用」 |
| 收藏存哪 | `auth.asset_favorite`（user_id, asset_id, created_at），主键 `(user_id, asset_id)` |
| 使用记录 | `auth.asset_usage`（user_id, asset_id, last_used_at），每用户每资产一行 |
| 计数缓存 | `auth.asset.favorite_count` / `usage_count` 由写入路径维护；明细才是账本 |
| 授权判定 | `effectivePermissions()` / `canReadAsset()` 的入参**没有收藏**；收藏行不参与任何判定 |
| 幂等 | 重复收藏返回 `false` 且计数不变；未收藏时取消返回 `false`，计数不低于 0 |
| 排序 | 最近使用倒序 → 使用次数倒序 → 收藏优先 → id 升序（见 §3） |
| 下线 / 上线通知 | 收件人加「收藏者」；见 `notification.md` §2 |

**核心出参（FR-007）**：收藏一份当前读不到的资产，`canReadAsset()` 仍为 `false`；
收藏人执行审核动作仍被 `authorizeTransition()` 拒绝。这两条各有用例钉住。

## 2. 为什么收藏必须独立于授权

设计 §1.3 / §3.5 把两件事分开：

- **能不能看 / 用**由 `role_resource` 授权与三级空间决定（组织侧）；
- **常不常用 / 想不想先看到**由收藏与最近使用决定（个人侧）。

一旦把「收藏过」读成「可见」，会同时坏两头：授权撤销后收藏入口继续露出内容（越权）；
而不想收窄授权的人就会用收藏当「启用开关」，把组织权限重新变成个人设置——正是 009 要拆掉的旧概念。

## 3. 抽屉排序：一条确定的无权重规则

设计里三种说法并存：PRD §8.2「按分组 + 最近使用 + 收藏加权」、design §1.5「最近使用上浮 +
收藏低频排后」、§1.3「收藏 = 排序权重」。`orderForDrawer()` 不发明数值权重，落成固定比较链：

1. **最近使用时间倒序**——用过的上浮；没用过视为 `-Infinity`；
2. **使用次数倒序**——高频在前；
3. **是否收藏**——次数相同时收藏的靠前；
4. **资产 id 升序**——兜底，保证稳定可测。

这样「收藏的低频资产」仍排在「未收藏的高频资产」之后，符合「收藏低频排后」；
同时次数相同时收藏能微调顺序，对应「收藏加权」。**排序不过滤**：入参原样返回，不在这里判权限。

> ⚠️ 产品口径待确认：如果「收藏加权」的本意是「收藏可以越过高频」，把第 2、3 步对调即可，
> 用例只需改一条（`收藏低频排后`）。当前选择是更保守的读法——不让个人收藏抵消组织内的
> 高频信号，也不让一堆积灰收藏把抽屉挤满。

## 4. API 与写入路径

| 函数 | 语义 | 说明 |
|---|---|---|
| `addFavorite(db, {userId, assetId, now?})` | 收藏；返回是否新插入 | 一条 CTE：插入成功才 `favorite_count + 1`，无 TOCTOU |
| `removeFavorite(db, {userId, assetId})` | 取消；返回是否真删了 | `greatest(count - 1, 0)` 防负数 |
| `isFavorite(db, {userId, assetId})` | 我是否收藏 | 不回答别人 |
| `favoriteAssetIds(db, userId)` | 我的收藏 id（时间倒序） | **原始清单**，调用方须再过滤 `canReadAsset()` |
| `recordUsage(db, {userId, assetId, now?})` | 记一次使用 | upsert `last_used_at` + `usage_count + 1`；调用方应已判读权限 |
| `lastUsedAtOf(db, userId)` | 资产 id → 最近使用时间 | 抽屉排序输入 |
| `favoriteUsers(db, assetId)` | 收藏该资产的人 | 下线 / 上线通知收件人 |
| `orderForDrawer(items, {favorites, lastUsedAt})` | 组内排序 | 纯函数，不改入参 |

**计数是缓存，不是账本**：用户注销时明细靠外键级联删除，但 `auth.asset.favorite_count`
不会自动回退（资产还在、收藏行没了）。要对账时用明细重算即可；本轮不做对账脚本。

## 5. 已知残差

| 项 | 现状 | 后续 |
|---|---|---|
| 收藏按钮 | `asset-detail.tsx` 仍按 T007 的口径「未接线不渲染」——没有资产 HTTP 接口，按下去无处可写 | 资产 API + T017 接线 |
| 抽屉排序接线 | `skill-drawer.tsx` 仍只分组；`orderForDrawer()` 已就绪，但前端今天拿不到「我的收藏 / 我的最近使用」（`SkillCapability` 只有 id/名称/描述/分组） | T017 供数（`GET /assets/capabilities` + 偏好字段） |
| 收藏列表的可见性过滤 | `favoriteAssetIds()` 返回原始行，可能含已无权资产 | T017：列出前逐条 `canReadAsset()` |
| 用户注销后的计数漂移 | 明细删了、缓存没回退 | 对账脚本（与 T003 孤儿目录一并） |
| 「最近用过」的通知收件人 | 使用明细已有，但「最近」的时间窗设计未定义 | 产品给窗口后加 `recentUsers` |
| 收藏 → 使用不联动 | 收藏不自动记一次使用；使用不自动收藏 | 设计未要求，不做 |

## 6. 用例与变异验证

- 新增用例：`preferences.test.ts` 16 条——
  收藏 4（幂等 / 取消 / 是否收藏 / 时间倒序）、授权分离 3（个人 / 部门 / 审核关）、
  使用记录 2、抽屉排序 5、级联寿命 2。
- `notify.test.ts` 追加 3 条（下线通知收藏者并排除发起人、重新上线只通知收藏者、别资产隔离）。
- 全量：`packages/asset-service` **152 pass / 0 fail**；`packages/auth` **286 pass / 3 skip /
  0 fail**（含 0012 迁移、中文注释全覆盖、PGlite 迁移）；`tsgo --noEmit` 两个 package 均为
  0 errors；oxlint（改动文件）0 warnings / 0 errors。
- 真 PG 表清单已更新（`migrate.real-pg.test.ts`），但**本机未跑** `test:real-pg`（默认 skip，
  需真 PG）——按 `#002-02` 记入缺口，不写成已覆盖。
- 变异（拆完即还原）：

| 拆掉什么 | 红在哪 | 条数 |
|---|---|---|
| `addFavorite` 的 `on conflict do nothing` 改成 `do update` | 重复收藏不重复计数 | 1 |
| 排序里把「收藏」提到「使用次数」之前 | 收藏低频排后 | 1 |
| 排序里去掉「最近使用」比较 | 最近使用上浮 | 1 |
| `bring_online` 收件人改回 `[]` | 矩阵口径 / 重新上线只通知收藏者 | 2 |
| `canReadAsset` 无条件放行（模拟「收藏即授权」的漏法） | 个人资产仍读不到 / 别的部门仍读不到 | 2 |

## 7. 同类落点（grep 记录）

| 落点 | 处理 |
|---|---|
| `authorization.ts` `canReadAsset()` 注释 | T004 已写明「收藏不是输入」，本轮用例把口径钉实 |
| `asset.ts` `insertAsset` 的 `favoriteCount` / `usageCount` | 新建资产由调用方给 0（`metadata.ts` 只校验非负）；缓存维护从 T011 起走本文件 |
| `asset-detail.tsx` / `asset-card.tsx` 的收藏展示 | 只显示 `favoriteCount`（人数），不显示「我是否收藏」；按钮残差见 §5 |
| `skill-drawer.tsx` / `projection.ts` | 只分组、不排序；006 移交的「收藏加权 / 最近使用」由 §5 的 T017 供数后接入 |
| `notify.ts` 收件人矩阵 | 已接收藏者；「最近用过」等时间窗 |
