# 文件操作失败「回到发起它的那个面」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次文件操作失败时，服务端那句话出现在**发起它的那个面**上——新建 / 删除弹窗**不关**、就地报；重命名报在**被改名的那一行**上；三者共用同一个提示件与同一句措辞。

**Architecture:** 沿本仓**已有**的同形先例 `ProjectPanel.onCreate` 的「回话约定」（`project-panel.tsx:178-187`、`:705-716`）：回调**回一句字符串 = 没办成**，那句话给民警看；`undefined` / 不回 = 收工。三个发起面（新建弹窗 / 删除弹窗 / 树里那一行）各把回话画在自己身上；接线层 `收下()` 从「写一个共享信号」改成「**回**那句话」，由各调用方决定报在哪。

**Tech Stack:** TypeScript 5.8（`tsgo -b`）、SolidJS 1.9.10、Bun 1.3.14 测试、happy-dom、oxlint 1.60。

**Spec:** `docs/superpowers/specs/2026-10-16-file-op-failure-in-place-design.md`

## Global Constraints

- **上游约束**：改动只落在 fork 自己的文件里（`packages/app/src/project/**`、`packages/app/src/workspace/**`）。**不碰** `packages/ui` 与 `packages/session-ui` 的上游源码。`packages/app/src/components/inline-rename-input.tsx` **一个字不改**。
- **单独提交**：每个 Task 一个提交；提交信息末尾写「这是要保留的定制」。
- **基线（2026-10-16 实测，命令与实得都在下面）**：组件套件 **1042 pass / 0 fail / 2248 `expect()` / 51 个文件**。
  ```
  cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts $(find src -name '*.test.tsx' | tr '\n' ' ')
  ```
  ⚠️ 用**显式文件清单**而不是包脚本里的 `./src/**/*.test.tsx`：本机 Git Bash 的 `shopt globstar` 是 `off`（`LEARNINGS #006-03`），那个模式只展开一层 `src/*/*.test.tsx`，会**少算 11 个三层的测试文件**。
- **门禁三条，都在仓库根跑**（`#004-10`：oxlint 在包目录里跑会**配置解析失败**，不是 lint 失败）：
  - `bunx oxlint packages/app/src`
  - `bunx tsgo -p packages/app/tsconfig.json --noEmit`（若该命令不成立，改用 `bun --cwd packages/app run typecheck`，它在 `packages/app/package.json` 里定义）
  - 上面的组件套件命令（`cd packages/app` 那一条）
- **根 `bun test` 禁止**（`package.json` 的 `test` 脚本 `exit 1`）。
- **根 `bun run lint` 天生是红的**（`#001-02`：1 个上游 error），别拿它当门禁。
- **不谎称改了**：只写跑过的命令与它**实际**的输出；没跑、跑不动的，如实记。
- **回话约定（本计划的核心契约，四处逐字相同）**：
  ```ts
  (…) => string | undefined | Promise<string | undefined> | void
  ```
  **回一句字符串 = 没办成**（那句话给民警看）；`undefined` / 不回 = 收工。消费者一律用 `typeof 回话 !== "string"` 判收工，**不按 `kind` 判**（spec §6 末段：`rejected` 不等于「可重试」）。

---

## 开工前必读（执行者按顺序读这三处，别跳）

1. `packages/app/src/project/project-panel.tsx:154-190`（回话约定的**定义**）与 `:655-729`（`没建成` / `在办` 两只信号、`建()` 的收尾、`收起()` 清提示）——**这就是蓝本**，本计划四处弹窗/行内都照它。
2. `packages/app/src/project/project-panel.test.tsx:300-430`——蓝本的**测试形状**（`onCreate={async () => "项目名已存在"}`、`onCreate={() => new Promise<string | undefined>(() => {})}` 钉「在飞时不重复」）。
3. `packages/app/src/components/inline-rename-input.tsx:51-63`（「一次编辑只结一次账」那条**真栈实测**出来的守卫）——本计划**不放开它**，这是 spec §3 那条偏离的全部理由。

---

## 文件结构（谁负责什么）

| 文件 | 职责 | 本次 |
|---|---|---|
| `packages/app/src/project/file-op-error.tsx` | 「一次文件操作失败了」在**发起面**上的统一样子 ＋ **措辞组合的唯一一处** | **新建** |
| `packages/app/src/project/file-op-error.test.tsx` | 上面那一件的判据 | **新建** |
| `packages/app/src/project/file-create-dialog.tsx` | 问名字；失败时**不关**、就地报 | 改 |
| `packages/app/src/project/file-create-dialog.test.tsx` | 既有 9 条 ＋ 新增 | 改（harness 一行 ＋ 增 3 条） |
| `packages/app/src/project/file-delete-dialog.tsx` | 二次确认；失败时**不关**、就地报 | 改 |
| `packages/app/src/project/file-delete-dialog.test.tsx` | 该弹窗自上线起**没有**组件测试（`ls` 过）⇒ 本次补上 | **新建** |
| `packages/app/src/project/file-tree.tsx` | 三个回调的**契约**（`onCreate` / `onRename` / `onDelete`）＋「行话」落到那一行 | 改 |
| `packages/app/src/project/file-tree.test.tsx` | 既有用例的**签名适配**（23 处）＋ 增行话判据 | 改 |
| `packages/app/src/workspace/workspace-entry.tsx` | `收下()` 从「写共享信号」改成「**回**那句话」 | 改 |
| `packages/app/src/workspace/workspace-entry.test.tsx` | 改写 1 条 ＋ 增 5 条 | 改 |
| `packages/app/e2e/real-stack/file-op-error-real.spec.ts` | 真栈：目录被删掉的项目里点新建 ⇒ 弹窗不关、出现「目标目录不存在」 | **新建（若挂具做不出来，如实进缺口表，不写成已覆盖）** |
| `docs/superpowers/specs/2026-10-15-file-tree-multi-select-move-design.md` | 三条「登记为下一步 / 仍是旧口径」的文字同步 | 改 |
| `packages/app/src/project/project-data.ts`、`openhive-file-ops.ts`、`components/inline-rename-input.tsx` | — | **一行不改** |

---

## Task 0：确认基线（不改任何代码）

**Files:** 无

- [ ] **Step 1: 量基线（组件套件）**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts $(find src -name '*.test.tsx' | tr '\n' ' ')
```
Expected（2026-10-16 实测）：
```
 1042 pass
 0 fail
 2248 expect() calls
Ran 1042 tests across 51 files.
```
**把这四个数记下来**，后面每个 Task 收尾都要对。

- [ ] **Step 2: 量基线（affected packages 的 typecheck 与 oxlint）**

Run:
```bash
bun --cwd packages/app run typecheck
bunx oxlint packages/app/src
```
Expected：typecheck 退出码 0；oxlint 0 error（根目录跑，见 Global Constraints）。

**Completion criteria**：四个数（`pass` / `fail` / `expect` / 文件数）＋ 两条门禁的退出码写进本次会话记录。**不写回任何文件。**

---

## Task 1：新件 `file-op-error.tsx`（三处发起面共用的「就地报一句」）

**Files:**
- Create: `packages/app/src/project/file-op-error.tsx`
- Test: `packages/app/src/project/file-op-error.test.tsx`

**Interfaces:**
- Consumes: 无（本 Task 是叶子）
- Produces:
  - `export const 通用下一步: string`
  - `export interface FileOpErrorProps { 话: string }`
  - `export function FileOpError(props: FileOpErrorProps): JSX.Element` —— 根节点带 `data-slot="file-op-error"` 与 `role="alert"`，`textContent` 里**两行都有**

- [ ] **Step 1: 写会红的用例**

`packages/app/src/project/file-op-error.test.tsx`：

```tsx
/**
 * 「一次文件操作失败了」在**发起面**上的统一样子。
 *
 * ## 这一条钉的是**措辞的组合**，不是样式
 *
 * 三处发起面（新建弹窗 / 删除弹窗 / 树里那一行）共用这一个件，理由是**措辞组合只能有一处**
 * （`LEARNINGS #002-06`：同一个判断不许两处各写一份）——三处各拼一遍，改一句就漏两处。
 * 所以判据落在「两截话都在、且服务端那句**原样**」上；`role="alert"` 单列一条
 * （它是屏幕阅读器**读不读**这条失败的全部依据，`DESIGN §4.3`：不单以图形传意）。
 *
 * ⚠️ 挂载/卸载照 `file-create-dialog.test.tsx` 顶部那一套（`挂过的` ＋ `afterEach` 先卸载、
 * 再擦 `body`）——不这么做，某条用例里残留的定时器会在**下一条用例**里开火，而且红在别人头上。
 */

import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileOpError, 通用下一步 } from "./file-op-error"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

function 挂(话: string): HTMLElement {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <FileOpError 话={话} />, host))
  return host
}

/**
 * 那个件本身。
 *
 * ⚠️ **不许对返回的节点写 `expect(节点).toBeNull()` / `.not.toBeNull()`**——节点型断言一旦红，
 * 会把整轮 `bun test` **挂死**（`LEARNINGS #005-01`）。本文件把断言落在 `?.textContent` 这种
 * **字符串**上；要判「在不在」就在调用方写成 `件(host) === null` 那种**布尔**。
 */
const 件 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-slot='file-op-error']")

