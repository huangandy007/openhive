import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { routeSessionID } from "./route-session"

/**
 * 右栏那三样东西的解析链：**路由 → 会话 id → 那个会话的目录 → 那个目录的会话数据**（T008）。
 *
 * ## 为什么要这么绕
 *
 * 右栏挂在 **shell 层**（`ThreePane.right`），而 shell 在**所有路由之上** ⇒ 它既没有 `:id`
 * 路由参数，也没有任何全局的「当前会话」「当前目录」。而 `session.list` / `message` 这些
 * **全是按目录取**的（`ServerSync.ensureDirSyncContext(目录)`）。
 * 唯一的出口是：解 URL 拿 id（`route-session.ts`）→ 向那个会话要它的 `directory`
 * （`ServerSession.lineage.resolve`）。
 *
 * ## 为什么抽成函数而不是写在组件里
 *
 * 这条链是**异步**的，而异步的东西最容易静默出错的地方是**竞态**——「慢的那个盖了新的那个」，
 * 不报错、不变红。所以它必须能单测（`right-pane-source.test.tsx`）；写进组件里就得先
 * 挂一串 provider 才跑得起来，等于测不成。依赖**注进来**，与 `workspace-entry.tsx` 的
 * `projectData` / `loadFile` 同因同法（那条注释明写：「该由应用入口注入……组件一挂上就会去打真接口」）。
 *
 * ## 防竞态用「代次」而不是等框架
 *
 * 写法照 `workspace-entry.tsx` 的 `清单代次`：写「目录」的有**两个出口**（换会话那一次、
 * 进场那一次），两者都异步、都可能迟到。少了这道闸，一个慢的旧会话响应当会把**刚切过去的那场**
 * 从右栏抹掉。
 *
 * ## ⚠️ 取数（`dataFor`）为什么写成 `createMemo`、而不是在 `.then` 里直接 `setData`
 *
 * 因为 `createRefCountMap`（`utils/refcount.ts`，`ensureDirSyncContext` 用的就是它）
 * **把释放动作写在 `onCleanup` 里**，而 `onCleanup` 需要一个 owner 才登记得上。
 * 实测（2026-10-07，bun 1.3.14 ＋ solid-js 1.9.10）：effect 体内 `getOwner()` 非空，
 * **同一个 effect 的 `.then` 回调里 `getOwner()` 是 `null`** ⇒ 在那里登记的 `onCleanup`
 * **永不执行**（卸载后一条都没跑）。于是每换一次会话就只**加**引用、从不减，目录同步上下文
 * 再也放不掉——不报错、不变红，只是内存一路涨。
 * 改成 memo 之后就与 `context/sync.tsx` 的 `useSync()` 同形了：**取数发生在有 owner 的计算里**，
 * 换目录时上一个会被 `cleanNode` 释放掉。
 * 这条有牙：`right-pane-source.test.tsx` 里那条「`onCleanup` 要真的跑」在改回 `.then` 写法时**恰红**。
 */
export interface RightPaneSourceDeps<T> {
  /** 当前路由路径。生产 = `() => useLocation().pathname`。 */
  pathname: Accessor<string>
  /**
   * 「会话 id → 它的目录」。`undefined` ＝ 这个会话现在问不出目录。
   * 生产 = `(id) => serverSync().session.lineage.resolve(id).then((r) => r.session.directory)`。
   */
  directoryOf: (sessionID: string) => Promise<string | undefined>
  /**
   * 「给目录，拿那一份会话数据」。类型**不在此处再声明一遍**，由实现猜——它就该是
   * `DataProvider` 要的那一种（`#002-06`：同一个形状不要两处各写一份）。
   * 生产 = `(目录) => serverSync().ensureDirSyncContext(目录).data`。
   *
   * ⚠️ 实现里可能注册 `onCleanup`（生产那份就会）⇒ 本条见上面「为什么写成 `createMemo`」。
   */
  dataFor: (directory: string) => T
}

/** 三样齐备的那种态：**右栏可渲染**。见 `ready`。 */
export interface RightPaneReady<T> {
  sessionID: string
  directory: string
  data: T
}

export interface RightPaneSource<T> {
  /** 路由里那场会话。没有（首页 / 草稿页 / 旧布局形态）时为 `undefined`。 */
  sessionID: Accessor<string | undefined>
  /** 那场会话的目录。还没问出来时为 `undefined`。 */
  directory: Accessor<string | undefined>
  /** 那个目录的会话数据。目录还没解出来时为 `undefined`。 */
  data: Accessor<T | undefined>
  /**
   * **三样齐了**的态，否则 `undefined`。给调用方一句 `<Show when={源.ready()}>` 就够。
   * 理由不是好看：`SessionPanel` 的 `directory` / `sessionID` 是必填，让调用方自己去断
   * `data() !== undefined` 的话，它只能靠 `!` 说服类型系统，而那句 `!` 没有任何东西守着。
   */
  ready: Accessor<RightPaneReady<T> | undefined>
}

export function createRightPaneSource<T>(deps: RightPaneSourceDeps<T>): RightPaneSource<T> {
  const [sessionID, setSessionID] = createSignal<string | undefined>()
  const [directory, setDirectory] = createSignal<string | undefined>()

  let 代次 = 0

  createEffect(() => {
    const id = routeSessionID(deps.pathname())
    const 代 = ++代次
    setSessionID(id)
    // 没有会话就把目录清掉：留着上一场的目录，会得到一个「标题是新路由、内容是旧会话」的右栏，
    // 而这种错配在界面上看着像「缓存」，不像坏了。（`data` 由 `directory` 派生，跟着一起空。）
    if (!id) {
      setDirectory(undefined)
      return
    }
    void deps.directoryOf(id).then(
      (dir) => {
        if (代 !== 代次) return
        setDirectory(dir)
      },
      () => {
        // 问不到就问不到：右栏退回空态，绝不把整页带崩（它是常驻的一栏，崩了连中栏都看不见）。
        if (代 !== 代次) return
        setDirectory(undefined)
      },
    )
  })

  /**
   * 会话数据**由目录派生**，不再是第三个信号。
   * 这样「谁去取数」就只有一个出口（目录变了才取），而不是「换会话」与「进场」两处各写一份
   * （`LEARNINGS #002-06`）。⚠️ 取数在这里发生，是**要**的——见文件头那段。
   */
  const data = createMemo(() => {
    const dir = directory()
    if (!dir) return undefined
    return deps.dataFor(dir)
  })

  const ready = createMemo<RightPaneReady<T> | undefined>(() => {
    const id = sessionID()
    const dir = directory()
    const 数据 = data()
    if (!id || !dir || !数据) return undefined
    return { sessionID: id, directory: dir, data: 数据 }
  })

  return { sessionID, directory, data, ready }
}
