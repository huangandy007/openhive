import { afterEach, describe, expect, test } from "bun:test"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { ProjectPanel, 近况分组, type ProjectEntry, type RecentGroup } from "./project-panel"

/**
 * 挂一块面板——**外面套着 `DialogProvider`**（2026-10-11 起）。
 *
 * 归档 / 找回改走弹窗之后，`ProjectPanel` 要用 `useDialog()`，而它在没有 Provider 时**抛错**
 * （`context/dialog.tsx`：刻意的，不是静默 `undefined`）。app 里那层 Provider 挂在 `app.tsx`，
 * 覆盖整个工作台；这里补上同一层，测试与真栈的组件树才是同一棵树（同 `file-tree.test.tsx`）。
 *
 * ⚠️ `render()` 返回的 dispose **必须记账**（`LEARNINGS #005-03`）：弹窗关闭是**延迟 100ms
 * 卸载**的（`context/dialog.tsx` 的 `close`），那条定时器挂在 `DialogProvider` 的 owner 上
 * ——**不卸载 Provider，它就会在下一条用例执行到一半时开火**，去 `cleanNode` 一棵已经被
 * `afterEach` 抹掉的树（`file-tree.test.tsx` 顶部记着实测：红的是下一条**毫不相干**的用例）。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
  return host
}

/**
 * 一条用例收工：**先卸载、再让一拍宏任务、最后擦 body**（顺序不能换，同 `file-tree.test.tsx`）。
 *
 * 弹窗是 `dialog.show()` **传送进 `document.body`** 的（`context/dialog.tsx` 的 `Kobalte.Portal`）
 * ——不在 host 里 ⇒ 擦掉 host 是清不掉它的，不清就串到下一条。
 */
afterEach(async () => {
  while (挂过的.length) 挂过的.pop()!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  document.body.innerHTML = ""
})

/**
 * ── 弹窗探针（2026-10-11 起）────────────────────────────────────────────
 *
 * 一律查 **`document`**、**不是 host**：弹窗是 `dialog.show()` **传送进 `document.body`** 的
 * （`context/dialog.tsx` 的 `Kobalte.Portal`），**不在**面板那棵树里。
 *
 * ⚠️ 「有弹窗」与「弹窗不在面板里」是**两条独立判据**（`LEARNINGS #005-19` 的「开在谁身上」）：
 * 只钉前者，一个把弹窗渲染回 host 里的实现照样全绿——而这条改动的**全部意义**正是
 * 「确认不再长在面板里」。
 */
const 弹窗 = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 有动作弹窗 = () => 弹窗("project-action-dialog") !== null
/** 弹窗里某槽位的文字（`文本` 只查 host，弹窗不在 host 里）。 */
const 弹窗文本 = (slot: string) => 弹窗(slot)?.textContent?.trim()

/**
 * 焦点在不在弹窗那颗「取消」上？——**返回布尔**，理由同 `焦点在输入框`（`LEARNINGS #005-01`：
 * 红的实得值若是节点会把整轮测试挂哑）。
 */
const 焦点在弹窗取消 = () => document.activeElement === 弹窗("project-action-cancel")
/** 点弹窗里那颗确认键——归档与找回**共用同一个槽位**（它们是同一个弹窗）。 */
const 点弹窗确认 = () => 弹窗("project-action-ok")?.click()

/**
 * 让一拍。`dialog.show()` 里那层 `startTransition` 让弹窗**晚一拍**才落下来
 * （同 `file-tree.test.tsx` 的 `歇一拍`），点完入口直接断「弹窗在不在」会读到 `false`。
 */
const 等一拍 = () => new Promise((resolve) => setTimeout(resolve, 5))

/**
 * 轮询等到某条件成立——**不要**用固定延时等一个「稍后会发生的事」（`LEARNINGS #005-29`）。
 *
 * 关弹窗就是这么一件事：`close()` 之后真摘节点是**再等 100ms** 的事。超时返回**最后一次**的
 * 实得值，让断言红在它自己身上，而不是红在一个超时异常里（同 `file-tree.test.tsx` 的 `等到`）。
 */
const 等到 = async (条件: () => boolean, 限时 = 1000) => {
  const 起 = Date.now()
  while (Date.now() - 起 < 限时) {
    if (条件()) return true
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  return 条件()
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 全槽 = (host: HTMLElement, slot: string) =>
  [...host.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()
const 按钮 = (host: HTMLElement, slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 某槽位**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能图省事写成 `expect(槽(host, "x")).toBeNull()`：**那条断言红了会把整轮测试挂死**
 * （机制与四条探针实测见 `project-anchor.test.tsx` 同名辅助函数、`LEARNINGS #005-01`）。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

/** 新建时那一行命名输入框（点「私有 / 共享」之后才在）。写法同上面的 `按钮`——泛型取元素，
 *  不写成 `槽(...) as HTMLInputElement`（断言会被 `no-unsafe-type-assertion` 告警）。 */
const 输入框 = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>("[data-slot='project-panel-name']")

/**
 * 焦点在不在那一行输入框上？——**返回布尔，不是拿节点去比**。
 *
 * ⚠️ 写成 `expect(document.activeElement).toBe(输入框(host))` 会**把整轮测试挂死**：
 * `.toBe` 失败时要打印**实得值**，而实得值是 `document.activeElement`，一个**被渲染过的节点**
 * ——打印器停不下来（`LEARNINGS #005-01`）。本条是那条的**推广形态**：中招的不只是
 * `.toBeNull()`，而是**任何「实得值可能是节点」的断言**。判据一句话：**实得值必须是原语**。
 * 2026-10-06 实测：写成上面那种，`timeout 60` 到点被杀，`EXIT=124`、一条结果都取不到。
 */
const 焦点在输入框 = (host: HTMLElement) => document.activeElement === 输入框(host)

/** 往那一行里打字。**先设 value 再派发 `input`**——Solid 的 `onInput` 靠这个事件。 */
const 输入 = (host: HTMLElement, 值: string) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，打不了字")
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * 在输入框上按一个键。
 *
 * 走**原生派发**而不是 `keyboard()` 之类：本组件只认 `key` 那一个字段，派真事件比造一串
 * 依赖更贴近浏览器里发生的事。
 */
const 按下 = (host: HTMLElement, key: string) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，按不了键")
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}
const 回车 = (host: HTMLElement) => 按下(host, "Enter")

/** 失焦。`blur` **不冒泡**，所以是真派在元素自己身上——与浏览器里点别处时一样。 */
const 失焦 = (host: HTMLElement) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，失不了焦")
  el.dispatchEvent(new FocusEvent("blur"))
}

/**
 * 等异步那一段走完。
 *
 * 用**宏任务**（`setTimeout 0`）而不是 `await Promise.resolve()`：提交之后要经过几个微任务
 * 才落地，取决于实现里 `await` 了几层；微任务只让一轮，数错了就会变成一条**假红**。
 * 宏任务一定排在当前所有微任务之后。
 */
const 冲一遍 = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 三 tab 之一（`data-tab` 是它的身份，`data-slot` 是它的种类）。 */
const 页签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='project-panel-tab'][data-tab='${id}']`)

/**
 * 一组项目。**用 `data-group` 选，不是用三个不同的 `data-slot`**——三组是同一种东西，
 * 差别只在分组键；分成三个槽位名会让「同一种行」在断言里长得像三种东西。
 */
const 组 = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-slot='project-group'][data-group='${key}']`)

/** 一行项目。 */
const 行 = (host: HTMLElement) => 全槽(host, "project-item")
/** 一行项目显示的名字，**按渲染顺序**——「最近」的倒序判据就断在这个顺序上。 */
const 项目名 = (host: HTMLElement) =>
  行(host).map((el) => el.querySelector("[data-slot='project-item-name']")?.textContent?.trim())
/** 某一行的成员徽章里的数字。 */
const 行成员 = (el: HTMLElement) =>
  el.querySelector("[data-slot='project-item-member-count']")?.textContent?.trim()

/** 造数据——形状即 `ProjectEntry`，不经过任何后端（本 task 刻意没有落库）。 */
const 私有 = (id: string, name: string, lastAccessedAt: number): ProjectEntry => ({
  id,
  name,
  type: "private",
  lastAccessedAt,
})
const 共享 = (id: string, name: string, lastAccessedAt: number, memberCount: number): ProjectEntry => ({
  id,
  name,
  type: "shared",
  memberCount,
  lastAccessedAt,
})
const 归档 = (e: ProjectEntry): ProjectEntry => ({ ...e, archived: true })
/**
 * 带「**我**在这个项目里的角色」的一行（T023）。角色的闭集**从 core 取**、不在这里抄一份
 * （`MemberRole` 与库里 `project_member.role` 的 CHECK 已经是同一份值的两处写法，
 * `membership.ts` 文件头记着——本文件没必要成为第三处）。
 */
const 我的 = (e: ProjectEntry, role: ProjectMembership.MemberRole): ProjectEntry => ({ ...e, role })

/**
 * 项目面板（FR-002 / FR-003 / `2026-09-11-项目管理-design.md` §3）：
 * 「＋新建项目（私有 / 共享）」置顶 +「最近 / 全部 / 已归档」三 tab。
 *
 * 与 `ProjectAnchor` 同口径——**受控组件**：数据由 `projects` prop 给、动作只喊回调，
 * 故能脱离六层 provider 单独渲染（本文件正是这么跑的）。happy-dom **没有 CSS 引擎**，
 * 所以钉的全是**结构不变量**（槽位、文本、顺序、点了通知谁），不是像素。
 *
 * ⚠️ 本 task **刻意不落库**（用户 2026-10-06 裁定：范围 = 前端面板 ＋ 接缝）：
 * 新建 / 列表接口的落库缺口由 **T018** 认领，「新建项目成功」这条出参**不在本 task 交付**。
 */