describe("FileOpError 失败提示件", () => {
  test("服务端那句原话**照登**（不改写、不加前缀）", () => {
    const host = 挂("项目根不能删")

    // `toContain` 而不是 `toBe`：下面那半截通用话也在同一段文本里
    expect(件(host)?.textContent ?? "").toContain("项目根不能删")
  })

  test("通用那句下一步在（与常量同源，不在这里再抄一遍字面量）", () => {
    const host = 挂("项目根不能删")

    expect(件(host)?.textContent ?? "").toContain(通用下一步)
  })

  test("`role=\"alert\"`——屏幕阅读器在它冒出来时读一遍", () => {
    const host = 挂("目标目录不存在")

    expect(件(host)?.getAttribute("role")).toBe("alert")
  })
})
```

- [ ] **Step 2: 跑用例，确认红**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-op-error.test.tsx
```
Expected: FAIL —— `error: Cannot find module "./file-op-error"`（文件还不存在）。**把实得的第一行原样记下来**。

- [ ] **Step 3: 写最小实现**

`packages/app/src/project/file-op-error.tsx`：

```tsx
/**
 * 「一次文件操作失败了」在**发起它的那个面**上的统一样子。
 *
 * ## 三处发起面共用一件，理由是措辞
 *
 * 新建弹窗（`file-create-dialog.tsx`）、删除弹窗（`file-delete-dialog.tsx`）、树里那一行
 * （`file-tree.tsx`）共用这一个件。合在一处的理由**不是省代码**，是**措辞的组合只能有一处**
 * ——三处各拼一遍，改一句就漏两处（`LEARNINGS #002-06`：同一个判断不许两处各写一份）。
 *
 * ## 判据是「发起这个动作时，用户正对着什么」
 *
 * 这条原则替代原来那条记错的（「是不是弹窗」）：上传 / 下载的失败仍走**内联**
 * `file-op-message`——它们的发起面是桌面拖拽 / 右键菜单，不在树上某一行、也不是弹窗
 * （spec §3 的落地表）。
 *
 * ## 不改写原因
 *
 * `openhive-file-ops.ts:377-379` 明写着这条：「服务端说了为什么就用它那句……前端不自己改写
 * 措辞，它不知道是哪一条规则挡下的」。下面补的那一句**不猜原因**（它不区分类别），所以不破
 * 那条原则。
 *
 * ⚠️ **不按失败类别分形状**：`FileOpOutcome` 里 `rejected` 不等于「可重试」——
 * `openhive-file-ops.ts:360-373` 点名 401（会话过期）与 403（已归档）都归 `rejected`，
 * 而它们「重试永远撞同一道门」；「目标目录不存在」是 400，也归 `rejected`。形状由**发起面**
 * 决定，与失败类别无关。
 */

import type { JSX } from "solid-js"

/**
 * 服务端那句原话下面固定补的一句。**这个常量只有一处消费者**（本文件），要换说法改这一行。
 *
 * 它是**兜底**：服务端说了原因（那样本句只是多余的礼貌），服务端**没说**原因（网络断、会话过期）
 * 时才显出用处——民警至少知道「这不是我的操作错了」。
 */
export const 通用下一步 = "如果反复出现，请把这句话告诉管理员。"

export interface FileOpErrorProps {
  /** 服务端那句话（`FileOpOutcome.message`）——**照登**，一个字都不改写、不加前缀。 */
  话: string
}

export function FileOpError(props: FileOpErrorProps): JSX.Element {
  return (
    <p
      data-slot="file-op-error"
      // 屏幕阅读器在它冒出来时读一遍。不是模态、不需要焦点管理
      // （同 `workspace-entry.tsx` 那条内联 `file-op-message`）。
      role="alert"
      // 样式与内联那条 `file-op-message` **逐字相同**（`workspace-entry.tsx:1095-1105`）：
      // 同一句话在两种容器里的同一个样子，色值分家会让「同样是失败」看起来是两回事。
      class="w-full min-w-0 rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[13px] break-all text-v2-state-fg-danger"
    >
      {/* 两截话各占一行（`block`）——`textContent` 因此是两段连排，`toContain` 两截都能命中。 */}
      <span class="block">{props.话}</span>
      <span class="block">{通用下一步}</span>
    </p>
  )
}
```

- [ ] **Step 4: 跑用例，确认绿**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-op-error.test.tsx
```
Expected: `3 pass / 0 fail`。

- [ ] **Step 5: 变异验证（④ 步，`#003-03` 三类据实记）**

拆掉 `file-op-error.tsx` 里的 `<span class="block">{通用下一步}</span>` 这一行，重跑 Step 4。
预期：「通用那句下一步在」**红**，另两条**绿**。**把红的那条的实得值原样记下来**（应当是 `toContain` 收到的实际字符串）。
拆完立刻把那一行**加回去**（`cp` 备份还原，**别用 `git checkout --`**——`#005-40`：这份改动还没入库）。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/project/file-op-error.tsx packages/app/src/project/file-op-error.test.tsx
git commit -m "feat(project): 文件操作失败提示件 FileOpError——三处发起面共用的措辞唯一来源

回话约定与 ProjectPanel.onCreate 逐字相同（回一句字符串 = 没办成）。
这是要保留的定制。"
```

---

## Task 2：新建弹窗——失败**不关**，就地报

**Files:**
- Modify: `packages/app/src/project/file-create-dialog.tsx`
- Modify: `packages/app/src/project/file-tree.tsx`（`:960-973` 的开弹窗处，`onConfirm` 改异步并交出回话）
- Test: `packages/app/src/project/file-create-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `FileOpError`
- Produces:
  - `FileCreateDialogProps.onConfirm: (name: string) => string | undefined | Promise<string | undefined> | void`
  - `FileTreeProps.onCreate` 同一形状（另外两个回调属别处：`onDelete` 见 Task 3、`onRename` 见 Task 4）

- [ ] **Step 1: 先改既有 harness（否则这一 Task 的 typecheck 与三条新用例都写不出来）**

`file-create-dialog.test.tsx:33-51` 那两个助手现在是（逐字，`grep -n "function 触发器\|async function 打开"` 可对上）：

```tsx
function 触发器(props: Omit<FileCreateDialogProps, "onConfirm"> & { 收到: string[] }): JSX.Element {
  const dialog = useDialog()
  return (
    <button
      data-slot="open"
      onClick={() =>
        dialog.show(() => <FileCreateDialog {...props} onConfirm={(name) => props.收到.push(name)} />)
      }
    >
      开
    </button>
  )
}

async function 打开(props: Omit<FileCreateDialogProps, "onConfirm">): Promise<string[]> {
  const 收到: string[] = []
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器({ ...props, 收到 })}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return 收到
}
```

两处要动，**`收到` 与既有 9 条的断言一个字不改**：

① `触发器` 的 `onConfirm` 换成**块体**，并把剧本的回话交出去：

```tsx
/** 剧本：`回话` = 服务端每次回的那句话（`string` = 没办成）；`在飞` = 手工控回话时机的通道。 */
interface 剧本 {
  回话?: string
  在飞?: Promise<string | undefined>
}

function 触发器(props: Omit<FileCreateDialogProps, "onConfirm"> & { 收到: string[] } & 剧本): JSX.Element {
  const dialog = useDialog()
  return (
    <button
      data-slot="open"
      onClick={() =>
        dialog.show(() => (
          <FileCreateDialog
            {...props}
            onConfirm={(name) => {
              // 块体 ⇒ 返回 `void`，落在新契约的 `| void` 那一支上。
              // （原来那个表达式体 `(name) => props.收到.push(name)` 返回 `number`——
              //  `number` **落不进**新契约的联合类型，2026-10-16 用 `tsc --strict` 实测过。）
              props.收到.push(name)
              return props.在飞 ?? props.回话
            }}
          />
        ))
      }
    >
      开
    </button>
  )
}
```

② `打开` 只补个 `剧本`，**函数体逐字不动**（返回值仍是 `收到`——既有 9 条读的就是它）：

```tsx
async function 打开(props: Omit<FileCreateDialogProps, "onConfirm"> & 剧本): Promise<string[]> {
```

⚠️ 既有 9 条**一个字不改**：它们不传 `回话` / `在飞` ⇒ 交回 `undefined` ⇒ 按收工处理，与改之前同行为。
**这是对 spec §7 的一处据实修正**（spec 写「一条不用改」；实际是**断言**一条不用改——harness 这两个
助手必须改），Task 7 会写回 spec。

③ 加一个**布尔**的「弹窗在不在」（**别**对节点写 `.not.toBeNull()`——`#005-01`：节点型断言红了会把
整轮 `bun test` 挂死）：

```tsx
/** 新建弹窗还在不在。**布尔**，不是节点——见 `file-op-error.test.tsx` 顶部那条警告。 */
const 弹窗在 = () => document.body.querySelector("[data-slot='file-create-dialog']") !== null
```

- [ ] **Step 2: 写会红的用例（三条，加在 `describe` 内末尾——既有 9 条之后）**

⚠️ 本文件既有的助手逐字是这些（**别自己另发明**）：`打开(props) → Promise<string[]>`（返回 `收到`）、
`框()`（输入框，按 `[data-slot='file-create-dialog'] input` 查，找不到就**抛**）、`填(值)`（填 ＋ 派发
`input`）、`提交()`（派发 `submit`——`ButtonV2 type="submit"` 在 happy-dom 里点不出 `submit`）、
`文案(slot)`（`document.body` 里某槽位的 `textContent.trim()`）、`确定()`（「确定」那颗**元素**，
不是点击函数）。

