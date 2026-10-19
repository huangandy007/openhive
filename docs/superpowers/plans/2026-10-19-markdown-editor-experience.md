# 中栏 Markdown 编辑体验 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把中栏 `.md` / `.txt` 视图改造成「永远可编辑、草稿跨文件不丢、自动保存、带日常够用的 Markdown 工具栏」的笔记本。

**Architecture:** 草稿从组件本地信号搬到**按路径键控的模块级 store**（`draft-store.ts`），自动保存的定时器与在飞请求都归 store 管；视图只负责渲染与把选区交回去。写出口回报「落盘后的新底本」，客户端不再猜 `content.trim()`（CRLF 文件会假冲突）；`STALE` 带机器码，store 据此进冲突态并暂停自动保存。Markdown 动作是纯函数（`markdown-actions.ts`），不碰 DOM。

**Tech Stack:** SolidJS 1.9.10、TypeScript 5.8.2、Bun 1.4.2、marked 18.0.7、DOMPurify（均已存在）。**不新增任何依赖。**

**Spec:** `docs/superpowers/specs/2026-10-19-markdown-editor-experience-design.md`

## Global Constraints

- **不加新依赖**；不跑 `bun install`（若跑了，`git diff --stat bun.lock` 必须为空）。
- **不碰上游文件**：`packages/app/src/center/center-content.tsx`、`center-split.tsx`、`tab-store.ts`、`tab-bar.tsx`、`binary-view.tsx`。
- **服务端只改** `packages/opencode/src/server/openhive/file.ts`。
- 每个定制提交的信息末尾必须带一行：`这是要保留的定制（openhive 中栏 Markdown 编辑器）。`
- 中文标识符、中文文案，跟随既有代码风格；注释解释「为什么」，不写「做了什么」。
- 视图测试必须在 `beforeEach` / `afterEach` 调 `清空草稿()` 与 `设自动保存参数(undefined)`——store 是模块级单例，会跨用例串味。
- 根目录 `bun test` 禁止；测试在受影响 package 内跑。
- 六步轨道里的**变异验证**（拆掉修复 ⇒ 对应用例必须红）在 Task 11 统一做，结论按 `LEARNINGS #003-03` 记。
- 参考并遵守：`#006-16`（重入守卫写在事件处理器里）、`#002-06`（同一个判断只写一处）、`#005-48`（宿主状态没人清）、`#006-25`（镜像边界语义要一致）、`#004-10`（门禁在仓库根跑）。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `packages/app/src/center/views/richtext/markdown-actions.ts` | 纯函数编辑动作：包裹 / 行前缀 / 插入块 |
| `packages/app/src/center/views/richtext/markdown-actions.test.ts` | 上者的单测 |
| `packages/app/src/center/views/richtext/richtext-path.ts` | Markdown 引用路径 ↔ 项目内路径（双向） |
| `packages/app/src/center/views/richtext/richtext-path.test.ts` | 上者的单测 |
| `packages/app/src/center/views/richtext/draft-store.ts` | 按路径键控的草稿、自动保存、冲突状态机 |
| `packages/app/src/center/views/richtext/draft-store.test.ts` | 上者的单测（定时器 / 在飞 / 冲突 / 清空） |
| `packages/app/src/center/views/richtext-toolbar.tsx` | 工具栏 UI（纯展示，动作由视图传入） |
| `packages/app/src/center/views/richtext/file-picker.tsx` | 项目内文件选择弹层（图片过滤 / 附件全量） |

**修改**

| 文件 | 改什么 |
|---|---|
| `packages/opencode/src/server/openhive/file.ts` | 写口回参加 `base`；STALE 带 `code` |
| `packages/opencode/test/server/openhive-file-ops.test.ts` | 钉 `base` 与 `code` |
| `packages/app/src/center/file-content.ts` | `SaveFileResult` 加 `base` / `code` |
| `packages/app/src/project/openhive-file-ops.ts` | `FileOpOutcome` 透传 `base` / `code` |
| `packages/app/src/project/openhive-file-ops.test.ts` | 钉透传 |
| `packages/app/src/project/openhive-file-saver.ts` | 折 `SaveFileResult` 时带上 `base` / `code` |
| `packages/app/src/project/openhive-file-saver.test.ts` | 钉回包与回退 |
| `packages/app/src/center/center-content.test.tsx` | `save` 替身的成功形状补 `base` |
| `packages/app/src/center/views/richtext-view.tsx` | 重写：store 驱动、常驻编辑、工具栏、预览补丁 |
| `packages/app/src/center/views/richtext-view.test.tsx` | 改写保存语义相关用例，新增草稿/自动保存/冲突/工具栏用例 |
| `packages/app/src/workspace/workspace-entry.tsx` | 换项目时 `清空草稿()` |
| `packages/app/src/workspace/workspace-entry.test.tsx` | 钉「换项目清空草稿」 |
| `packages/app/e2e/real-stack/richtext-edit-save-real.spec.ts` | 改「存完回预览」三条；新增自动保存 / 切文件草稿 / 冲突 / 显式预览 / 图片 / 相对链接 / 撤销 |

---

## Task 1: 写出口回报新底本，陈旧带 `STALE` 码

**Files:**
- Modify: `packages/opencode/src/server/openhive/file.ts:187-189`、`:318`、`:948`、`:966`
- Test: `packages/opencode/test/server/openhive-file-ops.test.ts:893-901`、写出口 describe（约 2345-2545）

**Interfaces:**
- Produces:
  - 成功回参 `{ path: string; base: string }`，`base` ＝ 落盘字节按 `TextDecoder("utf-8").decode(...).trim()` 算出的值（与读口同一套解码）。
  - 陈旧拒绝 `{ error: string; code: "STALE" }`。

- [ ] **Step 1: 在测试文件加两个回参形状**

在 `const Rejected = Schema.Struct({ error: Schema.String })` 下面加：

```ts
/** 写出口的成功回参：新路径 ＋ **下一次保存该用的底本**。 */
const 写成了 = Schema.Struct({ path: Schema.String, base: Schema.String })

/** 带机器码的拒绝（目前只有陈旧这一条要机器认）。 */
const 带码的拒绝 = Schema.Struct({ error: Schema.String, code: Schema.String })
```

- [ ] **Step 2: 写两条会红的用例**

在 `describe` 的写出口组里、`"打开→不改一字…"` 那条之后插入：

```ts
  /**
   * 回包里的 `base` 必须是**盘上那份**（CRLF 也按盘上的来），不能是客户端送来的 LF。
   * 少了它，客户端只能拿 `content.trim()` 猜底本——CRLF 文件第二次保存必然假冲突
   * （`LEARNINGS #006-25`：镜像的边界语义要对齐）。
   */
  it.live(
    "成功回参带 base：它是**盘上**那份（CRLF 按盘上），且拿它直接再存一次必须成功",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        writeFileSync(文件.甲, 带信封)

        const base = yield* 读正文("a.txt")
        const 新正文 = 换行归一(base).replace("第二行", "改过的第二行")
        const response = yield* 存(ALPHA, "a.txt", 新正文, base)

        expect(response.status).toBe(200)
        const 结论 = yield* json(写成了, response)
        expect(结论.path).toBe("a.txt")
        expect(结论.base).toBe("第一行\r\n改过的第二行")
        expect(结论.base).not.toBe(新正文) // 送出去的是 LF；回来的底本必须是盘上的 CRLF

        // 闭环：客户端下一次就送这个 base（正文仍是 LF 那一份）。
        const 再存 = yield* 存(ALPHA, "a.txt", 新正文, 结论.base)
        expect(再存.status).toBe(200)
      }),
    30_000,
  )
```

把现有的陈旧用例（`"base 与盘上现在这份不符 ⇒ 400「被改过」…"`）末尾那条断言改成：

```ts
        expect((yield* json(带码的拒绝, response)).code).toBe("STALE")
```

- [ ] **Step 3: 跑测试，确认它们红**

Run:

```bash
cd packages/opencode && bun test test/server/openhive-file-ops.test.ts --test-name-pattern "成功回参带 base|base 与盘上现在这份不符"
```

Expected: 两条都 FAIL（回参没有 `base` / 没有 `code`）。

- [ ] **Step 4: 改服务端**

`badRequest`：

```ts
function badRequest(message: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(
    code === undefined ? { error: message } : { error: message, code },
    { status: BAD_REQUEST },
  )
}
```

`Made`：

```ts
/** 写出口的成功回参：新条目**相对项目根**的路径；写正文时再带上新的底本。 */
const Made = (path: string, base?: string) =>
  HttpServerResponse.jsonUnsafe(base === undefined ? { path } : { path, base })
```

`handleWrite` 两处：

```ts
    if (文本.trim() !== base) return badRequest(STALE, "STALE")
```

```ts
    // ⚠️ `落盘.trim()` 与读口同一套解码（`handlers/file.ts` 的 `text.value.trim()`）：
    // BOM 与首尾空白都被吃掉、CRLF 原样留着。客户端下一次拿它当 `base` 才对得上。
    return Made(relativePath(project, target), 落盘.trim())
```

- [ ] **Step 5: 跑测试，确认全绿**

Run:

```bash
cd packages/opencode && bun test test/server/openhive-file-ops.test.ts
```

Expected: 全部 PASS，0 fail。

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/server/openhive/file.ts packages/opencode/test/server/openhive-file-ops.test.ts
git commit -m "feat(richtext): 写口回报落盘后的新底本，陈旧带 STALE 码

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 2: 客户端保存接缝透传 `base` / `code`

**Files:**
- Modify: `packages/app/src/center/file-content.ts:43`
- Modify: `packages/app/src/project/openhive-file-ops.ts:208-211`、`:565-599`
- Modify: `packages/app/src/project/openhive-file-saver.ts:34-41`
- Modify: `packages/app/src/center/center-content.test.tsx:148`
- Modify: `packages/app/src/center/views/richtext-view.test.tsx:266`、`:546`（两处 `save` 替身）
- Test: `packages/app/src/project/openhive-file-ops.test.ts:72-77`、`:954-1027`
- Test: `packages/app/src/project/openhive-file-saver.test.ts`

**Interfaces:**
- Consumes: Task 1 的服务端回参。
- Produces:
  - `SaveFileResult = { ok: true; base: string } | { ok: false; message: string; code?: string }`
  - `FileOpOutcome` 的 `done` 多一个可选 `base`，`rejected` 多一个可选 `code`。

- [ ] **Step 1: 加客户端测试替身与断言**

`packages/app/src/project/openhive-file-ops.test.ts`，在 `拒绝` 辅助下面加：

```ts
const 带底本 = (path: string, base: string) =>
  new Response(JSON.stringify({ path, base }), { headers: { "content-type": "application/json" } })