describe("ProjectPanel 项目面板（FR-002）", () => {
  test("置顶是「＋新建项目」，分私有 / 共享两个入口（设计 §3）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(槽(host, "project-panel-create")).not.toBeNull()
    expect(按钮(host, "project-panel-create-private")?.textContent?.trim()).toBe("私有")
    expect(按钮(host, "project-panel-create-shared")?.textContent?.trim()).toBe("共享")
  })

  test("点私有 / 共享 ⇒ 先要一个名字，不立刻建（名字是锚点行上唯一的显示物）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()

    expect(无槽(host, "project-panel-name")).toBe(false)
    // 关键：**还没建**。点了就建的话名字只能是编出来的，而 005 全仓没有改名入口 ⇒ 那名字是永久的。
    expect(记).toEqual([])
  })

  test("输入框出现时就拿住焦点——不然民警还得再点一下才打得出字", async () => {
    const host = mount(() => <ProjectPanel onCreate={() => {}} />)

    按钮(host, "project-panel-create-private")?.click()
    // 组件里聚焦要等一个微任务（`ref` 跑的时候节点还没进文档，见 `project-panel.tsx` 那条注）。
    await Promise.resolve()

    expect(焦点在输入框(host)).toBe(true)
  })

  test("打名字 ＋ 回车 ⇒ 报告 {name, type}，把输入框收起来（FR-003）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    // 交出去是**异步**的：要等那边的回话才知道该收起还是该报错，故等回话落地再断。
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "private" }])
    expect(无槽(host, "project-panel-name")).toBe(true)
    // 建成不等于「没有话要说」——这一槽位压根不该在（同下一条的「失败才在」）。
    expect(无槽(host, "project-panel-create-error")).toBe(true)
  })

  test("点「共享」建的共享项目，type 是 shared（两个入口各报各的）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-shared")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "shared" }])
  })

  test("名字首尾的空格去掉（民警手滑打了尾空格，项目名不该带着它走）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "  8·17专案  ")
    回车(host)
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "private" }])
  })

  /**
   * 失败**必须看得见**。这一段是用户 2026-10-06 裁定「输入框下显示一句」的落点：
   * 交出去的名字要是没建成，而界面上一点动静都没有，民警只会以为点坏了、再点一次
   * ——而 005 全仓**没有改名、也没有删项目**，重复建出来的东西只能留着。
   *
   * 三件事一起断：① 那句话在；② 输入框**留着**（要能改个名字重来）；③ 名字还在框里
   * （不能让他重打一遍）。
   */
  test("没建成 ⇒ 输入框下显示出那句话，输入框留着、名字还在（不许悄无声息地没了）", async () => {
    const host = mount(() => <ProjectPanel onCreate={async () => "项目名已存在"} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()

    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")
    expect(无槽(host, "project-panel-name")).toBe(false)
    expect(输入框(host)?.value).toBe("8·17专案")
  })

  /** 重来一次成功 ⇒ 那条文案跟着没了（不然上一次的失败会一直挂在那儿，像新的失败）。 */
  test("失败之后再建一次、这次成了 ⇒ 收起，那条文案也跟着消失", async () => {
    let 回话: string | undefined = "项目名已存在"
    const host = mount(() => <ProjectPanel onCreate={() => 回话} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()
    // 前置：先证明它真的报过错，否则下面的「没了」可能只是从来没出现过。
    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")

    回话 = undefined
    回车(host)

    // **交出去的那一刻**上一条就该没了：留着的话，正在办的这一段里显示的是**上一次**的判决。
    expect(文本(host, "project-panel-create-error")).toBeUndefined()

    await 冲一遍()

    expect(无槽(host, "project-panel-create-error")).toBe(true)
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  /**
   * 失败了按 `Esc` 收起、再重开 ⇒ **没有残留文案**。
   *
   * 本条是**变异找出来的缺口补的**（`#003-03` ② 的形态）：把「收起草稿时一起清文案」那一行
   * 去掉，全组 30 条**一条都不红**。但那一行不是多余的——清的是这一条路径：收起草稿之后
   * 输入框没了，而文案信号还留着上一次那句话，重开时它就**跟着新草稿一起冒出来**，
   * 说的却是上一回的事。缺的不是代码，是没人走过这条路。
   */
  test("失败后按 Esc 收起，再重开 ⇒ 没有残留文案（上一次的判决不跟着新草稿回来）", async () => {
    const host = mount(() => <ProjectPanel onCreate={async () => "项目名已存在"} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()
    // 前置：先证明它真的报过错，否则下面的「没有」可能只是从来没出现过。
    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")

    按下(host, "Escape")
    按钮(host, "project-panel-create-private")?.click()

    expect(无槽(host, "project-panel-create-error")).toBe(true)
  })

  /**
   * 「正在办」的时候回车不算数。
   *
   * 不是洁癖：005 全仓**没有删项目的入口**（`grep` 过），重复建出来的两个项目只能留着，
   * 而名字是永久的。这条路径是本 task 自己引入的——提交从同步改成异步之后，回车与回话之间
   * 才有了一段缝隙。
   */
  test("正在办的时候再按回车 ⇒ 只交一次（那段缝隙里按几下都不算）", async () => {
    let 回话: (v: string | undefined) => void = () => {}
    const 记: string[] = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input.name)
          return new Promise<string | undefined>((resolve) => {
            回话 = resolve
          })
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    // 前置：第一次真的交出去了（不然下面的「只一次」是废话）。
    expect(记).toEqual(["8·17专案"])

    回车(host)
    回车(host)

    expect(记).toEqual(["8·17专案"])

    // 回话之后仍然能正常收工（锁不是永久的）。
    回话(undefined)
    await 冲一遍()
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  /**
   * 正在办的时候点别处（失焦）**不收起**——与「正在办的时候回车不算数」同一条锁。
   *
   * 为什么失焦要跟回车一个待遇：收起之后那一行就没了，而**失败的话没地方落**
   * （文案槽在输入框里面）⇒ 民警看到的是「点了回车，然后什么都没发生」。这正是上一条要防的
   * 那种静默失败，只是从另一个门进来。
   */
  test("正在办的时候失焦 ⇒ 不收起（还没回话，这一行不能先没了）", async () => {
    const host = mount(() => (
      <ProjectPanel onCreate={() => new Promise<string | undefined>(() => {})} />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)

    失焦(host)

    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("正在办的时候按 Esc ⇒ 也不收起（同上：锁是一次性的，等回话）", async () => {
    const host = mount(() => (
      <ProjectPanel onCreate={() => new Promise<string | undefined>(() => {})} />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)

    按下(host, "Escape")

    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("空名字回车 ⇒ 什么都不发生，输入框留着（不拿一个空名去建）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "   ")
    回车(host)

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("按 Esc ⇒ 收起，不建（改主意不用付出代价）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    按下(host, "Escape")

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  test("点到别处（失焦）⇒ 收起，不建", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    失焦(host)

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  test("未接线时新建按钮是禁用态——不假装能点（本 task 确实没有接收方）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(按钮(host, "project-panel-create-private")?.disabled).toBe(true)
    expect(按钮(host, "project-panel-create-shared")?.disabled).toBe(true)
  })

  test("三 tab 齐备且顺序固定：最近 → 全部 → 已归档（FR-002）", () => {
    const host = mount(() => <ProjectPanel />)

    const 名字 = 全槽(host, "project-panel-tab").map((el) => el.textContent?.trim())

    expect(名字).toEqual(["最近", "全部", "已归档"])
  })

  test("三 tab 是真正的 tab 语义（可访问性：不只靠颜色，DESIGN §4.3）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} />)

    expect(槽(host, "project-panel-tabs")?.getAttribute("role")).toBe("tablist")
    for (const id of ["recent", "all", "archived"]) {
      expect(页签(host, id)?.getAttribute("role")).toBe("tab")
    }
    expect(页签(host, "recent")?.getAttribute("aria-selected")).toBe("true")
    expect(槽(host, "project-panel-body")?.getAttribute("role")).toBe("tabpanel")
  })

  test("默认停在「最近」（设计 §3 的第一个 tab）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} />)

    expect(页签(host, "recent")?.getAttribute("aria-selected")).toBe("true")
    expect(页签(host, "all")?.getAttribute("aria-selected")).toBe("false")
  })

  test("点 tab 真的切换内容，不是只换高亮（出参：三 tab 可切换）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 1))]} />
    ))

    expect(项目名(host)).toEqual(["活跃专案"])

    页签(host, "archived")?.click()

    expect(页签(host, "archived")?.getAttribute("aria-selected")).toBe("true")
    expect(项目名(host)).toEqual(["封存专案"])

    页签(host, "recent")?.click()

    expect(项目名(host)).toEqual(["活跃专案"])
  })

  test("「最近」按 lastAccessedAt 倒序，与传入顺序无关（FR-002）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("a", "A", 100), 私有("b", "B", 300), 私有("c", "C", 200)]}
      />
    ))

    expect(项目名(host)).toEqual(["B", "C", "A"])
  })

  test("「最近」不含已归档项目——归档后它就只在「已归档」里了（§8）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 99))]} />
    ))

    expect(项目名(host)).toEqual(["活跃专案"])
  })

  test("「全部」下分「我的项目 / 共享项目」两组（设计 §3）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]} />
    ))

    页签(host, "all")?.click()

    const 分组 = 全槽(host, "project-group").map((el) => el.getAttribute("data-group"))
    expect(分组).toEqual(["mine", "shared"])

    const 我的 = 组(host, "mine")
    const 共享组 = 组(host, "shared")
    expect(我的?.textContent).toContain("8·17专案")
    expect(共享组?.textContent).toContain("串并案")
  })

  test("共享项目带 👥 成员数，私有项目不带（设计 §3 / FR-015）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]} />
    ))

    页签(host, "all")?.click()

    const [我的行, 共享行] = [组(host, "mine"), 组(host, "shared")].map(
      (g) => g?.querySelector<HTMLElement>("[data-slot='project-item']") ?? null,
    )

    expect(共享行 && 行成员(共享行)).toBe("3")
    expect(我的行 && 行成员(我的行)).toBeUndefined()
  })

  test("当前项目在列表里带（当前）标记（设计 §3 的「8·17专案（当前）」）", () => {
    const host = mount(() => (
      <ProjectPanel
        currentId="p2"
        projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]}
      />
    ))

    const 标了 = 行(host).filter((el) => el.getAttribute("data-current") === "true")

    expect(标了).toHaveLength(1)
    expect(标了[0]?.textContent).toContain("串并案")
    expect(标了[0]?.textContent).toContain("当前")
  })

  /**
   * 选中态＝品牌浅金（005 Step 5 审查 **X5-1**，本用例是第二轮补的 **R2-03**）。
   *
   * 为什么非钉不可：`data-current` / `aria-selected` 只说**谁是激活的**，不说**它长什么样**。
   * 这条修复一共改了四处，`file-tree` 与 `sidebar-tabs` 各有一条断言守着，**面板里这两处没有**
   * ——把它们改回中性的 `layer-03`（改之前：选中与 hover 同一个底，鼠标一移开就分不清
   * 哪行还选着）**全套测试照样绿**（`#004-02`：两个投影各长各的，没有相等断言钉在一起）。
   * 实得值取 `className` 字符串（原语），红了毫秒级出结果（`#005-01`）。
   */
  test("「当前项目」行与选中页签都走品牌浅金，未选中的不带（X5-1 / R2-03）", () => {
    const host = mount(() => (
      <ProjectPanel
        currentId="p2"
        projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]}
      />
    ))
    const 金 = "bg-[var(--v2-background-bg-accent-soft)]"
    const 当前行 = 行(host).find((el) => el.getAttribute("data-current") === "true")
    const 别的行 = 行(host).find((el) => el.getAttribute("data-current") !== "true")

    // 被测属性先写：当前项目那一行是浅金
    expect(当前行?.className).toContain(金)
    // 对照：同一列表里别的行**不是**——只写上面那条的话，把整个列表刷成浅金也算「过」
    expect(别的行?.className).not.toContain(金)

    // 页签同理（默认停在「最近」）
    expect(页签(host, "recent")?.className).toContain(金)
    expect(页签(host, "all")?.className).not.toContain(金)
  })

  test("点某个项目：报告该项目本身（FR-003 / AC4 的落点）", () => {
    const 记: ProjectEntry[] = []
    const 甲 = 私有("p1", "8·17专案", 3)
    const host = mount(() => <ProjectPanel projects={[甲, 共享("p2", "串并案", 2, 3)]} onOpen={(p) => 记.push(p)} />)

    行(host)[0]?.click()

    expect(记.map((p) => p.id)).toEqual(["p1"])
    expect(记[0]).toEqual(甲)
  })

  test("未接线时项目行不可点（宁缺勿假：点不动的行不该像能点）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    expect(按钮(host, "project-item")?.disabled).toBe(true)
  })

  test("「已归档」tab 的项目带「找回」入口（设计 §3 / FR-009）", async () => {
    const 记: ProjectEntry[] = []
    const 封存 = 我的(归档(私有("p2", "封存专案", 1)), "owner")
    // 块体、不回话（`ProjectActionCallback` 的回话集合里没有 `number`——`push` 那个返回值
    // 不是「给民警看的一句话」，写成表达式体是拿数组长度冒充回话）。
    const host = mount(() => (
      <ProjectPanel
        projects={[封存]}
        onRestore={(p) => {
          记.push(p)
        }}
      />
    ))

    页签(host, "archived")?.click()
    组(host, "archived")?.querySelector<HTMLButtonElement>("[data-slot='project-restore']")?.click()
    await 等一拍()
    点弹窗确认()
    await 冲一遍()

    expect(记.map((p) => p.id)).toEqual(["p2"])
  })

  /**
   * 「找回」是**归档区**的事（FR-009）：活跃列表里没有它。
   *
   * ⚠️ 这条原来**只查了活跃那一侧**、没切到「已归档」tab——而那条「不给回调即不画」的守卫
   * 正好长在归档组里 ⇒ 两边都没盖住。2026-10-07 席 B 审查抓出：调用方把 `onRestore` 包成
   * 一个**恒真的函数**之后，`ArchivedGroup` 的 `Show` 被永远点亮，而未接线时这里**照样全绿**。
   * 所以两侧都要断（`LEARNINGS #003-02`：修完一处要 grep 谁在按同一个前提做同一件事）。
   *
   * ⚠️ 归档那行必须是 **owner**（2026-10-11 起）：找回加了 owner 收口后，一个没有 `role` 的行
   * **也不画**「找回」——那样下面第二条断言红得莫名其妙，红的其实不是「画在哪个 tab」
   * （`LEARNINGS #006-17`：前置条件自己先不成立了）。
   */
  test("「找回」只在「已归档」tab 出现，不在活跃列表里（FR-009 是归档区的事）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("p1", "活跃专案", 2), 我的(归档(私有("p2", "封存专案", 1)), "owner")]}
        onRestore={() => {}}
      />
    ))

    expect(无槽(host, "project-restore")).toBe(true)

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(false)
  })

  test("没有项目时三 tab 都走空态，不伪造项目名（宁缺勿假）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(项目名(host)).toEqual([])
    expect(文本(host, "project-panel-empty")).toBe("还没有项目")

    页签(host, "archived")?.click()

    expect(文本(host, "project-panel-empty")).toBe("没有已归档的项目")
  })

  test("「已归档」tab 空态与「最近」空态不是同一句——两者说的不是一件事", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "活跃专案", 2)]} />)

    // 活跃列表非空 ⇒ **没有空态节点**（不是「空态里没字」）——缺的槽位读作 `undefined`。
    expect(文本(host, "project-panel-empty")).toBeUndefined()

    页签(host, "archived")?.click()

    expect(文本(host, "project-panel-empty")).toBe("没有已归档的项目")
  })

  /**
   * ── 清单**取不到**（2026-10-11 用户实报）─────────────────────────────────
   *
   * ## 现场
   *
   * 用户报「只有一个项目时，新建会话图标与会话列表都不显示」，F12 里一条 `GET /openhive/project`
   * 是 500（挂具的 PGlite 撞 `42P05`，见 `LEARNINGS #005-02`——那是夹具伪影，不是产品缺陷）。
   * 但那条 500 撞出一件**真的产品行为**：`拉清单` 拿不到清单时**不写缝、不报错、不重试**，
   * 于是 `projectList()` 永久停在 `undefined` ⇒ 左栏会话 tab 一体空白（`SessionList` 的 `directory`
   * 由清单推出来），而**同一时刻项目面板会说一句假话**：「还没有项目」。
   *
   * 「取不到」与「一个都没有」是**两件事**（`project-list.ts` 文件头那句「`undefined` 与 `[]`
   * 是两件事」的另一半）——把前者说成后者，民警会以为自己的项目没了。
   *
   * ## 判据
   *
   * 面板不认识 HTTP：它只管「有没有话要说、能不能再来一次」。把状态码翻成话是调用方的事
   * （同 `onCreate` 的「回一句话」口径）——所以这里收的是两个 prop：`loadFailed` 与 `onRetryLoad`。
   */
  test("清单取不到 ⇒ 说一句话 ＋ 一颗重试钮，**不**说假话「还没有项目」", () => {
    const host = mount(() => <ProjectPanel loadFailed onRetryLoad={() => {}} />)

    expect(文本(host, "project-panel-load-failed")).toBe("项目清单没取到")
    expect(无槽(host, "project-panel-retry")).toBe(false)
    // 这一半才是缺陷本身：`projects` 是空的（`undefined`），旧写法会画出「还没有项目」。
    expect(无槽(host, "project-panel-empty")).toBe(true)
  })

  test("取不到时仍然把手里那份旧清单画出来——失败不该把民警的项目从屏幕上抹走", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} loadFailed onRetryLoad={() => {}} />
    ))

    expect(文本(host, "project-panel-load-failed")).toBe("项目清单没取到")
    expect(项目名(host)).toEqual(["8·17专案"])
  })

  test("点那颗重试钮 ⇒ 报告一次（重试就是再拉一次清单，面板自己不去认出口）", () => {
    let 次数 = 0
    const host = mount(() => <ProjectPanel loadFailed onRetryLoad={() => 次数++} />)

    按钮(host, "project-panel-retry")?.click()

    expect(次数).toBe(1)
  })

  test("没失败时看不到那句话——「取不到」不是常驻噪音", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} onRetryLoad={() => {}} />)

    expect(无槽(host, "project-panel-load-failed")).toBe(true)
    expect(无槽(host, "project-panel-retry")).toBe(true)
  })
})

