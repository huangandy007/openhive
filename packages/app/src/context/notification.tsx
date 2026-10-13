import { createStore, reconcile } from "solid-js/store"
import { type Accessor, batch, createEffect, createMemo, createRoot, getOwner, onCleanup, runWithOwner } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { ServerSDK } from "./server-sdk"
import type { ServerSync } from "./server-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { playSoundById } from "@/utils/sound"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

type ErrorNotification = NotificationBase & {
  type: "error"
  error: EventSessionError["properties"]["error"]
}

export type Notification = TurnCompleteNotification | ErrorNotification

type NotificationIndex = {
  session: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

function createNotificationIndex(): NotificationIndex {
  return {
    session: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
    project: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
  }
}

function buildNotificationIndex(list: Notification[]) {
  const index = createNotificationIndex()

  list.forEach((notification) => {
    if (notification.session) {
      const all = index.session.all[notification.session] ?? []
      index.session.all[notification.session] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.session.unseen[notification.session] ?? []
        index.session.unseen[notification.session] = [...unseen, notification]
        index.session.unseenCount[notification.session] = unseen.length + 1
        if (notification.type === "error") index.session.unseenHasError[notification.session] = true
      }
    }

    if (notification.directory) {
      const all = index.project.all[notification.directory] ?? []
      index.project.all[notification.directory] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[notification.directory] ?? []
        index.project.unseen[notification.directory] = [...unseen, notification]
        index.project.unseenCount[notification.directory] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[notification.directory] = true
      }
    }
  })

  return index
}

