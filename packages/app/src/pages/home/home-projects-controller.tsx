import { useServerManagementController } from "@/components/dialog-select-server"
import { useSettingsCommand } from "@/components/settings-dialog"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { closeHomeProject, errorMessage } from "@/pages/layout/helpers"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createResource } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "./home-controller"

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const notification = useNotification()
  /**
   * ⚠️ **只为副作用调用**（返回值不要了）：它给本页注册 `settings.open`（`mod+,`）那条指令。
   *
   * 主页那颗「设置」**按钮** 2026-10-09 随 #3 迁到图标栏（`rail/rail.tsx` ⇒ `layout-new.tsx` 的
   * `useSettingsDialog()`），但**快捷键不是按钮的私产**——删了这次注册，主页上 `mod+,` 就静默失效，
   * 而「迁走一个入口」不该顺带干掉一条平台级快捷键。写法与 `pages/session.tsx`
   * （`useSettingsCommand()` 单行、不取返回值）逐字同形。
   */
  useSettingsCommand()
  const serverManagement = useServerManagementController({ navigateOnAdd: false })
  const [_state, setState, _, ready] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )
  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function canRevealProject(conn: ServerConnection.Any) {
    return platform.platform === "desktop" && !!platform.openPath && ServerConnection.local(conn)
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canDefault: serverManagement.canDefault,
      defaultKey: serverManagement.defaultKey,
      setDefault: (conn: ServerConnection.Any | undefined) =>
        serverManagement.setDefault(conn ? ServerConnection.key(conn) : null),
      remove: (conn: ServerConnection.Any) => serverManagement.handleRemove(ServerConnection.key(conn)),
      edit: (conn: ServerConnection.Http) => dialog.show(() => <DialogServerV2 mode="edit" server={conn} />),
      focus: home.selection.focusServer,
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      homedir: home.project.homedir,
      select: home.project.select,
      add: home.project.add,
      openNewSession: home.project.openProjectNewSession,
      edit: (conn: ServerConnection.Any, project: LocalProject) => {
        void import("@/components/dialog-edit-project-v2").then(({ DialogEditProjectV2 }) => {
          void dialog.show(() => <DialogEditProjectV2 server={conn} project={project} />)
        })
      },
      unseenCount: (conn: ServerConnection.Any, project: LocalProject) => {
        const state = notification.ensureServerState(ServerConnection.key(conn))
        return directories(project).reduce((total, directory) => total + state.project.unseenCount(directory), 0)
      },
      clearNotifications: (conn: ServerConnection.Any, project: LocalProject) => {
        const state = notification.ensureServerState(ServerConnection.key(conn))
        directories(project)
          .filter((directory) => state.project.unseenCount(directory) > 0)
          .forEach((directory) => state.project.markViewed(directory))
      },
      // 「选目录添加项目」出口 2026-10-09 随主页最后一处「添加项目」图标（`HomeServerRow` 的多服务器
      // hover 那颗，截图 ② 的同族第三处）一起删除——它的**唯一**消费方是那颗图标（经 `home-projects.tsx`
      // 传给 `HomeProjectsView.onChooseProject`）。删了它 = 主页不再有任何添加项目入口（用户 2026-10-09
      // 裁定）。`project.add` 本身**仍在**（「最近关闭」那行重新打开要用，见 `onAddProjects`）。
      close: (conn: ServerConnection.Any, directory: string) => {
        const next = closeHomeProject(
          home.selection.value(),
          ServerConnection.key(conn),
          home.server.context(conn).projects,
          directory,
        )
        if (next) home.selection.set(next)
      },
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        const ctx = home.server.context(conn)
        // ⚠️ 拖拽的 `index` 是**列出来的那一行**的下标，而 `projects.move` 认的是「打开过」记录里的
        // 下标——主页改读真清单（#4）之后两个坐标系不再重合：真清单里的项目，本地记录里可能**一个都
        // 没有**，而 `move` 见 `fromIndex === -1` 就**静默 return**（`context/server.tsx`，上游文件）
        // ⇒ 拖了会弹回去。所以先把记录**对齐到显示次序**（全撤下、再按显示次序登回去，`open` 会从
        // `recentlyClosed` 里移出且不重复登记），两个坐标系重合之后 `move` 才有意义。
        //
        // 「对齐」这一步的落点只有人读代码看得见（它要 `home.server.context(conn)`，`bun test` 里
        // 建不出来）——**记进缺口**，不写成已覆盖（`LEARNINGS #002-02`）。
        const 可见 = home.project.forServer(conn).map((项目) => 项目.worktree)
        for (const 目录 of 可见) ctx.projects.remove(目录)
        for (const 目录 of [...可见].reverse()) ctx.projects.open(目录)
        ctx.projects.move(worktree, index)
      },
      canReveal: canRevealProject,
      reveal: (conn: ServerConnection.Any, project: LocalProject) => {
        if (!platform.openPath || !canRevealProject(conn)) return
        platform.openPath(project.worktree).catch((cause: unknown) =>
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          }),
        )
      },
    },
    // `utility` 这一档 2026-10-09 随它的两个出口一起空掉、删除：
    // · `utility.help` —— 截图 ④ 的「帮助」行（`platform.openExternal(...)`，唯一消费方是
    //   `HomeUtilityNav`）；
    // · `utility.settings` —— #3 的「设置」行（唯一消费方同上，功能已迁到图标栏那颗
    //   `settings-gear`）。
    // 两行的宿主 `HomeUtilityNav` 因此变空、连组件一起删（见 `home-projects-view.tsx` 那段注释）。
    // ⚠️ 上面那次 `useSettingsCommand()` **不在此列**——它留在原处，管的是 `mod+,` 那条指令。
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