/**
 * 「最近」的时间分桶（**2026-10-11 用户下达**，借鉴 DeepSeek 的「今天 / 7 天内 / 30 天内」）。
 *
 * ## 为什么要有它
 *
 * 改之前「最近」是一条**扁平**的倒序清单。项目一多，这个 tab 就退化成「所有活跃项目按时间排」
 * ——与「全部」的区别只剩排序，而使用者真正要找的是**「我这两天动过的」**那几件。
 * 分桶把「多久以前」变成**一眼可见**的东西，而桶名本身就是一层筛选。
 *
 * ## 分桶的边界按**自然日**，不按「距今多少小时」
 *
 * 今天 00:01 访问的与此刻（同一天）在同一桶里；而 23:59 那一秒之差对使用者没有意义——他脑子里的
 * 「昨天」是**日历上的昨天**。所以判据是**日差**（两个时刻各自所在自然日相差几天），不是 `now - t`。
 *
 * ## 桶是「算」出来的，`now` 从参数进
 *
 * `近况分组(entries, now)` 是**纯函数**（组件里那一处 `Date.now()` 只是取值），于是跨日 / 跨周 /
 * 跨月边界都能在单测里**钉死**——不必等到某天正好跨周才发现分错了桶（`LEARNINGS #004-13`：
 * 时序类判据要自己造出条件，别等）。
 */
