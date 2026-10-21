/**
 * 归档项目的会话标签：**别再盲探**（2026-10-21 用户报「403 会不会越来越多」）。
 *
 * ## 现象
 *
 * 归档项目不碰会话标签（`workspace-entry.tsx` 的归档收尾只清当前项目、重拉清单），
 * 于是已归档项目下的标签永久留在 `localStorage`，而标签条对**每个**持久化标签挂载即复探
 * （`titlebar-tab-strip.tsx` 的 `SessionTabEntry`）。归档项目的 `/session/:id` 一律 403
 * （`project-location.ts`：归档 = 冻结，连读也冻）⇒ **每次刷新 = 归档标签数 × 1 条 403**，
 * 归档项目越多、红字越多。
 *
 * ## 判据
 *
 * 归档态是**已知**的，不该拿 403 去学：
 * - `projectList()`（`GET /openhive/project`）的项目行自带 `archived`；
 * - `tabs.info[标签键].directory` 已持久化，末段就是 projectID。
 *
 * 但两件事实都**可能还没有来源**（清单未加载 / 旧标签没有 directory）——那时**不假装知道**，
 * 照旧探一次；探到 403 就记住（`tabs.frozen`），下次刷新不再问。这条记忆只在两种情况下解除：
 * 清单**明确**说该项目未归档（找回），或标签被删掉。
 *
 * ## 为什么「找不到那一行」不清标记
 *
 * 清单里找不到项目有三种可能：项目被删、我被移出成员、清单只列了一部分。前两种下标签
 * 都没有再探的意义（404 会被 `标签该剪` 剪掉，而删除项目的标签本也可以由用户手动关）；
 * 贸然清标记只会让每次刷新再撞一次 403。保持「上次探到的是归档」更接近事实。
 */
export type 项目行 = { readonly id: string; readonly archived?: boolean }

/**
 * 会话目录末段的项目 id（`…/workspaces/<userId>/<projectId>`，win32 / posix 分隔符都认）。
 *
 * ⚠️ 只认**末段**，不做路径包含判断：目录是服务端给的绝对路径，用 `includes` 会把用户 id
 * 之类的巧合匹配进来。
 */
export function 目录的项目(目录: string | undefined): string | undefined {
  if (!目录) return undefined
  const 末 = 目录.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
  return 末 === "" ? undefined : 末
}

/**
 * 清单对「这个标签所属项目」说了什么。
 *
 * - `archived`：那一行明确 `archived === true`；
 * - `active`：那一行明确不是归档（省略 `archived` 也是这一支）；
 * - `unknown`：清单还没来源 / 目录判不出项目 / 清单里没有这一行——**不猜**。
 *
 * 拆成「清单判定」与「冻结判定」两层，是因为**写侧**（标签条的 effect：按清单记 / 清标记）
 * 不该读冻结标记——读了就自己触发自己；而**读侧**（复探前的 source）要在清单判不了时
 * 沿用标记。两层共用这一份清单口径，判定仍然只有一处。
 */
export function 清单判定(
  清单: readonly 项目行[] | undefined,
  目录: string | undefined,
): "archived" | "active" | "unknown" {
  if (!清单) return "unknown"
  const id = 目录的项目(目录)
  if (!id) return "unknown"
  const 行 = 清单.find((item) => item.id === id)
  if (!行) return "unknown"
  return 行.archived === true ? "archived" : "active"
}

/**
 * 这个标签现在算不算冻结，以及要不要**清掉**那条 403 的记忆。
 *
 * | 清单判定 | 结果 |
 * |---|---|
 * | `archived` | 冻结，不清标记 |
 * | `active` | 不冻结，**清标记**（找回后自动恢复复探） |
 * | `unknown` | 沿用标记（首屏清单未到时，靠上一次 403 的记忆；判不了就不猜） |
 */
export function 冻结判定(input: {
  readonly 清单: readonly 项目行[] | undefined
  readonly 目录: string | undefined
  readonly 已标记: boolean
}): { readonly frozen: boolean; readonly 清标记: boolean } {
  const 判 = 清单判定(input.清单, input.目录)
  if (判 === "archived") return { frozen: true, 清标记: false }
  if (判 === "active") return { frozen: false, 清标记: true }
  return { frozen: input.已标记, 清标记: false }
}