```tsx
  /**
   * ── 「失败回到发起它的那个面」（2026-10-16）────────────────────────
   *
   * 改之前：`确定()` **立刻** `dialog.close()`，服务端那句话落在**工具栏下方**的内联红字里
   * （`workspace-entry.tsx` 的 `file-op-message`）——用户在弹窗里按了确定，话掉到一棵树之外，
   * 既看不到名字还在不在、也不知道该不该重来（民警 2026-10-16 实报）。
   * 改之后：回了字符串 ⇒ 弹窗**不关**、话就地在落点那行下面。
   */

  test("没办成 ⇒ 弹窗**不关**、服务端原话就地显示、名字草稿还在", async () => {
    await 打开({ kind: "file", parent: "资料", 回话: "目标目录不存在" })

    填("新.md")
    提交()
    await flush()
    await flush()

    // 主判据：那句话在**弹窗里那一件**上（`FileOpError` 的根带 `data-slot="file-op-error"`）
    expect(文案("file-op-error") ?? "").toContain("目标目录不存在")
    // 「不关」这条承诺的全部证据
    expect(弹窗在()).toBe(true)
    // 名字草稿留着：改一处就能再交一次，不必重开、重敲
    expect(框().value).toBe("新.md")
  })

  test("没办成之后改个名字再交 ⇒ **会再发一次**（弹窗没关，所以这条链还在）", async () => {
    const 收到 = await 打开({ kind: "file", parent: "资料", 回话: "目标目录不存在" })

    填("新.md")
    提交()
    await flush()
    await flush()

    填("改过的.md")
    提交()
    await flush()
    await flush()

    expect(收到).toEqual(["新.md", "改过的.md"])
  })

  test("在飞时再按一次「确定」⇒ 只发一次（这个洞是「弹窗不关」新造出来的）", async () => {
    let 放行: ((话: string | undefined) => void) | undefined
    // 一条**不自己兑现**的 promise 当剧本，由本用例手工放行
    const 在飞 = new Promise<string | undefined>((resolve) => (放行 = resolve))
    const 收到 = await 打开({ kind: "file", parent: "资料", 在飞 })

    填("新.md")
    提交()
    提交() // 第二次：此刻回话还没到（`在飞` 尚未兑现）
    await flush()
    放行?.(undefined)
    await flush()
    await flush()

    expect(收到).toEqual(["新.md"])
  })
```

- [ ] **Step 3: 跑，确认红**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-create-dialog.test.tsx
```
Expected: 三条新用例**红**，既有 9 条**绿**。红的样子：第一条红在 `文案("file-op-error")`（实得
`undefined`——件压根没被渲染）；第二条红在 `toEqual(["新.md","改过的.md"])`（实得只剩 `["新.md"]`——
弹窗关了、第二趟交不出去）；第三条红在 `toEqual(["新.md"])`（实得 `["新.md","新.md"]`）。
**把三条实得值原样记下来**（`#005-46`：别先写预期再对答案）。

- [ ] **Step 4: 改实现**

`file-create-dialog.tsx` 四处改动：

① `props` 类型（`:45-52`）：`onConfirm` 那一段连同注释换成：

```tsx
  /**
   * 回话约定（与 `ProjectPanel.onCreate` **逐字相同**，见 `project-panel.tsx:178-187`）：
   * **回一句字符串 = 没办成**，那句话就地在弹窗里给民警看、弹窗**不关**；`undefined` / 不回 /
   * `Promise<void>` = 收工（弹窗关掉）。
   *
   * 取消 / 关闭仍然**一次都不喊**。
   */
  onConfirm: (name: string) => string | undefined | Promise<string | undefined> | void
```

② 两只新信号（在 `const [草稿, set草稿] = createSignal("")` 下一行）：

```tsx
  /** 上一次没办成的那句话；`undefined` = 没话说。用户一动输入框就清掉（见 `onInput`）。 */
  const [失败话, set失败话] = createSignal<string | undefined>()
  /** 交出去之后、回话之前。这段缝隙里「确定」是锁着的（见 `确定`）。 */
  const [忙, set忙] = createSignal(false)
```

③ `确定()`（`:62-69`）整段换成：

```tsx
  async function 确定() {
    const name = 名字()
    // `忙` 守卫：「弹窗不关」**新造**出一个旧形状不存在的洞——请求在飞时再按一次「确定」会
    // **建两次**。改之前弹窗立刻关，这个洞不存在（spec §5.2 第 1 条）。
    if (name === undefined || 忙()) return
    set忙(true)
    let 回话: string | undefined | void
    try {
      回话 = await props.onConfirm(name)
    } catch (err) {
      // 抛错 = 「我们这边坏了」。保住原注释那条理由：别让用户对着一个「填好了却没反应」的框。
      // 这一支**不在本次射程内**，一个字不改它的行为。
      dialog.close()
      throw err
    } finally {
      set忙(false)
    }
    // 只有**字符串**算「有话要说」——`undefined` / `void` 都按收工处理（同 `project-panel.tsx:711`）。
    if (typeof 回话 !== "string") {
      dialog.close()
      return
    }
    set失败话(回话)
  }
```

④ 输入框与渲染：

- `onInput` 改成 `onInput={(event) => { set草稿(event.currentTarget.value); set失败话(undefined) }}`
  —— 用户动了输入框，那句「名字不合法」就过期了；留着是不再成立的话（`#005-45` 同族）。
- 落点那行 `<p data-slot="file-create-parent">` **下面**插入：

```tsx
          {/* 失败就地在弹窗里（spec §3：失败回到**发起它的那个面**）。
              位置在落点那行下面、按钮上面——用户的眼睛本来就在这一带来回。 */}
          <Show when={失败话()}>{(话) => <FileOpError 话={话()} />}</Show>
```

- `onSubmit` 改成 `onSubmit={(event) => { event.preventDefault(); void 确定() }}`（`void`：`no-floating-promises`）。
- 「确定」那颗：`disabled={名字() === undefined || 忙()}`。
- 顶部 import 加：`import { Show, createSignal, type JSX } from "solid-js"`（`Show` 是新加的）与 `import { FileOpError } from "./file-op-error"`。

⑤ `file-tree.tsx:960-973` 的开弹窗处（`onConfirm` 那一段）换成：

```tsx
      <FileCreateDialog
        kind={kind}
        parent={parent}
        onConfirm={async (name) => {
          // 默认全收缩（用户第 5 条）之下，不打开落点这一条链，用户建完就**看不见自己刚建的东西**
          // ——所以提交那一刻先开链，再喊回调。
          // ⚠️ 时机仍是「用户提交了」，不是「服务端回了成功」：这条取舍的代价只是「失败时多展开了
          // 几个目录」。
          展开链(parent)
          // 把回话**原样**交回弹窗（`string` = 没办成 ⇒ 弹窗不关、就地报）。
          return 交({ kind, parent, name })
        }}
      />
```

同时把 `FileTreeProps.onCreate`（`:151`）的类型改成与 `FileCreateDialogProps.onConfirm` 同一形状：

```ts
  onCreate?: (input: { kind: "file" | "directory"; parent: string; name: string }) =>
    | string
    | undefined
    | Promise<string | undefined>
    | void
```

- [ ] **Step 5: 跑，确认绿**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-create-dialog.test.tsx
```
Expected: **12 pass / 0 fail**（既有 9 ＋ 新 3）。

- [ ] **Step 6: 变异验证（④ 步）**

把 `确定()` 里那两句 `if (typeof 回话 !== "string") { dialog.close(); return }` 与 `set失败话(回话)`
换成改之前的 `dialog.close()`（即「永远关」）。重跑 Step 5。

**据实记红哪几条、红在哪一句**（`#005-46`：别先写预期再对答案）。可预期的形状是：`不关 / 原话 / 草稿`
那条红在 `文案("file-op-error")`（实得 `undefined`）、`会再发一次` 那条红在 `toEqual`（实得只剩一趟）。
**第三条「在飞时再按一次」大概率仍绿**——它断的是「只发一次」，而「永远关」也满足它。⇒ 当场记一句：
**它在这一轮变异下不是守护者**，它守的是 `忙()` 那条守卫；要证它有牙，**另跑一次专门的变异**：
只删掉 `if (name === undefined || 忙()) return` 里的 `|| 忙()`，重跑 ⇒ 期待它红成 `["新.md","新.md"]`。
**两轮变异都要记**，按 `#003-03` 三类（恰红 / 红得更多 / 全绿）分开写。
⚠️ 跑完把实现改回来（`cp` 备份还原，`#005-40`：这份改动还没入库）。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/project/file-create-dialog.tsx packages/app/src/project/file-create-dialog.test.tsx packages/app/src/project/file-tree.tsx
git commit -m "feat(project): 新建弹窗失败不关、就地报服务端原话