describe("「最近」的时间分桶", () => {
  /** 一个固定的「现在」——下面所有边界都由它推出来，与真实时钟无关。 */
  const 基准 = new Date(2026, 5, 15, 10, 0, 0).getTime()
  /** 从某个时刻往前推 N 个自然日（同一钟点；跨月由 `Date` 自己进位）。 */
  const 往前 = (ms: number, 天: number) => {
    const d = new Date(ms)
    d.setDate(d.getDate() - 天)
    return d.getTime()
  }
  /** 分组的桶键，**顺序即渲染顺序**。 */
  const 桶 = (groups: RecentGroup[]) => groups.map((g) => g.key)
  /** 分组里所有项目的名字（展平，按渲染顺序）。 */
  const 项名 = (groups: RecentGroup[]) => groups.flatMap((g) => g.items.map((p) => p.name))
  /** 一个时刻单独成组时，它落在哪个桶（边界用例都走这条）。 */
  const 落桶 = (ms: number) => 桶(近况分组([私有("a", "A", ms)], 基准))

  test("同一个自然日内都算「今天」——按日历切，不按 24 小时切", () => {
    // 今天 00:00 与基准（今天 10:00）差 10 小时，但**同一个自然日**。
    expect(落桶(new Date(2026, 5, 15, 0, 0, 0).getTime())).toEqual(["today"])
  })

  test("刚过子夜就是「昨天」⇒ 落到 7 天内（差一秒也是另一天）", () => {
    expect(落桶(new Date(2026, 5, 14, 23, 59, 0).getTime())).toEqual(["week"])
  })

  test("7 天内**含第 7 天**，第 8 天落到 30 天内", () => {
    expect(落桶(往前(基准, 7))).toEqual(["week"])
    expect(落桶(往前(基准, 8))).toEqual(["month"])
  })

  test("30 天内**含第 30 天**，第 31 天落到「更早」", () => {
    expect(落桶(往前(基准, 30))).toEqual(["month"])
    expect(落桶(往前(基准, 31))).toEqual(["older"])
  })

  test("桶按固定顺序排：今天 → 7 天内 → 30 天内 → 更早（与传入顺序无关）", () => {
    const groups = 近况分组(
      [
        私有("d", "更早的", 往前(基准, 40)),
        私有("a", "今天的", 往前(基准, 0)),
        私有("c", "上个月的", 往前(基准, 10)),
        私有("b", "前几天的", 往前(基准, 3)),
      ],
      基准,
    )

    expect(桶(groups)).toEqual(["today", "week", "month", "older"])
  })

  test("同一个桶里按 lastAccessedAt 倒序（越近越靠上）", () => {
    const groups = 近况分组(
      [私有("a", "三天前", 往前(基准, 3)), 私有("b", "昨天", 往前(基准, 1)), 私有("c", "两天前", 往前(基准, 2))],
      基准,
    )

    expect(桶(groups)).toEqual(["week"])
    expect(项名(groups)).toEqual(["昨天", "两天前", "三天前"])
  })

  test("空桶不画——没有 30 天内的项目时，那个标题也不该在场", () => {
    const groups = 近况分组([私有("a", "三天前", 往前(基准, 3)), 私有("b", "去年的", 往前(基准, 400))], 基准)

    expect(桶(groups)).toEqual(["week", "older"])
  })

  test("一个项目也没有 ⇒ 一个桶也没有（不是四个空桶）", () => {
    expect(近况分组([], 基准)).toEqual([])
  })

  /**
   * 组件那一层：桶名**真的画成了组标题**（`data-group` 是机器读的身份，标签是给人读的）。
   *
   * 时间戳一律走**正午**：跑在 00:00:01 时，「现在减 1 分钟」会落到昨天 ⇒ 断「今天」会偶发假红。
   */
  test("「最近」tab 按桶分组画出来，组键与组名都对得上", () => {
    const 正午 = (天前: number) => {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() - 天前)
      return d.getTime()
    }
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("a", "今天的", 正午(0)), 私有("b", "前几天的", 正午(3)), 私有("c", "去年的", 正午(400))]}
      />
    ))

    expect(全槽(host, "project-group").map((el) => el.getAttribute("data-group"))).toEqual([
      "today",
      "week",
      "older",
    ])
    expect(全槽(host, "project-group-label").map((el) => el.textContent?.trim())).toEqual([
      "今天",
      "7 天内",
      "更早",
    ])
    expect(项目名(host)).toEqual(["今天的", "前几天的", "去年的"])
  })
})

/**
 * 「已归档」的截断与提示（**2026-10-11 用户下达**：「按时间倒序加载 50 条（最多），
 * 但是可以通过搜索来进行查找」）。
 *
 * ## 为什么必须截断
 *
 * 「已归档」是三个 tab 里**唯一只涨不落**的一个：归档只进不出（找回是少数），它最终会变成
 * 这份清单里最大的一堆。而它又**没有『最近』那样的天然入口**——民警找归档项目通常是**点名找**
 * （「上次那个结了的案子」），不是「翻着看」。既然找法是点名的，就该让**搜索**承担它，
 * 列表只负责「最近归档的那几条」。
 *
 * ## 50 这个数落在哪、不落在哪
 *
 * 落在**画**这一侧（`slice`）而不是取数那侧：出口 `handleList` 一次给全量，前端截断
 * ——**这一轮刻意不改后端**（把取数分页留给真到 2000+ 才需要的那一轮，登记在 state 的挂账里）。
 * 于是「还有多少」这个数是**算得出来的**，提示行才写得出确切数。
 *
 * ## 排序是这一批带出来的第二件事
 *
 * 改之前「已归档」**原样跟着 `projects` 的顺序走**（只 filter，不 sort）——于是它显示的顺序
 * 其实是服务端那两条链并起来之后的顺序，谁都不该依赖。倒序既是「最近归档的在上」的直觉，
 * 也是**截断的前提**：不排序就 slice，砍掉的是「传进来排在后面的」，与「多久以前」无关。
 */
describe("「已归档」的截断与提示", () => {
  /** N 个已归档项目：`案0` 最新，`案{N-1}` 最旧（时间下标倒着来）。 */
  const 一批归档 = (n: number) =>
    Array.from({ length: n }, (_, i) => 归档(私有(`p${i}`, `案${i}`, 1000 - i)))

  test("「已归档」按最近访问倒序，与传入顺序无关", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[归档(私有("a", "A", 100)), 归档(私有("b", "B", 300)), 归档(私有("c", "C", 200))]}
      />
    ))

    页签(host, "archived")?.click()

    expect(项目名(host)).toEqual(["B", "C", "A"])
  })

  test("超过 50 条 ⇒ 只画 50 行，且砍掉的是最旧的那些（排序是截断的前提）", () => {
    const host = mount(() => <ProjectPanel projects={一批归档(60)} />)

    页签(host, "archived")?.click()

    expect(行(host)).toHaveLength(50)
    expect(项目名(host)[0]).toBe("案0")
    expect(项目名(host)[49]).toBe("案49")
    expect(项目名(host)).not.toContain("案59")
  })

  test("超过 50 条 ⇒ 提示行写出还剩多少个，并指向搜索（剩下的不是不见了，是换了个找法）", () => {
    const host = mount(() => <ProjectPanel projects={一批归档(60)} />)

    页签(host, "archived")?.click()

    const 提示 = 文本(host, "project-archived-hint") ?? ""
    expect(提示).toContain("10") // 60 - 50
    expect(提示).toContain("搜索")
  })

  test("刚好 50 条 ⇒ 没有提示行（一条都没少，不该说「还有」）", () => {
    const host = mount(() => <ProjectPanel projects={一批归档(50)} />)

    页签(host, "archived")?.click()

    expect(行(host)).toHaveLength(50)
    expect(无槽(host, "project-archived-hint")).toBe(true)
  })

  test("50 条以内 ⇒ 全部画出来，也没有提示行", () => {
    const host = mount(() => <ProjectPanel projects={一批归档(3)} />)

    页签(host, "archived")?.click()

    expect(项目名(host)).toEqual(["案0", "案1", "案2"])
    expect(无槽(host, "project-archived-hint")).toBe(true)
  })

  /** 截断只咬「已归档」——「全部」与「最近」不设上限（它们各有各的收敛方式）。 */
  test("截断不咬别的 tab：「全部」上 60 个活跃项目一条不少", () => {
    const projects = Array.from({ length: 60 }, (_, i) => 私有(`p${i}`, `案${i}`, 1000 - i))
    const host = mount(() => <ProjectPanel projects={projects} />)

    页签(host, "all")?.click()

    expect(行(host)).toHaveLength(60)
  })
})

/**
 * 项目搜索（**2026-10-11 用户下达**：「我们是不是要添加搜索项目的搜索入口，设置在哪里比较合适呢？」
 * ——落点选在 **tab 栏**的放大镜：那里是面板里唯一「与三个 tab 平级」的位置，而搜索本身
 * **不属于任何一个 tab**）。
 *
 * ## 搜索为什么不是「第四个 tab」
 *
 * 三个 tab 是**同一份集合的三个视图**（活跃 / 分组 / 归档），搜索不是第四个视图——它是**另一个问题**：
 * 「我记得有那么个案子，它叫什么来着」。做成第四个 tab，它就得和另外三个抢同一行位置，而且
 * 一旦切走就丢了搜索词；做成 tab 栏上的一个**开关**，它在哪个 tab 上都唤得出来，语义也对得上。
 *
 * ## 它和「已归档 50 条截断」是一对
 *
 * 截断那条提示行写着「请用搜索查找」——**这句承诺由这里兑现**。所以搜索**必须**能搜到被截掉的
 * 那些（下面有一条专门钉它）：不搜全量的话，第 51 个之后的归档项目就**永远找不回来了**，
 * 提示行也就成了一句谎。
 *
 * ## 命中的归档项不可点，但有「找回」
 *
 * 归档态下服务端 `frozen` 拒绝一切写入 ⇒ 点开也干不了活。所以结果里归档的那几行**整行不可点**、
 * 带一个「已归档」标记（说明它为什么点不开），尾巴上给「找回」——**就地救回来**，
 * 不必「先切到已归档 tab 再找一遍」。
 */
