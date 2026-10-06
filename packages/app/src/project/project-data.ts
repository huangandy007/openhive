/**
 * 005 T018 · 「项目」这件事的**数据源接线**：一个窄接口 ＋ 它的生产实现。
 *
 * ## 为什么要有这一层，而不是让 `workspace-entry` 直接 import 那三个客户端
 *
 * 因为它要落在**上游文件**里。`workspace-entry.tsx` 由应用入口 `pages/layout-new.tsx` 挂——
 * 那是上游的文件，本项目对它只有**一行**的改动预算（见 `CLAUDE.md` 的「最小化与官方合并冲突」：
 * 品牌化走配置、侵入是「加」不是「改」）。于是把「界面要什么」收成一个接口，
 * 入口只需要 **1 行 import ＋ 1 个 prop**；以后换实现（真后端 / 测试替身 / 另一套取数）
 * 都不用再动那个文件。
 *
 * ## 为什么接口在**这里**、而不在 `workspace-entry.tsx` 里写
 *
 * 写在那里的话，入口除了 1 行 import 还得再声明一次接口——那就不止一行了，而且接口一旦长在
 * 上游文件里，改它就是在改上游文件。放这里：接口与实现同住一个**本项目自有**的文件，
 * 只有「用哪一个」这一个决定被交给入口。
 *
 * ## 与「接入缝」（`project-list.ts` / `project-files.ts`）是什么关系
 *
 * 两者**不是一回事，缺一不可**：
 * - **接入缝**是模块级信号，是**组件**读数据的地方（`workspace-entry.tsx` 是唯一写入方）；
 * - **本文件的接口**是那份数据**从哪儿来**——`workspace-entry` 拿到结果就写进缝里。
 *
 * 分开的好处是组件不必知道数据是从 HTTP、内存还是替身来的（所以组件测试能离线跑），
 * 而这层接口让「从哪儿来」变成一个**可替换的决定**（`layout-new.tsx` 挑一个传进去）。
 *
 * ⚠️ 没有默认实现：`workspace-entry` 的 `projectData` 省略时**一次都不发请求**。
 * 给一个「默认连真后端」的实现，组件测试就会在无网络的环境里去打真接口——那正是
 * `workspace-entry.tsx` 文件头里 `loadFile` 那条注释防的同一件事。
 */

import type { CreateProjectOutcome, ProjectActionOutcome } from "./openhive-project"
import { archiveProject, createProject, listProjects, restoreProject } from "./openhive-project"
import { listProjectFiles } from "./openhive-files"
import type { NewProjectInput, ProjectEntry } from "./project-panel"

/**
 * 界面要用到的五件事——**按「谁要用」定的，不是按后端有什么**（`LEARNINGS #004-07`）。
 *
 * `create` / `archive` / `restore` 交出去的都是**结论**而不是一句话：把「拒绝」与「失败」
 * 并成一句话的活不在这层做（那会让「你填得不对」和「我们这边坏了」长成一个样），
 * 而把结论翻成给人看的那句话，是**界面**那一侧的事（`workspace-entry` → `ProjectPanel`）。
 *
 * ## 为什么 `archive` / `restore` 是**两个**方法，不合成一个 `(projectId, archived: boolean)`
 *
 * 合成一个的话，调用方要负责把「我要归档」翻成一个布尔，而**翻反了不报错也不变红**——
 * 民警点「归档」却被恢复了。两个名字把方向写在**函数名**上（同 `auth/project-member.ts` 的
 * `markArchived` / `markRestored` 不合成一个的道理）。两者共用的那部分在
 * `openhive-project.ts` 的 `projectAction` 里已经只有一份。
 */
export interface ProjectData {
  /** 取当前用户的全部项目。`undefined` = 取不到，`[]` = 一个都没有（三态见 `listProjects`）。 */
  list(): Promise<readonly ProjectEntry[] | undefined>
  /** 建一个新项目。 */
  create(input: NewProjectInput): Promise<CreateProjectOutcome>
  /** 归档一个项目（FR-008，破坏性：沙箱文件先备份再删）。 */
  archive(projectId: string): Promise<ProjectActionOutcome>
  /** 找回一个已归档的项目（FR-009）。 */
  restore(projectId: string): Promise<ProjectActionOutcome>
  /** 取某个项目的全部文件路径（`undefined` = 取不到，`[]` = 一个文件都没有）。 */
  files(projectId: string): Promise<readonly string[] | undefined>
}

/**
 * 生产用的那一个——五个方法各接各的客户端（`openhive-project` ×4 ＋ `openhive-files`）。
 *
 * ⚠️ **五个都别接错**：接错了不报错、不变红，类型上也都合法（`archive` 与 `restore` 的签名
 * 更是一模一样，接反了只有请求路径不同）。`project-data.test.ts` 就是为这件事写的
 * （stub 进程的 `fetch`，走真客户端）。
 */
export const PROJECT_DATA: ProjectData = {
  list: () => listProjects(),
  create: (input) => createProject(input),
  archive: (projectId) => archiveProject(projectId),
  restore: (projectId) => restoreProject(projectId),
  files: (projectId) => listProjectFiles(projectId),
}
