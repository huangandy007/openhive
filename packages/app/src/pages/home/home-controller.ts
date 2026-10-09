import { useGlobal } from "@/context/global"
import { type HomeProjectSelection, useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { toggleHomeProjectSelection } from "@/pages/layout/helpers"
import { projectList } from "@/project/project-list"
import { createEffect, createMemo } from "solid-js"
import { 主页项目 } from "./home-project-source"

export function createHomeController() {
  const sync = useServerSync()
  const layout = useLayout()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const selection = layout.home.selection
  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === selection().server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  /**
   * 某个服务器上主页该列的项目。
   *
   * ⚠️ **取数口 2026-10-09 换过（用户下达 #4），别再改回 `ctx.projects.list()`**：那一份是
   * 「**我打开过的**项目」（`context/server.tsx` 的 `createServerProjects`，**上游**文件），
   * 新用户天然为空 ⇒ 主页项目列 0 行 ⇒ 中栏 `projectDirectories` 跟着空 ⇒ 会话索引也空
   * （真栈实测：后端有 2 个项目，主页 0 行）。真数据源是 `projectList()`（`GET /openhive/project`，
   * 由 `workspace-entry.tsx` 拉好），本地记录只留「次序 ＋ 收起」两件事。
   * 判据全在 `主页项目` 里（`home-project-source.test.ts`，10 条），这里只负责把三份信号喂进去。
   */
  const 列项目 = (conn: ServerConnection.Any) => {
    const ctx = global.ensureServerCtx(conn)
    return 主页项目(
      projectList(),
      ctx.projects.list(),
      ctx.projects.recentlyClosed().map((项目) => 项目.worktree),
    )
  }
  const projects = createMemo(() => {
    const conn = focusedServer()
    if (conn) return 列项目(conn)
    // 没有聚焦服务器时退到布局那一份（两者同源，`context/layout.tsx` 的 `projects` 转调 `server.projects`）。
    return 主页项目(
      projectList(),
      layout.projects.list(),
      layout.projects.recentlyClosed().map((项目) => 项目.worktree),
    )
  })
  const recentlyClosed = createMemo(
    () => focusedServerCtx()?.projects.recentlyClosed() ?? layout.projects.recentlyClosed(),
  )
  const homedir = createMemo(() => focusedSync().data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )

  createEffect(() => {
    const list = global.servers.list()
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  return {
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: global.servers.list,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: 列项目,
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)
        if (global.servers.health[key]?.healthy === false) return
        // 守卫对着**列出来的那一份**问（`列项目`），不是背后的本地记录——否则真清单里、
        // 本地记录里没有的那些行点得着但选不中（点了没反应、不报错）。
        if (!列项目(conn).some((project) => project.worktree === directory)) return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = directories[0]
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        directories.forEach((item) => {
          if (ctx.projects.list().some((project) => project.worktree === item)) return
          const location = { directory: item }
          void ctx.sdk.api.file
            .list({ path: ".", location })
            .then(async (files) => {
              if (files.data.length > 0) return ctx.sdk.api.project.current({ location })
              const result = await ctx.sdk.client.project.initGit({ directory: item })
              return result.data ?? ctx.sdk.api.project.current({ location })
            })
            .then((project) => ctx.sync.child(item, { bootstrap: false })[1]("project", project.id))
            .catch(() => undefined)
          ctx.projects.open(item)
        })
        ctx.projects.touch(directory)
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()
        if (!conn || !project) return
        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