describe("项目搜索（2026-10-11 用户下达）", () => {
  const 搜框 = (host: HTMLElement) => host.querySelector<HTMLInputElement>("[data-slot='project-search']")
  /** 往搜索框里打字（同 `输入`：先设 value 再派 `input`）。 */
  const 打字 = (host: HTMLElement, 值: string) => {
    const el = 搜框(host)
    if (!el) throw new Error("搜索框不在，打不了字")
    el.value = 值
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }
  /** 开搜索（点 tab 栏那颗放大镜）。 */
  const 开搜索 = (host: HTMLElement) => 按钮(host, "project-search-toggle")?.click()

  test("默认不占位，点放大镜才出现搜索框（设计：搜索挂在 tab 栏，不是第四个 tab）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    expect(无槽(host, "project-search")).toBe(true)

    开搜索(host)

    expect(无槽(host, "project-search")).toBe(false)
  })

  test("搜索框出现时就拿住焦点（点完直接能打字）", async () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    // 组件里聚焦要等一个微任务（同新建那行输入框的 `ref`）。
    await Promise.resolve()

    expect(document.activeElement === 搜框(host)).toBe(true)
  })

  test("输入一段字 ⇒ 只画匹配的项目（结果**跨 tab**：停在「最近」也搜得到已归档的）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("p1", "8·17专案", 3), 私有("p2", "涉税案", 2), 归档(私有("p3", "8·17旧版", 1))]}
      />
    ))

    开搜索(host)
    打字(host, "8·17")

    expect(项目名(host)).toEqual(["8·17专案", "8·17旧版"])
  })

  test("匹配是「包含」不是「等于」，且不分大小写（民警记不住全名）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "Case Alpha", 3), 私有("p2", "别的", 2)]} />
    ))

    开搜索(host)
    打字(host, "alpha")

    expect(项目名(host)).toEqual(["Case Alpha"])
  })

  test("命中项按最近访问倒序（与传入顺序无关，结果才稳定）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "专案甲", 100), 私有("p2", "专案乙", 300)]} />
    ))

    开搜索(host)
    打字(host, "专案")

    expect(项目名(host)).toEqual(["专案乙", "专案甲"])
  })

  test("没匹配上 ⇒ 空态说「没有匹配的项目」（不是「还没有项目」——那说的是另一件事）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    打字(host, "查无此案")

    expect(项目名(host)).toEqual([])
    expect(文本(host, "project-panel-empty")).toBe("没有匹配的项目")
  })

  /**
   * **开了框但没打字 ≠ 在搜**（列表区的变化只由「有没有词」决定）。
   *
   * 这条是**变异找出来的缺口**（`#003-02` / `#005-18` 的老账换了个咬法）：把 `在搜` 从
   * 「有词」改成「框开着」，上面整套里**一条都不红**——`清空搜索词` 那条手上只有一件项目，
   * 「回到 tab 列表」与「显示全部项目」长得一模一样。差别得用一件**只在某个 tab 里才出现**
   * 的东西才看得出来，所以这条停在「已归档」tab：没打字时它该**只**画归档的那一件，
   * 而不是把活跃的一起端出来。
   */
  test("开了搜索框但一个字没打 ⇒ 列表照旧（不是「把全部项目都当结果」）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 1))]} />
    ))

    页签(host, "archived")?.click()
    // 前置：先证明这个 tab 上只有一件（否则下面「还是那件」可能只是碰巧）。
    expect(项目名(host)).toEqual(["封存专案"])

    开搜索(host)

    expect(项目名(host)).toEqual(["封存专案"])
  })

  test("清空搜索词 ⇒ 回到原来的 tab 列表（不用关掉搜索框）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    打字(host, "查无此案")
    expect(项目名(host)).toEqual([])

    打字(host, "")

    expect(项目名(host)).toEqual(["8·17专案"])
  })

  test("已归档的命中项带「已归档」标记（不然「为什么这行点不开」看不出来）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[归档(私有("p3", "8·17旧版", 1))]} />
    ))

    开搜索(host)
    打字(host, "8·17")

    expect(文本(host, "project-item-archived")).toBe("已归档")
  })

  test("活跃的命中项**不带**「已归档」标记（标记要有判别力，不能人人都有）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    打字(host, "8·17")

    expect(无槽(host, "project-item-archived")).toBe(true)
  })

  test("活跃的命中项可点，报告的是那一项（搜索是「找到就走」，不是「找到还要切 tab」）", () => {
    const 记: ProjectEntry[] = []
    const 甲 = 私有("p1", "8·17专案", 3)
    const host = mount(() => <ProjectPanel projects={[甲]} onOpen={(p) => 记.push(p)} />)

    开搜索(host)
    打字(host, "8·17")
    行(host)[0]?.click()

    expect(记.map((p) => p.id)).toEqual(["p1"])
  })

  test("已归档的命中项**不可点**——它那一行不是按钮（归档态下服务端拒绝一切写入）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[归档(私有("p3", "8·17旧版", 1))]} onOpen={() => {}} />
    ))

    开搜索(host)
    打字(host, "8·17")

    // 活跃行是 `button`（名字那一块），归档行是 `div`——tagName 就是「能不能点」的判据。
    expect(行(host)[0]?.tagName).toBe("DIV")
  })

  /** 搜索里就地「找回」——不必「先切到已归档 tab 再找一遍」（用户 2026-10-11 点名的交互）。 */
  test("已归档的命中项带「找回」，点了开弹窗、确认才交出去（owner 才画，同归档那条口径）", async () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[归档(我的(私有("p3", "8·17旧版", 1), "owner"))]}
        onRestore={(p) => {
          记.push(p)
        }}
      />
    ))

    开搜索(host)
    打字(host, "8·17")
    按钮(host, "project-restore")?.click()
    await 等一拍()

    // 先问一句，不立刻交出去——搜索这条路与「已归档」tab 那条走的是**同一个弹窗**。
    expect(记).toEqual([])
    expect(有动作弹窗()).toBe(true)

    点弹窗确认()
    await 冲一遍()

    expect(记.map((p) => p.id)).toEqual(["p3"])
  })

  /**
   * 收口要在**两个出口**上都成立（`LEARNINGS #005-12`：同一个修法落在 N 个动作上就写 N 条用例）。
   *
   * 「找回」的画点有两处——「已归档」tab 那一行、搜索命中那一行。只钉前者的话，一个把守卫
   * 只接在 tab 那侧的实现照样全绿，而民警在搜索里能把共享项目找回走（那是服务端会拒的写入）。
   */
  test("搜索命中里 member 的行也不画「找回」（收口的第二个出口）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[归档(我的(共享("p3", "8·17旧版", 1, 3), "member"))]}
        onRestore={() => {}}
      />
    ))

    开搜索(host)
    打字(host, "8·17")

    expect(无槽(host, "project-restore")).toBe(true)
  })

  /**
   * 截断只咬 tab、不咬搜索——**这是那行提示存在的全部意义**。
   *
   * 少了这一条，`slice(0,50)` 一扩到搜索路径上（或搜索复用了 `已归档()` 而不是全量），
   * 第 51 个之后的归档项目就永远找不回来了，而提示行还写着「请用搜索查找」。
   */
  test("搜索能搜到第 50 条之外的已归档项目（截断只咬 tab）", () => {
    const projects = Array.from({ length: 60 }, (_, i) => 归档(私有(`p${i}`, `案${i}`, 1000 - i)))
    const host = mount(() => <ProjectPanel projects={projects} />)

    开搜索(host)
    打字(host, "案59")

    expect(项目名(host)).toEqual(["案59"])
  })

  test("按 Esc ⇒ 收起搜索框，回到 tab 列表（改主意不用付出代价）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    打字(host, "查无此案")
    搜框(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    expect(无槽(host, "project-search")).toBe(true)
    expect(项目名(host)).toEqual(["8·17专案"])
  })

  test("再点一次放大镜 ⇒ 收起，也把搜索词清掉（下次打开是干净的）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    开搜索(host)
    打字(host, "查无此案")
    开搜索(host)

    expect(无槽(host, "project-search")).toBe(true)

    开搜索(host)

    expect(搜框(host)?.value).toBe("")
    expect(项目名(host)).toEqual(["8·17专案"])
  })
})

/**
 * 归档 / 找回的**接线与呈现**（T023 · FR-008 / FR-009）。
 *
 * 本 task 只做接线与呈现：判定（谁能归档、归档态下能做什么）**一份都不在这里**，
 * 全部走 `ProjectMembership.decide`（`project-panel.tsx` 的 `canArchive`）。
 * 所以这组用例钉的是**范围**（画在哪个 tab、哪一行画）与**流程**（二次确认、失败落到哪）。
 *
 * ⚠️ 二次确认是本组最要紧的一条：归档**是破坏性操作**（沙箱文件先备份进 MinIO、本地那份删掉），
 * 而 005 全仓**没有「取消归档」**——误触之后只能等文件搬回来。所以「点一下就直接归档」这件事
 * 必须有一条用例明确地说不允许（`记` 在确认之前是空的）。
 */