回话约定与 ProjectPanel.onCreate 逐字相同；在飞期间「确定」锁住（弹窗不关新造的重发洞）。
这是要保留的定制。"
```

---

## Task 3：删除弹窗——同一份形状（并**补上缺失的组件测试**）

**Files:**
- Modify: `packages/app/src/project/file-delete-dialog.tsx`
- Modify: `packages/app/src/project/file-tree.tsx`（`:917` 的 `onConfirm` 与 `FileTreeProps.onDelete` 的类型）
- Test: `packages/app/src/project/file-delete-dialog.test.tsx`（**新建**）

**Interfaces:**
- Consumes: Task 1 的 `FileOpError`
- Produces: `FileDeleteDialogProps.onConfirm: () => string | undefined | Promise<string | undefined> | void`

**⚠️ 背景（据实记）**：该弹窗自 2026-10-11 上线起**没有**组件测试（`ls packages/app/src/project/` 过）。
本 Task 补上的是**既往空白**，不是本次改动引入的 —— 收尾写进 spec §10 缺口。

- [ ] **Step 1: 写会红的用例（新文件）**

`packages/app/src/project/file-delete-dialog.test.tsx`：

```tsx
/**
 * 「删除」二次确认弹窗的组件测试（**本文件是补的**，2026-10-11 上线时没有——见计划 Task 3 的背景）。
 *
 * ## 弹窗不在树里
 *
 * `dialog.show` 传送到 `document.body`，所以本文件一律查 `document`（同 `file-create-dialog.test.tsx`）。
 * 树那一侧（哪个入口 ⇒ 作用对象是谁）由 `file-tree.test.tsx` 与 `workspace-entry.test.tsx` 钉
 * ——两件事分开，红了才看得出是哪一半。
 *
 * ## 这一条最要紧的判据是「取消时**一次都不喊**」
 *
 * 破坏性动作的弹窗，「点遮罩 / 按 Escape / 点取消 / 点右上角关闭」四条出口**都必须不删**。
 * 这里只做得到前两条与「取消」（遮罩与 Escape 归 Kobalte 的 `DismissableLayer`，组件测试里
 * 够不着它的内部派发）——剩下的据实进 spec §10 缺口，**不写成已覆盖**。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileDeleteDialog } from "./file-delete-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface 剧本 {
  /** 每次按下「删除」记一笔，并回这个值（`undefined` = 收工）。 */
  回话?: string
  收到: number[]
  在飞?: Promise<string | undefined>
}

function 触发器(剧本: 剧本): JSX.Element {
  const dialog = useDialog()
  return (
    <button data-slot="open" onClick={() => dialog.show(() => <FileDeleteDialog path="资料/话单.csv" onConfirm={() => {
      剧本.收到.push(1)
      return 剧本.在飞 ?? 剧本.回话
    }} />)}>
      开
    </button>
  )
}

async function 打开(剧本: Omit<剧本, "收到"> = {}): Promise<剧本> {
  const 全: 剧本 = { ...剧本, 收到: [] }
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器(全)}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return 全
}

/** 弹窗里某颗钮（`data-slot` 落在 `ButtonV2` 自己那层，`rest` 原样透传，不会被覆盖）。 */
const 钮 = (slot: string) => document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)
const 弹窗在 = () => document.body.querySelector("[data-slot='file-delete-dialog']") !== null

describe("FileDeleteDialog 删除二次确认弹窗", () => {
  test("问的是**哪一个**对象——路径就写在弹窗里", async () => {
    await 打开()

    expect(document.body.textContent ?? "").toContain("资料/话单.csv")
  })

  test("按「删除」才喊回调，且**只喊一次**", async () => {
    const 剧本 = await 打开()

    钮("file-delete-ok")!.click()
    await flush()

    expect(剧本.收到.length).toBe(1)
  })

  test("按「取消」⇒ 一个回调都不喊，弹窗关掉", async () => {
    const 剧本 = await 打开()

    钮("file-delete-cancel")!.click()
    await flush()

    expect(剧本.收到.length).toBe(0)
    expect(弹窗在()).toBe(false)
  })

  test("办成（回 `undefined`）⇒ 弹窗关掉", async () => {
    await 打开()

    钮("file-delete-ok")!.click()
    await flush()
    await flush()

    expect(弹窗在()).toBe(false)
  })

  test("没办成 ⇒ 弹窗**不关**、服务端原话就地显示", async () => {
    await 打开({ 回话: "项目根不能删" })

    钮("file-delete-ok")!.click()
    await flush()
    await flush()

    expect(document.body.textContent ?? "").toContain("项目根不能删")
    // 主判据：弹窗**还在**（改之前它已经关了，话掉到工具栏下方）
    expect(弹窗在()).toBe(true)
  })

  test("失败之后再按一次「删除」⇒ 会再发一次（「可以重试」这条承诺）", async () => {
    const 剧本 = await 打开({ 回话: "项目根不能删" })

    钮("file-delete-ok")!.click()
    await flush()
    await flush()
    钮("file-delete-ok")!.click()
    await flush()
    await flush()

    expect(剧本.收到.length).toBe(2)
  })

  test("在飞时再按一次 ⇒ 只发一次", async () => {
    let 放行: ((话: string | undefined) => void) | undefined
    const 在飞 = new Promise<string | undefined>((resolve) => (放行 = resolve))
    const 剧本 = await 打开({ 在飞 })

    钮("file-delete-ok")!.click()
    钮("file-delete-ok")!.click()
    await flush()
    放行?.(undefined)
    await flush()
    await flush()

    expect(剧本.收到.length).toBe(1)
  })
})
```

- [ ] **Step 2: 跑，确认红**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-delete-dialog.test.tsx
```
Expected: FAIL —— `Cannot find module "./file-delete-dialog"` 之外的、真正该红的是**三条**：
「没办成 ⇒ 不关」「失败后再按 ⇒ 会再发」「在飞时再按 ⇒ 只发一次」。但此刻弹窗**还不存在**这个文件里的
import 就已经失败 ⇒ **先照 Step 3 把 import 需要的形状建起来（改实现），再回来跑**。
⚠️ 顺序上这一步的唯一产出是「实得红的样子」——**照抄终端里的前 8 行**。

- [ ] **Step 3: 改实现**

`file-delete-dialog.tsx`：

① props（`:42-47`）：

```tsx
export interface FileDeleteDialogProps {
  /** 要删的那一项的路径——用户得看得出对象（改之前那条横幅上的 `file-tree-delete-name` 同款）。 */
  path: string
  /**
   * 用户按下「删除」才喊；取消 / 点遮罩 / Escape / 右上角关闭**一次都不喊**。
   *
   * 回话约定（与 `ProjectPanel.onCreate` **逐字相同**）：**回一句字符串 = 没办成**，那句话就地
   * 显示、弹窗**不关**；`undefined` / 不回 = 收工。
   */
  onConfirm: () => string | undefined | Promise<string | undefined> | void
}
```

② 信号与 `确定()`：

```tsx
export function FileDeleteDialog(props: FileDeleteDialogProps): JSX.Element {
  const dialog = useDialog()
  /** 上一次没办成的那句话；`undefined` = 没话说。（本弹窗没有输入框 ⇒ 不存在「用户一动就过期」。） */
  const [失败话, set失败话] = createSignal<string | undefined>()
  /** 交出去之后、回话之前。「弹窗不关」新造出重发的洞 ⇒ 这段缝隙里「删除」是锁着的。 */
  const [忙, set忙] = createSignal(false)

  async function 确定() {
    if (忙()) return
    set忙(true)
    let 回话: string | undefined | void
    try {
      回话 = await props.onConfirm()
    } catch (err) {
      // 抛错 = 「我们这边坏了」，先收弹窗（保住原注释那条理由）。这一支不在本次射程内。
      dialog.close()
      throw err
    } finally {
      set忙(false)
    }
    if (typeof 回话 !== "string") {
      dialog.close()
      return
    }
    set失败话(回话)   // 不关：用户在同一个面上改一个别的（或原样再试一次）
  }
```

③ `DialogBody` 里、那句「确定删除…」**下面**插入：

```tsx
          <Show when={失败话()}>{(话) => <FileOpError 话={话()} />}</Show>
```

④ 「删除」那颗：`disabled={忙()}`、`onClick={() => void 确定()}`。
⑤ import 加：`import { createSignal, Show, type JSX } from "solid-js"`、`import { FileOpError } from "./file-op-error"`。

⑥ `file-tree.tsx:917`：`onConfirm` 那一段**逐字不动**（`onConfirm={() => 交(path)}` 已经把 `交` 的回话
原样转交）；只改 `FileTreeProps.onDelete`（`:162`）的类型：

```ts
  /** 删除**选中项**（工具栏）／**右键那一项**（菜单）。省略 = 还没接线，按钮与菜单项都禁用。回话约定同 `onCreate`。 */
  onDelete?: (path: string) => string | undefined | Promise<string | undefined> | void
```

- [ ] **Step 4: 跑，确认绿**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-delete-dialog.test.tsx
```
Expected: **7 pass / 0 fail**。

- [ ] **Step 5: 变异验证（④ 步）**

把 `确定()` 里 `if (typeof 回话 !== "string") { dialog.close(); return }` / `set失败话(回话)` 换成
改之前的「永远 `dialog.close()`」。重跑 Step 4。**据实记红哪几条**（预期「没办成 ⇒ 不关」与
「失败后再按 ⇒ 会再发」两条红；`在飞` 那条**大概率仍绿**——因为它断的是「只发一次」，而永远关也能满足
⇒ 这条要**单独记一句**：它在变异下不是这个改动的守护者，它守的是 `忙()` 那条守卫，**另跑一次专门
的变异**（删掉 `if (忙()) return`）来证它有牙）。**两轮变异都要记。**
⚠️ 跑完改回来（`cp` 备份还原）。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/project/file-delete-dialog.tsx packages/app/src/project/file-delete-dialog.test.tsx packages/app/src/project/file-tree.tsx
git commit -m "feat(project): 删除弹窗失败不关、就地报；补上该弹窗缺失的组件测试

组件测试是补既往空白（2026-10-11 上线时就没有），不是本次引入。
这是要保留的定制。"
```

---

## Task 4：文件树——重命名失败的话落到**那一行**

**Files:**
- Modify: `packages/app/src/project/file-tree.tsx`
- Modify: `packages/app/src/project/file-tree.test.tsx`（23 处签名适配 ＋ 增 2 条）

