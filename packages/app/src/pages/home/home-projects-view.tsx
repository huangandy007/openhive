import { type Accessor, createMemo, For, type JSX, onCleanup, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { getProjectAvatarVariant, type HomeProjectSelection, type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { ServerRowMenuView, serverMenuLabels } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { type ServerHealth } from "@/utils/server-health"
import { fileManagerApp } from "@/utils/file-manager"

const HOME_PROJECT_NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"

const serverContextMenuID = (server: ServerConnection.Any) => `server:${ServerConnection.key(server)}`
const projectContextMenuID = (server: ServerConnection.Any, directory: string) =>
  `project:${ServerConnection.key(server)}:${directory}`

export type HomeProjectsViewProps = {
  language: ReturnType<typeof useLanguage>
  servers: Accessor<ServerConnection.Any[]>
  projects: Accessor<LocalProject[]>
  recentlyClosed: Accessor<LocalProject[]>
  selection: Accessor<HomeProjectSelection>
  homedir: Accessor<string>
  serverHealth: (server: ServerConnection.Any) => ServerHealth | undefined
  projectsForServer: (server: ServerConnection.Any) => LocalProject[]
  collapsed: (server: ServerConnection.Any) => boolean
  canDefaultServer: Accessor<boolean>
  defaultServerKey: Accessor<ServerConnection.Key | null | undefined>
  canRevealProject: (server: ServerConnection.Any) => boolean
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  onWheel: (event: WheelEvent) => void
  // `onChooseProject` 2026-10-09 删（它只喂 `HomeServerRow` 那颗已删的「添加项目」图标）。
  onFocusServer: (server: ServerConnection.Any) => void
  onToggleCollapsed: (server: ServerConnection.Any) => void
  onEditServer: (server: ServerConnection.Http) => void
  onSetDefaultServer: (server: ServerConnection.Any | undefined) => void
  onRemoveServer: (server: ServerConnection.Any) => void
  onMoveProject: (server: ServerConnection.Any, worktree: string, index: number) => void
  onSelectProject: (server: ServerConnection.Any, directory: string) => void
  onAddProjects: (server: ServerConnection.Any, directories: string[]) => void
  onOpenProjectNewSession: (server: ServerConnection.Any, directory: string) => void
  onEditProject: (server: ServerConnection.Any, project: LocalProject) => void
  onRevealProject: (server: ServerConnection.Any, project: LocalProject) => void
  onClearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  onCloseProject: (server: ServerConnection.Any, directory: string) => void
  // `onOpenSettings` 2026-10-09 随底部的设置行一起删（#3：功能迁到图标栏那颗 `settings-gear`）。
  // 它的**唯一**消费方是 `HomeUtilityNav`（那一颗按钮），行删了它就没人调。
}

export function HomeProjectsView(props: HomeProjectsViewProps) {
  const [contextMenu, setContextMenu] = createStore({ open: undefined as string | undefined })
  const contextMenuProps = {
    contextMenuOpen: (id: string) => contextMenu.open === id,
    onSetContextMenuOpen: (id: string, open: boolean) => setContextMenu("open", open ? id : undefined),
  }
  return (
    <aside
      class={`
        mt-6 flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden
        lg:sticky lg:top-14 lg:mt-14 lg:h-[calc(100cqh-56px)] lg:self-start lg:pt-[52px]
      `}
      aria-label={props.language.t("home.projects")}
      onWheel={(event) => {
        if (event.target === event.currentTarget) return
        props.onWheel(event)
      }}
    >
      <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">{props.language.t("home.projects")}</div>
        {/* 表头那颗「添加项目」图标按钮 2026-10-09 按用户下达**整块删除**（截图 ②，连 `data-action`
            一起删，不留死锚）——「项目」这一行现在只留标题。
            ⚠️ 同一件事还有两处落点，见本文件 `HomeServerRow` 那颗与 `HomeProjectEmpty` 那整行：
            前者**有意保留**（多服务器态 hover 才出现，用户本轮未涉及），后者同批删除（截图 ①）。 */}
      </div>
      <ScrollView data-slot="home-projects-scroll" class="min-h-0 min-w-0 shrink">
        <Show
          when={props.servers().length > 1}
          fallback={
            <div class="pr-3">
              <Show
                when={props.projects().length > 0}
                fallback={<HomeProjectEmpty {...props} server={props.servers()[0]} items={props.recentlyClosed()} />}
              >
                <HomeProjectList
                  {...props}
                  {...contextMenuProps}
                  server={props.servers()[0]}
                  items={props.projects()}
                />
              </Show>
            </div>
          }
        >
          <div class="flex min-w-0 flex-col gap-4 pr-3">
            <For each={props.servers()}>
              {(item) => {
                const projects = () => props.projectsForServer(item)
                const healthy = () => !!props.serverHealth(item)?.healthy
                const hasProjects = () => projects().length > 0
                const collapsed = () => props.collapsed(item)
                return (
                  <div class="flex min-w-0 flex-col gap-1">
                    <HomeServerRow
                      server={item}
                      {...props}
                      {...contextMenuProps}
                      selected={props.selection().server === ServerConnection.key(item) && !props.selection().directory}
                      collapsed={collapsed()}
                      health={props.serverHealth(item)}
                    />
                    <Show when={healthy() && hasProjects() && !collapsed()}>
                      <div class="mx-3 h-px bg-v2-border-border-base" />
                      <HomeProjectList {...props} {...contextMenuProps} server={item} items={projects()} />
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </ScrollView>
      {/* `HomeUtilityNav`（底部的「帮助」＋「设置」两行）2026-10-09 整颗删除——两行先后被下掉之后
          它渲染的是**一个空 div**，故按 CLAUDE.md §3「清理自己造成的孤儿」连组件一起清：
          · ④「帮助」行：2026-10-09 用户下达（截图 ④）；
          · ⑤「设置」行：同日用户下达的 #3——**设置功能迁到图标栏底部那颗 `settings-gear`**
            （`rail/rail.tsx` → `pages/layout-new.tsx` 的 `useSettingsDialog()`），主页不再留第二个入口。
          ⚠️ 它曾**同时**是两个落点（本处 `hidden lg:flex` 与 `pages/home.tsx` 的 `flex lg:hidden`
          渲染的是同一个它）⇒ 删组件即两处一起消失，不必两处各删一遍。
          侧边栏那一份「设置」是**另一条**通道（`pages/layout.tsx` → `sidebar-shell.tsx`），不在此列。 */}
    </aside>
  )
}

function HomeServerRow(props: {
  language: HomeProjectsViewProps["language"]
  projectsForServer: HomeProjectsViewProps["projectsForServer"]
  contextMenuOpen: HomeProjectsContextMenuProps["contextMenuOpen"]
  canDefaultServer: HomeProjectsViewProps["canDefaultServer"]
  defaultServerKey: HomeProjectsViewProps["defaultServerKey"]
  onFocusServer: HomeProjectsViewProps["onFocusServer"]
  onToggleCollapsed: HomeProjectsViewProps["onToggleCollapsed"]
  onEditServer: HomeProjectsViewProps["onEditServer"]
  onSetDefaultServer: HomeProjectsViewProps["onSetDefaultServer"]
  onRemoveServer: HomeProjectsViewProps["onRemoveServer"]
  onSetContextMenuOpen: HomeProjectsContextMenuProps["onSetContextMenuOpen"]
  server: ServerConnection.Any
  selected: boolean
  collapsed: boolean
  health: ServerHealth | undefined
}) {
  const healthy = () => !!props.health?.healthy
  const canToggle = () => healthy() && props.projectsForServer(props.server).length > 0
  const contextMenuID = () => serverContextMenuID(props.server)
  onCleanup(() => {
    const id = contextMenuID()
    if (props.contextMenuOpen(id)) props.onSetContextMenuOpen(id, false)
  })
  return (
    <div class="group/server relative flex h-7 min-w-0 items-center rounded-[6px]">
      <HomeProjectNavButton
        type="button"
        class="pr-16 disabled:opacity-60"
        data-selected={props.selected ? "" : undefined}
        disabled={!healthy()}
        onClick={() => props.onFocusServer(props.server)}
      >
        <span
          data-action="home-server-collapse"
          class={`
            -ml-0.5 -mr-1.5 inline-flex size-5 shrink-0 items-center justify-center
            rounded-[4px] text-v2-icon-icon-muted
          `}
          classList={{
            "hover:bg-v2-overlay-simple-overlay-hover": canToggle(),
            "cursor-default opacity-40": !canToggle(),
          }}
          aria-label={
            props.collapsed ? props.language.t("home.server.expand") : props.language.t("home.server.collapse")
          }
          aria-disabled={!canToggle()}
          aria-expanded={canToggle() ? !props.collapsed : undefined}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!canToggle()) return
            props.onToggleCollapsed(props.server)
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <IconV2
            name="chevron-down"
            size="small"
            class="transition-transform duration-150 ease-in-out"
            style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
          />
        </span>
        <div class="flex size-4 shrink-0 items-center justify-center -mr-0.5">
          <ServerHealthIndicator health={props.health} />
        </div>
        <span class="flex min-w-0 items-center gap-1">
          <span class={HOME_PROJECT_NAV_LABEL}>{props.server.displayName ?? new URL(props.server.http.url).host}</span>
          <Show when={props.server.label}>
            {(label) => (
              <span
                class={`
                  shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5
                  text-[9px] leading-none text-v2-text-text-muted
                `}
              >
                {label()}
              </span>
            )}
          </Show>
        </span>
      </HomeProjectNavButton>
      <div
        class={`
          hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1
          group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
        `}
        data-menu={props.contextMenuOpen(contextMenuID())}
      >
        <ServerRowMenuView
          server={props.server}
          labels={serverMenuLabels(props.language)}
          canDefault={props.canDefaultServer()}
          isDefault={props.defaultServerKey() === ServerConnection.key(props.server)}
          onEdit={props.onEditServer}
          onSetDefault={() => props.onSetDefaultServer(props.server)}
          onRemoveDefault={() => props.onSetDefaultServer(undefined)}
          onRemove={() => props.onRemoveServer(props.server)}
          open={props.contextMenuOpen(contextMenuID())}
          onOpenChange={(open) => props.onSetContextMenuOpen(contextMenuID(), open)}
        />
        {/* 「添加项目」那颗 `folder-add-left`（`data-action="home-add-project"`）2026-10-09 连同
            `data-action` 一起删（截图 ② 的**同族第三处**：单服务器/空列表态那两处删掉后，只剩这一处
            多服务器 hover 才出现的）。它删掉 = 主页**已无任何**「添加项目」入口，这是用户 2026-10-09
            裁定的方向。本簇另一件事——服务器菜单「⋯」（`ServerRowMenuView`，edit/默认/删除）——不在此列。
            ⚠️ `onChooseProject` 这个入参**同批删掉**（连同 `home-projects.tsx` 的传参、`home-projects-controller`
            的 `choose`）：它是本次改动造成的孤儿，留着就是死参数。 */}
      </div>
    </div>
  )
}

type HomeProjectsContextMenuProps = {
  contextMenuOpen: (id: string) => boolean
  onSetContextMenuOpen: (id: string, open: boolean) => void
}

type HomeProjectListProps = HomeProjectsViewProps &
  HomeProjectsContextMenuProps & {
    server: ServerConnection.Any
    items: LocalProject[]
  }

function HomeProjectList(props: HomeProjectListProps) {
  let listRef!: HTMLDivElement

  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: (event) =>
            event.pointerType === "touch"
              ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
              : [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) => event.target instanceof Element && !!event.target.closest("[data-action]"),
        }),
      ]}
      modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => listRef })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
        Feedback.configure({ dropAnimation: null }),
      ]}
      onDragEnd={(event) => {
        const source = event.operation.source
        if (event.canceled || !isSortable(source)) return
        if (source.initialIndex !== source.index) props.onMoveProject(props.server, source.id.toString(), source.index)
        if (props.selection().server !== ServerConnection.key(props.server))
          props.onSelectProject(props.server, source.id.toString())
      }}
    >
      <div class="flex min-w-0 flex-col gap-1" ref={listRef}>
        {/* Keyed on worktree strings: the enriched project objects are
            recreated on every store or sync update, so iterating them directly
            remounts all rows — killing any in-flight drag activation (the
            row's sortable unregisters on unmount) and discarding animations.
            String keys keep row elements alive and move them on reorder. */}
        <For each={props.items.map((project) => project.worktree)}>
          {(worktree, index) => <HomeProjectSlot {...props} worktree={worktree} index={index} />}
        </For>
      </div>
    </DragDropProvider>
  )
}