describe("归档 / 找回的接线（T023）", () => {
  /** 切到「全部」再点那一行尾巴上的「归档」——面板上的归档动作**只**画在那儿（设计 §8.1）。 */
  const 点归档 = (host: HTMLElement) => {
    页签(host, "all")?.click()
    按钮(host, "project-archive")?.click()
  }

  /** 切到「已归档」再点那一行尾巴上的「找回」。 */
  const 点找回 = (host: HTMLElement) => {
    页签(host, "archived")?.click()
    按钮(host, "project-restore")?.click()
  }

  /**
   * 点入口、**把弹窗等出来**、并且**当场确认它真的开了**。
   *
   * 前两件事的理由：`dialog.show()` 里那层 `startTransition` 让弹窗晚一拍才落下来，点完立刻
   * 断「弹窗在不在」会读到 `false`——那是**读数读早了**，不是弹窗没开（`LEARNINGS #006-31`）。
   *
   * 第三件事是给**下面每条用例**兜底：不然「取消 ⇒ 什么都不发」这类用例会在弹窗压根不存在时
   * **绿着通过**（没有弹窗 ⇒ 没有项目被交出去 ⇒ 断言全成立），而那正是 `#006-16` 说的
   * 「守卫在界面上走不到，变异全绿」——先钉住「弹窗确实开了」，后面的判据才有对象。
   */
  const 开弹窗 = async (点入口: (host: HTMLElement) => void, host: HTMLElement) => {
    点入口(host)
    await 等一拍()
    expect(有动作弹窗()).toBe(true)
  }
  const 开归档确认 = (host: HTMLElement) => 开弹窗(点归档, host)
  const 开找回确认 = (host: HTMLElement) => 开弹窗(点找回, host)

  test("「全部」tab 上，owner 那一行带「归档」，且写明是归档哪一个（FR-008 的入口）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(文本(host, "project-archive")).toBe("归档")
    expect(按钮(host, "project-archive")?.getAttribute("aria-label")).toBe("归档 8·17专案")
  })

  test("「最近」tab 不画「归档」——归档动作只画在「全部」里（设计 §8.1）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    expect(无槽(host, "project-archive")).toBe(true)
  })

  test("member 的行不画「归档」（owner 才行——判定走 `decide`，组件零规则复述）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(共享("p2", "串并案", 2, 3), "member")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  /**
   * 缺 `role` = **没有成员关系**（不是 member）⇒ fail-closed。
   *
   * 这条与上一条分开，因为它们是两件事：上一条是「判定说不行」，这条是「**没有授权依据**」。
   * 后者最危险的写法是给个默认角色（`?? "owner"` 会立刻放行，`?? "member"` 则把「不知道」
   * 说成「知道他不是 owner」）——两种都不报错、不变红（`LEARNINGS #004-07`）。
   */
  test("没有 role 的行不画「归档」（缺键 = 没有授权依据，不倒向任何角色）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  test("没接线（没传 onArchive）⇒ 谁都不画「归档」（不画一个点了没用的按钮）", () => {
    const host = mount(() => <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} />)

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  /**
   * 上一条的**第二个出口**（FR-009）。两条分开写，因为守卫长在两个不同的组里——归档那条读
   * `props.onAskArchive`，找回这条读 `props.onRestore`（在 `ArchivedGroup` 内部）。
   *
   * ⚠️ 必须**切到「已归档」tab**才测得到：守卫在归档组里，不切过去它压根不渲染，这条就退化成
   * 一句废话（原来的「找回只在已归档 tab」那条正是这么退化的）。
   *
   * ⚠️ 角色必须是 **owner**（2026-10-11 起）：找回加了 owner 收口之后，一个没有 `role` 的行
   * **同样**不画「找回」——那样这条就在拿「没有授权依据」冒充「没接线」，红绿都读不出你要的原因
   * （`LEARNINGS #006-17`：为被测属性搭的前置条件自己先不成立了）。
   */
  test("没接线（没传 onRestore）⇒ 「已归档」tab 上谁都不画「找回」（同一个约定的第二个出口）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} />
    ))

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(true)
  })

  /**
   * 归档确认的**第一条**：它是弹窗，且**不长在面板里**。
   *
   * 「有弹窗」与「弹窗不在面板里」是**两条独立判据**（`LEARNINGS #005-19` 的「开在谁身上」）：
   * 只钉前者，一个把确认条渲染回 host 里的实现照样全绿——而这条改动的**全部意义**正是
   * 「确认不再长在面板里」（用户 2026-10-11 下达：「归档按钮被点击后，其交互为弹窗式交互」）。
   *
   * ⚠️ `弹窗()` 查的是 `document.body`，而 host **也在** body 里 ⇒ 单靠它证明不了「不在面板里」；
   * 所以下面紧跟一条 `无槽(host, …)` 的**反向断言**，两条合起来才说得清这件事。
   */
  test("点「归档」开的是**弹窗**（传送进 body），面板里不再有内联确认条", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    点归档(host)

    expect(await 等到(() => 有动作弹窗())).toBe(true)
    expect(无槽(host, "project-action-dialog")).toBe(true)
    expect(无槽(host, "project-archive-confirm")).toBe(true)
  })

  test("点「归档」是先问一句，**不立刻交出去**（破坏性操作要二次确认）", async () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    await 开归档确认(host)

    expect(记).toEqual([])
    expect(有动作弹窗()).toBe(true)
  })

  test("弹窗上写出归档的是哪一个项目（点确认前得看清对象）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    await 开归档确认(host)

    expect(弹窗文本("project-action-name")).toBe("8·17专案")
  })

  /**
   * 确认文案必须说清**三步**（用户 2026-10-06 裁定）——这不是措辞洁癖：民警要据此判断
   * 「我点下去会失去什么、还能不能拿回来」。三件事各对应实现里一个真实的事实：
   * 备份先发生（T013 的次序保证）、本地那份真的没了、之后能找回（FR-009 存在）。
   */
  test("归档弹窗说清三件事：先备份进 MinIO、本地这份删掉、之后能找回", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    await 开归档确认(host)

    const 文案 = 弹窗文本("project-action-dialog") ?? ""
    expect(文案).toContain("MinIO")
    expect(文案).toContain("删掉")
    expect(文案).toContain("找回")
  })

  /**
   * 破坏性操作的默认焦点落在「取消」上（用户 2026-10-11 点名）。
   *
   * 这一条与「取消 ⇒ 什么都不发」是**两件事**：那条钉的是点取消的结果，这条钉的是
   * 「连输入都不用给」——民警按一下回车（或者压根没看清就敲下去）不该把项目归档掉。
   */
  test("归档弹窗开出来时焦点就在「取消」上（破坏性操作，手快也不该确认）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    await 开归档确认(host)

    expect(焦点在弹窗取消()).toBe(true)
  })

  /**
   * 归档那颗确认键是**危险色**（`ButtonV2` 的 `data-variant`，`button-v2.tsx:22`）。
   *
   * 断的是属性、不是 `className` 串：Tailwind 类名断子串会假绿（`LEARNINGS #006-22`，
   * `border-b` ⊂ `border-base` 那一族），而 `data-variant` 是 `ButtonV2` 自己算出来的值。
   */
  test("归档弹窗的确认键是危险色，不是中性的（这一下要毁掉本地那份）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    await 开归档确认(host)

    expect(弹窗("project-action-ok")?.getAttribute("data-variant")).toBe("danger")
  })

  test("取消 ⇒ 弹窗收掉，什么都不发（改主意不用付出代价）", async () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    await 开归档确认(host)
    弹窗("project-action-cancel")?.click()

    /**
     * ⚠️ 等条件、不等时间（`LEARNINGS #005-29` / `#005-33`）：`dialog.close()` 之后真摘节点是
     * **再等 100ms** 的事，点完立刻断「弹窗没了」会红，而它读起来像「关不掉」。
     */
    expect(await 等到(() => !有动作弹窗())).toBe(true)
    expect(记).toEqual([])
  })

  test("确认 ⇒ 交出去的是那一行项目本身，弹窗同时收掉（不留一层挡住第二次点）", async () => {
    const 记: ProjectEntry[] = []
    const 甲 = 我的(私有("p1", "8·17专案", 3), "owner")
    const host = mount(() => (
      <ProjectPanel
        projects={[甲]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    await 开归档确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(记).toEqual([甲])
    expect(await 等到(() => !有动作弹窗())).toBe(true)
  })

  /**
   * 没办成必须有回音。**点了归档却什么都没发生**是最坏的一种静默：民警会以为归档好了，
   * 而项目还在「全部」里（同 `project-panel-create-error` 那条「失败的话没地方落」）。
   */
  test("归档没办成 ⇒ 面板底下那句话，`role=alert`（点了什么都不发生是最坏的静默）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => "无权归档该项目"} />
    ))

    await 开归档确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("无权归档该项目")
    expect(槽(host, "project-panel-action-error")?.getAttribute("role")).toBe("alert")
  })

  test("归档办成了（回调不回话）⇒ 一句错误文案都不留", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    await 开归档确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })

  /** 下一次动作开始时上一句话就该消失——留着它，民警分不清那是新结果还是旧结果。 */
  test("再办一次 ⇒ 上一次那句话先清掉（不把旧结论挂在新动作上）", async () => {
    let 这次: string | undefined = "第一次没办成"
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={() => {
          const 回话 = 这次
          这次 = undefined
          return 回话
        }}
      />
    ))

    await 开归档确认(host)
    点弹窗确认()
    await 冲一遍()
    expect(文本(host, "project-panel-action-error")).toBe("第一次没办成")

    await 开归档确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })

  /**
   * ── 找回（FR-009）──────────────────────────────────────────────────────
   *
   * 找回也走**同一个弹窗**（用户 2026-10-11：「通过弹窗进行交互，让用户选择『找回』、『取消』」）。
   *
   * 下面这一组刻意分成两块：**第一块**钉「它确实是个弹窗、形状对、说清了后果」，
   * **第二块**钉「交出去之后出错落到哪一格」——两块钉的不是一回事，红了也好分诊。
   */
  test("点「找回」也开弹窗（与归档同一个），不是就地办掉", async () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]}
        onRestore={(p) => {
          记.push(p)
        }}
      />
    ))

    点找回(host)

    expect(await 等到(() => 有动作弹窗())).toBe(true)
    expect(无槽(host, "project-action-dialog")).toBe(true)
    expect(记).toEqual([])
  })

  test("找回弹窗上写出的还是那一行项目", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    await 开找回确认(host)

    expect(弹窗文本("project-action-name")).toBe("封存专案")
  })

  /** 找回是**可逆**的那一侧，说清「找回后会回到哪儿」就够——别把它写成危险操作。 */
  test("找回弹窗说清找回后回到哪里（不写那句「删掉」——它不删任何东西）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    await 开找回确认(host)

    const 文案 = 弹窗文本("project-action-dialog") ?? ""
    expect(文案).toContain("找回")
    expect(文案).toContain("全部")
    expect(文案).not.toContain("删掉")
  })

  /**
   * 找回那颗确认键**不是**危险色——同一个弹窗、两个动作，形状得跟着「这一步要不要毁东西」走。
   *
   * ⚠️ 这条与上面「归档是 danger」是**一对**：只钉归档那条的话，一个永远给 `danger` 的实现
   * 照样全绿（两处写死同一个值），而民警在找回时会被吓一跳。
   */
  test("找回弹窗的确认键是中性的，不是危险色（它不毁东西）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    await 开找回确认(host)

    expect(弹窗("project-action-ok")?.getAttribute("data-variant")).toBe("neutral")
  })

  test("找回弹窗开出来时焦点也在「取消」上（同一个弹窗，同一个默认）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    await 开找回确认(host)

    expect(焦点在弹窗取消()).toBe(true)
  })

  test("找回确认 ⇒ 交出去那一行，弹窗收掉", async () => {
    const 记: ProjectEntry[] = []
    const 甲 = 我的(归档(私有("p2", "封存专案", 1)), "owner")
    const host = mount(() => (
      <ProjectPanel
        projects={[甲]}
        onRestore={(p) => {
          记.push(p)
        }}
      />
    ))

    await 开找回确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(记).toEqual([甲])
    expect(await 等到(() => !有动作弹窗())).toBe(true)
  })

  /**
   * ── 找回收口：只有 owner 能找回（用户 2026-10-11 裁定「找回按 owner 收口」）──────────
   *
   * 判定**一份都不在这里**：读 `ProjectMembership.decide({archived: true, action: "restore"})`
   * ——归档态下 `restore` 只有 owner 过（`membership.ts` 的 `if (input.archived)` 那一支）。
   * 下面两条钉的是**范围**：member 不画、缺 role 不画。
   *
   * 缺 `role` 那条与 member 那条**必须分开**（同归档那两条的理由）：前者的危险写法是给个默认
   * 角色（`?? "owner"` 直接放行），那等于「不知道」被当成「知道他是 owner」（`LEARNINGS #004-07`）。
   */
  test("member 的行不画「找回」（找回按 owner 收口，判定走 `decide`）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(归档(共享("p2", "串并案", 2, 3)), "member")]}
        onRestore={() => {}}
      />
    ))

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(true)
  })

  test("没有 role 的行不画「找回」（缺键 = 没有授权依据，不倒向任何角色）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[归档(私有("p2", "封存专案", 1))]} onRestore={() => {}} />
    ))

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(true)
  })

  /** 反向的一条：owner **要**画。少了它，上面两条可以被一个「永远不画」的实现骗过。 */
  test("owner 的行画「找回」（上两条的反向对照，不然「永远不画」也能全绿）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    页签(host, "archived")?.click()

    expect(文本(host, "project-restore")).toBe("找回")
  })

  test("找回没办成 ⇒ 同一处报错（两个动作共一格，不各报一半）", async () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]}
        onRestore={() => "找回项目失败"}
      />
    ))

    await 开找回确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("找回项目失败")
  })

  test("找回的回话是异步的（Promise）也等得到（同 onCreate 那条）", async () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]}
        onRestore={() => Promise.resolve("还是不行")}
      />
    ))

    await 开找回确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("还是不行")
  })

  test("找回办成了 ⇒ 不留错误文案（同一格的另一半）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]} onRestore={() => {}} />
    ))

    await 开找回确认(host)
    点弹窗确认()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })

  /**
   * 找回那一侧的「取消」——归档那条已有，这条是**另一半**：同一个弹窗、同一个取消键，
   * 走的是 `onRestore` 那条回路的守卫。只钉归档那条的话，一个「取消键只对归档有效」的
   * 实现照样全绿，而民警在找回弹窗里点取消时项目已经被找回走了。
   */
  test("找回弹窗点取消 ⇒ 弹窗收掉，一次都不发（改主意不用付出代价）", async () => {
    let 次数 = 0
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(归档(私有("p2", "封存专案", 1)), "owner")]}
        onRestore={() => {
          次数 += 1
        }}
      />
    ))

    await 开找回确认(host)
    弹窗("project-action-cancel")?.click()

    expect(await 等到(() => !有动作弹窗())).toBe(true)
    expect(次数).toBe(0)
  })
})