```

在 `saveFile` 的 describe 里加三条：

```ts
  test("200 且带 base ⇒ done 把新底本一起带回去", async () => {
    const { send } = stub(() => 带底本("资料/摘录.txt", "第二行\r\n第三行"))

    expect(await saveFile(PROJECT, "资料/摘录.txt", "第二行\n第三行", "第一行", send)).toEqual({
      kind: "done",
      path: "资料/摘录.txt",
      base: "第二行\r\n第三行",
    })
  })

  test("400 带 code ⇒ rejected 把机器码一起带回去", async () => {
    const { send } = stub(
      () =>
        new Response(JSON.stringify({ error: "被改过", code: "STALE" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )

    expect(await saveFile(PROJECT, "资料/摘录.txt", "第二行", "第一行", send)).toEqual({
      kind: "rejected",
      message: "被改过",
      code: "STALE",
    })
  })

  test("200 但没 base（旧内核）⇒ done 不带 base，不伪造", async () => {
    const { send } = stub(() => 成功("资料/摘录.txt"))

    expect(await saveFile(PROJECT, "资料/摘录.txt", "第二行", "第一行", send)).toEqual({
      kind: "done",
      path: "资料/摘录.txt",
    })
  })
```

`openhive-file-saver.test.ts`：把成功用例的回包改成带 `base`，并加一条回退用例。

```ts
  test("当前项目在场 ⇒ 走写出口，带项目头，三个字段各就各位", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send, 收到 } = 替身(
      new Response('{"path":"资料/甲.txt","base":"改后的正文"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const save = createSaveProjectFile(send)

    expect(await save("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: true,
      base: "改后的正文",
    })
    expect(收到).toHaveLength(1)
    expect(收到[0].url).toBe("/openhive/file/write")
    expect(收到[0].method).toBe("POST")
    expect(收到[0].project).toBe(PROJECT)
    expect(JSON.parse(String(收到[0].body))).toEqual({
      path: "资料/甲.txt",
      content: "改后的正文",
      base: "读回来那份",
    })
  })

  test("回包没带 base（旧内核）⇒ 用 content.trim() 兜底，不把保存判失败", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send } = 替身(
      new Response('{"path":"资料/甲.txt"}', { status: 200, headers: { "content-type": "application/json" } }),
    )

    expect(await createSaveProjectFile(send)("资料/甲.txt", "  改后的正文  ", "读回来那份")).toEqual({
      ok: true,
      base: "改后的正文",
    })
  })

  test("拒绝时把 code 透传给视图", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send } = 替身(
      new Response(JSON.stringify({ error: "被改过", code: "STALE" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    )

    expect(await createSaveProjectFile(send)("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: false,
      message: "被改过",
      code: "STALE",
    })
  })
```

`center-content.test.tsx:148` 那个替身：

```ts
          save: async () => ({ ok: true, base: "" }),
```

`richtext-view.test.tsx` 里两处直接 `mount` 的 `save` 替身（第 266、546 行，都是 binary 文件用例）也要补齐新字段，否则 `packages/app` 的 typecheck 会红：

```tsx
        save={async () => ({ ok: true, base: "" })}
```

- [ ] **Step 2: 跑测试，确认它们红**

Run:

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/project/openhive-file-ops.test.ts src/project/openhive-file-saver.test.ts
```

Expected: 新用例 FAIL（`base` / `code` 没被带回）。

- [ ] **Step 3: 改类型与实现**

`packages/app/src/center/file-content.ts`：

```ts
/**
 * 存一份文件的正文——成没成的**两种**结论。
 *
 * 成功时 `base` 是服务端回报的**落盘后的新底本**（与读口同一套 trim / CRLF 口径）。
 * 客户端**不许**用 `content.trim()` 自己算：CRLF 文件上算出来的是 LF，下一次保存会被
 * 服务端判成「这份文件被改过」（假冲突）。旧内核不回 `base` 时由
 * `openhive-file-saver` 回退到 `content.trim()`，那是降级、不是正路。
 *
 * 失败时的 `code` 是机器可读的原因（目前只有 `STALE`）；`message` 仍是给人看的那句话。
 */
export type SaveFileResult =
  | { ok: true; base: string }
  | { ok: false; message: string; code?: string }
```

`packages/app/src/project/openhive-file-ops.ts`：

```ts
export type FileOpOutcome =
  | { kind: "done"; path: string; base?: string }
  | { kind: "rejected"; message: string; code?: string }
  | { kind: "failed"; message: string }
```

`outcomeOf`：

```ts
  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    return {
      kind: "rejected",
      message: messageOf(body) ?? failed,
      ...(codeOf(body) === undefined ? {} : { code: codeOf(body)! }),
    }
  }
  if (!response.ok) return { kind: "failed", message: failed }

  const body = await readJson(response)
  const path = madePath(body)
  if (path === undefined) return { kind: "failed", message: failed }
  const base = madeBase(body)
  return base === undefined ? { kind: "done", path } : { kind: "done", path, base }
```

在 `madePath` 下面加：

```ts
/** 写出口成功时带回来的新底本。没有（旧内核 / 别的出口）就不带。 */
function madeBase(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  return typeof body.base === "string" ? body.base : undefined
}

/** 拒绝时的机器码（目前只有 `STALE`）。非字符串 / 空串都当「没说」。 */
function codeOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const code = body.code
  return typeof code === "string" && code.length > 0 ? code : undefined
}
```

`openhive-file-saver.ts`：

```ts
export function createSaveProjectFile(send: FileOpsFetch = defaultSend): SaveFileContent {
  return async (path, content, base) => {
    const id = currentProject()?.id
    if (id === undefined) return { ok: false, message: 没项目 }
    const 结论 = await saveFile(id, path, content, base, send)
    if (结论.kind !== "done") {
      return { ok: false, message: 结论.message, ...(结论.code === undefined ? {} : { code: 结论.code }) }
    }
    // 旧内核不回 base：回退到 content.trim()。⚠️ 这是**降级**——CRLF 文件上它会让
    // 下一次保存假冲突。新内核总会回 base，这条只在「前端新、内核旧」时走到。
    return { ok: true, base: 结论.base ?? content.trim() }
  }
}
```

- [ ] **Step 4: 跑测试，确认全绿**

Run:

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/project/openhive-file-ops.test.ts src/project/openhive-file-saver.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/center/file-content.ts packages/app/src/project/openhive-file-ops.ts packages/app/src/project/openhive-file-ops.test.ts packages/app/src/project/openhive-file-saver.ts packages/app/src/project/openhive-file-saver.test.ts packages/app/src/center/center-content.test.tsx
git commit -m "feat(richtext): 保存接缝透传新底本与 STALE 码

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 3: Markdown 纯函数动作

**Files:**
- Create: `packages/app/src/center/views/richtext/markdown-actions.ts`
- Test: `packages/app/src/center/views/richtext/markdown-actions.test.ts`

**Interfaces:**
- Produces:
  - `编辑快照 { value: string; start: number; end: number }`
  - `编辑动作 = "bold" | "italic" | "strike" | "code" | "link" | "h1"…"h6" | "ul" | "ol" | "quote" | "hr" | "code-block" | "table"`
  - `包裹(快照, 动作)`、`切行首(快照, 动作)`、`插入分隔线(快照)`、`插入代码块(快照)`、`插入表格(快照)`、`插入引用(快照, "image" | "attachment", 路径)`

- [ ] **Step 1: 写失败用例**

创建 `packages/app/src/center/views/richtext/markdown-actions.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { 包裹, 切行首, 插入代码块, 插入分隔线, 插入表格, 插入引用 } from "./markdown-actions"

const 选 = (value: string, start: number, end = start) => ({ value, start, end })

describe("行内包裹", () => {
  test("粗体：包住选区，整段仍被选中", () => {
    expect(包裹(选("第一行", 0, 3), "bold")).toEqual({ value: "**第一行**", start: 2, end: 5 })
  })

  test("粗体：再按一次拆掉（选区落回原文）", () => {
    expect(包裹(选("**第一行**", 2, 5), "bold")).toEqual({ value: "第一行", start: 0, end: 3 })
  })

  test("空选区：光标落在两个标记中间", () => {
    expect(包裹(选("甲乙", 1), "italic")).toEqual({ value: "甲**乙", start: 2, end: 2 })
  })

  test("粗体里的选区按斜体，不会被当成已有斜体拆掉", () => {
    // `**粗**` 里选中 `粗`：外侧的单星号属于粗体标记，不是斜体。
    expect(包裹(选("**粗**", 2, 3), "italic")).toEqual({ value: "***粗***", start: 1, end: 4 })
  })

  test("删除线与行内代码", () => {
    expect(包裹(选("划掉", 0, 2), "strike")).toEqual({ value: "~~划掉~~", start: 2, end: 4 })
    expect(包裹(选("code", 0, 4), "code")).toEqual({ value: "`code`", start: 1, end: 5 })
  })

  test("链接：有选区时选中 url 占位符", () => {
    expect(包裹(选("看这里", 0, 3), "link")).toEqual({ value: "[看这里](url)", start: 6, end: 9 })
  })

  test("链接：空选区插入 []()，光标在方括号中间", () => {
    expect(包裹(选("甲乙", 1), "link")).toEqual({ value: "甲[](url)乙", start: 2, end: 2 })
  })
})

describe("行前缀", () => {
  test("标题：加级别、换级别、同级再按取消", () => {
    expect(切行首(选("标题", 0), "h1")).toEqual({ value: "# 标题", start: 0, end: 4 })
    expect(切行首(选("# 标题", 0), "h3")).toEqual({ value: "### 标题", start: 0, end: 6 })
    expect(切行首(选("### 标题", 0), "h3")).toEqual({ value: "标题", start: 0, end: 2 })
  })

  test("无序列表：加、取消、从有序转过来", () => {
    expect(切行首(选("一", 0), "ul")).toEqual({ value: "- 一", start: 0, end: 3 })
    expect(切行首(选("- 一", 0), "ul")).toEqual({ value: "一", start: 0, end: 1 })
    expect(切行首(选("1. 一", 0), "ul")).toEqual({ value: "- 一", start: 0, end: 3 })
  })

  test("有序列表：从无序转过来并重新编号", () => {
    expect(切行首(选("- 一\n- 二", 0, 7), "ol")).toEqual({
      value: "1. 一\n2. 二",
      start: 0,
      end: 9,
    })
  })

  test("多行选区逐行加前缀；空行不留下 `- ` / `> `", () => {
    expect(切行首(选("一\n\n二", 0, 4), "ul")).toEqual({ value: "- 一\n\n- 二", start: 0, end: 8 })
  })

  test("CRLF 不丢", () => {
    expect(切行首(选("一\r\n二", 0, 4), "quote")).toEqual({ value: "> 一\r\n> 二", start: 0, end: 8 })
  })

  test("引用：再按一次取消", () => {
    expect(切行首(选("> 一", 0), "quote")).toEqual({ value: "一", start: 0, end: 1 })
  })
})

describe("插入块", () => {
  test("分隔线：前后补空行，光标落到块后", () => {
    expect(插入分隔线(选("甲", 1))).toEqual({ value: "甲\n\n---", start: 6, end: 6 })
  })

  test("代码块：空选区插入围栏，光标在中间", () => {
    expect(插入代码块(选("甲", 1))).toEqual({ value: "甲\n```\n\n```", start: 6, end: 6 })
  })

  test("代码块：有选区时包住原文，原文仍被选中", () => {
    expect(插入代码块(选("甲\n乙", 2, 3))).toEqual({ value: "甲\n```\n乙\n```", start: 6, end: 7 })
  })

  test("表格：插入两列表头，并选中「列1」", () => {
    const 结论 = 插入表格(选("", 0))
    expect(结论.value).toBe("| 列1 | 列2 |\n| --- | --- |\n|  |  |")
    expect(结论.value.slice(结论.start, 结论.end)).toBe("列1")
  })

  test("图片：alt 去掉扩展名；路径有空格时尖括号包住", () => {
    expect(插入引用(选("", 0), "image", "卷宗/附件/图 1.png")).toEqual({
      value: "![图 1](<卷宗/附件/图 1.png>)",
      start: 23,
      end: 23,
    })
  })

  test("附件：alt 用文件名；有选区时用选中文字", () => {
    expect(插入引用(选("", 0), "attachment", "卷宗/名单.pdf")).toEqual({
      value: "[名单.pdf](卷宗/名单.pdf)",
      start: 20,
      end: 20,
    })
    expect(插入引用(选("名单", 0, 2), "attachment", "卷宗/名单.pdf").value).toBe("[名单](卷宗/名单.pdf)")
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run:

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/markdown-actions.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `packages/app/src/center/views/richtext/markdown-actions.ts`：

```ts
/**
 * Markdown 编辑动作：纯函数，(正文, 选区) 进、出。
 *
 * 不读 DOM、不认得 Solid、不发请求——视图只负责在调用前后把焦点与选区交还给编辑框。
 * 这样每一条语法都能在 happy-dom 之外单独钉住（`markdown-actions.test.ts`）。
 */

export interface 编辑快照 {
  value: string
  start: number
  end: number
}

export type 包裹动作 = "bold" | "italic" | "strike" | "code" | "link"
export type 行动作 = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol" | "quote"
export type 插入动作 = "hr" | "code-block" | "table"
export type 编辑动作 = 包裹动作 | 行动作 | 插入动作

const 标记: Record<Exclude<包裹动作, "link">, { 开: string; 闭: string }> = {
  bold: { 开: "**", 闭: "**" },
  italic: { 开: "*", 闭: "*" },
  strike: { 开: "~~", 闭: "~~" },
  code: { 开: "`", 闭: "`" },
}

/**
 * 选区外侧是否已经是这一对标记。
 *
 * ⚠️ 粗体 `**x**` 里选中 `x` 时，紧挨着的单星号也「看起来」是一对斜体标记——那是粗体的
 * 一半。不排除它，在粗体里按斜体会把 `**` 拆成 `***`（语义变成粗斜体），不是用户要的。
 */
function 已包住(value: string, start: number, end: number, 开: string, 闭: string): boolean {
  if (start < 开.length || value.slice(start - 开.length, start) !== 开) return false
  if (value.slice(end, end + 闭.length) !== 闭) return false
  if (开 === "*" && (value[start - 2] === "*" || value[end + 1] === "*")) return false
  if (开 === "**" && (value[start - 3] === "*" || value[end + 2] === "*")) return false
  return true
}

/** 包一层行内标记；已有同一对时拆掉。空选区把光标放到两个标记之间。 */
export function 包裹(快照: 编辑快照, 动作: 包裹动作): 编辑快照 {
  const { value, start, end } = 快照
  if (动作 === "link") return 链接(快照)

  const { 开, 闭 } = 标记[动作]
  if (已包住(value, start, end, 开, 闭)) {
    return {
      value: value.slice(0, start - 开.length) + value.slice(start, end) + value.slice(end + 闭.length),
      start: start - 开.length,
      end: end - 开.length,
    }
  }

  const 选中 = value.slice(start, end)
  const 新值 = value.slice(0, start) + 开 + 选中 + 闭 + value.slice(end)
  const 光标 = start + 开.length
  return { value: 新值, start: 光标, end: start === end ? 光标 : 光标 + 选中.length }
}

function 链接({ value, start, end }: 编辑快照): 编辑快照 {
  if (start !== end) {
    const 文字 = value.slice(start, end)
    const 新值 = value.slice(0, start) + `[${文字}](url)` + value.slice(end)
    const 址起 = start + 文字.length + 3
    return { value: 新值, start: 址起, end: 址起 + 3 }
  }
  const 新值 = value.slice(0, start) + "[](url)" + value.slice(end)
  return { value: 新值, start: start + 1, end: start + 1 }
}

const 标题 = /^(#{1,6})\s+/
const 无序 = /^[-*+]\s+/
const 有序 = /^\d+\.\s+/
const 引用 = /^>\s?/

function 改一行(行: string, 动作: 行动作): string {
  if (动作[0] === "h") {
    const 级 = Number(动作.slice(1))
    const 已 = 行.match(标题)
    const 无 = 已 ? 行.slice(已[0].length) : 行
    return 已 && 已[1]!.length === 级 ? 无 : "#".repeat(级) + " " + 无
  }
  if (动作 === "ul") {
    if (无序.test(行)) return 行.replace(无序, "")
    if (有序.test(行)) return 行.replace(有序, "- ")
    return "- " + 行
  }
  if (动作 === "ol") {
    if (有序.test(行)) return 行.replace(有序, "")
    if (无序.test(行)) return 行.replace(无序, "1. ")
    return "1. " + 行
  }
  return 引用.test(行) ? 行.replace(引用, "") : "> " + 行
}

/** 有序列表重新编号：每一行按出现顺序拿 1、2、3…（只改已经带编号的行）。 */
function 重编号(行们: string[]): string[] {
  let 号 = 1
  return 行们.map((行) => {
    const 命中 = 行.match(/^(\d+)\.\s+/)
    if (!命中) return 行
    return `${号++}. ` + 行.slice(命中[0].length)
  })
}

function 行区间(value: string, start: number, end: number) {
  const 起 = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1
  let 止 = value.indexOf("\n", end)
  if (止 < 0) 止 = value.length
  // 选区正好停在下一行行首 ⇒ 不把下一行算进来。
  if (end > start && value[end - 1] === "\n") 止 = end - 1
  return { 起, 止 }
}

/** 对选中的每一行加 / 换 / 取消行前缀。空行不留下看不见的标记。 */
export function 切行首(快照: 编辑快照, 动作: 行动作): 编辑快照 {
  const { 起, 止 } = 行区间(快照.value, 快照.start, 快照.end)
  const 块 = 快照.value.slice(起, 止)
  const 行们 = 块.split("\n")
  const 改后 = 行们.map((行) => {
    const 尾 = 行.endsWith("\r") ? "\r" : ""
    const 肉 = 尾 ? 行.slice(0, -1) : 行
    if (肉.trim() === "") return 行
    return 改一行(肉, 动作) + 尾
  })
  const 重编 = 动作 === "ol" ? 重编号(改后) : 改后
  const 新块 = 重编.join("\n")
  return {
    value: 快照.value.slice(0, 起) + 新块 + 快照.value.slice(止),
    start: 起,
    end: 起 + 新块.length,
  }
}

/** 插一个块级元素：与上下文之间补空行，光标落到块后。 */
function 段落插入(快照: 编辑快照, 块: string): 编辑快照 {
  const { value, start, end } = 快照
  const 前 = value.slice(0, start)
  const 后 = value.slice(end)
  const 前隔 = 前 === "" || 前.endsWith("\n\n") ? "" : 前.endsWith("\n") ? "\n" : "\n\n"
  const 后隔 = 后 === "" || 后.startsWith("\n\n") ? "" : 后.startsWith("\n") ? "\n" : "\n\n"
  const 新值 = 前 + 前隔 + 块 + 后隔 + 后
  const 光标 = 前.length + 前隔.length + 块.length
  return { value: 新值, start: 光标, end: 光标 }
}

export function 插入分隔线(快照: 编辑快照): 编辑快照 {
  return 段落插入(快照, "---")
}

export function 插入表格(快照: 编辑快照): 编辑快照 {
  const 表 = "| 列1 | 列2 |\n| --- | --- |\n|  |  |"
  const 结论 = 段落插入(快照, 表)
  const 位 = 结论.start - 表.length + 2
  return { ...结论, start: 位, end: 位 + 2 }
}

/** 代码块：有选区就包住它，空选区插一对空围栏并把光标放进去。 */
export function 插入代码块(快照: 编辑快照): 编辑快照 {
  const { value, start, end } = 快照
  const 前需 = start > 0 && value[start - 1] !== "\n" ? "\n" : ""
  const 后需 = end < value.length && value[end] !== "\n" ? "\n" : ""
  const 选中 = value.slice(start, end)
  const 块 = `${前需}\`\`\`\n${选中}\n\`\`\`${后需}`
  const 内起 = start + 前需.length + 4
  return {
    value: value.slice(0, start) + 块 + value.slice(end),
    start: 内起,
    end: 内起 + 选中.length,
  }
}

/**
 * 插入一条图片 / 附件引用。`路径` 是**写进 Markdown 的字面写法**（相对当前文件目录）；
 * 调用方用 `相对引用(当前文件, 项目内目标)` 算好再传（见 `richtext-path.ts`）。
 * 图片的 alt 默认用去掉扩展名的文件名；有选中文字时用选中文字。
 */
export function 插入引用(
  快照: 编辑快照,
  类型: "image" | "attachment",
  路径: string,
): 编辑快照 {
  const { value, start, end } = 快照
  const 选中 = value.slice(start, end)
  const 目标 = 路径.includes(" ") ? `<${路径}>` : 路径
  const 名 = 路径.split(/[/\\]/).pop() || 路径
  const 文字 = 选中 || (类型 === "image" ? 名.replace(/\.[^.]+$/, "") : 名)
  const 语法 = 类型 === "image" ? `![${文字}](${目标})` : `[${文字}](${目标})`
  return {
    value: value.slice(0, start) + 语法 + value.slice(end),
    start: start + 语法.length,
    end: start + 语法.length,
  }
}
```

- [ ] **Step 4: 跑测试，确认全绿**

Run:

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/markdown-actions.test.ts
```

Expected: 全部 PASS。若某条几何断言（`start` / `end`）与实现差一位，以**行为对不对**为准修断言或实现，两边必须一致。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/center/views/richtext/markdown-actions.ts packages/app/src/center/views/richtext/markdown-actions.test.ts
git commit -m "feat(richtext): Markdown 编辑动作做成纯函数

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 4: 引用路径解析

**Files:**
- Create: `packages/app/src/center/views/richtext/richtext-path.ts`
- Test: `packages/app/src/center/views/richtext/richtext-path.test.ts`

**Interfaces:**
- Produces:
  - `引用路径(当前文件: string, href: string): string | undefined`
    - 返回项目根相对的 `/` 分隔路径；绝对路径、协议、锚点、越出项目根一律 `undefined`。
  - `相对引用(当前文件: string, 目标: string): string`
    - 反过来：把项目根相对的**目标路径**写成从当前文件所在目录出发的 Markdown 引用
      （`附件/图.png`、`../附件/图.png`），与 `引用路径` 互为逆运算。
    - 为什么插入时要反算：§8.2 的解析口径是「未加 `/` 的按**当前文件目录**解析」。文件选择
      弹层与文件树给的是项目根相对的路径，原样写进 `![](卷宗/附件/图.png)`，在
      `卷宗/纪要.md` 里会被解析成 `卷宗/卷宗/附件/图.png`（spec §7.4「路径口径与 tab 一致」
      指的是**来源**是同一套项目内路径，不是字面形式）。

- [ ] **Step 1: 写失败用例**

```ts
import { describe, expect, test } from "bun:test"
import { 引用路径, 相对引用 } from "./richtext-path"

describe("Markdown 引用路径", () => {
  test("相对当前文件所在目录", () => {
    expect(引用路径("卷宗/纪要.md", "附件/图.png")).toBe("卷宗/附件/图.png")
  })

  test("去掉开头的 ./", () => {
    expect(引用路径("卷宗/纪要.md", "./附件/图.png")).toBe("卷宗/附件/图.png")
  })

  test("../ 回上一层，仍在项目内", () => {
    expect(引用路径("卷宗/子目录/纪要.md", "../图.png")).toBe("卷宗/图.png")
  })

  test("相对路径越出项目根 ⇒ 不认", () => {
    expect(引用路径("纪要.md", "../图.png")).toBeUndefined()
  })

  test("以 / 开头 ⇒ 项目根写法，不是本机绝对路径", () => {
    expect(引用路径("卷宗/纪要.md", "/附件/图.png")).toBe("附件/图.png")
  })

  test("协议 / 锚点 ⇒ 不认", () => {
    expect(引用路径("卷宗/纪要.md", "https://example.com/图.png")).toBeUndefined()
    expect(引用路径("卷宗/纪要.md", "data:image/png;base64,AAAA")).toBeUndefined()
    expect(引用路径("卷宗/纪要.md", "#小节")).toBeUndefined()
  })

  test("百分号编码先解码再对盘上的名字", () => {
    expect(引用路径("卷宗/纪要.md", "%E9%99%84%E4%BB%B6/%E5%9B%BE.png")).toBe("卷宗/附件/图.png")
  })

  test("尖括号包住的路径（有空格时的写法）", () => {
    expect(引用路径("卷宗/纪要.md", "<附件/图 1.png>")).toBe("卷宗/附件/图 1.png")
  })

  test("反斜杠按 Windows 习惯也认", () => {
    expect(引用路径("卷宗/纪要.md", "附件\\图.png")).toBe("卷宗/附件/图.png")
  })

  test("去掉 URL 的 #片段 与 ?查询", () => {
    expect(引用路径("卷宗/纪要.md", "附件/图.png#x")).toBe("卷宗/附件/图.png")
    expect(引用路径("卷宗/纪要.md", "附件/图.png?v=1")).toBe("卷宗/附件/图.png")
  })
})

describe("插入引用时的反向写法", () => {
  test("同目录 ⇒ 只剩文件名", () => {
    expect(相对引用("卷宗/纪要.md", "卷宗/附件/图.png")).toBe("附件/图.png")
  })

  test("目标在上层目录 ⇒ 先 ../ 再往下", () => {
    expect(相对引用("卷宗/子目录/纪要.md", "卷宗/附件/图.png")).toBe("../附件/图.png")
  })

  test("当前文件在项目根 ⇒ 原样是项目根相对路径", () => {
    expect(相对引用("纪要.md", "卷宗/名单.pdf")).toBe("卷宗/名单.pdf")
  })

  test("与 引用路径 互为逆运算（四种深度各验一遍）", () => {
    const 对: Array<[string, string]> = [
      ["纪要.md", "卷宗/附件/图.png"],
      ["卷宗/纪要.md", "卷宗/附件/图.png"],
      ["卷宗/子目录/纪要.md", "卷宗/附件/图.png"],
      ["卷宗/子目录/纪要.md", "名单.pdf"],
    ]
    for (const [当前, 目标] of 对) {
      expect(引用路径(当前, 相对引用(当前, 目标))).toBe(目标)
    }
  })

  test("路径里有空格时原样留着（尖括号由 插入引用 加）", () => {
    expect(相对引用("卷宗/纪要.md", "卷宗/附件/图 1.png")).toBe("附件/图 1.png")
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/richtext-path.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * Markdown 里的引用路径 → **项目内**的实际路径（`/` 分隔、相对项目根）。
 *
 * 预览里的图片要经 `load(path)` 取字节，而 `load` 只认项目内路径；`<img src>` 原样交给
 * 浏览器会去请求前门（404），并且相对路径的基准是页面 URL，不是当前文件——两处都不对。
 *
 * 以 `/` 开头按 **Markdown 的常规约定**读成「项目根」，不当作本机绝对路径。不认的写法一律
 * `undefined`：带协议的 URL、纯锚点、以及 `../` 走到项目根之外。
 */
export function 引用路径(当前文件: string, href: string): string | undefined {
  let 路径 = href.trim()
  if (路径.startsWith("<") && 路径.endsWith(">")) 路径 = 路径.slice(1, -1)
  if (路径 === "" || 路径.startsWith("#")) return undefined
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(路径)) return undefined

  路径 = 路径.split("#")[0]!.split("?")[0]!
  // 中文文件名在 Markdown 里常被写成百分号编码；盘上的名字是解码后的。
  try {
    路径 = decodeURIComponent(路径)
  } catch {
    return undefined
  }
  if (路径 === "") return undefined

  const 从根 = 路径.startsWith("/")
  const 去点 = (从根 ? 路径.slice(1) : 路径).replace(/^\.\//, "").replace(/\\/g, "/")
  const 目录 = 从根 ? "" : 当前文件.split("/").slice(0, -1).join("/")
  const 段 = [...(目录 === "" ? [] : 目录.split("/")), ...去点.split("/")]
  const 结果: string[] = []
  for (const 一 of 段) {
    if (一 === "" || 一 === ".") continue
    if (一 === "..") {
      if (结果.length === 0) return undefined
      结果.pop()
      continue
    }
    结果.push(一)
  }
  return 结果.length === 0 ? undefined : 结果.join("/")
}

/**
 * `引用路径` 的反向：项目根相对的**目标** → 从当前文件所在目录出发的 Markdown 写法。
 *
 * 文件树与文件选择弹层给的都是项目根相对路径（`卷宗/附件/图.png`）；原样写进 Markdown 后，
 * 预览会按**当前文件目录**解析（§8.2），在 `卷宗/纪要.md` 里就变成了
 * `卷宗/卷宗/附件/图.png`。插入引用时在这里反算一次，写下去的就是 `附件/图.png`。
 */
export function 相对引用(当前文件: string, 目标: string): string {
  const 段 = (path: string) => path.split("/").filter((一) => 一 !== "" && 一 !== ".")
  const 目录 = 段(当前文件).slice(0, -1)
  const 目标段 = 段(目标)
  let 同 = 0
  while (同 < 目录.length && 同 < 目标段.length && 目录[同] === 目标段[同]) 同++
  return [...Array<string>(目录.length - 同).fill(".."), ...目标段.slice(同)].join("/")
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/richtext-path.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/center/views/richtext/richtext-path.ts packages/app/src/center/views/richtext/richtext-path.test.ts
git commit -m "feat(richtext): 预览引用路径按当前文件解析

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 5: 草稿 store（状态机、自动保存、冲突）

**Files:**
- Create: `packages/app/src/center/views/richtext/draft-store.ts`
- Test: `packages/app/src/center/views/richtext/draft-store.test.ts`

**Interfaces:**
- Consumes: `SaveFileResult` / `SaveFileContent` / `LoadFileContent`（Task 2）。
- Produces:

```ts
export type 草稿状态 = "clean" | "dirty" | "saving" | "error" | "conflict"
export interface 草稿 {
  path: string
  content: string
  base: string
  /**
   * **上一次成功交出去的正文**（没有成功过就是初始正文）。
   *
   * 不能拿 `content === base` 判「有没有未保存的字」：写口回来的 `base` 是 `落盘.trim()`，
   * 用户输入的首尾空白被削掉了。拿它比，用户打的尾空行会在存成功后永远显示「未保存」，
   * 并每 800ms 再存一次。`base` 只用于**并发比对**，`已存` 只用于**脏判断**。
   */
  已存: string
  mode: "edit" | "preview"
  status: 草稿状态
  savedAt?: number
  message?: string
  selection: { start: number; end: number }
}
export const 草稿表: () => ReadonlyMap<string, 草稿>
export function 取草稿(path: string): 草稿 | undefined
export function 登记出口(path: string, 出口: { save?: SaveFileContent; load?: LoadFileContent }): void
export function 开始编辑(path: string, 初始: { content: string; base: string }): void
export function 改草稿(path: string, content: string, selection: { start: number; end: number }): void
/** `强制 = true` 是用户明确点「保存 / 重试」：只有它能穿透 `conflict`；自动保存不能。 */
export function 立即保存(path: string, 强制?: boolean): Promise<boolean>
export function 切预览(path: string): Promise<boolean>
export function 记盘上版本(path: string, 盘上: { content: string; base: string }): void
export async function 载入盘上版本(path: string): Promise<boolean>
export function 清空草稿(): void
export function 设自动保存参数(参数: { 延迟?: number; 上限?: number } | undefined): void
```

- [ ] **Step 1: 写失败用例**

创建 `packages/app/src/center/views/richtext/draft-store.test.ts`：

```ts
import { beforeEach, describe, expect, test } from "bun:test"
import type { SaveFileContent, SaveFileResult } from "@/center/file-content"
import {
  取草稿,
  改草稿,
  开始编辑,
  立即保存,
  切预览,
  记盘上版本,
  载入盘上版本,
  登记出口,
  清空草稿,
  设自动保存参数,
} from "./draft-store"

const 等 = (毫秒: number) => new Promise((r) => setTimeout(r, 毫秒))
const 选 = (start: number, end = start) => ({ start, end })

beforeEach(() => {
  清空草稿()
  设自动保存参数(undefined)
})

type 存盘结论 = SaveFileResult | Promise<SaveFileResult>
type 交 = { path: string; content: string; base: string }

/** 记账的存盘替身；`结论` 可以是固定值，也可以每次现算。 */
function 装存盘(结论: 存盘结论 | ((交: 交) => 存盘结论)) {
  const 收到: 交[] = []
  const save: SaveFileContent = async (path, content, base) => {
    收到.push({ path, content, base })
    return typeof 结论 === "function" ? 结论({ path, content, base }) : 结论
  }
  return { save, 收到 }
}

describe("草稿状态", () => {
  test("开始编辑 ⇒ clean；content 与 base 是两个独立的值", () => {
    开始编辑("a.md", { content: "原文", base: "原文" })

    expect(取草稿("a.md")).toMatchObject({
      content: "原文",
      base: "原文",
      mode: "edit",
      status: "clean",
    })
  })

  test("只移光标不算改；正文变了才 dirty", () => {
    开始编辑("a.md", { content: "原文", base: "原文" })

    改草稿("a.md", "原文", 选(0, 1))
    expect(取草稿("a.md")?.status).toBe("clean")

    改草稿("a.md", "原文加字", 选(4))
    expect(取草稿("a.md")?.status).toBe("dirty")
  })

  test("再改回与底本相同 ⇒ dirty 收回到 clean", async () => {
    设自动保存参数({ 延迟: 1000, 上限: 2000 })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))
    改草稿("a.md", "原文", 选(2))

    expect(取草稿("a.md")?.status).toBe("clean")
  })
})

describe("自动保存", () => {
  test("停手后保存；成功后用回包里的 base，状态回 clean", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "甲\r\n乙" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲\n乙", base: "甲\n乙" })

    改草稿("a.md", "甲\n丙", 选(3))
    await 等(20)

    expect(收到).toEqual([{ path: "a.md", content: "甲\n丙", base: "甲\n乙" }])
    const 项 = 取草稿("a.md")!
    expect(项.content).toBe("甲\n丙")
    expect(项.base).toBe("甲\r\n乙") // 回包说了算，不是 content.trim()
    expect(项.status).toBe("clean")
    expect(项.savedAt).toBeTruthy()
  })

  /**
   * 写口回来的 `base` 是 `落盘.trim()` 的口径；用户打的尾空行不会落盘。
   * 拿 base 回写 content / 拿 `content === base` 判脏，会让这份草稿存完立刻又显示「未保存」
   * 并每 800ms 再存一次。`已存` 就是为这一条存在的。
   */
  test("存完保留用户打的尾空行：状态回 clean，且不会反复重存", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "甲" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })

    改草稿("a.md", "甲\n\n", 选(3))
    await 等(20)

    const 项 = 取草稿("a.md")!
    expect(收到[0]!.content).toBe("甲\n\n")
    expect(项.content).toBe("甲\n\n")
    expect(项.base).toBe("甲")
    expect(项.status).toBe("clean")

    await 等(20)
    expect(收到).toHaveLength(1)
  })

  test("一直不停手也不会超过上限：延迟 1000 / 上限 20 ⇒ 20ms 内就存", async () => {
    设自动保存参数({ 延迟: 1000, 上限: 20 })
    const { save, 收到 } = 装存盘({ ok: true, base: "改过" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))

    await 等(40)

    expect(收到).toHaveLength(1)
  })

  test("保存在飞时继续打字 ⇒ 回包不把新字判成已保存，随后再存一次", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const 收到: string[] = []
    const save: SaveFileContent = async (_path, content) => {
      收到.push(content)
      if (收到.length === 1) await 闸门
      return { ok: true, base: content }
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })

    改草稿("a.md", "乙", 选(1))
    const 第一 = 立即保存("a.md")
    改草稿("a.md", "丙", 选(1))
    放行()
    await 第一
    await 等(20)

    expect(收到).toEqual(["乙", "丙"])
    expect(取草稿("a.md")?.status).toBe("clean")
    expect(取草稿("a.md")?.content).toBe("丙")
  })

  test("连调两次立即保存 ⇒ 只发一次请求（第二下等在飞那次）", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const { save, 收到 } = 装存盘(async () => {
      await 闸门
      return { ok: true, base: "乙" }
    })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 一 = 立即保存("a.md")
    const 二 = 立即保存("a.md")
    await 等(0)
    expect(收到).toHaveLength(1)

    放行()
    expect(await 一).toBe(true)
    expect(await 二).toBe(true)
  })

  test("清空草稿会取消定时器：之后一个请求都不发", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "改过" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))

    清空草稿()
    await 等(20)

    expect(收到).toHaveLength(0)
    expect(取草稿("a.md")).toBeUndefined()
  })

  test("清空草稿作废在飞的回包：回包到了也不许把表写回来", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const { save } = 装存盘(async () => {
      await 闸门
      return { ok: true, base: "乙" }
    })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 存 = 立即保存("a.md")
    清空草稿()
    放行()
    await 存
    await 等(0)

    expect(取草稿("a.md")).toBeUndefined()
  })
})