**Interfaces:**
- Consumes: Task 1 的 `FileOpError`、Task 2/3 定下的回话约定
- Produces:
  - `FileTreeProps.onRename: (path: string, name: string) => string | undefined | Promise<string | undefined> | void`
  - 行话的渲染记号：`[data-slot='file-tree-row'][data-path='<旧路径>'] [data-slot='file-op-error']`

**设计要点（照 spec §3 与 §5.3，两处偏离都要照做）**

1. **`就地改名输入` 组件一个字不改**（`on提交: (新名: string) => void`）——异步与报错都发生在**调用方**
   这一侧。改了它就会连带动 `ai-session/session-rename.tsx:41` 那条链。
2. **提交时照旧先退编辑态**（`set改名的(undefined)`）——`inline-rename-input.tsx:51-63` 那条**真栈实测**
   出来的「一次编辑只结一次账」守卫不放开。代价：名字会丢（重开预填的是旧名），**据实记**进 spec §9。

- [ ] **Step 1: 先做 23 处签名适配（纯语法，不改任何判据）**

新契约的返回类型是 `string | undefined | Promise<string | undefined> | void`。既有测试里那些
**返回 `number`** 的箭头（`(i) => 记.push(i)`）落不进任何一支 ⇒ typecheck 会报
`Type 'number' is not assignable to type '…'`。改法是**把表达式体换成块体**（块体无 `return` ⇒ `void`）：

| 规则 | 例 |
|---|---|
| `onCreate={(i) => 记.push(i)}` | → `onCreate={(i) => { 记.push(i) }}` |
| `onRename={(p, n) => 记.push(\`${p}=>${n}\`)}` | → `onRename={(p, n) => { 记.push(\`${p}=>${n}\`) }}` |
| `onDelete={(path) => 收.push(path)}` | → `onDelete={(path) => { 收.push(path) }}` |

`file-tree.test.tsx` 里**必须改**的行号（2026-10-16 `grep` 出来的全量落点，逐个打勾）：

- [ ] `:733` `onCreate={(i) => 记.push(i)}`
- [ ] `:752` 同上
- [ ] `:1092` 同上
- [ ] `:1110` 同上
- [ ] `:1130` 同上
- [ ] `:1147` 同上
- [ ] `:1167` 同上
- [ ] `:1218` 同上
- [ ] `:1931` `onCreate={(input) => 收到.push(input)}`
- [ ] `:1946` 同上
- [ ] `:2069` 同上
- [ ] `:1266` `onRename={(path, name) => 记.push(\`改:${path}=>${name}\`)}`
- [ ] `:1296` `onRename={(p, n) => 记.push(\`${p}=>${n}\`)}`
- [ ] `:1311` `onRename={(p) => 记.push(p)}` **与** `onDelete={(p) => 记.push(p)}`（同一行两处）
- [ ] `:1894` `onRename={(path, name) => 收到.push(\`${path}=>${name}\`)}`
- [ ] `:1267` `onDelete={(path) => 记.push(\`删:${path}\`)}`
- [ ] `:1911` `onDelete={(path) => 收到.push(path)}`
- [ ] `:2278` `onDelete={(path) => 记.push(path)}`
- [ ] `:2300` 同上
- [ ] `:2319` 同上
- [ ] `:2340` 同上
- [ ] `:2353` 同上

**不用改**的（返回 `void`，落在联合的 `| void` 那一支上）：`:1028`、`:1055`、`:1070`、`:1653`、
`:2210`、`:2217`、`:2235`、`:2263`、`:2289`、`:2372` 的 `() => {}`；
`file-tree.stories.tsx:72`、`:85`、`:87` 的 `() => {}`。

Run（确认这一步**只是适配、没有改动行为**）：
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-tree.test.tsx
```
Expected：与开工前**同样的 pass 数**（先量：`grep -c "  test(" src/project/file-tree.test.tsx` 记下条数，
跑完对得上）。**这一步之后 `file-tree.tsx` 还没改** ⇒ 类型尚未收紧，套件应当全绿。

- [ ] **Step 2: 改 `file-tree.tsx` 的契约与行话**

① `onRename` 的类型（`:160`）与 `onCreate` / `onDelete` 对齐：

```ts
  /**
   * 重命名**选中项**（工具栏）／**右键那一项**（菜单），`name` 是**新的单段名**。
   *
   * ⚠️ 同样**不立刻喊**（T018 起）：先把那一行的名字就地换成输入条（见 `改名的`），
   * Enter 才把新名字喊出去。`path` 仍是**旧路径**——服务方的责任是拿它反推所在目录（同 `renameEntry`）。
   *
   * 回话约定（与 `ProjectPanel.onCreate` 逐字相同）：**回一句字符串 = 没办成**，那句话落在
   * **被改名的这一行**上；`undefined` / 不回 = 收工。
   *
   * 省略 = 还没接线，按钮与菜单项都禁用。
   */
  onRename?: (path: string, name: string) => string | undefined | Promise<string | undefined> | void
```

② 新信号（放在 `const [改名的, set改名的] = createSignal<string>()`（`:378`）后面）：

```ts
  /**
   * 「上一次重命名没办成」的那句话 ＋ 它属于**哪一行**（按**旧路径**记）。
   *
   * ## 为什么存**路径**而不是「当前那一行」
   *
   * 渲染时只在**当前仍存在**的那一行上画 —— 行没了，话自然不画，**不需要**在卸载时去清
   * （少一处遗漏的机会）。显式清掉只发生在两处：① 该行**开始下一次改名**（见 `改名`）；
   * ② **清单重取**（`props.paths` 换了新数据，见下面那个 `createEffect`）。两处都在本文件里，不跨层。
   */
  const [行话, set行话] = createSignal<{ 路径: string; 话: string }>()
```

③ 两处清掉：

- `改名(path)`（`:977-979`）改成：

```ts
  /** 点重命名（工具栏 / 菜单）——同样只是把那一行换成输入条。**顺带清掉那一行上旧的失败话**。 */
  function 改名(path: string) {
    set行话(undefined)
    set改名的(path)
  }
```

- 在信号声明之后加一个 effect（`createEffect` 与 `on` 需要 import）：

```ts
  // 清单换了新数据 ⇒ 上一轮那句话过期（树上的真相永远是重取那一份）。
  // `defer: true`：挂载那一次不算「换了新数据」。
  createEffect(on(() => props.paths, () => set行话(undefined), { defer: true }))
```

顶部 import 改成：`import { createEffect, createMemo, createSignal, For, on, Show, splitProps, type JSX } from "solid-js"`。

④ 行内提交处（`:730-740`）改成：

```tsx
                        <就地改名输入
                          槽位="file-tree-rename-input"
                          可访问名称="条目名称"
                          原名={row.node.name}
                          on提交={async (name) => {
                            // 先收编辑态再喊回调——同上面新建那条，理由一样（`inline-rename-input.tsx`
                            // 「一次编辑只结一次账」那条真栈实测出来的守卫不放开）。
                            set改名的(undefined)
                            const 回话 = await props.onRename?.(row.node.path, name)
                            if (typeof 回话 === "string") set行话({ 路径: row.node.path, 话: 回话 })
                          }}
                          on取消={() => set改名的(undefined)}
                        />
```

⑤ 渲染：在行元素的**最后一个格子之后**（`:741` 那个 `</Show>` 之后、`:742` 的 `</div>` 之前）插入：

```tsx
                      {/* 重命名失败的话落在**这一行**上（spec §3：失败回到发起它的那个面）。
                          ⚠️ 它是行的**子节点**（不是行的兄弟）——行的 `role="treeitem"` 里允许任意内容，
                          摆在 `role="tree"` 下当一个无角色的 `<div>` 则是无效的 ARIA 结构。
                          `w-full` 让它自己占一整行（见 `ROW` 的 `flex-wrap`）。 */}
                      <Show when={行话()?.路径 === row.node.path}>
                        {(话) => (
                          <div class="w-full min-w-0">
                            <FileOpError 话={话().话} />
                          </div>
                        )}
                      </Show>
```

⑥ `ROW`（`:115`）从 `h-6` 改成 `min-h-6` 并加 `flex-wrap`：

```ts
/**
 * 一行。`min-h-6` 而不是 `h-6`、并允许换行：**重命名失败时那一行要长出一句话**
 * （`FileOpError` 带 `w-full` ⇒ 换到第二行、整行变高）。
 * ⚠️ 对**没有**失败话的行，两者算出来的高度逐字相同（`min-h-6` 的 24px ＋ 单行内容），
 * 故这不是一次视觉改动——那 24px 是既有真栈读数（`context-menu-dismiss-probe.spec.ts` 注释里的
 * 行坐标）赖以成立的前提，别拿掉 `min-h-6`。
 */