export const { use: useNotification, provider: NotificationProvider } = createSimpleContext({
  name: "Notification",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const navigate = useNavigate()
    const platform = usePlatform()
    const settings = useSettings()
    const language = useLanguage()
    const owner = getOwner()
    const states = new Map<ServerScope, { dispose: () => void; state: NotificationState }>()

    const activeServer = createMemo(() => {
      if (params.serverKey) return requireServerKey(params.serverKey)
      if (search.draftId) {
        const draft = tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
        if (draft) return draft.server
      }
      return server.key
    })
    const activeDirectory = createMemo(() => decode64(params.dir))
    const activeSession = createMemo(() => params.id)

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Notification server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing) return existing.state
      const root = createRoot(
        (dispose) => ({
          dispose,
          state: createServerNotificationState({
            sdk: ctx.sdk,
            sync: ctx.sync,
            active: () => server.scope(activeServer()) === ctx.sdk.scope,
            directory: activeDirectory,
            sessionID: activeSession,
            platform,
            settings,
            language,
            navigate,
          }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const scopes = new Set(global.servers.list().map((conn) => server.scope(ServerConnection.key(conn))))
      states.forEach((value, scope) => {
        if (scopes.has(scope)) return
        value.dispose()
        states.delete(scope)
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    const selected = () => {
      const list = global.servers.list()
      const key = activeServer()
      if (list.some((conn) => ServerConnection.key(conn) === key)) return ensure(key)
      const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
      if (!conn) throw new Error("Notification server not found")
      return ensure(ServerConnection.key(conn))
    }

    return {
      ready: () => selected().ready(),
      ensureServerState: ensure,
      session: {
        all: (session: string) => selected().session.all(session),
        unseen: (session: string) => selected().session.unseen(session),
        unseenCount: (session: string) => selected().session.unseenCount(session),
        unseenHasError: (session: string) => selected().session.unseenHasError(session),
        markViewed: (session: string) => selected().session.markViewed(session),
      },
      project: {
        all: (directory: string) => selected().project.all(directory),
        unseen: (directory: string) => selected().project.unseen(directory),
        unseenCount: (directory: string) => selected().project.unseenCount(directory),
        unseenHasError: (directory: string) => selected().project.unseenHasError(directory),
        markViewed: (directory: string) => selected().project.markViewed(directory),
      },
    }
  },
})

type NotificationState = ReturnType<typeof createServerNotificationState>

function createServerNotificationState(input: {
  sdk: ServerSDK
  sync: ServerSync
  active: Accessor<boolean>
  directory: Accessor<string | undefined>
  sessionID: Accessor<string | undefined>
  platform: ReturnType<typeof usePlatform>
  settings: ReturnType<typeof useSettings>
  language: ReturnType<typeof useLanguage>
  navigate: (href: string) => void
}) {
  const serverSDK = () => input.sdk
  const serverSync = () => input.sync
  const platform = input.platform
  const settings = input.settings
  const language = input.language

  // ⚠️ **本仓定制（openhive，2026-10-13）**：上游这里没有这一行。本工厂在 `NotificationProvider`
  // 的 `createRoot(...)` 回调内被调用 ⇒ 此刻的 owner 就是本状态自己的 root（`states` 里那个
  // `dispose` 的入口）。`lookup` 需要它来承接下面那次 `onCleanup` 登记（理由见 `lookup`）。
  const rootOwner = getOwner()

  const empty: Notification[] = []

  const currentDirectory = input.directory
  const currentSession = input.sessionID

  const [store, setStore, _, ready] = persisted(
    Persist.serverGlobal(serverSDK().scope, "notification", ["notification.v1"]),
    createStore({
      list: [] as Notification[],
    }),
  )
  const [index, setIndex] = createStore<NotificationIndex>(buildNotificationIndex(store.list))

  const meta = { pruned: false, disposed: false }

  const updateUnseen = (scope: "session" | "project", key: string, unseen: Notification[]) => {
    setIndex(scope, "unseen", key, unseen)
    setIndex(scope, "unseenCount", key, unseen.length)
    setIndex(
      scope,
      "unseenHasError",
      key,
      unseen.some((notification) => notification.type === "error"),
    )
  }

  const appendToIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("session", "unseen", notification.session, (unseen = []) => [...unseen, notification])
        setIndex("session", "unseenCount", notification.session, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("session", "unseenHasError", notification.session, true)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("project", "unseen", notification.directory, (unseen = []) => [...unseen, notification])
        setIndex("project", "unseenCount", notification.directory, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("project", "unseenHasError", notification.directory, true)
      }
    }
  }

  const removeFromIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.session.unseen[notification.session] ?? empty).filter((n) => n !== notification)
        updateUnseen("session", notification.session, unseen)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.project.unseen[notification.directory] ?? empty).filter((n) => n !== notification)
        updateUnseen("project", notification.directory, unseen)
      }
    }
  }

  createEffect(() => {
    if (!ready()) return
    if (meta.pruned) return
    meta.pruned = true
    const list = pruneNotifications(store.list)
    batch(() => {
      setStore("list", list)
      setIndex(reconcile(buildNotificationIndex(list), { merge: false }))
    })
  })

  const append = (notification: Notification) => {
    const list = pruneNotifications([...store.list, notification])
    const keep = new Set(list)
    const removed = store.list.filter((n) => !keep.has(n))

    batch(() => {
      if (keep.has(notification)) appendToIndex(notification)
      removed.forEach((n) => removeFromIndex(n))
      setStore("list", list)
    })
  }

  const lookup = async (directory: string, sessionID?: string) => {
    if (!sessionID) return undefined
    // ⚠️ **本仓定制（openhive，2026-10-13）**：上游这一行是直接调用
    // `serverSync().ensureDirSyncContext(directory)`。
    //
    // 为什么必须包在 `runWithOwner` 里：本函数由 `sdk.event.listen` 的**流回调**投递
    // （`session.idle` / `session.error` 那两条），而事件回调里 `getOwner()` 是 `null`；那个读口
    // （`server-sync.tsx` 的 `createRefCountMap`，`utils/refcount.ts`）**无条件**在返回闭包的
    // 第一行登记一个 `onCleanup` ⇒ ① 控制台刷 `cleanups created outside a 'createRoot' or 'render'
    // will never be run`（用户 F12 报的就是它）；② 登记不上的那个释放回调永不执行 ⇒
    // 该目录的引用计数只增不减 ⇒ `remove`（`inner.disableMcp(dir)`）**永不跑**。
    // 包上 owner 之后这次登记挂在**本状态的 root** 上：warning 消失，释放随本状态 `dispose` 一起跑。
    //
    // 真栈判据：`packages/app/e2e/real-stack/session-idle-oncleanup-real.spec.ts`
    // （发一条消息 ⇒ `session.idle` ⇒ 控制台 0 条该告警；变异：拆掉本行 ⇒ 恰 1 条）。
    const sync = runWithOwner(rootOwner, () => serverSync().ensureDirSyncContext(directory))!
    const session = sync.session.get(sessionID)
    if (session) return session
    return sync.session
      .sync(sessionID)
      .then(() => sync.session.get(sessionID))
      .catch(() => undefined)
  }

  const viewedInCurrentSession = (directory: string, sessionID?: string) => {
    if (!input.active()) return false
    const activeDirectory = currentDirectory()
    const activeSession = currentSession()
    if (!activeSession) return false
    if (!sessionID) return false
    if (activeDirectory && directory !== activeDirectory) return false
    return sessionID === activeSession
  }

  const handleSessionIdle = (directory: string, event: { properties: { sessionID?: string } }, time: number) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed) return
      if (!session) return
      if (session.parentID) return

      if (settings.sounds.agentEnabled()) {
        void playSoundById(settings.sounds.agent())
      }

      append({
        directory,
        time,
        viewed: viewedInCurrentSession(directory, sessionID),
        type: "turn-complete",
        session: sessionID,
      })

      const href = `/${base64Encode(directory)}/session/${sessionID}`
      if (settings.notifications.agent()) {
        void platform.notify(language.t("notification.session.responseReady.title"), session.title ?? sessionID, () =>
          input.navigate(href),
        )
      }
    })
  }

  const handleSessionError = (
    directory: string,
    event: { properties: { sessionID?: string; error?: EventSessionError["properties"]["error"] } },
    time: number,
  ) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed) return
      if (session?.parentID) return

      if (settings.sounds.errorsEnabled()) {
        void playSoundById(settings.sounds.errors())
      }

      const error = "error" in event.properties ? event.properties.error : undefined
      append({
        directory,
        time,
        viewed: viewedInCurrentSession(directory, sessionID),
        type: "error",
        session: sessionID ?? "global",
        error,
      })
      const description =
        session?.title ??
        (typeof error === "string" ? error : language.t("notification.session.error.fallbackDescription"))
      const href = sessionID ? `/${base64Encode(directory)}/session/${sessionID}` : `/${base64Encode(directory)}`
      if (settings.notifications.errors()) {
        void platform.notify(language.t("notification.session.error.title"), description, () => input.navigate(href))
      }
    })
  }

  const unsub = serverSDK().event.listen((e) => {
    const event = e.details
    if (event.type !== "session.idle" && event.type !== "session.error") return

    const directory = e.name
    const time = Date.now()
    if (event.type === "session.idle") {
      handleSessionIdle(directory, event, time)
      return
    }
    handleSessionError(directory, event, time)
  })
  onCleanup(() => {
    meta.disposed = true
    unsub()
  })

  return {
    ready,
    session: {
      all(session: string) {
        return index.session.all[session] ?? empty
      },
      unseen(session: string) {
        return index.session.unseen[session] ?? empty
      },
      unseenCount(session: string) {
        return index.session.unseenCount[session] ?? 0
      },
      unseenHasError(session: string) {
        return index.session.unseenHasError[session] ?? false
      },
      markViewed(session: string) {
        const unseen = index.session.unseen[session] ?? empty
        if (!unseen.length) return

        const projects = [
          ...new Set(unseen.flatMap((notification) => (notification.directory ? [notification.directory] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.session === session && !n.viewed, "viewed", true)
          updateUnseen("session", session, [])
          projects.forEach((directory) => {
            const next = (index.project.unseen[directory] ?? empty).filter(
              (notification) => notification.session !== session,
            )
            updateUnseen("project", directory, next)
          })
        })
      },
    },
    project: {
      all(directory: string) {
        return index.project.all[directory] ?? empty
      },
      unseen(directory: string) {
        return index.project.unseen[directory] ?? empty
      },
      unseenCount(directory: string) {
        return index.project.unseenCount[directory] ?? 0
      },
      unseenHasError(directory: string) {
        return index.project.unseenHasError[directory] ?? false
      },
      markViewed(directory: string) {
        const unseen = index.project.unseen[directory] ?? empty
        if (!unseen.length) return

        const sessions = [
          ...new Set(unseen.flatMap((notification) => (notification.session ? [notification.session] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.directory === directory && !n.viewed, "viewed", true)
          updateUnseen("project", directory, [])
          sessions.forEach((session) => {
            const next = (index.session.unseen[session] ?? empty).filter(
              (notification) => notification.directory !== directory,
            )
            updateUnseen("session", session, next)
          })
        })
      },
    },
  }
}