/**
 * 超期提醒的呈现（T024 · FR-008 的下半条：3 个月无操作 ⇒ **提醒 owner** 确认后归档）。
 *
 * ## 本 task 只做「呈现」，判定一条都不在这里
 *
 * `stale` 是**服务端算好的**（`project_ext.last_accessed_at` ＋ 一次 `Date.now()`，
 * 见 `core/src/project/ext.ts` 的 `isStale`）——本面板不碰时钟、不碰「90 天」那个数。
 * 谁该被提醒则复用现成的 `canArchive`（`ProjectMembership.decide` 那一份实现），
 * 所以本组钉的是**范围**：提醒跟着「能归档」那一行走，且**不跟着归档按钮一起被限制在「全部」tab**。
 *
 * ## 提醒与动作是两件事（用户 2026-10-07 裁定的范围）
 *
 * `行` 上出现「超期未归档」**只说明事实**（这个项目 3 个月没人动过），它不是一个按钮：
 * 归档那个动作仍只在「全部」tab 的那一行上（设计 §8.1）。所以下面有一条用例专门钉
 * 「最近 tab 有提醒、却没有归档按钮」——这两件事混起来（把提醒挂在按钮的守卫上）会让
 * 民警在「最近」里看不到任何提醒，而那正是他每天会打开的那个 tab。
 */
describe("超期提醒的呈现（T024）", () => {
  /** 一个「超期」的行（服务端说这一行的 `stale` 为真）。 */
  const 超期 = (e: ProjectEntry): ProjectEntry => ({ ...e, stale: true })

  test("「全部」tab：owner 那一行带「超期未归档」（FR-008 的提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(私有("p1", "8·17专案", 3), "owner"))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(文本(host, "project-stale")).toBe("超期未归档")
  })

  /** 不超期 ⇒ 什么都不画（缺的槽位读作 `undefined`，不是「空字」）。 */
  test("没过 3 个月的行不带提醒（`stale` 缺键 = 不提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /**
   * **提醒只给能归档的那个人**（owner）——判定复用 `canArchive`，组件零规则复述。
   * member 看得见项目，但归档不是他能做的（`decide` 拒）⇒ 提醒他也不该看到：
   * 一条他无法处置的提醒只是噪音（`§3` 那句「提醒 owner 确认」的「owner」就是这个意思）。
   */
  test("member 的行不带提醒（提醒的是能处置它的那个人）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(共享("p2", "串并案", 2, 3), "member"))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /** 缺 `role` = 没有成员关系 ⇒ 同 `canArchive`：fail-closed，不提醒。 */
  test("没有 role 的行不带提醒（缺键 = 没有授权依据，不倒向 owner）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(私有("p1", "8·17专案", 3))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /** 已归档的行不带提醒——归档就是这条提醒的**结果**（`canArchive` 对归档态拒）。 */
  test("已归档的行不带提醒（归档正是这条提醒要办的事，办完了就不提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(归档(我的(私有("p1", "8·17专案", 3), "owner")))]} onRestore={() => {}} />
    ))

    页签(host, "archived")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /**
   * **「最近」tab 也画提醒**，但**不画**归档按钮——这两件事在 T024 被刻意拆开
   * （`onArchive` 只喂给「全部」那一组，而提醒跟着 `canArchive` 走）。
   *
   * 一条用例同时钉住两半：少了后半句，把提醒挂在 `onAskArchive` 上的写法会绿；少了前半句，
   * 提醒只活在用户不常打开的 tab 里（每天打开的是「最近」）。
   */
  test("「最近」tab 也画提醒，但不画「归档」（提醒只说明事实，动作仍在「全部」）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(私有("p1", "8·17专案", 3), "owner"))]} onArchive={() => {}} />
    ))

    expect(文本(host, "project-stale")).toBe("超期未归档")
    expect(无槽(host, "project-archive")).toBe(true)
  })
})

/**
 * 面板的高度约束与滚动（**2026-10-11 用户实报**：「最近 / 全部 / 已归档三个 tab 没有垂直滚动条」，
 * 项目多到超出视口时列表末尾与归档确认框都够不着）。
 *
 * ## 根因（真栈实测，不是推断）
 *
 * 面板根元素**既无高度上限、也无滚动容器**；挂它的槽（`workspace-entry.tsx:695`）是
 * `absolute inset-x-0 top-10`，**不限高** ⇒ 面板长到内容高（实测 32 行时 `h=1010`、底边
 * `y=1095`，而视口只到 919）。唯一能滚的祖先 `three-pane-left-card` 是
 * **`overflow-y: hidden`** ⇒ 超出的 176px 被**裁掉且滚不动**：真栈里 `page.mouse.wheel(0,800)`
 * 前后 `scrollTop` 恒为 0，页面上没有任何一处能滚。归档确认框因此渲染在 `y=1094`，真人永远点不到
 * （Playwright 点得着只是因为它能**程序化**滚动 `overflow:hidden` 的盒子 —— `LEARNINGS #005-30`：
 * 那是工具的规矩，不是产品的行为）。
 *
 * ## 这一层能钉什么、不能钉什么
 *
 * ⚠️ happy-dom **没有 CSS 引擎**（本文件头那条），所以这里只能钉「**滚动容器**这件事在 DOM 上
 * 留下的**记号**」——`overflow-y-auto` 与 `min-h-0` 两个 token 在不在。**真的滚得动**、面板底边
 * 落回容器内、归档确认框落进视口，都由真栈 spec 量几何，**不在这一层**（`LEARNINGS #002-02`：
 * 测不了的要写成缺口，不能写成覆盖）。
 *
 * ⚠️ 高度上限**不在这里**：它落在挂载槽上（那个盒子才知道自己
 * `top-10`、包含块多高），故本组件测试看不到它 —— 组件测试钉「面板肯被压」，
 * 槽钉「能压到多高」，两处各钉一半。
 */
describe("面板的高度约束与滚动（用户 2026-10-11 实报）", () => {
  /**
   * `className` 串 → token 集合。
   *
   * ⚠️ **必须逐 token 相等，不能用 `toContain`**：`min-h-0` 是 `min-h-0.5` 的**真前缀**，
   * 子串匹配会被另一个真类名满足而**假绿**（`LEARNINGS #006-22`）。
   */
  const 类名集 = (el: HTMLElement | null) => new Set((el?.className ?? "").split(/\s+/).filter(Boolean))

  test("列表区是滚动容器（`overflow-y-auto`），且面板根与列表区都允许被压到内容高以下（`min-h-0`）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    const 根 = 类名集(host.querySelector<HTMLElement>("[data-component='project-panel']"))
    const 体 = 类名集(槽(host, "project-panel-body"))

    // 被测属性先写：列表区自己就是滚动容器
    expect(体.has("overflow-y-auto")).toBe(true)
    // 光有 `overflow-y-auto` **不够**：flex 子项的自动最小高＝内容高，不给 `min-h-0` 就压不扁、
    // 照样把面板撑破（这条正是「加了 overflow 却没生效」的那种半修）。
    expect(体.has("min-h-0")).toBe(true)
    // 根同理：它本身是槽的 flex 子项，不给 `min-h-0` 就在槽里压不下去。
    expect(根.has("min-h-0")).toBe(true)
  })
})