function HomeProjectSlot(
  props: HomeProjectListProps & {
    worktree: string
    index: () => number
  },
) {
  const initial = props.items.find((item) => item.worktree === props.worktree)
  if (!initial) return
  const project = createMemo<LocalProject>(
    (previous) => props.items.find((item) => item.worktree === props.worktree) ?? previous,
    initial,
  )

  return (
    <HomeProjectRow
      {...props}
      project={project()}
      server={props.server}
      index={props.index}
      serverSelected={props.selection().server === ServerConnection.key(props.server)}
      selected={
        props.selection().server === ServerConnection.key(props.server) &&
        props.selection().directory === props.worktree
      }
      unseen={props.unseenCount(props.server, project())}
    />
  )
}

function HomeProjectEmpty(
  props: HomeProjectsViewProps & {
    server: ServerConnection.Any
    items: LocalProject[]
  },
) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      {/* 空列表里那整行「添加项目」2026-10-09 按用户下达删除（截图 ①）——**整块删，连
          `data-action="home-add-project-row"` 一起**，不留死锚（e2e 曾按这个锚点取件，见
          `home-hidden-entries.test.tsx` 的文件头）。删完后本组件只剩「最近关闭」那一块，
          没有最近关闭时这一支渲染出一个空容器（= 空态什么都不显示）。
          它原来的 `unreachable()` 守卫随按钮一起走——那是个只喂 `disabled` 的局部量。 */}
      <Show when={props.items.length > 0}>
        <div class="mt-3 flex h-7 min-w-0 shrink-0 items-center pl-1.5 pr-3">
          <div class="text-v2-text-text-faint [font-weight:530]">{props.language.t("home.recentlyClosed")}</div>
        </div>
        <For each={props.items}>
          {(project) => <HomeRecentlyClosedRow {...props} project={project} server={props.server} />}
        </For>
      </Show>
    </div>
  )
}