const ROW = "flex flex-wrap min-h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
```

⑦ import 加 `import { FileOpError } from "./file-op-error"`。

- [ ] **Step 3: 增两条用例（`file-tree.test.tsx` 的 `describe("新建 / 重命名 / 删除…")` 那一节**末尾**，`:1308` 那条之后、`:1311` 的 `})` 之前）**

⚠️ 本文件既有的助手（**直接用，别另发明**）：`行按名(host, 名)`、`行按路径(host, 路径)`、
`按钮(host, slot)`、`条里打字(host, slot, 值)`、`条里敲(el, key)`、`槽(host, slot)`、`无槽(host, slot)`（都返回
**布尔**）、`树(...paths)`、`mount(...)`、`歇一拍()`。两条**注意**：

- `行按名` / `行按路径` **找不到就抛**（不是回 `undefined`）⇒ 别写 `expect(行).not.toBeNull()`，那句是死代码。
- `歇一拍` 定义在 `:541`，**就在本文件那唯一一个 `describe`（`:414`）体内** ⇒ 本节的用例**够得着**，
  不用自己再造一个。（本文件只有一个 `^describe(`，其余都是它的嵌套。）

```tsx
    /**
     * ── 重命名失败的话落在**那一行**上（2026-10-16）────────────────────
     *
     * 改之前：树的 `onRename` 是 `void`，失败与成功在树上长得一样 —— 那句话只可能由接线层
     * （`workspace-entry`）画到**工具栏下方**，离用户点的那一行隔着一整棵树。
     */
    test("重命名没办成 ⇒ 原话出现在**那一行**上（行的子节点，不是工具栏下方）", async () => {
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} onRename={() => "项目根不能删"} />)

      行按名(host, "资金.xlsx")?.click()
      按钮(host, "file-tree-action-rename")?.click()
      条里敲(条里打字(host, "file-tree-rename-input", "明细.xlsx"), "Enter")
      await 歇一拍()

      // `行按路径` 找不到就抛 ⇒ 这一句本身就钉住了「失败=路径没变、那一行还在」
      const 行 = 行按路径(host, "资金.xlsx")
      expect(行.querySelector("[data-slot='file-op-error']")?.textContent ?? "").toContain("项目根不能删")
      // 反面：**别的行**上没有这句话（防「画到第一行去了」那种假绿）。
      // ⚠️ 写成布尔，**别**写 `expect(节点).toBeNull()`——`#005-01`：节点型断言红了会把整轮挂死。
      expect(行按路径(host, "话单.csv").querySelector("[data-slot='file-op-error']") === null).toBe(true)
    })

    test("清单重取（`paths` 换了一份）⇒ 那句行话收掉，不永久挂着", async () => {
      // 一条能换 `paths` 的挂具：`createSignal` 存 paths，重取时再赋一份**同内容的新数组**
      // （这正是 `workspace-entry` 重取清单的形状：同路径、新身份）。
      const [路径们, set路径们] = createSignal(树("话单.csv", "资金.xlsx"))
      const host = mount(() => <FileTree paths={路径们()} onRename={() => "项目根不能删"} />)

      行按名(host, "资金.xlsx")?.click()
      按钮(host, "file-tree-action-rename")?.click()
      条里敲(条里打字(host, "file-tree-rename-input", "明细.xlsx"), "Enter")
      await 歇一拍()
      // 前提：先证那句话**在**（否则下面那句「没了」可能一直是没了的空转，`#006-17`）
      expect(无槽(host, "file-op-error")).toBe(false)

      set路径们(树("话单.csv", "资金.xlsx")) // 新数组、同内容
      await 歇一拍()

      expect(无槽(host, "file-op-error")).toBe(true)
    })
```

⚠️ 第二条用到 `createSignal`，而本文件顶部只有 `import { type JSX } from "solid-js"`（`:4`）⇒ 先把它改成：

```tsx
import { createSignal, type JSX } from "solid-js"
```

- [ ] **Step 4: 跑，确认绿**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-tree.test.tsx
```
Expected：旧的**全绿** ＋ 新的 **2 pass**。

⚠️ **`:1261` 那条既有用例在 `条里敲(…, "Enter")` 之后是「同步」断言的**（`expect(记).toEqual([…])`），
别伸手去加 `await 歇一拍()`。它**照旧绿**，理由：`on提交` 变成 `async` 之后，`记.push(...)` 那一句仍在
**回调被调用的那一刻同步执行**（`await` 推后的只是它**之后**的续行），所以 `记` 当场就有了。
**若它真红了，先回来读这一行**——不是让你改它。

- [ ] **Step 5: 变异验证（④ 步）**

拆掉 `on提交` 里那两句（`const 回话 = await …` 与 `if (typeof 回话 === "string") set行话(…)`）。
重跑 Step 4。**据实记**：预期「原话出现在那一行」红；「清单重取 ⇒ 收掉」那条**会红成「前提不成立」**
（它先在前提里断「那句话在」）——这一类红是 `#005-49` 讲的「假红」，**要写明它是怎么红的**。
再把第二个 effect（`createEffect(on(() => props.paths, …))`）**单独**拆掉重跑：预期
「清单重取 ⇒ 收掉」红、另一条绿 ⇒ 这才是它守的东西的证明。
⚠️ 两轮变异都要记；跑完 `cp` 还原。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/project/file-tree.tsx packages/app/src/project/file-tree.test.tsx
git commit -m "feat(project): 重命名失败的话落到被改名的那一行

行话按路径存、只在仍存在的那一行上画；清单重取时清掉。就地改名输入组件一字不改
（那条「一次编辑只结一次账」的真栈守卫不放开）。既有用例 23 处签名适配，判据未动。
这是要保留的定制。"
```

---

## Task 5：接线层——`收下()` 从「写共享信号」改成「**回**那句话」

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.tsx`

**Interfaces:**
- Consumes: Task 2/3/4 定下的三个回调契约
- Produces: `async function 收下(结论: FileOpOutcome): Promise<string | undefined>`

- [ ] **Step 1: `收下()` 换签名（`:591-604`）**

```ts
  /**
   * 一次文件动作的收尾：**办成** ⇒ 清话 ＋ 重取清单，回 `undefined`；
   * **没办成** ⇒ **回**服务端那句话（一个字都不写进内联那行 `file-op-message`）。
   *
   * ## 为什么从「写共享信号」改成「回一句话」
   *
   * 改之前它把失败话写进 `文件话`，而 `文件话` 画在**工具栏下方**——那是「上传 / 下载」的
   * 发起面，不是新建弹窗 / 删除弹窗 / 树里那一行的发起面。于是民警在弹窗里点了确定，
   * 话掉到一棵树之外（2026-10-16 实报）。
   *
   * 现在报在哪儿由**各调用方**决定：`建条` / `改名条` / `删条` 把回话交回发起它的那个面；
   * `搬一批` / `传` 的**成功支**只借这一步的重取清单，故 `void` 掉返回值。
   *
   * ⚠️ **不往这里塞弹窗**：它只回一句话。`2026-10-15-…-design.md:170` 那条「这份重复是有意的、
   * 不要顺手合并」的警戒，前提是「把弹窗塞进 `收下` 会连带改掉另外三个动作的报告方式」——
   * 本设计不塞弹窗，那条前提没了。
   *
   * 「重取」而不是「本地拼」：服务端回的新路径**只用来报一句话**，界面上的真相永远是重取那
   * 一份（同 T018 的「清单重拉，不把新行拼进旧清单」）。
   */
  async function 收下(结论: FileOpOutcome): Promise<string | undefined> {
    // 只有 `done` 算办成；`rejected` 与 `failed` 都回那句话（**不按类别分形状**：
    // `rejected` 里既有「可改一处再交」的 400，也有「重试永远撞同一道门」的 401 / 403，
    // 见 spec §6 末段）。
    if (结论.kind !== "done") return 结论.message
    set文件话(undefined)
    拨清单重取()
    return undefined
  }
```

- [ ] **Step 2: 三个调用点改成 `return`（`:721-739`）**

```ts
  async function 建条(input: { kind: "file" | "directory"; parent: string; name: string }) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    // 把回话**原样**交回新建弹窗（`string` = 没办成 ⇒ 弹窗不关、就地报）。
    return 收下(await projectData.createEntry(id, input.kind, input.parent, input.name))
  }

  /** 改名（T018）：`path` 是**旧路径**、`name` 是新名字——两样都由文件树给（它手里有节点表）。 */
  async function 改名条(path: string, name: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    return 收下(await projectData.renameEntry(id, path, name))
  }

  /** 删除（T018）：文件直接删、**目录递归删**。二次确认在文件树那侧（FR-006），到这里已经确认过。 */
  async function 删条(path: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    return 收下(await projectData.removeEntry(id, path))
  }
```

`建条` 上面那段注释块（`:713-720`）**一字不改**（「本层一个字都不加工」「判据在服务端只有一条」两条都还成立）。

- [ ] **Step 3: 两个成功支改成 `void`（`:649` 与 `:685`）**

```ts
      // 全成：借 `收下` 那一步的重取清单，返回值不用（移动 / 复制报在报告弹窗里，不在内联那行）。
      void 收下({ kind: "done", path: dir })
```

两处**都要**改成这个形状（`:649` 在 `搬一批`、`:685` 在 `传`）。
⚠️ `搬一批` 上面那段「不要顺手合并」的注释（`:624-631`）里，关于「为什么不复用 `收下()`」的理由
**已经过期**（那种重复本次消失了）——把那段注释按下面这段替换：

```ts
  /**
   * 把一批路径搬进 `dir`。**右键那条老路（`搬`）与拖拽那条新路共用这一份**——同一个动作的
   * 两条入口不许各写一套（`LEARNINGS #002-06`）。
   *
   * 逐个 `await`、分开记账：服务端一次搬一个，「几个成了」这句话只有在这一层说得出来
   * （与既有 `传()` 同一形状）。
   *
   * ## 全成那一支借 `收下()` 的重取清单
   *
   * `收下()` 是五个动作共用的结论口，但它**只回一句话、不画任何东西**（2026-10-16 改）。
   * 所以这里可以放心借它的「办成 ⇒ 清话 ＋ 重取清单」，返回值 `void` 掉即可。
   * **失败支仍各回各的面**：这里回报告弹窗，`传` 回内联那行（发起面不同，spec §3 的表）。
   */