describe("拒绝与冲突", () => {
  test("STALE ⇒ conflict，且继续打字也不再发请求", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: false, message: "被改过", code: "STALE" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 等(20)

    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.message).toBe("被改过")

    改草稿("a.md", "乙丙", 选(2))
    await 等(20)

    expect(收到).toHaveLength(1)
    expect(取草稿("a.md")?.content).toBe("乙丙") // 字留着，只是不自动存
  })

  test("冲突后点「重试」（强制保存）⇒ 再发一次；成功回 clean", async () => {
    let 第几次 = 0
    const { save, 收到 } = 装存盘(() =>
      第几次++ === 0 ? { ok: false, message: "被改过", code: "STALE" } : { ok: true, base: "乙丙" },
    )
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙丙", 选(2))
    await 立即保存("a.md")
    expect(取草稿("a.md")?.status).toBe("conflict")

    // 非强制的不许穿透（自动保存不能自己解除冲突），强制的是用户明确点了「重试」。
    expect(await 立即保存("a.md")).toBe(false)
    expect(收到).toHaveLength(1)
    expect(await 立即保存("a.md", true)).toBe(true)
    expect(收到).toHaveLength(2)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("普通错误 ⇒ error；下一次输入会重试", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 第几次 = 0
    const { save, 收到 } = 装存盘(() =>
      第几次++ === 0 ? { ok: false, message: "断网了" } : { ok: true, base: "乙丙" },
    )
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 等(20)
    expect(取草稿("a.md")?.status).toBe("error")
    expect(取草稿("a.md")?.message).toBe("断网了")

    改草稿("a.md", "乙丙", 选(2))
    await 等(20)

    expect(收到).toHaveLength(2)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("载入盘上版本：重新 load，正文与底本都换成盘上那份", async () => {
    let 第几次 = 0
    const save: SaveFileContent = async () => {
      第几次++
      return { ok: false, message: "被改过", code: "STALE" }
    }
    登记出口("a.md", {
      save,
      load: async () => ({ type: "text", content: "盘上那份" }),
    })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 立即保存("a.md")

    expect(await 载入盘上版本("a.md")).toBe(true)

    expect(取草稿("a.md")).toMatchObject({
      content: "盘上那份",
      base: "盘上那份",
      status: "clean",
    })
  })
})

describe("预览与盘上版本", () => {
  test("切预览先冲刷：存成功才切", async () => {
    const { save, 收到 } = 装存盘({ ok: true, base: "乙" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    expect(await 切预览("a.md")).toBe(true)
    expect(收到).toHaveLength(1)
    expect(取草稿("a.md")?.mode).toBe("preview")
  })

  test("切预览：存失败 ⇒ 留在编辑态，草稿不动", async () => {
    const { save } = 装存盘({ ok: false, message: "断网了" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    expect(await 切预览("a.md")).toBe(false)
    expect(取草稿("a.md")?.mode).toBe("edit")
    expect(取草稿("a.md")?.content).toBe("乙")
  })

  test("预览态收到盘上版本 ⇒ 覆盖 clean 内容", () => {
    记盘上版本("a.md", { content: "甲", base: "甲" })
    expect(取草稿("a.md")?.mode).toBe("preview")

    记盘上版本("a.md", { content: "甲2", base: "甲2" })

    expect(取草稿("a.md")?.content).toBe("甲2")
    expect(取草稿("a.md")?.base).toBe("甲2")
  })

  test("编辑态的底本变了 ⇒ conflict（别人的改动不静默盖掉）", () => {
    记盘上版本("a.md", { content: "甲", base: "甲" })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "我改的", 选(3))

    记盘上版本("a.md", { content: "别人改的", base: "别人改的" })

    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.content).toBe("我改的")
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/draft-store.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `packages/app/src/center/views/richtext/draft-store.ts`：

```ts
import { createSignal } from "solid-js"
import type { LoadFileContent, SaveFileContent } from "@/center/file-content"

/**
 * 中栏文档的草稿 store（2026-10-19）。
 *
 * ## 为什么是模块级、按路径键控
 *
 * 中栏视图在换文件 / 换分屏时会**重挂**（keyed `<Show>`），组件本地信号随卸载一起没。
 * 民警打了半页字再去开另一个文件，回来字就没了——用户实报的第一条。草稿必须活得比组件久，
 * 且按**路径**分开：同时开两篇文档，各自的草稿不能串。
 *
 * ## 为什么定时器与在飞请求也在这里
 *
 * 自动保存的计时器若挂在组件上，切 tab 时 `onCleanup` 一跑就没人再存了。store 活着，
 * 计时器就活着；「切换视图」不再是「放弃保存」的同义词。
 *
 * ## 状态机
 *
 * `clean → dirty → saving → clean`
 *                  ↘ `error`（下一次输入重试）
 *                  ↘ `conflict`（`STALE`：盘上变了，暂停自动保存，等用户载入盘上版本）
 *
 * `conflict` **不因继续打字而解除**：那会把「盘上已经不同」这件事吞掉，下一次保存又会撞。
 */

export type 草稿状态 = "clean" | "dirty" | "saving" | "error" | "conflict"

export interface 草稿 {
  path: string
  content: string
  base: string
  /**
   * **上一次成功交出去的正文**（没有成功过就是初始正文）。
   *
   * 不能拿 `content === base` 判「有没有未保存的字」：写口回来的 `base` 是 `落盘.trim()`，
   * 用户输入的首尾空白被削掉了。拿它比，用户打的尾空行会在存成功后永远显示「未保存」，
   * 并每 800ms 再存一次。`base` 只用于**并发比对**，`已存` 只用于**脏判断**。
   */
  已存: string
  mode: "edit" | "preview"
  status: 草稿状态
  savedAt?: number
  message?: string
  selection: { start: number; end: number }
}

interface 出口 {
  save?: SaveFileContent
  load?: LoadFileContent
}

const 出口表 = new Map<string, 出口>()
const 定时器 = new Map<string, ReturnType<typeof setTimeout>>()
/** 第一笔「与底本不同」的时刻——「上限」从它算起，不是从最后一次击键算起。 */
const 首改 = new Map<string, number>()
const 在飞 = new Map<string, Promise<boolean>>()
let 延迟 = 800
let 上限 = 5000
/** `清空草稿()` 之后，上一代的回包一律作废（换项目时在飞的保存不许写回来）。 */
let 代次 = 0

const [表, set表] = createSignal<ReadonlyMap<string, 草稿>>(new Map())

/** 只读快照；视图用它做细粒度响应。 */
export const 草稿表 = 表

export function 取草稿(path: string): 草稿 | undefined {
  return 表().get(path)
}

export function 登记出口(path: string, 出口项: 出口): void {
  出口表.set(path, { ...出口表.get(path), ...出口项 })
}

function 改表(path: string, 改: (旧: 草稿 | undefined) => 草稿 | undefined): void {
  set表((旧表) => {
    const 旧 = 旧表.get(path)
    const 新 = 改(旧)
    if (新 === 旧) return 旧表
    const 副本 = new Map(旧表)
    if (新 === undefined) 副本.delete(path)
    else 副本.set(path, 新)
    return 副本
  })
}

function 清定时器(path: string): void {
  const 计时 = 定时器.get(path)
  if (计时 !== undefined) clearTimeout(计时)
  定时器.delete(path)
  首改.delete(path)
}

/** 按「停手 800ms、最长 5s」排一次自动保存。conflict 与预览态不排。 */
function 排(path: string): void {
  const 项 = 取草稿(path)
  if (!项 || 项.mode !== "edit" || 项.status === "conflict") return
  if (项.content === 项.已存) {
    清定时器(path)
    return
  }

  const 已有 = 定时器.get(path)
  if (已有 !== undefined) clearTimeout(已有)

  const 起 = 首改.get(path) ?? Date.now()
  首改.set(path, 起)
  const 剩余 = Math.max(0, 上限 - (Date.now() - 起))
  const 等待 = Math.min(延迟, 剩余)

  定时器.set(
    path,
    setTimeout(() => {
      定时器.delete(path)
      void 立即保存(path)
    }, 等待),
  )
}

/** 进入编辑态。已有一份草稿（比如刚切回来）**绝不拿盘上版本盖掉它**。 */
export function 开始编辑(path: string, 初始: { content: string; base: string }): void {
  改表(path, (旧) => {
    if (旧) return { ...旧, mode: "edit" }
    return {
      path,
      content: 初始.content,
      base: 初始.base,
      已存: 初始.content,
      mode: "edit",
      status: "clean",
      selection: { start: 0, end: 0 },
    }
  })
}

/** 用户改字 / 移光标。只有正文真的变了才动状态。 */
export function 改草稿(path: string, content: string, selection: { start: number; end: number }): void {
  改表(path, (旧) => {
    if (!旧) return 旧
    const 正文变了 = content !== 旧.content
    const 选区变了 = selection.start !== 旧.selection.start || selection.end !== 旧.selection.end
    if (!正文变了 && !选区变了) return 旧
    if (!正文变了) return { ...旧, selection }
    // 冲突期间只留字，不恢复自动保存：盘上已经不同，自动存只会再撞一次。
    if (旧.status === "conflict") return { ...旧, content, selection }
    return {
      ...旧,
      content,
      selection,
      // 改回与「上次交出去的那份」相同 ⇒ 已经没有未保存的字，收回 clean。
      // 在飞时继续打字 ⇒ 立刻回 dirty（否则状态栏在用户已经接着改之后还说「保存中…」）；
      // 回包发现正文变了会保持 dirty 并再排一次。
      status: content === 旧.已存 ? "clean" : "dirty",
      message: undefined,
    }
  })
  排(path)
}

/**
 * 立刻存一次。重入时**等在飞那次**，回来若仍有未保存的字就再存一次（不并发、不丢字）。
 *
 * ⚠️ 守卫写在函数里而不是「把按钮置灰」：置灰的按钮在 happy-dom 里连事件都不派，
 * 守卫就永远走不到、拆掉也不变红（`LEARNINGS #006-16`）。
 */
export async function 立即保存(path: string, 强制 = false): Promise<boolean> {
  const 飞的 = 在飞.get(path)
  if (飞的) {
    const 成 = await 飞的
    const 项 = 取草稿(path)
    if (!项 || 项.content === 项.已存) return 成
    return 立即保存(path, 强制)
  }

  const 项 = 取草稿(path)
  if (!项) return false

  if (项.content === 项.已存) {
    if (项.status !== "clean") {
      改表(path, (旧) => 旧 && { ...旧, status: "clean", message: undefined })
    }
    return true
  }

  // 冲突只能由用户明确点「重试 / 保存」穿透；定时器与切预览都走非强制，不许悄悄覆盖。
  if (项.status === "conflict" && !强制) return false

  const save = 出口表.get(path)?.save
  if (!save) {
    改表(path, (旧) => 旧 && { ...旧, status: "error", message: "现在没有存盘出口，改动只在这台机器的内存里。" })
    return false
  }

  清定时器(path)
  const 代 = 代次
  const 存的内容 = 项.content
  const 存底本 = 项.base

  改表(path, (旧) => 旧 && { ...旧, status: "saving", message: undefined })

  const 任务 = (async () => {
    try {
      const 结论 = await save(path, 存的内容, 存底本)
      if (代 !== 代次) return false
      if (!结论.ok) {
        改表(path, (旧) =>
          旧 && {
            ...旧,
            status: 结论.code === "STALE" ? "conflict" : "error",
            message: 结论.message,
          },
        )
        return false
      }

      改表(path, (旧) => {
        if (!旧) return 旧
        const 没再改 = 旧.content === 存的内容
        return {
          ...旧,
          base: 结论.base,
          已存: 存的内容,
          // ⚠️ 不回写 `content`：写口回来的 base 是 `content.trim()` 的口径，回写会把用户
          // 刚打的尾空行当场抹掉。正文保持原样，脏判断靠 `已存`。
          // 存的是旧内容而用户又打了字 ⇒ 状态回 dirty，下面再排一次。
          status: 没再改 ? "clean" : "dirty",
          savedAt: Date.now(),
          message: undefined,
        }
      })
      return true
    } catch (原因) {
      if (代 === 代次) {
        console.warn(`[openhive] 存盘没走通（${path}）`, 原因)
        改表(path, (旧) => 旧 && { ...旧, status: "error", message: "保存文件失败" })
      }
      return false
    } finally {
      在飞.delete(path)
    }
  })()

  在飞.set(path, 任务)
  const 成 = await 任务

  const 后 = 取草稿(path)
  if (后 && 后.status === "dirty") 排(path)
  return 成
}

/** 显式切预览：先冲刷，存成功才切。失败留在编辑态（字一个都不丢）。 */
export async function 切预览(path: string): Promise<boolean> {
  const 项 = 取草稿(path)
  if (!项) return true
  if (项.content !== 项.已存 || 项.status !== "clean") {
    const 成 = await 立即保存(path)
    if (!成) return false
  }
  const 后 = 取草稿(path)
  if (!后 || 后.status !== "clean") return false
  改表(path, (旧) => 旧 && { ...旧, mode: "preview" })
  return true
}

/**
 * 预览那一侧读回来的盘上版本。
 *
 * - 还没有草稿 ⇒ 建一份 preview / clean 的；
 * - 预览且 clean ⇒ 换成新读到的（切回 tab 时盘上可能已经变了）；
 * - 编辑态：底本一致就什么都不做；**底本变了 ⇒ conflict**，绝不静默拿盘上版本盖掉用户手里的字。
 */
export function 记盘上版本(path: string, 盘上: { content: string; base: string }): void {
  改表(path, (旧) => {
    if (!旧) {
      return {
        path,
        content: 盘上.content,
        base: 盘上.base,
        已存: 盘上.content,
        mode: "preview",
        status: "clean",
        // 从预览进编辑时没有「上次的光标」，落到正文末尾（spec §7.2）；放 0 会让用户
        // 一点编辑就从第一个字开始背对刚才在看的地方。
        selection: { start: 盘上.content.length, end: 盘上.content.length },
      }
    }
    if (旧.mode === "preview" && 旧.status === "clean") {
      if (旧.content === 盘上.content && 旧.base === 盘上.base) return 旧
      return { ...旧, content: 盘上.content, base: 盘上.base, 已存: 盘上.content }
    }
    if (旧.base === 盘上.base) return 旧
    return {
      ...旧,
      status: "conflict",
      message: "这份文件在你打开之后被改过（可能有人在别处改过）。为避免覆盖别人的改动，请载入盘上版本。",
    }
  })
}

/** 冲突时用户选「载入盘上版本」：重新读一次，把草稿换成盘上那份。 */
export async function 载入盘上版本(path: string): Promise<boolean> {
  const load = 出口表.get(path)?.load
  if (!load) return false
  const 内容 = await load(path)
  if (内容?.type !== "text") return false
  清定时器(path)
  // 读口回来的 content 正是服务端比对用的 base（BOM / 首尾空白已削、CRLF 保留）。
  改表(
    path,
    (旧) =>
      旧 && {
        ...旧,
        content: 内容.content,
        base: 内容.content,
        已存: 内容.content,
        status: "clean",
        message: undefined,
      },
  )
  return true
}

/** 换项目时清空：旧项目的正文不许跟着串到新项目。 */
export function 清空草稿(): void {
  代次++
  for (const 计时 of 定时器.values()) clearTimeout(计时)
  定时器.clear()
  首改.clear()
  在飞.clear()
  出口表.clear()
  set表(new Map())
}

/** 测试与「读者偏好」用；省略 = 回到 800ms / 5s。 */
export function 设自动保存参数(参数: { 延迟?: number; 上限?: number } | undefined): void {
  延迟 = 参数?.延迟 ?? 800
  上限 = 参数?.上限 ?? 5000
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts src/center/views/richtext/draft-store.test.ts
```

Expected: 全部 PASS。若「在飞继续打字」那条偶发红，先把等待放大到 30ms 再跑，确认不是逻辑错。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/center/views/richtext/draft-store.ts packages/app/src/center/views/richtext/draft-store.test.ts
git commit -m "feat(richtext): 草稿 store 与自动保存状态机

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 6: 预览补丁（图片 object URL、相对链接不跳走）

**Files:**
- Modify: `packages/app/src/center/views/richtext-view.tsx:87-91`
- Test: `packages/app/src/center/views/richtext-view.test.tsx`（新增一组）

**Interfaces:**
- Consumes: `引用路径`（Task 4）、`decodeBytes`。
- Produces: `造Markdown渲染器({ path?, load? }): BytesRenderer`；`renderMarkdown` 仍是「无选项」的那一份（既有测试与只读宿主继续用）。

- [ ] **Step 1: 写失败用例**

在 `richtext-view.test.tsx` 的 Markdown 组里加：

```tsx
  test("相对图片路径经 load 取字节，换成 object URL；清理时 revoke", async () => {
    const 原建 = URL.createObjectURL
    const 原销 = URL.revokeObjectURL
    const 建过: string[] = []
    const 销过: string[] = []
    URL.createObjectURL = () => {
      const url = `blob:openhive-${建过.length}`
      建过.push(url)
      return url
    }
    URL.revokeObjectURL = (url: string) => 销过.push(url)
    try {
      const 容器 = document.createElement("div")
      const 取过: string[] = []
      const 清理 = await 造Markdown渲染器({
        path: "卷宗/纪要.md",
        load: async (path) => {
          取过.push(path)
          return { type: "binary", content: "AAEC", encoding: "base64", mimeType: "image/png" }
        },
      })(字节("![图](附件/图.png)"), 容器)

      expect(取过).toEqual(["卷宗/附件/图.png"])
      expect(容器.querySelector("img")?.getAttribute("src")).toBe("blob:openhive-0")
      清理?.()
      expect(销过).toEqual(["blob:openhive-0"])
    } finally {
      URL.createObjectURL = 原建
      URL.revokeObjectURL = 原销
    }
  })

  test("图片取不到时不把整篇文档打成渲染失败（剩下的正文还在）", async () => {
    const 容器 = document.createElement("div")
    await 造Markdown渲染器({
      path: "卷宗/纪要.md",
      load: async () => undefined,
    })(字节("正文\n\n![图](没有.png)"), 容器)

    expect(容器.textContent).toContain("正文")
    expect(容器.querySelector("img")).not.toBeNull()
  })

  test("相对链接不整页跳走（点一下只拦默认行为）", async () => {
    const 容器 = document.createElement("div")
    容器.addEventListener("click", (事件) => 事件.preventDefault())
    const 清理 = await 造Markdown渲染器({ path: "卷宗/纪要.md" })(字节("[别的文档](另一个.md)"), 容器)
    const 链接 = 容器.querySelector("a")!

    const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
    链接.dispatchEvent(事件)

    expect(事件.defaultPrevented).toBe(true)
    清理?.()
  })
```

顶部 import 增加 `造Markdown渲染器`。

- [ ] **Step 2: 跑测试，确认它们红**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/richtext-view.test.tsx --test-name-pattern "相对图片|图片取不到|相对链接"
```

Expected: FAIL（`造Markdown渲染器` 不存在）。

- [ ] **Step 3: 实现**

把 `renderMarkdown` 一段替换为：

```ts
/**
 * 造一个 Markdown 渲染器。
 *
 * 不给 `path` / `load` 时就是原来的纯渲染（只读宿主、单元测试用它）。给了之后多两件事：
 * ① 相对图片路径经 `load` 取字节、换成 object URL（`<img src="附件/图.png">` 原样交给浏览器会
 *    去请求前门，而不是项目文件）；清理函数负责 revoke。
 * ② 点相对链接**不整页跳走**——这个工作区是一张 SPA，跳到别处等于把民警正在做的事丢了。
 *
 * 图片取不到**不许**让整篇渲染失败：一篇纪要配图丢了，剩下几千字还得能看。
 */
export function 造Markdown渲染器(选项: { path?: string; load?: LoadFileContent } = {}): BytesRenderer {
  return async (bytes, container) => {
    标("markdown", container)
    container.innerHTML = sanitizeHtml(await marked.parse(解码(bytes)))

    // cleanup 可能在 `load` 还在飞的时候跑（切文件 / 切模式）。没有这个标志，晚到的回包会
    // 往已经摘掉的 DOM 上写 src、并留下一个永远没人 revoke 的 object URL。
    const 状态 = { 活着: true }
    const 回收: string[] = []
    if (选项.path && 选项.load) await 装图片(container, 选项.path, 选项.load, 回收, 状态)

    const 点击 = (事件: MouseEvent) => {
      const 链接 = (事件.target as Element | null)?.closest("a")
      if (!链接) return
      const href = 链接.getAttribute("href")
      if (!href || href.startsWith("#")) return // 页内锚点交给浏览器
      事件.preventDefault()
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer")
        return
      }
      // 相对链接的基准是「当前文件所在目录」，不是页面 URL——打开它要另一条路由，
      // 这里先不猜：拦住跳转，控制台留一句。
      console.warn(`[openhive] 预览里的相对链接没有打开（${href}）`)
    }
    container.addEventListener("click", 点击)

    return () => {
      状态.活着 = false
      container.removeEventListener("click", 点击)
      for (const url of 回收) URL.revokeObjectURL(url)
    }
  }
}

/** 既有的纯渲染入口：只读宿主与单测继续用它。 */
export const renderMarkdown: BytesRenderer = 造Markdown渲染器()

const 图片类型: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
}

async function 装图片(
  container: HTMLElement,
  当前文件: string,
  load: LoadFileContent,
  回收: string[],
  状态: { 活着: boolean },
): Promise<void> {
  const 图们 = [...container.querySelectorAll<HTMLImageElement>("img[src]")]
  await Promise.all(
    图们.map(async (img) => {
      const href = img.getAttribute("src")
      if (!href) return
      const 路径 = 引用路径(当前文件, href)
      if (!路径) return
      // 一张图读不到只影响它自己（见函数上那条注释）。
      const 内容 = await load(路径).catch(() => undefined)
      if (!状态.活着) return
      const 字节 = decodeBytes(内容)
      if (!字节) return
      const 下缀 = 路径.slice(路径.lastIndexOf(".")).toLowerCase()
      // 落点必须是图片：`decodeBytes` 能解出字节的也可能是被误判成 binary 的文本，
      // 塞进 `<img>` 只会让整篇多一个破图（spec §13 风险表）。
      const 类型 = 内容?.mimeType ?? 图片类型[下缀]
      if (!类型 || !类型.startsWith("image/")) return

      const url = URL.createObjectURL(new Blob([字节], { type: 类型 }))
      if (!状态.活着) {
        URL.revokeObjectURL(url)
        return
      }
      回收.push(url)
      img.src = url
      img.removeAttribute("srcset")
    }),
  )
}
```

同时把文件顶部的 import 整块改成（`FileContent` 那一行与新增的 `decodeBytes` / `LoadFileContent` 合并）：

```ts
import DOMPurify from "dompurify"
import { marked } from "marked"
import { createEffect, createSignal, Show } from "solid-js"
import { decodeBytes, type FileContent, type LoadFileContent } from "@/center/file-content"
import { extensionOf, type ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 阅读字号, 设阅读字号, 步进, 最大字号, 最小字号 } from "./reading-size"
import { 引用路径 } from "./richtext/richtext-path"
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/richtext-view.test.tsx
```

Expected: 全部 PASS（新三条 + 既有渲染/净化用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/center/views/richtext-view.tsx packages/app/src/center/views/richtext-view.test.tsx
git commit -m "feat(richtext): 预览支持相对图片与安全的链接点击

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 7: 工具栏与文件选择弹层

**Files:**
- Create: `packages/app/src/center/views/richtext-toolbar.tsx`
- Create: `packages/app/src/center/views/richtext/file-picker.tsx`

**Interfaces:**
- Consumes: `编辑动作`（Task 3）、`草稿状态`（Task 5）、`extensionOf` / `projectFiles`。
- Produces:
  - `工具栏钮(props: { 动作: string; 文案: string; 说明?: string; 点: () => void; 禁用?: boolean })`
  - `编辑工具栏(props: { 模式: "edit" | "preview"; markdown: boolean; 状态: 草稿状态; 提示?: string; savedAt?: number; 动作; 编辑; 保存; 重试; 预览; 载入盘上; 图片; 附件; 撤销; 重做 })`
    - `markdown === false`（`.txt`）只渲染撤销/重做、标题以外的**非 Markdown** 钮（spec §7.1）。
  - `引用文件选择(props: { 类型: "image" | "attachment"; 选好: (path: string) => void; 关掉: () => void })`

- [ ] **Step 1: 实现工具栏**

创建 `packages/app/src/center/views/richtext-toolbar.tsx`：

```tsx
import { For, Show } from "solid-js"
import type { 草稿状态 } from "./richtext/draft-store"
import type { 编辑动作 } from "./richtext/markdown-actions"

/**
 * 中栏文档的编辑工具栏。
 *
 * 纯展示：每个按钮只报「用户按了哪个动作」，正文与选区怎么变全在
 * `markdown-actions.ts`（纯函数）与视图里。这样工具栏自己不需要 DOM，也不会偷偷改草稿。
 *
 * ⚠️ 按钮的 `mousedown` 一律 `preventDefault`：不这么做，按下按钮会先把焦点从编辑框抢走，
 * 选区在 `click` 之前就已经塌掉——加粗的会是「光标处」而不是「选中的那段」（`#005-17` 同族）。
 */

const 钮类 =
  "flex h-7 cursor-pointer items-center rounded px-2 text-[13px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-v2-text-text-muted"

export function 工具栏钮(props: {
  动作: string
  文案: string
  说明?: string
  点: () => void
  禁用?: boolean
}) {
  return (
    <button
      type="button"
      data-action={props.动作}
      title={props.说明}
      aria-label={props.说明}
      disabled={props.禁用}
      onMouseDown={(事件) => 事件.preventDefault()}
      onClick={props.点}
      class={钮类}
    >
      {props.文案}
    </button>
  )
}

const 行内: Array<{ 动作: 编辑动作; 文案: string; 说明: string }> = [
  { 动作: "bold", 文案: "B", 说明: "粗体（Ctrl+B）" },
  { 动作: "italic", 文案: "I", 说明: "斜体（Ctrl+I）" },
  { 动作: "strike", 文案: "S", 说明: "删除线" },
  { 动作: "code", 文案: "`", 说明: "行内代码" },
  { 动作: "link", 文案: "链接", 说明: "插入链接" },
]

const 行块: Array<{ 动作: 编辑动作; 文案: string; 说明: string }> = [
  { 动作: "ul", 文案: "• 列表", 说明: "无序列表" },
  { 动作: "ol", 文案: "1. 列表", 说明: "有序列表" },
  { 动作: "quote", 文案: "引用", 说明: "引用" },
  { 动作: "hr", 文案: "分隔线", 说明: "水平分隔线" },
  { 动作: "code-block", 文案: "代码块", 说明: "代码块" },
  { 动作: "table", 文案: "表格", 说明: "插入表格" },
]

const 状态话 = (状态: 草稿状态, 提示?: string, savedAt?: number): string => {
  switch (状态) {
    case "clean": {
      if (savedAt === undefined) return ""
      const 时 = new Date(savedAt)
      const 两 = (值: number) => String(值).padStart(2, "0")
      return `已保存 ${两(时.getHours())}:${两(时.getMinutes())}`
    }
    case "dirty":
      return "未保存"
    case "saving":
      return "保存中…"
    case "error":
      return `保存失败：${提示 ?? "未知原因"}`
    case "conflict":
      return "盘上已改动，自动保存已暂停"
  }
}

export function 编辑工具栏(props: {
  模式: "edit" | "preview"
  markdown: boolean
  状态: 草稿状态
  提示?: string
  savedAt?: number
  动作: (动作: 编辑动作) => void
  编辑: () => void
  保存: () => void
  重试: () => void
  预览: () => void
  载入盘上: () => void
  图片: () => void
  附件: () => void
  撤销: () => void
  重做: () => void
}) {
  return (
    <Show
      when={props.模式 === "edit"}
      fallback={<工具栏钮 动作="edit" 文案="编辑" 说明="进入编辑" 点={props.编辑} />}
    >
      <div class="flex flex-1 flex-wrap items-center gap-1">
        <工具栏钮 动作="undo" 文案="撤销" 说明="撤销（Ctrl+Z）" 点={props.撤销} />
        <工具栏钮 动作="redo" 文案="重做" 说明="重做（Ctrl+Shift+Z）" 点={props.重做} />

        <Show when={props.markdown}>
          <select
            data-action="heading"
            aria-label="标题级别"
            class="h-7 cursor-pointer rounded bg-transparent px-1 text-[13px] text-v2-text-text-muted outline-none hover:text-v2-text-text-base"
            onChange={(事件) => {
              const 值 =事件.currentTarget.value
              事件.currentTarget.value = ""
              if (值 !== "") props.动作(值 as 编辑动作)
            }}
          >
            <option value="">标题</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
            <option value="h4">H4</option>
            <option value="h5">H5</option>
            <option value="h6">H6</option>
          </select>

          <For each={行内}>
            {(项) => <工具栏钮 动作={项.动作} 文案={项.文案} 说明={项.说明} 点={() => props.动作(项.动作)} />}
          </For>
          <For each={行块}>
            {(项) => <工具栏钮 动作={项.动作} 文案={项.文案} 说明={项.说明} 点={() => props.动作(项.动作)} />}
          </For>

          <工具栏钮 动作="image" 文案="图片" 说明="插入项目里的图片" 点={props.图片} />
          <工具栏钮 动作="attachment" 文案="附件" 说明="插入项目里的附件" 点={props.附件} />
        </Show>

        <工具栏钮 动作="save" 文案="保存" 说明="立即保存（Ctrl+S）" 点={props.保存} />
        <工具栏钮 动作="preview" 文案="预览" 说明="保存并回到预览" 点={props.预览} />

        <Show when={props.状态 === "conflict"}>
          <工具栏钮 动作="retry" 文案="重试" 说明="再存一次（盘上确实变了就仍会冲突）" 点={props.重试} />
          <工具栏钮 动作="load-disk" 文案="载入盘上版本" 说明="放弃我的改动，载入盘上那份" 点={props.载入盘上} />
        </Show>

        <span
          data-slot="richtext-save-state"
          data-status={props.状态}
          class="ml-auto text-[12px] leading-5 text-v2-text-text-muted"
        >
          {状态话(props.状态, props.提示, props.savedAt)}
        </span>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 实现文件选择弹层**

创建 `packages/app/src/center/views/richtext/file-picker.tsx`：

```tsx
import { createMemo, createSignal, For, Show } from "solid-js"
import { extensionOf } from "@/center/view-registry"
import { projectFiles } from "@/project/project-files"

/**
 * 从**当前项目的文件清单**里挑一个，插成引用。
 *
 * 为什么不走系统文件对话框：Markdown 里要写的是**项目内相对路径**，系统对话框给的是本机绝对
 * 路径——两者对不上。上传新文件（把本机文件搬进项目）是 P1，本期只引用已经在项目里的文件。
 *
 * 图片只列图片扩展名；附件列全部（附件可以是任何东西）。
 */
/** 拖入时也用它判类型，所以导出。 */
export const 图片扩展 = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"])

export function 引用文件选择(props: {
  类型: "image" | "attachment"
  选好: (path: string) => void
  关掉: () => void
}) {
  const [找, set找] = createSignal("")
  const 候选 = createMemo(() => {
    const 全部 = projectFiles() ?? []
    const 过滤 =
      props.类型 === "image" ? 全部.filter((路径) => 图片扩展.has(extensionOf(路径) ?? "")) : 全部
    const 词 = 找().trim().toLowerCase()
    return 词 === "" ? 过滤 : 过滤.filter((路径) => 路径.toLowerCase().includes(词))
  })

  return (
    <div
      data-slot="richtext-file-picker"
      class="flex w-full flex-col gap-1 rounded-md border border-v2-border-border-strong bg-v2-background-bg-base p-2"
    >
      <div class="flex items-center gap-1">
        <input
          data-slot="richtext-file-search"
          value={找()}
          onInput={(事件) => set找(事件.currentTarget.value)}
          placeholder={props.类型 === "image" ? "搜索项目里的图片" : "搜索项目里的文件"}
          class="h-7 min-w-0 flex-1 rounded bg-transparent px-2 text-[13px] text-v2-text-text-base outline-none"
        />
        <button
          type="button"
          data-slot="richtext-file-cancel"
          onClick={props.关掉}
          class="flex h-7 cursor-pointer items-center rounded px-2 text-[13px] text-v2-text-text-muted hover:text-v2-text-text-base"
        >
          取消
        </button>
      </div>
      <div class="max-h-56 overflow-auto">
        <For each={候选()}>
          {(路径) => (
            <button
              type="button"
              data-slot="richtext-file-option"
              data-path={路径}
              onClick={() => props.选好(路径)}
              class="flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
            >
              {路径}
            </button>
          )}
        </For>
        <Show when={候选().length === 0}>
          <div data-slot="richtext-file-empty" class="px-2 py-1 text-[12px] text-v2-text-text-muted">
            没有匹配的文件
          </div>
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 类型检查**

```bash
cd packages/app && bun run typecheck
```

Expected: 通过（这两个文件还没有调用方，但自身类型必须成立）。

- [ ] **Step 4: 提交**

```bash
git add packages/app/src/center/views/richtext-toolbar.tsx packages/app/src/center/views/richtext/file-picker.tsx
git commit -m "feat(richtext): 编辑工具栏与项目内文件选择弹层

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 8: 视图重写（草稿常驻、编辑态常驻、工具栏接线）

**Files:**
- Modify: `packages/app/src/center/views/richtext-view.tsx`（整段替换 `RichtextView`，保留 `sanitizeHtml` / `标` / `renderPlainText` / `造Markdown渲染器`）
- Modify: `packages/app/src/center/views/richtext-view.test.tsx`

**Interfaces:**
- Consumes: Task 3-7 的全部导出。
- Produces: `RichtextView` 的 DOM 契约（测试与 E2E 依赖）：
  - `[data-slot="richtext-editor-bar"]`：工具栏所在的带子（`save` 省略时不渲染）
  - `[data-slot="richtext-editor"]`：`<textarea>`，编辑态才在
  - `[data-slot="richtext-save-state"][data-status="clean|dirty|saving|error|conflict"]`
  - `[data-slot="richtext-editor-note"]`：错误 / 冲突那句话
  - `[data-action="edit|save|preview|load-disk|undo|redo|bold|..."]`
  - `[data-slot="richtext-file-picker"]` 及其子元素

- [ ] **Step 1: 改 `挂编辑器` 与测试的公共准备**

在 `richtext-view.test.tsx` 顶部 import 加：

```ts
import { 清空草稿, 设自动保存参数 } from "./richtext/draft-store"
```

在文件顶部（所有 describe 之前）加：

```ts
beforeEach(() => {
  清空草稿()
  设自动保存参数(undefined)
})
```

把 `挂编辑器` 的替身与返回改成：

```tsx
function 挂编辑器(
  正文: string | readonly string[],
  选项: {
    路径?: string
    保存结果?:
      | { ok: true; base: string }
      | { ok: false; message: string; code?: string }
      | ((交: { path: string; content: string; base: string }) =>
          | { ok: true; base: string }
          | { ok: false; message: string; code?: string })
    保存抛?: boolean
    保存等着?: () => Promise<void>
    读等着?: (第几次: number) => Promise<void> | undefined
  } = {},
) {
  const 序 = typeof 正文 === "string" ? [正文] : 正文
  let 第几次 = 0
  const 交出去的: Array<{ path: string; content: string; base: string }> = []
  const host = mount(() => (
    <RichtextView
      path={选项.路径 ?? "/p/摘录.md"}
      load={async () => {
        const 本次 = 第几次++
        const 门 = 选项.读等着?.(本次)
        if (门) await 门
        return { type: "text", content: 序[Math.min(本次, 序.length - 1)] }
      }}
      save={async (path, content, base) => {
        const 交 = { path, content, base }
        交出去的.push(交)
        if (选项.保存等着) await 选项.保存等着()
        if (选项.保存抛) throw new Error("断网了")
        const 结果 = 选项.保存结果
        if (typeof 结果 === "function") return 结果(交)
        return 结果 ?? { ok: true, base: content.trim() }
      }}
    />
  ))
  return {
    host,
    读次数: () => 第几次,
    交出去的,
    编辑框: () => host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']"),
    钮: (动作: string) => host.querySelector<HTMLButtonElement>(`[data-action='${动作}']`),
    状态: () =>
      host.querySelector<HTMLElement>("[data-slot='richtext-save-state']")?.getAttribute("data-status"),
    提示: () => host.querySelector("[data-slot='richtext-editor-note']")?.textContent?.trim(),
    预览文字: () => host.querySelector("[data-component='richtext-view']")?.textContent ?? "",
  }
}
```

同时在辅助函数下面加一个可卸载的挂法：

```tsx
function 挂一次(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 释放 = render(element, host)
  return { host, 释放 }
}
```

- [ ] **Step 2: 改 / 删既有「保存后回预览」用例**

把这三条**替换**为新语义：

```tsx
  test("存成功 ⇒ **留在编辑态**，状态显示已保存（不用再点编辑）", async () => {
    const h = 挂编辑器("第一行")
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.编辑框()).not.toBeNull()
    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.钮("save")).not.toBeNull()
    expect(h.状态()).toBe("clean")
    expect(h.交出去的).toHaveLength(1)
  })

  test("连点两下「保存」⇒ 只发一次，第一下收尾后仍留在编辑态", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((resolve) => (放行 = resolve))
    const h = 挂编辑器("第一行", { 保存等着: () => 闸门 })
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    h.钮("save")!.click()
    await 落定()

    expect(h.交出去的).toHaveLength(1)

    放行()
    await 落定()
    expect(h.编辑框()).not.toBeNull()
  })
```

删除「存完、重读还没回来 ⇒ 编辑钮先不给」整条（`底本作废窗口` 随 `set底本(undefined)` 一起没了）。

把「服务端拒了」那条的断言补上状态：

```tsx
    expect(h.状态()).toBe("error")
    expect(h.提示()).toBe(那句)
```

把「存盘自己抛」那条补上：

```tsx
    expect(h.状态()).toBe("error")
```

删除「取消 / 继续改 / 丢掉」三条与 `问句()` 辅助（草稿不再有取消；丢弃只发生在冲突的「载入盘上版本」）。

- [ ] **Step 3: 加新用例**

```tsx
describe("图文视图 · 草稿与 Markdown 编辑（2026-10-19）", () => {
  /**
   * 用户实报的第一条：打了半页字去开别的文件 / 分屏，回来字全没了。
   * 判据必须**真的卸载再挂回来**——只断组件内部状态证明不了草稿活得比组件久。
   */
  test("切去别的文件再回来 ⇒ 没保存的字还在", async () => {
    const 甲 = 挂一次(() => (
      <RichtextView
        path="/p/甲.md"
        load={async () => ({ type: "text", content: "甲原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()
    甲.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    const 框 = 甲.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")!
    打字(框, "甲改过")
    框.focus()
    框.setSelectionRange(1, 3)
    框.dispatchEvent(new Event("select"))
    甲.释放()

    const 乙 = 挂一次(() => (
      <RichtextView
        path="/p/乙.md"
        load={async () => ({ type: "text", content: "乙原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()
    expect(乙.host.querySelector("[data-slot='richtext-editor']")).toBeNull()
    乙.释放()

    const 回来 = 挂一次(() => (
      <RichtextView
        path="/p/甲.md"
        load={async () => ({ type: "text", content: "甲原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()

    const 回框 = 回来.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")
    expect(回框?.value).toBe("甲改过")
    // 光标也回来：回来之后用户接着打字，不该从头开始。
    expect({ start: 回框?.selectionStart, end: 回框?.selectionEnd }).toEqual({ start: 1, end: 3 })
    回来.释放()
  })

  /**
   * 自动保存的定时器必须活在**组件外**：打完字马上切走（组件卸载），到点仍然要存。
   * 这条会把「定时器挂在 onCleanup 上」的实现当场打红（spec §11.5 的关键变异）。
   */
  test("打完字立刻切走（卸载）⇒ 到点仍然自动保存", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const 交出去的: string[] = []
    const 挂的 = 挂一次(() => (
      <RichtextView
        path="/p/卸载.md"
        load={async () => ({ type: "text", content: "原文" })}
        save={async (_p, content) => {
          交出去的.push(content)
          return { ok: true, base: content }
        }}
      />
    ))
    await 落定()
    挂的.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    打字(挂的.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")!, "切走前打的字")
    挂的.释放()

    await new Promise((r) => setTimeout(r, 30))

    expect(交出去的).toEqual(["切走前打的字"])
  })

  test("工具栏加粗再点一次 ⇒ 拆掉（切换语义）", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    h.编辑框()!.setSelectionRange(0, 3)

    h.钮("bold")!.click()
    await 落定()
    expect(h.编辑框()?.value).toBe("**第一行**")

    // 拆掉时选区落在原来那段文字上（不是整段带标记）。
    h.编辑框()!.setSelectionRange(2, 5)
    h.钮("bold")!.click()
    await 落定()
    expect(h.编辑框()?.value).toBe("第一行")
  })

  test(".txt 不渲染 Markdown 动作（只留保存 / 预览 / 撤销重做）", async () => {
    const h = 挂编辑器("纯文本", { 路径: "/p/摘录.txt" })
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    expect(h.钮("save")).not.toBeNull()
    expect(h.钮("preview")).not.toBeNull()
    expect(h.钮("undo")).not.toBeNull()
    expect(h.钮("bold")).toBeNull()
    expect(h.host.querySelector("[data-action='heading']")).toBeNull()
    expect(h.钮("image")).toBeNull()
  })

  test("停手后自动保存（不用点保存）", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    打字(h.编辑框()!, "第二行")
    await new Promise((r) => setTimeout(r, 20))

    expect(h.交出去的).toHaveLength(1)
    expect(h.交出去的[0]).toEqual({ path: "/p/摘录.md", content: "第二行", base: "第一行" })
    expect(h.状态()).toBe("clean")
    expect(h.编辑框()).not.toBeNull()
  })

  test("Ctrl+S 立刻保存", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")

    h.编辑框()!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }))
    await 落定()

    expect(h.交出去的).toHaveLength(1)
  })

  test("Ctrl+K 插入链接占位", async () => {
    const h = 挂编辑器("看这里")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    h.编辑框()!.setSelectionRange(0, 3)

    h.编辑框()!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))
    await 落定()

    expect(h.编辑框()?.value).toBe("[看这里](url)")
  })

  test("从文件树拖入 ⇒ 读 file: 载荷，图片插 ![](...)", async () => {
    const h = 挂编辑器("正文")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 框 = h.编辑框()!
    框.focus()
    框.setSelectionRange(2, 2)

    // 文件树的载荷是 `text/plain` 里的 `file:<路径>`，不是 `File` 对象。
    const 事件 = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(事件, "dataTransfer", { value: { getData: () => "file:卷宗/附件/图.png" } })
    框.dispatchEvent(事件)
    await 落定()

    // 当前文件是 `/p/摘录.md` ⇒ 从 `p/` 出发到项目根的 `卷宗/附件/图.png` 要退一层。
    expect(h.编辑框()?.value).toBe("正文![图](../卷宗/附件/图.png)")
  })

  test("STALE ⇒ 冲突态、保留我的字、给「载入盘上版本」", async () => {
    const h = 挂编辑器("第一行", {
      保存结果: { ok: false, message: "这份文件在你打开之后被改过", code: "STALE" },
    })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.状态()).toBe("conflict")
    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.钮("load-disk")).not.toBeNull()
  })

  test("冲突里点「载入盘上版本」⇒ 正文换成盘上那份", async () => {
    const h = 挂编辑器(["第一行", "盘上新的"], {
      保存结果: { ok: false, message: "被改过", code: "STALE" },
    })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "我改的")
    h.钮("save")!.click()
    await 落定()

    h.钮("load-disk")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("盘上新的")
    expect(h.状态()).toBe("clean")
  })

  test("点预览 ⇒ 先保存再回预览；预览里是新正文", async () => {
    const h = 挂编辑器(["第一行", "第二行"])
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("preview")!.click()
    await 落定()

    expect(h.交出去的).toHaveLength(1)
    expect(h.编辑框()).toBeNull()
    expect(h.读次数()).toBe(2)
    expect(h.预览文字()).toContain("第二行")
  })

  test("预览存失败 ⇒ 留在编辑态，字不丢", async () => {
    const h = 挂编辑器("第一行", { 保存结果: { ok: false, message: "断网了" } })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("preview")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.状态()).toBe("error")
  })

  test("工具栏加粗：选中一段再点 B ⇒ 正文被 ** 包住", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 框 = h.编辑框()!
    框.setSelectionRange(0, 3)

    h.钮("bold")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("**第一行**")
  })

  test("工具栏插入图片：从项目清单里挑，插成相对路径", async () => {
    setProjectFiles(["卷宗/附件/图.png", "卷宗/纪要.md"])
    try {
      const h = 挂编辑器("正文")
      await 落定()
      h.钮("edit")!.click()
      await 落定()
      h.钮("image")!.click()
      await 落定()

      const 选项 = h.host.querySelectorAll<HTMLElement>("[data-slot='richtext-file-option']")
      expect([...选项].map((项) => 项.dataset.path)).toEqual(["卷宗/附件/图.png"])

      选项[0]!.click()
      await 落定()

      expect(h.编辑框()?.value).toContain("![图](../卷宗/附件/图.png)")
    } finally {
      setProjectFiles(undefined)
    }
  })
})
```

顶部再补 import：

```ts
import { setProjectFiles } from "@/project/project-files"
```

`挂一次` 的 `释放` 就是 `render()` 返回的 dispose；调用后 Solid 会跑 `onCleanup`。

- [ ] **Step 4: 跑组件测试，确认它们红**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/richtext-view.test.tsx
```

Expected: 新用例大面积 FAIL（视图还是旧实现）。

- [ ] **Step 5: 重写视图**

把 `richtext-view.tsx` 里 `RichtextView` **整段**替换（文件头的 `sanitizeHtml` / `标` / `renderPlainText` / Task 6 的 `造Markdown渲染器` 保持不动），并改 import：

```ts
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { FileContent } from "@/center/file-content"
import { extensionOf, type ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 阅读字号, 设阅读字号, 步进, 最大字号, 最小字号 } from "./reading-size"
import {
  取草稿,
  改草稿,
  开始编辑,
  立即保存,
  切预览,
  记盘上版本,
  载入盘上版本,
  登记出口,
} from "./richtext/draft-store"
import {
  包裹,
  切行首,
  插入代码块,
  插入分隔线,
  插入表格,
  插入引用,
  type 编辑动作,
  type 编辑快照,
} from "./richtext/markdown-actions"
import { 编辑工具栏, 工具栏钮 } from "./richtext-toolbar"
import { 引用文件选择, 图片扩展 } from "./richtext/file-picker"
import { 相对引用 } from "./richtext/richtext-path"
```

视图本体：

```tsx
/**
 * 图文视图（`.md` / `.txt`）。
 *
 * ## 2026-10-19：从「按一下编辑」改成「永远可编辑的记事本」
 *
 * 用户实报四条：换文件 / 分屏会丢没保存的字、点保存就退出编辑态、没有自动保存、没有
 * Markdown 编辑功能。前三条是同一个根因：草稿与保存状态长在**组件**上，而中栏换文件是
 * **重挂**组件。现在草稿按路径存在 `draft-store`，组件重挂不影响它；保存成功也不再退出
 * 编辑态（要回预览请点「预览」）。
 *
 * ## 底本只有一条来路
 *
 * 预览里的 `BinaryView` 读回来的文本经 `收到内容` 交给 `记盘上版本`；保存成功后用**服务端
 * 回包里的 base**，不再自己拿 `content.trim()` 算（CRLF 文件上那会假冲突）。
 *
 * ## 二进制文件仍然不给改
 *
 * `load` 判成 binary 的文件不建草稿：拿 base64 当正文存回去是在毁数据，不是「存不上」。
 */
export const RichtextView: ViewComponent = (props) => {
  /** 这份文件是不是可编辑的文本（binary / 还没读到 ⇒ false）。 */
  const [可编辑, set可编辑] = createSignal(取草稿(props.path) !== undefined)
  const [选文件, set选文件] = createSignal<"image" | "attachment" | undefined>()
  let 框: HTMLTextAreaElement | undefined

  const 项 = () => (props.save ? 取草稿(props.path) : undefined)
  const 改着 = () => 项()?.mode === "edit"

  createEffect(() => {
    登记出口(props.path, { save: props.save, load: props.load })
  })

  createEffect(() => {
    document.documentElement.style.setProperty("--richtext-size", `${阅读字号()}px`)
  })

  /** 预览那一侧读回来的盘上版本（`BinaryView` 只在这一态挂载）。 */
  const 收到内容 = (内容: FileContent | undefined) => {
    const 文本 = 内容?.type === "text" ? 内容.content : undefined
    set可编辑(文本 !== undefined)
    if (文本 === undefined) return
    记盘上版本(props.path, { content: 文本, base: 文本 })
  }

  const 渲染器 = createMemo<BytesRenderer>(() =>
    extensionOf(props.path) === ".md" ? 造Markdown渲染器({ path: props.path, load: props.load }) : renderPlainText,
  )

  const 开始 = () => {
    const 当前 = 项()
    if (!当前) return
    开始编辑(props.path, { content: 当前.content, base: 当前.base })
  }

  /** 把纯函数的结论写回 store，并把焦点与选区交还编辑框。 */
  const 落结论 = (结论: 编辑快照) => {
    const 框引用 = 框
    改草稿(props.path, 结论.value, { start: 结论.start, end: 结论.end })
    queueMicrotask(() => {
      框引用?.focus()
      框引用?.setSelectionRange(结论.start, 结论.end)
    })
  }

  const 快照 = (): 编辑快照 | undefined => {
    const 当前 = 项()
    const 框引用 = 框
    if (!当前 || !框引用) return undefined
    return { value: 当前.content, start: 框引用.selectionStart, end: 框引用.selectionEnd }
  }

  const 做动作 = (动作: 编辑动作) => {
    const 前 = 快照()
    if (!前) return
    if (动作 === "hr") return 落结论(插入分隔线(前))
    if (动作 === "code-block") return 落结论(插入代码块(前))
    if (动作 === "table") return 落结论(插入表格(前))
    if (动作 === "bold" || 动作 === "italic" || 动作 === "strike" || 动作 === "code" || 动作 === "link") {
      return 落结论(包裹(前, 动作))
    }
    落结论(切行首(前, 动作))
  }

  const 插引用 = (路径: string, 类型: "image" | "attachment") => {
    set选文件(undefined)
    const 前 = 快照()
    if (!前) return
    // 文件树 / 文件选择弹层给的是**项目根相对**路径；写进 Markdown 前换成
    // 「相对当前文件所在目录」的写法，否则预览会按当前目录再拼一层（见 `相对引用`）。
    落结论(插入引用(前, 类型, 相对引用(props.path, 路径)))
  }

  /**
   * 撤销 / 重做交给浏览器的原生栈（`execCommand`）：textarea 的撤销历史由浏览器维护，
   * 自己再存一份会和输入法、粘贴、拖放打架。`execCommand` 在真浏览器里会派发 `input`，
   * 这里再同步一次是为了在它不派发的环境里也不丢状态。
   */
  const 同步框 = () => {
    const 框引用 = 框
    if (!框引用) return
    改草稿(props.path, 框引用.value, { start: 框引用.selectionStart, end: 框引用.selectionEnd })
  }
  const 撤销 = () => {
    框?.focus()
    document.execCommand?.("undo")
    同步框()
  }
  const 重做 = () => {
    框?.focus()
    document.execCommand?.("redo")
    同步框()
  }

  const 按键 = (事件: KeyboardEvent) => {
    if (!(事件.ctrlKey || 事件.metaKey)) return
    const 键 = 事件.key.toLowerCase()
    if (键 === "s") {
      事件.preventDefault()
      // 用户按的保存是**明确动作**：冲突态下也照存（仍会被服务端判 STALE，但那是用户的意图）。
      void 立即保存(props.path, true)
      return
    }
    // Ctrl/Cmd+Z / Shift+Z **不拦截**（spec §7.3）：textarea 的原生撤销栈比我们自己的可靠，
    // 撤销后浏览器会派 `input`，`onInput` 顺手把新值同步进 store。
    if (键 === "b") {
      事件.preventDefault()
      做动作("bold")
      return
    }
    if (键 === "i") {
      事件.preventDefault()
      做动作("italic")
      return
    }
    if (键 === "k") {
      事件.preventDefault()
      做动作("link")
    }
  }

  return (
    <>
      <Show when={props.save}>
        <div data-slot="richtext-editor-bar" class="flex w-full shrink-0 flex-col gap-1 px-4 pt-3 pb-1">
          <div class="flex items-start gap-1">
            <Show when={可编辑()}>
              <编辑工具栏
                模式={改着() ? "edit" : "preview"}
                markdown={extensionOf(props.path) === ".md"}
                状态={项()?.status ?? "clean"}
                提示={项()?.message}
                savedAt={项()?.savedAt}
                动作={做动作}
                编辑={开始}
                保存={() => void 立即保存(props.path, true)}
                重试={() => void 立即保存(props.path, true)}
                预览={() => void 切预览(props.path)}
                载入盘上={() => void 载入盘上版本(props.path)}
                图片={() => set选文件("image")}
                附件={() => set选文件("attachment")}
                撤销={撤销}
                重做={重做}
              />
            </Show>
            {/*
              字号两颗钮不在「可编辑」的 Show 里：它调的是**读者**的偏好，不是这份文件的性质
              ——二进制 / 还没读到的文件上也该调得动。
            */}
            <div data-slot="richtext-reading-size" class="ml-auto flex shrink-0 items-center gap-1">
              <工具栏钮
                动作="smaller"
                文案="A-"
                说明="把正文调小一号"
                禁用={阅读字号() === 最小字号}
                点={() => 设阅读字号(步进(阅读字号(), -1))}
              />
              <工具栏钮
                动作="larger"
                文案="A+"
                说明="把正文调大一号"
                禁用={阅读字号() === 最大字号}
                点={() => 设阅读字号(步进(阅读字号(), 1))}
              />
            </div>
          </div>
          {/*
            冲突那句话单独一行：它不是状态栏的一句灰字，而是「盘上已经不同」的告知
            ——继续打字不会解除它，只有「载入盘上版本」能。
          */}
          <Show when={项()?.status === "conflict"}>
            <div data-slot="richtext-editor-note" class="text-[12px] leading-5 text-v2-text-text-muted">
              {项()?.message}
            </div>
          </Show>
          <Show when={项()?.status === "error"}>
            <div data-slot="richtext-editor-note" class="text-[12px] leading-5 text-v2-text-text-muted">
              {项()?.message}
            </div>
          </Show>
          <Show when={选文件()}>
            {(类型) => (
              <引用文件选择 类型={类型()} 选好={(路径) => 插引用(路径, 类型())} 关掉={() => set选文件(undefined)} />
            )}
          </Show>
        </div>
      </Show>
      {/*
        ⚠️ 编辑态仍然**换掉**预览：预览由 `BinaryView` 画，它只在预览态挂载、只在那一态读盘。
        草稿在 store 里，所以「换掉」不再意味着丢字。
      */}
      <Show
        when={改着()}
        fallback={
          <BinaryView
            name="richtext-view"
            path={props.path}
            load={props.load}
            render={渲染器()}
            onContent={收到内容}
          />
        }
      >
        <div class="flex w-full min-h-0 flex-1 flex-col p-4">
          <textarea
            data-slot="richtext-editor"
            ref={(el) => {
              框 = el
              const 选区 = 项()?.selection ?? { start: 0, end: 0 }
              el.focus()
              el.setSelectionRange(选区.start, 选区.end)
            }}
            value={项()?.content ?? ""}
            onInput={(事件) => {
              const el = 事件.currentTarget
              改草稿(props.path, el.value, { start: el.selectionStart, end: el.selectionEnd })
            }}
            onSelect={(事件) => {
              const el = 事件.currentTarget
              const 当前 = 项()
              if (!当前) return
              改草稿(props.path, 当前.content, { start: el.selectionStart, end: el.selectionEnd })
            }}
            onKeyDown={按键}
            onDragOver={(事件) => 事件.preventDefault()}
            onDrop={(事件) => {
              事件.preventDefault()
              // 左栏文件树给的载荷是 `file:<项目内路径>`（`file-tree.tsx`），**不是** `File` 对象
              // ——树上的文件本来就在项目里，不存在「从本机拖进来」这回事，读 `files` 只会拿到空。
              const 载荷 = 事件.dataTransfer?.getData("text/plain") ?? ""
              if (!载荷.startsWith("file:")) return
              const 路径 = 载荷.slice("file:".length)
              if (路径 === "") return
              // 只插引用、不写盘：上传是 P1。
              插引用(路径, 图片扩展.has(extensionOf(路径) ?? "") ? "image" : "attachment")
            }}
            spellcheck={false}
            class="min-h-0 w-full flex-1 resize-none rounded-md border border-v2-border-border-strong bg-v2-background-bg-base p-3 font-sans text-v2-text-text-base outline-none"
          />
        </div>
      </Show>
    </>
  )
}
```

同时删掉旧的 `动作钮`、`存不上`、`底本` / `草稿` / `改着` / `问着` / `说法` / `存着` 那些局部信号与 `开始改` / `存` / `取消` / `丢掉` 函数。

- [ ] **Step 6: 跑组件测试，确认全绿**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/richtext-view.test.tsx
```

Expected: 全部 PASS。若「切去别的文件再回来」红在 `load` 被调用次数上，检查视图是不是在编辑态错挂了 `BinaryView`。

- [ ] **Step 7: 跑类型检查**

```bash
cd packages/app && bun run typecheck
```

Expected: 通过。特别留意 `center-content.test.tsx` 的 `save` 替身（Task 2 已补 `base`）。

- [ ] **Step 8: 提交**

```bash
git add packages/app/src/center/views/richtext-view.tsx packages/app/src/center/views/richtext-view.test.tsx
git commit -m "feat(richtext): 中栏文档改成常驻编辑的记事本

草稿按路径跨组件存活、自动保存、保存后不退出编辑态；工具栏接入
Markdown 动作、图片/附件引用与冲突处置。

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 9: 换项目清空草稿

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.tsx:510-517`（加 import）
- Modify: `packages/app/src/workspace/workspace-entry.test.tsx`

**Interfaces:**
- Consumes: `清空草稿()`、`开始编辑()`、`取草稿()`（Task 5）。

- [ ] **Step 1: 写失败用例**

在 `workspace-entry.test.tsx` 的「换项目清空中栏」那条下面加：

```tsx
  test("换项目也清空草稿：旧项目没保存的正文不跟着串到新项目", async () => {
    setCurrentProject(undefined)
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案]} />
      </WorkspaceEntry>
    ))
    await 冲一遍()

    开始编辑("卷宗/纪要.md", { content: "旧项目里没保存的字", base: "旧原文" })
    expect(取草稿("卷宗/纪要.md")?.content).toBe("旧项目里没保存的字")

    setCurrentProject({ id: "p2", name: "另一个案子" })
    await 冲一遍()

    expect(取草稿("卷宗/纪要.md")).toBeUndefined()
  })
```

顶部 import 加：

```ts
import { 取草稿, 开始编辑 } from "@/center/views/richtext/draft-store"
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx --test-name-pattern "换项目也清空草稿"
```

Expected: FAIL（草稿还在）。

- [ ] **Step 3: 实现**

`workspace-entry.tsx` 顶部 import 加：

```ts
import { 清空草稿 } from "@/center/views/richtext/draft-store"
```

清栏 effect 里加一行（`center.clear()` 之前）：

```ts
  let 上次清栏: string | undefined = undefined
  createEffect(() => {
    const id = currentProject()?.id
    if (id !== 上次清栏) {
      上次清栏 = id
      // 草稿按**路径**存，而路径只在项目内唯一：换了项目还留着旧草稿，下一次打开同名文件
      // 会看到上一个案子的字（用户实报「串项目」的同族）。与 `center.clear()` 同一拍。
      清空草稿()
      center.clear()
    }
  })
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/workspace/workspace-entry.test.tsx
```

Expected: 全部 PASS（含既有的换项目清中栏）。

- [ ] **Step 5: 提交**

```bash
git add packages/app/src/workspace/workspace-entry.tsx packages/app/src/workspace/workspace-entry.test.tsx
git commit -m "fix(richtext): 换项目时清空草稿，避免跨项目串正文

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 10: 真栈用例（自动保存 / 切文件草稿 / 冲突 / 显式预览）

**Files:**
- Modify: `packages/app/e2e/real-stack/richtext-edit-save-real.spec.ts`

**Interfaces:**
- Consumes: Task 8 的 DOM 契约。

- [ ] **Step 0: 让夹具能在开页前多写几个文件**

把 `开一篇md` 的签名与写盘段改成：

```ts
/**
 * 备一个项目、一篇 md（带信封地写到盘上），并在中栏把它打开。
 *
 * `同目录另写` 的键是**相对 `卷宗/` 的文件名**，值是要写的字节。必须**在 `进项目` 之前**
 * 写盘：文件树只在启动时与文件动作后取清单，页面跑起来之后往里塞文件它看不见；而
 * `page.reload()` 会清掉内存里的草稿，测「切文件草稿还在」时不能用重载来刷树。
 */
async function 开一篇md(
  page: Page,
  context: BrowserContext,
  项目名: string,
  同目录另写: Record<string, Buffer | string> = {},
) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "纪要.md"), 带信封)
  for (const [名, 内容] of Object.entries(同目录另写)) writeFileSync(path.join(目录, 名), 内容)
```

- [ ] **Step 1: 改「界面」读数与三条旧用例**

`界面()` 改成：

```ts
const 界面 = (page: Page) =>
  page.evaluate(() => {
    const 编 = document.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")
    const 钮 = (动作: string) => document.querySelector(`[data-action='${动作}']`) !== null
    return {
      编辑框在: 编 !== null,
      编辑框值: 编?.value ?? null,
      有编辑: 钮("edit"),
      有保存: 钮("save"),
      有预览: 钮("preview"),
      有重试: 钮("retry"),
      有载入盘上: 钮("load-disk"),
      状态: document.querySelector("[data-slot='richtext-save-state']")?.getAttribute("data-status") ?? null,
      说明: document.querySelector("[data-slot='richtext-editor-note']")?.textContent?.trim() ?? null,
      预览: document.querySelector("[data-component='richtext-view']")?.textContent ?? "",
    }
  })
```

「改一处存回去」那条：把「等回预览」的两句换成**等状态回 clean**，并断言仍在编辑态：

```ts
  // 等**可观测的完成**：状态回 clean（保存回包已经落到 store），而不是等界面退出编辑态。
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  await expect(page.locator("[data-slot='richtext-editor']")).toBeVisible()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/# 纪要\n\n第二行/)
```

「裸键盘打字」那条：把 `save` 之后等预览的那句换成同样的 `toHaveAttribute("data-status", "clean")`，然后 `toHaveValue(/补一句/)`。

「存完 ⇒ 回预览、编辑钮回来」整条替换为：

```ts
/**
 * 存完**留在编辑态**（2026-10-19 用户裁定：保存不再是「退出编辑」的同义词）。
 * 判据三件一起：编辑框还在、保存钮还在、状态回 clean。
 */
test("存完 ⇒ 留在编辑态、状态显示已保存", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·收尾·${Date.now()}`)

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n第二行")
  await 点钮(page, "save")

  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  const 现在 = await 界面(page)
  expect(现在.编辑框在).toBe(true)
  expect(现在.有保存).toBe(true)
  expect(现在.有编辑).toBe(false)
})
```

- [ ] **Step 2: 加四条新用例**

```ts
/**
 * 用户实报的第三条：没有自动保存。停手后不等点按钮，盘上就该有新字。
 */
test("停手后自动保存：不点保存，盘上也会出现新字", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·自动·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n自动保存进来的")

  await expect
    .poll(() => 读盘(甲.文件).toString("utf8"), { timeout: 15_000 })
    .toContain("自动保存进来的")
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean")
  expect(await page.locator("[data-slot='richtext-editor']").isVisible()).toBe(true)
})

/**
 * 用户实报的第一条：去开别的文件，回来没保存的字全没了。
 * 这一条必须**真的换 tab 再换回来**——组件重挂之后字还在，才说明草稿在组件之外。
 */
test("打了字去开另一篇、再切回来 ⇒ 没保存的字还在", async ({ page, context }) => {
  // 另一篇必须在开页前就写进盘：开页后重载会清掉内存草稿，这条就测不到东西了。
  await 开一篇md(page, context, `编辑·切回·${Date.now()}`, { "另一篇.md": "# 另一篇\n" })

  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n切走之前的字")

  await 行(page, "卷宗/另一篇.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-slot='richtext-editor']")).toBeHidden()

  // 中栏 tab 的定位口径见 `center-session-edit-real.spec.ts`（`data-slot='tab'` + 文件名）。
  await page.locator("[data-slot='tab']").filter({ hasText: "纪要.md" }).click()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/切走之前的字/, { timeout: 30_000 })
})

/**
 * 盘上被别人改了 ⇒ 保存不许覆盖，界面进冲突态并给「载入盘上版本」。
 */
test("盘上被改过 ⇒ 保存进冲突态，点「载入盘上版本」换成盘上那份", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·冲突·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")

  // 打开之后、第一次保存之前，别处把盘上那份改了（这就是服务端 `base` 比的「变了没有」）。
  writeFileSync(甲.文件, "# 纪要\n\n别人改的\n", "utf8")

  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n我改的")
  await page.keyboard.press("Control+s")

  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "conflict", {
    timeout: 30_000,
  })
  await expect(page.locator("[data-action='retry']")).toBeVisible()
  await expect(page.locator("[data-action='load-disk']")).toBeVisible()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/我改的/)

  await 点钮(page, "load-disk")
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/别人改的/, { timeout: 30_000 })
})

/**
 * 保存不再退出编辑态之后，「回预览」是一条显式动作：先存、再切。
 */
test("点「预览」⇒ 保存后回预览，预览里是新正文", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·预览·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n预览里的新正文")
  await 点钮(page, "preview")

  await expect(page.locator("[data-component='richtext-view']")).toContainText("预览里的新正文", { timeout: 30_000 })
  expect(await page.locator("[data-slot='richtext-editor']").isVisible()).toBe(false)
  await expect
    .poll(() => 读盘(甲.文件).toString("utf8"), { timeout: 15_000 })
    .toContain("预览里的新正文")
})

/**
 * 预览里的项目内图片必须**真的显示出来**：`<img src="图.png">` 原样交给浏览器会去请求
 * 应用前门（404），`naturalWidth` 恒 0——这正是补丁要证明的事（spec §8.2）。
 */
test("预览里的项目内图片经 load 取字节后真的画出来（naturalWidth > 0）", async ({ page, context }) => {
  // 1×1 的合法 PNG。
  const 一像素 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  await 开一篇md(page, context, `编辑·图片·${Date.now()}`, {
    "图.png": 一像素,
    "带图.md": "# 图\n\n![图](图.png)\n",
  })

  await 行(page, "卷宗/带图.md").dblclick()
  const 图 = page.locator("[data-component='richtext-view'] img")
  await expect(图).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => 图.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)
})

/**
 * 预览里点**相对链接**不许把整个工作区导航走——那会把正在做的事（草稿、tab、会话）全丢。
 */
test("预览里点相对链接 ⇒ 不整页跳走", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·链接·${Date.now()}`, {
    "另一篇.md": "# 另一篇\n",
    "带链.md": "# 链\n\n[另一篇](另一篇.md)\n",
  })

  await 行(page, "卷宗/带链.md").dblclick()
  await expect(page.locator("[data-component='richtext-view'] a")).toBeVisible({ timeout: 30_000 })
  const 原址 = page.url()

  await page.locator("[data-component='richtext-view'] a").click()
  await page.waitForTimeout(300)

  expect(page.url()).toBe(原址)
})

/**
 * 「撤销钮真的回退」——`execCommand("undo")` 之后不把 textarea 的值同步回 store 的实现在这里红。
 * ⚠️ 用的是真键盘打字（`fill` 不产生撤销历史）；撤销分组由浏览器定，若这条偶发红，
 * 先重跑确认，再按 spec §13 退回 store 内历史栈（那一版不需要 execCommand）。
 */
test("撤销钮真的把刚打的字退回去", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·撤销·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  const 框 = page.locator("[data-slot='richtext-editor']")
  await 框.click()
  await page.keyboard.press("Control+End")
  const 原值 = await 框.inputValue()

  await page.keyboard.type("追加")
  await expect(框).toHaveValue(原值 + "追加")

  await 点钮(page, "undo")
  await expect(框).toHaveValue(原值, { timeout: 10_000 })
})
```

- [ ] **Step 3: 跑真栈**

先看端口有没有被残留栈占住（不要杀进程；占住就换 `REAL_STACK_FRONT_PORT`）：

```bash
netstat -ano | grep -E ':(3010|4711)\s' || true
```

Run:

```bash
cd packages/app && E2E_BROWSER=C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe \
  bunx playwright test --config e2e/real-stack/playwright.config.ts e2e/real-stack/richtext-edit-save-real.spec.ts
```

Expected: 全部 PASS。首次跑会起真栈，留足 180s。

若 `3010` / `4711` 被占，换：

```bash
cd packages/app && REAL_STACK_FRONT_PORT=3011 \
  E2E_BROWSER=C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe \
  bunx playwright test --config e2e/real-stack/playwright.config.ts e2e/real-stack/richtext-edit-save-real.spec.ts
```

（内核端口由 `stack.ts` 从 `REAL_STACK_KERNEL_PORT` 读，若也需换，一并带上。）

- [ ] **Step 4: 提交**

```bash
git add packages/app/e2e/real-stack/richtext-edit-save-real.spec.ts
git commit -m "test(richtext): 真栈钉自动保存、切文件草稿、冲突与显式预览

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## Task 11: 门禁、变异验证与对账

**Files:** 无新增；只跑命令、必要时修。

- [ ] **Step 1: 受影响 package 的单测**

```bash
cd packages/opencode && bun test test/server/openhive-file-ops.test.ts
```

```bash
cd packages/app && bun test --conditions=solid --preload ./happydom.ts \
  src/center/views/richtext/markdown-actions.test.ts \
  src/center/views/richtext/richtext-path.test.ts \
  src/center/views/richtext/draft-store.test.ts \
  src/project/openhive-file-ops.test.ts \
  src/project/openhive-file-saver.test.ts
```

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts \
  src/center/views/richtext-view.test.tsx src/workspace/workspace-entry.test.tsx
```

Expected: 三组都 0 fail。

- [ ] **Step 2: 类型检查与 lint（仓库根）**

**三条命令各自从仓库根开始执行**（不要串成一条链——第一条 `cd` 之后，第二条的相对路径就落到 `packages/app` 里了，`LEARNINGS #004-10`）：

```bash
cd packages/app && bun run typecheck
```

```bash
cd packages/opencode && bun run typecheck
```

```bash
bun run lint
```

Expected: typecheck 退出 0；lint 对**本次改动文件**0 错误。若 lint 报的错在未改动文件里（例如 `packages/session-ui/...` 的既有告警），如实记下「既有、非本次引入」，不要顺手改。

- [ ] **Step 3: 变异验证（每条拆一处，确认对应用例红）**

逐条做，做完立刻还原：

| 拆掉哪一行 | 哪条用例必须红 | 记下红在哪句（`LEARNINGS #003-03`） |
|---|---|---|
| `draft-store.ts` 成功分支里的 `base: 结论.base` 改成 `base: 存的内容.trim()` | `draft-store.test.ts`「停手后保存…回包里的 base」 | `expect(项.base).toBe("甲\r\n乙")` |
| `draft-store.ts` 的 `if (旧.status === "conflict") return { ...旧, content, selection }` 删掉（改成照常 dirty） | 「STALE ⇒ conflict，且继续打字也不再发请求」 | 第二次请求数从 1 变 2 |
| `draft-store.ts` 的 `清空草稿` 里 `clearTimeout` 循环删掉 | 「清空草稿会取消定时器」 | `收到` 长度 0 → 1 |
| `draft-store.ts` 的 `if (代 !== 代次) return false` 删掉 | 「清空草稿作废在飞的回包」 | `取草稿` 不再是 undefined |
| `draft-store.ts` 的 `记盘上版本` 里 `if (旧.base === 盘上.base) return 旧` 改成直接覆盖 | 「编辑态的底本变了 ⇒ conflict」 | `content` 从「我改的」变成「别人改的」 |
| `workspace-entry.tsx` 的 `清空草稿()` 删掉 | workspace 的「换项目也清空草稿」 | `取草稿` 仍有值 |
| `richtext-view.tsx` 的 `when={改着()}` 改成 `when={false}`（永远预览） | 「切去别的文件再回来 ⇒ 没保存的字还在」 | 回来时没有编辑框 |
| `markdown-actions.ts` 的 `已包住` 里 `if (开 === "*" && …)` 删掉 | 「粗体里的选区按斜体」 | 结果多一层星号 |
| `richtext-view.tsx` 的 `onKeyDown` 里 Ctrl+S 分支删掉 | 「Ctrl+S 立刻保存」 | `交出去的` 长度 0 |
| `richtext-view.tsx` 的 `onKeyDown` 里 Ctrl+K 分支删掉 | 「Ctrl+K 插入链接占位」 | 编辑框里没有 `[](url)` |
| `richtext-view.tsx` 里把自动保存定时器改挂到 `onCleanup(() => 设自动保存参数(...))` 式的组件清理 | 「打完字立刻切走（卸载）⇒ 到点仍然自动保存」 | `交出去的` 长度 0 |

**拆不动的三条，如实记缺口（`LEARNINGS #003-03` 第三类）：**

- `draft-store.ts` 的 `排` 里 `if (项.status === "conflict") return`：定时器到点调的是**非强制**的 `立即保存`，而它自己也有一道 conflict 守卫（`if (项.status === "conflict" && !强制) return false`）⇒ 单独拆掉 `排` 这一行，行为不变、红不出来。它是**冗余防线**，保留但不作为变异项。
- `document.execCommand` 的撤销在 happy-dom 里不可用，组件层测不了 ⇒ 只由真栈「撤销钮真的把刚打的字退回去」钉；`同步框()` 这一行在真浏览器里即使删掉也可能绿（Chromium 会派 `input`），所以**不作为变异项**，只作为兜底保留。
- 「自动保存定时器活在组件外」用行为用例钉住（卸载后仍保存），不去硬拆实现——拆法不唯一，红法不可复现时不写「已验证」。

每条把**实际**红的那句记进提交信息或进度记录；红不出来就是测试没钉住，补测试再说。

- [ ] **Step 4: 真栈全量回归本 spec**

再跑一次 Task 10 的命令（含新增四条与既有六条）。Expected: 全绿。

- [ ] **Step 5: 对账 spec 的完成判据（§14）**

逐条打勾，把证据（命令 ＋ 输出）写进最终回复：

- [ ] 编辑态的草稿在切换文件 / 分屏 / 切 tab 后仍在（组件测试 + 真栈）。
- [ ] 保存后留在编辑态，不再需要重复点「编辑」（组件测试 + 真栈）。
- [ ] 停手 800ms 自动保存；连续输入最长 5s 必存（store 单测）。
- [ ] 保存成功用服务端回报的 `base`；CRLF 文件连存两次不假冲突（服务端单测 + store 单测）。
- [ ] 冲突进 `conflict`、暂停自动保存、可载入盘上版本（store 单测 + 真栈）。
- [ ] 工具栏动作齐全：保存、预览、撤销、重做、粗体、斜体、删除线、H1-H6、无序/有序列表、分隔线、链接、行内代码、代码块、表格、引用、图片、附件（视图测试 + 纯函数测试）。
- [ ] 预览里相对图片经 `load` 显示；相对链接不整页跳走（视图测试 + 真栈可选）。
- [ ] 换项目清空草稿（workspace 测试）。
- [ ] `git diff --stat bun.lock` 为空（没跑 `bun install`）。

- [ ] **Step 6: 提交（若 Step 3-5 有修补）**

```bash
git add -A
git commit -m "test(richtext): 门禁与变异验证收尾

这是要保留的定制（openhive 中栏 Markdown 编辑器）。"
```

---

## 不做（与 spec §12 一致）

- 模板 / 保存为模板（P1）。
- 引用式链接（reference link）语法（P1）。
- 粘贴图片自动上传（P1，需要文件上传出口）。
- WYSIWYG / CodeMirror（路线已裁定：源码 textarea ＋ 工具栏 ＋ 预览切换）。
- 正文里跨文件的链接跳转（本期只拦默认行为，不猜路由）。
- 多设备 / 跨会话的草稿恢复（草稿是内存态，刷新即丢；自动保存把已保存的部分落到盘上）。