function HomeRecentlyClosedRow(
  props: HomeProjectsViewProps & {
    project: LocalProject
    server: ServerConnection.Any
  },
) {
  const unreachable = () => props.serverHealth(props.server)?.healthy === false
  const path = () => {
    const home = props.homedir()
    const worktree = props.project.worktree
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }
  return (
    <TooltipV2 placement="right" value={path()}>
      <HomeProjectNavButton
        type="button"
        data-component="home-recently-closed-row"
        class="disabled:opacity-60"
        disabled={unreachable()}
        onClick={() => props.onAddProjects(props.server, [props.project.worktree])}
      >
        <HomeProjectAvatar project={props.project} outline />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </HomeProjectNavButton>
    </TooltipV2>
  )
}

function HomeProjectRow(
  props: HomeProjectsViewProps &
    HomeProjectsContextMenuProps & {
      project: LocalProject
      server: ServerConnection.Any
      index: () => number
      serverSelected: boolean
      selected: boolean
      unseen: number
    },
) {
  const platform = usePlatform()
  const serverUnreachable = () => props.serverHealth(props.server)?.healthy === false
  const sortable = useSortable({
    get id() {
      return props.project.worktree
    },
    get index() {
      return props.index()
    },
  })
  let pointerDownSelected: boolean | undefined
  const contextMenuID = () => projectContextMenuID(props.server, props.project.worktree)
  onCleanup(() => {
    const id = contextMenuID()
    if (props.contextMenuOpen(id)) props.onSetContextMenuOpen(id, false)
  })
  return (
    <div
      ref={sortable.ref}
      class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]"
      classList={{ "z-10": sortable.isDragSource() }}
      onContextMenu={(event) => {
        event.preventDefault()
        props.onSetContextMenuOpen(contextMenuID(), true)
      }}
    >
      <HomeProjectNavButton
        type="button"
        data-component="home-project-row"
        class="pr-16 disabled:opacity-60"
        classList={{
          "bg-v2-background-bg-layer-01 text-v2-text-text-base": sortable.isDragSource(),
        }}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        disabled={serverUnreachable()}
        onPointerDown={(event) => {
          // Same-server mouse selection happens on pointerdown (like tabs),
          // but only ever selects; selectProject toggles, and deselecting here
          // would fire on every drag before the threshold is met. Cross-server
          // selection waits for click so reordering a remote server's projects
          // does not focus that server and load its session index. Touch is
          // excluded so flick-scrolling the list cannot select rows.
          pointerDownSelected = undefined
          if (event.button !== 0 || event.pointerType === "touch") return
          if (!props.serverSelected) return
          pointerDownSelected = props.selected
          if (!props.selected) props.onSelectProject(props.server, props.project.worktree)
        }}
        onClick={(event) => {
          // The drag sensor calls preventDefault on post-drag clicks; never
          // toggle selection as part of a reorder.
          if (event.defaultPrevented) return
          // Keyboard activation and touch taps keep the original toggle.
          if (event.detail === 0 || pointerDownSelected === undefined) {
            props.onSelectProject(props.server, props.project.worktree)
            return
          }
          // Mouse: pointerdown already selected unselected rows; a plain click
          // on an already-selected row toggles it off.
          if (pointerDownSelected) props.onSelectProject(props.server, props.project.worktree)
          pointerDownSelected = undefined
        }}
      >
        <HomeProjectAvatar project={props.project} />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </HomeProjectNavButton>
      <div
        class={`
          hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1
          group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
        `}
        data-menu={props.contextMenuOpen(contextMenuID())}
      >
        <MenuV2
          gutter={6}
          modal={false}
          placement="bottom-end"
          open={props.contextMenuOpen(contextMenuID())}
          onOpenChange={(open) => props.onSetContextMenuOpen(contextMenuID(), open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.onOpenProjectNewSession(props.server, props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.onEditProject(props.server, props.project)}>
                {props.language.t("dialog.project.edit.title")}
              </MenuV2.Item>
              <Show when={props.canRevealProject(props.server)}>
                <MenuV2.Item onSelect={() => props.onRevealProject(props.server, props.project)}>
                  {props.language.t(
                    fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown")
                      .actionLabel,
                  )}
                </MenuV2.Item>
              </Show>
              <MenuV2.Item
                disabled={props.unseen === 0}
                onSelect={() => props.onClearNotifications(props.server, props.project)}
              >
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.onCloseProject(props.server, props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={() => props.onOpenProjectNewSession(props.server, props.project.worktree)}
        />
      </div>
    </div>
  )
}

function HomeProjectNavButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <button
      {...rest}
      class={`
        flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-left
        text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
        hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
        data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base
        data-[selected]:hover:bg-v2-background-bg-layer-03
        focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none
        focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]
        ${local.class ?? ""}
      `}
      classList={local.classList}
    >
      {local.children}
    </button>
  )
}

function HomeProjectAvatar(props: { project: LocalProject; outline?: boolean }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <ProjectAvatar
      fallback={name()}
      src={props.outline ? undefined : getProjectAvatarSource(props.project.id, props.project.icon)}
      variant={props.outline ? "outline" : getProjectAvatarVariant(props.project.icon?.color)}
    />
  )
}