```

- [ ] **Step 4: 接线处（`:1060-1062`）交出回话**

```tsx
                        // 三个回调都把回话**原样**往回交（`string` = 没办成）：新建 / 删除由弹窗就地报，
                        // 重命名由树报在**那一行**上。
                        onCreate={有项目() ? (input) => 建条(input) : undefined}
                        onRename={有项目() ? (path, name) => 改名条(path, name) : undefined}
                        onDelete={有项目() ? (path) => 删条(path) : undefined}
```

⚠️ 原来的写法是 `(input) => void 建条(input)`（`void` 把回话丢掉了）——**这就是本次要改掉的那一处**。

- [ ] **Step 5: 跑受影响的五套，确认绿**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx src/project/file-tree.test.tsx src/project/file-create-dialog.test.tsx src/project/file-delete-dialog.test.tsx src/project/file-op-error.test.tsx
```
Expected：`workspace-entry.test.tsx` 里**恰有一条红**（`:2631` 那条「删除被拒 ⇒ 留 `file-op-message`」
——与新行为**正好相反**）。**若它红，那是预期内的**，Task 6 会改写它。**把实得原样记下来。**
其余文件全绿。

⚠️ **必须仍然绿的那几条**（spec §7 点名「保留」的，跑完当场点名核对，别只看总数）：
- `workspace-entry.test.tsx:2313`——**下载**失败仍走内联那一行（`expect(text(host,"file-op-message")).toContain("话单.csv")`）
- `workspace-entry.test.tsx:2645`——「新建弹窗点「取消」⇒ 一个请求都不发」
- `file-create-dialog.test.tsx` 既有 **9** 条

⚠️ **据实记一条**：**上传**失败那句「（这批 N 个里 M 个没成功）」在 `workspace-entry.test.tsx` 里
**没有**对应的组件级用例（`grep -n "没成功\|上传"` 只捞到两条**成功**路径的用例：`:2224`、`:2251`）。
所以「上传失败仍走内联」本次**只能靠不碰那段代码来保证**，**不许**在报告里写成「有测试守着」。

两个**本次一个字不改**的文件也一并跑一次，确认零影响：
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/openhive-file-ops.test.ts src/components/inline-rename-input.test.tsx
```

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/workspace/workspace-entry.tsx
git commit -m "feat(project): 收下() 从写共享信号改成回一句话——报在哪儿交给发起面决定

建条/改名条/删条 把回话交回发起它的那个面；搬一批/传 的成功支 void 掉返回值，
失败支各回各的面（报告弹窗 / 内联）一字不改。
这是要保留的定制。"
```

---

## Task 6：接线层的既有用例改写 ＋ 新增五条

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.test.tsx`

- [ ] **Step 1: 改写 `:2631` 那条（`#005-36`：改默认行为要找出**断言了旧行为**的用例）**

`删除被拒（项目根不能删）⇒ 留下服务端那句原话，且不重取清单` 整条换成：

```tsx
  /**
   * ⚠️ **本条 2026-10-16 改写过**：改之前它断的是「那句话落在 `file-op-message`（工具栏下方）」，
   * 与新行为**正好相反**（载体从内联句改成弹窗里的提示）。`LEARNINGS #005-36`：改一个行为之前，
   * 先 `grep` 出**断言了这个旧行为**的既有用例，逐条明说去向——这里是**改写**，不是删。
   *
   * 反面断言（清单不重取）**继续留着**：盘上没变，重取是空跑。
   */
  test("删除被拒（项目根不能删）⇒ 弹窗**不关**、原话在弹窗里，且不重取清单", async () => {
    const { host, 假 } = await 开({ removeEntry: async () => ({ kind: "rejected", message: "项目根不能删" }) })
    const 删前 = 假.files.length

    右键行(host, "话单.csv")
    点菜单项("delete")
    await 冲一遍()
    删弹窗钮("file-delete-ok")?.click()
    await 冲一遍()

    // 主判据：原话在**弹窗**里（不是工具栏下方那行内联）
    expect(document.body.textContent ?? "").toContain("项目根不能删")
    // 「弹窗不关」这条承诺的证据。
    // ⚠️ 写成**布尔**，别写 `expect(节点).not.toBeNull()`——`#005-01`：节点型断言红了会把整轮挂死。
    expect(不存在(document.body, "[data-slot='file-delete-dialog']")).toBe(false)
    // 反面断言
    expect(假.files.length, "没成的事不该刷成「好像变了」").toBe(删前)
  })
```

- [ ] **Step 2: 增四条（加在同一节末尾——改写那条之后、`新建弹窗点「取消」`（`:2656`）之前）**

本文件既有的助手（**直接用，别另发明**）：`开(剧本)`（每节局部；返回 `{ host, 假 }`，`假` 就是记账对象）、
`右键行` / `点菜单项` / `找行` / `树按钮` / `弹窗填` / `弹窗提交` / `弹窗取消` / `删弹窗钮`、`条里打字` /
`条里敲`、`text(root, slot)`、`不存在(root, selector)`、`冲一遍()`。

```tsx
  test("新建没办成 ⇒ 弹窗**不关**、原话在弹窗里、名字草稿还在", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "rejected", message: "目标目录不存在" }) })

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("新.md")
    弹窗提交()
    await 冲一遍()
    await 冲一遍()

    expect(document.body.textContent ?? "").toContain("目标目录不存在")
    // 布尔，不是节点断言（`#005-01`）
    expect(不存在(document.body, "[data-slot='file-create-dialog']")).toBe(false)
    expect(假.建的条目.length, "第一趟确实发出去了").toBe(1)
  })

  test("新建没办成之后改个名字再交 ⇒ **会再发一次**", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "rejected", message: "目标目录不存在" }) })

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("新.md")
    弹窗提交()
    await 冲一遍()
    弹窗填("改过的.md")
    弹窗提交()
    await 冲一遍()

    expect(假.建的条目).toEqual([
      ["p1", "file", "资料", "新.md"],
      ["p1", "file", "资料", "改过的.md"],
    ])
  })

  test("重命名没办成 ⇒ 原话落在**那一行**上，工具栏下方那行内联**不出现**", async () => {
    const { host, 假 } = await 开({ renameEntry: async () => ({ kind: "rejected", message: "项目根不能删" }) })

    找行(host, "话单.csv").click()
    树按钮(host, "file-tree-action-rename")?.click()
    条里敲(条里打字(host, "file-tree-rename-input", "旧名.csv"), "Enter")
    await 冲一遍()

    // 主判据：话在那一行上
    const 行 = host.querySelector<HTMLElement>("[data-slot='file-tree-row'][data-path='资料/话单.csv']")
    expect(行?.querySelector("[data-slot='file-op-error']")?.textContent ?? "").toContain("项目根不能删")
    // 旧载体确实退场了（不是「两处都画」）
    expect(text(host, "file-op-message")).toBe(undefined)
    expect(假.改名的.length).toBe(1)
  })

  test("重命名办成 ⇒ 清单重取，行话不留在屏幕上", async () => {
    const { host, 假 } = await 开({ renameEntry: async () => ({ kind: "done", path: "资料/新名.csv" }) })

    找行(host, "话单.csv").click()
    树按钮(host, "file-tree-action-rename")?.click()
    条里敲(条里打字(host, "file-tree-rename-input", "新名.csv"), "Enter")
    await 冲一遍()

    expect(假.改名的).toEqual([["p1", "资料/话单.csv", "新名.csv"]])
    expect(text(host, "file-op-error")).toBe(undefined)
  })
```

- [ ] **Step 3: 跑**

Run:
```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx
```
Expected：全绿，条数 = 开工前该文件的条数 **＋ 4**（改写那条不计增减）。

- [ ] **Step 4: 变异验证（④ 步）**

拆掉 `workspace-entry.tsx` 接线处的 `return`（即把 `onCreate={… (input) => 建条(input) …}` 换回
`(input) => void 建条(input)`）。重跑 Step 3。**据实记**：预期「新建没办成 ⇒ 弹窗不关」与
「新建没办成之后改个名字再交」两条红（弹窗关了 ⇒ 前者红在 `toContain`、后者红在第二趟没发出去）。
⚠️ `void` 掉回话之后 `建条` 仍会执行 ⇒ **`假.建的条目` 那条断言不会红** ⇒ 那说明「第一趟确实发出去了」
这句只是**前提**，不是守护者，**据实写进记录**。跑完还原（`cp`，`#005-40`）。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/workspace/workspace-entry.test.tsx
git commit -m "test(project): 改写「删除被拒」那条并补四条——失败话回到发起它的那个面

改写理由：原判据断的是旧行为（话落在工具栏下方），与新行为正好相反。
这是要保留的定制。"
```

---

## Task 7：两处规格文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-file-tree-multi-select-move-design.md`
- Modify: `docs/superpowers/specs/2026-10-16-file-op-failure-in-place-design.md`

- [ ] **Step 1: 结清 2026-10-15 那份的三条**

- `:34`「登记为下一步」的那条 ⇒ 改写为「已由 2026-10-16 那轮结清（见 `2026-10-16-file-op-failure-in-place-design.md`）」。
- `:293` 同款 ⇒ 同上。
- `:239` 第 27 条「删除失败 ⇒ **仍**是 `file-op-message`」⇒ 改成「删除失败 ⇒ 删除弹窗**不关**、就地报（2026-10-16）」。

Run（确认三条都动到了）：
```bash
grep -n "已由 2026-10-16\|删除弹窗**不关**" docs/superpowers/specs/2026-10-15-file-tree-multi-select-move-design.md
```
Expected：三行命中。

- [ ] **Step 2: 把本次实施中发现的**三处对 spec 的据实修正**写回 2026-10-16 那份**