/**
 * ── 项目行 ⋯ 菜单 / 就地改名 / 删除确认（2026-10-16 spec §3/§8/§10）──────────────
 *
 * 行内 ⋯ 菜单的两个动作（改名 / 删除）与删除确认。`mount` / `等一拍` / `等到` / `弹窗` /
 * `点弹窗确认` 复用本文件已有的；下面这组辅助（`指` / `行菜单钮` / `菜单项` / `改名框` /
 * `打字` / `点弹窗取消`）是本 task 新加的。
 */

/**
 * 点一颗钮，派**真实的指针序列**——`pointerdown` 开菜单、`pointerup` 选中项。
 *
 * ⚠️ 不能用 `.click()`：Kobalte 的菜单项选择发生在 **`pointerup`**（`menu-item-base`：
 * `e.button === 0` 且未 disabled ⇒ `onSelect()`），而 `.click()` 派的那条链**不含**它
 * ⇒ 点菜单项**什么都不发生**、而用例**不报错**（`LEARNINGS #006-37`）。
 * 先例：`file-tree.test.tsx` 的 `点加号` / `点菜单项`。
 */
const 指 = (el: HTMLElement | null | undefined) => {
  if (!el) throw new Error("指针目标不在——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/**
 * 把「这几次延时都排空」——`setTimeout(0)` → `requestAnimationFrame` → `setTimeout(0)`。
 *
 * ⚠️ 「就地改名」那条链上这是**必须**的两拍之一：菜单**开**那一刻 Kobalte 的 `tryAutoFocus`
 * （延迟自动聚焦，`setTimeout 0`）会在点菜单项**之后**才把焦点抢回菜单内容（`LEARNINGS #006-31`：
 * 等条件不等时间——`等到` 在菜单项一出现就同步返回，tryAutoFocus 还没落地）。点菜单项前先
 * `冲刷` 一拍让它落地；点完再 `冲刷` 一拍让 `就地改名输入` 的 rAF 焦点赢下来。少了它，测的就变成
 * 「开菜单与点菜单项落在同一个 tick」，是**挂具造出来的**时序，不是产品行为。
 * 先例：`ai-session/session-list.test.tsx` 的 `冲刷`（同一段理由，同一段注释）。
 */
const 冲刷 = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 某一行上那颗「⋯」（菜单触发器）。菜单 Portal 到 `document.body` ⇒ 内容要查 `document`。 */
const 行菜单钮 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-item-name']")?.textContent?.trim() === 名)
    ?.querySelector<HTMLElement>("[data-project-action='menu']")

/** 菜单里某一项（**Portal 到 body**，不在 host 里）。 */
const 菜单项 = (action: string) => document.body.querySelector<HTMLElement>(`[data-project-action='${action}']`)

/** 某一行上那个就地改名输入框（编辑态才有）。 */
const 改名框 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-rename-input']") !== null)
    ?.querySelector<HTMLInputElement>("[data-slot='project-rename-input']")

/** 往输入框里打字：Solid 的 `onInput` 读 `event.currentTarget.value` ⇒ 先落值再派事件。 */
const 打字 = (el: HTMLInputElement, 值: string) => {
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 点弹窗里那颗「取消」（三个动作**共用同一个槽位**——它们是同一个弹窗）。 */
const 点弹窗取消 = () => 弹窗("project-action-cancel")?.click()

describe("项目行 ⋯ 菜单（spec §8 / §10 判据 8）", () => {
  const 项目 = (over: Partial<ProjectEntry> = {}): ProjectEntry => ({
    id: "p1",
    name: "8·17专案",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
    ...over,
  })

  test("接了 onRename / onDelete ⇒ 那一行有 ⋯；菜单里两项：改名、删除", async () => {
    const host = mount(() => <ProjectPanel projects={[项目()]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("rename") !== null)

    expect(菜单项("rename")?.textContent?.trim()).toBe("改名")
    expect(菜单项("delete")?.textContent?.trim()).toBe("删除")
  })

  /**
   * **未接线 ⇒ 不画**（本文件那条既有的约定：不给回调 ⇒ 那个动作不长出来）。
   * 只钉「接了就有」会漏掉这一半——一个「总是画」的实现照样绿，而它给民警的是
   * 两颗点了没反应的钮（本文件 `问归档` 那段注释逐字记着这条的理由）。
   */
  test("一个回调都不接 ⇒ 那一行**没有** ⋯", () => {
    const host = mount(() => <ProjectPanel projects={[项目()]} />)
    expect(行菜单钮(host, "8·17专案") === null).toBe(true)
  })

  /**
   * **归档态下只有删除、没有改名**（`decide` 的归档分支：只对 owner 的 restore 与 delete 开口）。
   * 这条同时是「面板不重写规则、只把事实交给 `decide`」的判据。
   *
   * ⚠️ 已归档的行只在「已归档」tab 或搜索结果里出现（默认「最近」tab 只画活跃项目），
   * 所以先切到「已归档」tab——brief 原样用例没有这一步，会红在「前提不成立」上。
   */
  test("已归档的行：⋯ 里只有删除（改名在归档态下被拒）", async () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[项目({ archived: true })]}
        onRename={() => {}}
        onDelete={() => {}}
        onRestore={() => {}}
      />
    ))

    页签(host, "archived")?.click()
    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("delete") !== null)

    expect(菜单项("rename") === null).toBe(true)
    expect(菜单项("delete")?.textContent?.trim()).toBe("删除")
  })

  /**
   * **member 看到的是「能不能」而不是「点了会怎样」**：非 owner 的 ⋯ 一项都不该有
   * （spec §7：改名与删除都只有创建人能做）。
   */
  test("角色是 member ⇒ 那一行**没有** ⋯（两个动作都不是他能做的）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[项目({ role: "member" })]} onRename={() => {}} onDelete={() => {}} />
    ))
    expect(行菜单钮(host, "8·17专案") === null).toBe(true)
  })
})

describe("就地改名（spec §8 / §10 判据 9）", () => {
  const 项目: ProjectEntry = {
    id: "p1",
    name: "8·17专案",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
  }

  test("点「改名」⇒ 那一行的名字那格变输入框，**预填着原名**", async () => {
    const host = mount(() => <ProjectPanel projects={[项目]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("rename") !== null)
    await 冲刷()
    指(菜单项("rename"))
    await 冲刷()

    expect(改名框(host, "8·17专案")?.value).toBe("8·17专案")
  })

  test("回车 ⇒ `onRename` 收到**那一行**的项目与 trim 后的新名字", async () => {
    const 收到: Array<[string, string]> = []
    const host = mount(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(p, name) => {
          收到.push([p.id, name])
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("rename") !== null)
    await 冲刷()
    指(菜单项("rename"))
    await 冲刷()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "  8·17专案（改）  ")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(收到).toEqual([["p1", "8·17专案（改）"]])
  })

  /**
   * **Esc 与空草稿都不提交**（判据 9 的后半句）——两条**分开**写：它们走的是同一条
   * `on取消`，但**理由不同**（一个是用户反悔、一个是「清空名字不是一次改名」），
   * 合成一条时只会在改一处时漏掉另一处（`LEARNINGS #005-12`：同一个修法落在 N 个入口就写 N 条）。
   */
  test("Esc ⇒ 一个回调都不喊，那一行退回展示态", async () => {
    const 收到: unknown[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(...args) => {
          收到.push(args)
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("rename") !== null)
    await 冲刷()
    指(菜单项("rename"))
    await 冲刷()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "改到一半")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await 等一拍()

    expect(收到).toEqual([])
    expect(改名框(host, "8·17专案") === undefined).toBe(true)
  })

  test("空草稿回车 ⇒ 不提交（清空名字不是一次改名），那一行退回展示态", async () => {
    const 收到: unknown[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(...args) => {
          收到.push(args)
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 菜单项("rename") !== null)
    await 冲刷()
    指(菜单项("rename"))
    await 冲刷()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "   ")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await 等一拍()

    expect(收到).toEqual([])
    expect(改名框(host, "8·17专案") === undefined).toBe(true)
  })
})

describe("删除确认（spec §8 / §10 判据 10）", () => {
  const 项目: ProjectEntry = {
    id: "p1",
    name: "甲项目",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
  }

  test("点「删除」⇒ 开确认框，措辞是 spec §8 那两句（**不提聊天记录**）", async () => {
    const host = mount(() => <ProjectPanel projects={[项目]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "甲项目"))
    await 等到(() => 菜单项("delete") !== null)
    指(菜单项("delete"))
    await 等一拍()

    expect(有动作弹窗()).toBe(true)
    expect(弹窗文本("project-action-name")).toBe("甲项目")
    expect(弹窗文本("project-action-hint")).toBe("项目里的文件会一并删掉，删了找不回来。")
  })

  test("点「取消」⇒ `onDelete` **一个请求都不发**，弹窗关掉", async () => {
    const 收到: unknown[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={() => {}}
        onDelete={(...args) => {
          收到.push(args)
        }}
      />
    ))

    指(行菜单钮(host, "甲项目"))
    await 等到(() => 菜单项("delete") !== null)
    指(菜单项("delete"))
    await 等一拍()
    点弹窗取消()

    expect(收到).toEqual([])
    // ⚠️ 关弹窗是**两步**（状态立刻、节点 ~100ms 后 dispose，`LEARNINGS #005-33`）
    // ⇒ 用有界轮询等它没了，不用固定延时。
    await 等到(() => !有动作弹窗())
  })

  test("点确认 ⇒ `onDelete` 收到那一行项目", async () => {
    const 收到: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={() => {}}
        onDelete={(p) => {
          收到.push(p)
        }}
      />
    ))

    指(行菜单钮(host, "甲项目"))
    await 等到(() => 菜单项("delete") !== null)
    指(菜单项("delete"))
    await 等一拍()
    点弹窗确认()

    expect(收到.map((p) => p.id)).toEqual(["p1"])
  })
})
