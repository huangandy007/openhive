import type { LocalProject } from "@/context/layout"
import type { ProjectEntry } from "@/project/project-panel"

/**
 * 主页项目列**该列哪些、叫什么、什么次序**——一条纯计算，没有 signal、没有请求。
 *
 * ## 两个来源的分工（2026-10-09 用户下达 #4）
 *
 * | 来源 | 管什么 | 为什么 |
 * |---|---|---|
 * | **真清单**（`projectList()` ← `GET /openhive/project`） | **有哪些项目** ＋ **项目名** | 服务端才知道我属于哪些项目；`ProjectEntry` 带 `name` |
 * | **本地记录**（`projects.list()` / `recentlyClosed()`） | **次序** ＋ **可见性（收起）** | 拖拽排序与右键「关闭」写在这里，改读真清单后仍要算数 |
 *
 * 修掉的缺陷有两个，同一个根因（主页唯一取数口是本地那份「我打开过的项目」）：
 * ① 新用户本地记录为空 ⇒ 真项目一个都不显示；② `StoredProject` 没有 `name` ⇒ 项目名退化成目录
 * 末段（实测显示成 `9902aff9-41d8-404b-9e93-…`）。
 *
 * ## 为什么不是「只读真清单」
 *
 * 只读真清单最省事，但会让**两个用户看得见的动作变成静默空操作**：`projects.move`（拖拽排序）
 * 在真清单上找不到落点、`projects.close`（右键「关闭」）写进 `recentlyClosed` 却没人读
 * ⇒ 点了没反应、不报错、不变红。红线「不做表面修改」不容这个。
 *
 * ## 为什么不是「把真清单回写进本地记录」（方案 B，未采纳）
 *
 * 那会让两份数据互相追着写——用户裁定走「真清单进、本地记录只留本地 UI 状态」这一侧。
 *
 * ⚠️ **本文件不读 signal**：`projectList()` / `projects.list()` / `recentlyClosed()` 由
 * `home-controller.ts` 取好再喂进来。读 signal 的那一层在 `bun test` 里挂不起来（要
 * `useServerSync()` 等一串 provider）——那半截是**缺口**，靠真栈验收（`LEARNINGS #002-02`）。
 *
 * @param entries 真清单。`undefined` = **还没取到**，`[]` = **取到了、一个都没有**（两件事）。
 * @param opened 本地记录里「打开过」的项目，**顺序即用户拖出来的顺序**；它们**没有 name**。
 * @param closed 本地记录里「收起」的目录（`recentlyClosed`）——这些**不列**，但也不删。
 */
export function 主页项目(
  entries: readonly ProjectEntry[] | undefined,
  opened: readonly LocalProject[],
  closed: readonly string[],
): LocalProject[] {
  const 收起 = new Set(closed)

  /**
   * 真清单按目录建索引：本地记录里那一行要**用真清单的 name 补上**（否则还是显示 UUID）。
   * 没有 `directory` 的行跳过——列出来也是个取不到会话的空壳（`sidebar-sessions.tsx` 的
   * 「当前项目 → 那一行的 directory」是左栏唯一的取数路）。
   */
  const 真 = new Map<string, LocalProject>()
  for (const 行 of entries ?? []) {
    if (!行.directory || 真.has(行.directory)) continue
    真.set(行.directory, { id: 行.id, worktree: 行.directory, name: 行.name, expanded: true })
  }

  const 结果: LocalProject[] = []
  const 已列 = new Set<string>()
  const 收 = (目录: string, 兜底: LocalProject) => {
    if (收起.has(目录) || 已列.has(目录)) return
    已列.add(目录)
    结果.push(真.get(目录) ?? 兜底)
  }

  // 次序：本地记录里排过序的在前，真清单新增的按真清单自己的顺序追加在后。
  for (const 项 of opened) 收(项.worktree, 项)
  for (const 目录 of 真.keys()) 收(目录, { worktree: 目录, expanded: true })

  return 结果
}