① §4 的 `file-tree.tsx` 那一行**不完整**：它只列了 `onRename`，而 `onCreate` / `onDelete` **也必须**
一起改（`FileCreateDialog` / `FileDeleteDialog` 的 `onConfirm` 由 `file-tree.tsx` 接线，回话要过这两只手）。
② 回话类型最终取的是 `string | undefined | Promise<string | undefined> | void`（**联合**，与
`ProjectPanel.onCreate` **逐字相同**），不是 spec 写的严格 `Promise<string | undefined>` ——
理由：本仓已有先例、四处契约一致、且 `| void` 那一支让「不接线的调用方」与「只记不看回话的测试」
不必改。⚠️ **据实记**：联合**收不下**返回 `number` 的箭头（2026-10-16 实测
`./node_modules/.bin/tsc --noEmit --strict`：`error TS2322: Type 'number' is not assignable to type '…'`），
故 `file-tree.test.tsx` 有 **23 处**签名适配。
③ §7 表里 `file-create-dialog.test.tsx` 那行「预期一条不用改」⇒ 改为「**断言**一条不用改；
但 harness 里那个箭头（`:39`）必须改（返回 `number` 落不进新契约）」。
④ §4 的 `file-delete-dialog.test.tsx` 那行补一句：它是**补既往空白**（该弹窗 2026-10-11 上线起没有测试）。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/2026-10-15-file-tree-multi-select-move-design.md docs/superpowers/specs/2026-10-16-file-op-failure-in-place-design.md
git commit -m "docs(specs): 结清 2026-10-15 登记的三条；把实施中发现的四处对 spec 的修正写回

这是要保留的定制。"
```

---

## Task 8：真栈（能做的做，做不出来的**如实记**）

**Files:**
- Run: `packages/app/e2e/real-stack/file-tree-delete-dialog-real.spec.ts`、`file-tree-empty-dir-real.spec.ts`
- Create（若挂具允许）: `packages/app/e2e/real-stack/file-op-error-real.spec.ts`

**前置（本机约定）**：真栈端口被残留进程占住时**换备用端口**（`REAL_STACK_*_PORT`），**不要杀进程**；
`E2E_BROWSER` 指到 `chromium-1234`。

- [ ] **Step 1: 先跑既有的两条，确认没被我改坏**

Run:
```bash
cd packages/app && bunx playwright test e2e/real-stack/file-tree-delete-dialog-real.spec.ts e2e/real-stack/file-tree-empty-dir-real.spec.ts
```
Expected：全绿。**把 pass 数记下来。** 若红：先问「是不是我的改动引起的」（`#006-02`：把 feature 起点那一版
拉到当前环境同跑），**别先改断言**。

- [ ] **Step 2: 写新 spec（照**同族挂具**整段抄，`#004-12`）**

第一动作：读 `packages/app/e2e/real-stack/file-tree-delete-dialog-real.spec.ts` 的**全文**，把它的
import 组、`test.use`、登录步骤、造项目 / 造文件的步骤、等待助手（`等到` 一类）**整段搬过来**，
只换判据。**不要自己从零搭**——那里面全是隐性约定（身份走 cookie 不是 Bearer、沙箱落点、
`REAL_STACK_STATE_DIR`…），自己发明一遍等于把这些坑再踩一遍。

判据（逐条）：

1. 进到一个项目、停在「文件」Tab。
2. **把那个项目在盘上的目录删掉**（`fs.rm(<state>/workspaces/<userId>/<projectId>, { recursive: true, force: true })`）。
   ⚠️ 这一步是这条 spec 的全部价值所在：它复现的是 2026-10-16 那次实报现场
   （目录被 C 盘清理删掉的那三个项目）。
3. 打开「新建文件」弹窗，填一个名字、提交。
4. 断言：**弹窗还在**（`[data-slot='file-create-dialog']` 可见）＋ 弹窗文本里含
   `目标目录不存在`（服务端 400 的原话，见 `server/openhive/file.ts` 的 `handleCreate`：落盘前先 `stat(dir)`）。

- [ ] **Step 3: 跑新 spec**

Run:
```bash
cd packages/app && bunx playwright test e2e/real-stack/file-op-error-real.spec.ts
```
Expected：1 pass。

- [ ] **Step 4: 若做不出来 —— 按红线如实记，不写成已覆盖**

三种「做不出来」都算，逐条写进 spec §10 缺口（**写清卡在哪、缺什么**）：

- 挂具造不出「目录被删掉」这个态（例如种子链会自动重建目录）；
- 真栈起不来（端口 / 浏览器 / 落盘态）；
- 断言写出来了但**恒绿空转**（`#006-06` / `#005-47` 同族）——这种情况**必须**先做一次变异
  （把弹窗改回「永远关」）确认那条断言**会红**，否则不许写成已覆盖。

- [ ] **Step 5: 提交**

```bash
git add packages/app/e2e/real-stack/file-op-error-real.spec.ts
git commit -m "test(e2e): 真栈——目录没了的新建失败，弹窗不关、就地报原话

这是要保留的定制。"
```

---

## 收尾：门禁 ＋ 对账 ＋ ⑥ 步落点清单

- [ ] **Step 1: 三条门禁（在仓库根跑）**

```bash
bunx oxlint packages/app/src
bun --cwd packages/app run typecheck
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts $(find src -name '*.test.tsx' | tr '\n' ' ')
```
Expected：oxlint 0 error；typecheck 退出码 0；套件 **pass ≥ 1042 ＋ 新增条数（3＋3＋7＋2＋4 = 19）＝ 1061**，
`fail = 0`。**把三条的实得输出原样贴进报告**。

- [ ] **Step 2: ⑥ 步落点清单——「谁在按同一个前提做同一件事」（`#002-06`）**

逐处**当场判定并写下**（「没改」与「没查」在报告里长得一样，`#005-45`）：

| 落点 | 判据 | 本次处置 |
|---|---|---|
| `FileTreeProps.onCreate` | 同一个「回话约定」 | 改（Task 2） |
| `FileTreeProps.onRename` | 同上 | 改（Task 4） |
| `FileTreeProps.onDelete` | 同上 | 改（Task 3） |
| `FileCreateDialogProps.onConfirm` | 同上 | 改（Task 2） |
| `FileDeleteDialogProps.onConfirm` | 同上 | 改（Task 3） |
| `ProjectPanel.onCreate` / `onRestore` 等（`project-panel.tsx:157`、`:187`、`:195`） | **已经是**这条约定、就是蓝本 | **不动**（本次只是**对齐**它） |
| `packages/app/src/components/inline-rename-input.tsx` 的 `on提交` | **不是**这条约定（它只答「这一下要不要交出去」） | **不动**（spec §5.3）；连带 `ai-session/session-rename.tsx:41` 与 `inline-rename-input.test.tsx:62` **逐处确认零改动** |
| `file-tree.tsx:960` `新建` 里 `展开链(parent)` 的时机 | 「用户提交了」而不是「服务端回了成功」 | **不动**（代价只是失败时多展开几个目录） |
| `workspace-entry.tsx:690` 上传失败的措辞（`（这批 N 个里 M 个没成功）`） | 它**不说原因**、只说数量 | **不动**（spec §2 v1 不做） |
| `workspace-entry.tsx:707` 下载失败的 `下载「X」失败` | 内联那行，发起面是右键菜单 | **不动**（spec §2 v1 不做） |

Run（确认既有弹窗 / 内联那两条**没有**被顺手改掉）：
```bash
grep -n "file-op-message" packages/app/src/workspace/workspace-entry.tsx
grep -n "set文件话" packages/app/src/workspace/workspace-entry.tsx
```
Expected：`file-op-message` 那条渲染**原样在**；`set文件话` 的出现次数**少了 3 处**（`收下` 里那 2 处 ＋ 原先
的三个调用点不再经 `收下` 写话）——**数实得值并逐个点名**，别只写「少了」。

- [ ] **Step 3: 确认 `bun.lock` 没被动过**

```bash
git diff --stat bun.lock
```
Expected：**空**。有输出就 `git checkout -- bun.lock`（本计划全程不需要新增依赖）。

- [ ] **Step 4: 收尾对账走 `superpowers:verification-before-completion`**

逐条对：
- spec §8 的六条完成判据（用例数、typecheck、oxlint、两条真栈 spec、新增真栈 spec、④ 步记录）；
- spec §10 的缺口有没有新增（`file-delete-dialog.test.tsx` 那条既往空白已补 ⇒ 从缺口表里**划掉**，
  并按 Task 3 Step 1 的说明补上「遮罩 / Escape 两条出口本机够不着」这条**新**缺口）。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore(project): 文件操作失败「回到发起它的那个面」收尾——门禁与对账

这是要保留的定制。"
```

---

## 已知缺口（别假装已覆盖）

| 缺口 | 为什么 | 记在哪儿 |
|---|---|---|
| 删除弹窗的「点遮罩关闭 / 按 Escape」**不能删** 这两条出口 | 归 Kobalte `DismissableLayer` 的内部派发，happy-dom 里够不着（同 `#005-30` 那类） | spec §10 |
| 重命名失败后名字会丢（重开预填的是旧名） | `inline-rename-input.tsx` 那条真栈实测出来的守卫不放开（spec §9 取舍 2） | spec §9 |
| 上传 / 下载的失败仍走内联 | 它们的发起面是桌面拖拽 / 右键菜单，不在树上某一行、也不是弹窗 | spec §2 / §9 |
| 真栈那条新 spec 若挂具做不出来 | 见 Task 8 Step 4，**如实记**，不许写成已覆盖 | spec §10 |
