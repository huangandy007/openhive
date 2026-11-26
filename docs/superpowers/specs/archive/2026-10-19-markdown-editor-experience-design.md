# OpenHive 中栏 Markdown 编辑体验设计

- **日期**：2026-10-19
- **状态**：已逐节确认（2026-10-19 用户确认），待实现计划
- **分支**：`multi-tenant`
- **性质**：本仓定制（openhive），提交信息须标注「这是要保留的定制」
- **关联**：`2026-10-12-中栏文件浏览与分屏-design.md`（中栏 Tab / 分屏）、`2026-10-14-send-to-session-design.md`（拖拽载荷）、`2026-10-18-sheet-excel-like-browsing-design.md`（同为「视图状态活在组件外」的同类问题）
- **上游约束**：不引入新依赖；不碰上游 `center-content.tsx` / `center-split.tsx` / `tab-store.ts` / `tab-bar.tsx` / `binary-view.tsx`；服务端只改 openhive 自己的 `packages/opencode/src/server/openhive/file.ts`

---

## 0. 一句话

把中栏的 `.md` / `.txt` 从「文档查看器」改造成**一直可编辑的笔记本**：草稿不随 tab / 分屏丢，保存不退出编辑，停手自动落盘，工具栏覆盖日常够用的 Markdown 动作。

---

## 1. 背景：用户原话与诉求映射

2026-10-19 用户反馈（逐条保留原意）：

1. 记录了很多文字，打开其他文件 / 做分屏后，**md 里没保存的信息全部清除了**，必须重新输入；
2. 点保存后文件**跳回非编辑状态**，要反复点「编辑」「保存」；
3. **没有自动保存**；
4. 编辑时**没有 md 编辑功能**（保存、保存为模版、撤销、重做、粗体、斜体、删除线、标题一到六、无序/有序列表、分隔线、链接、引用链接、图片、行内代码、代码块、表格、引用、附件等），但「不是全部要有，日常够用即可」。

映射到本期能力：

| 诉求 | 能力 |
|---|---|
| 1 | 草稿按路径常驻（模块级 store），切 tab / 分屏 / 开别的文件都不丢 |
| 2 | 编辑态常驻；保存是就地动作；编辑/预览是独立开关 |
| 3 | 停止输入 800ms 自动保存；连续输入每 5s 兜底；`Ctrl/Cmd+S` 立即保存 |
| 4 | 工具栏 + 快捷键，覆盖日常动作；进阶项（模版、引用链接、粘贴上传）暂缓 |

**用户已拍板**：编辑器走「源码 + 工具栏 + 预览开关」，不引入 CodeMirror，不做 WYSIWYG；P1 全部暂缓。

---

## 2. 事实核查（现状与根因）

### 2.1 草稿为什么丢

- 草稿是**组件内信号**：`packages/app/src/center/views/richtext-view.tsx:185-188`（`底本` / `草稿` / `改着`）。
- 视图由 `packages/app/src/center/center-content.tsx:211-218` 的 keyed `<Show>` 挂载；判定「还是同一份」只看 `Component + path + 代`（`center-content.tsx:105-112`）。
- ⇒ 切到另一张 tab，或在这一栏打开另一个文件，`path` 变 ⇒ **整个视图卸载重挂** ⇒ 草稿归零。
- 分屏本身用 `display:none` 保节点（`center-split.tsx:148-170`），不重挂；但分屏后「打开文件」落在**受焦栏**（`workspace-entry.tsx:170` 一带），受焦的若正是正在编辑那栏，就会把它顶掉。
- AI 改过文件后点带圆点的 tab 会推进「重载代」（`session-edits.ts:90-97`）⇒ 同样重挂 ⇒ 草稿也会丢。

### 2.2 保存为什么退出编辑

`richtext-view.tsx:241` 存成功后 `set改着(false)`——这是「文档查看器」的语义（存完回预览）。

### 2.3 为什么没有自动保存

只有显式 `存()`（`richtext-view.tsx:220-250`），没有任何定时或失焦保存。

### 2.4 为什么没有编辑能力

编辑面是一个裸 `<textarea>`（`richtext-view.tsx:341-347`）；工具栏只有 编辑 / 保存 / 取消 / A±（`279-302`）。

### 2.5 外部约束

- 保存已有并发保护：读口回 `content: text.trim()`（`handlers/file.ts` 的 `content`），写口按 `base` 比对（`openhive/file.ts:948`）。
- 写口会把 BOM / 首尾空白 / 行尾风格按盘上原样裹回去（`openhive/file.ts:950-961`）；textarea 的 API 值是 LF。⇒ 前端**不能**用 `content.trim()` 猜新 base，否则 CRLF 文件第二次保存必假冲突。
- 左侧文件树起拖载荷是 `file:<路径>`（`components/file-tree.tsx:159` / `file-tree-v2.tsx:94`），已有现成记号。
- 当前项目文件清单已在模块级缝 `@/project/project-files` 的 `projectFiles()` 里，工具栏做文件选择器可直接读，不必新拉取数口。

---

## 3. 目标与非目标

### 3.1 目标

1. 草稿常驻：切 tab、分屏、开别的文件、进预览都不丢，回来恢复正文与光标。
2. 编辑态常驻：保存不退出编辑；工具栏显示保存状态。
3. 自动保存：停手落盘；冲突不覆盖、不丢字。
4. 日常够用的 Markdown 工具栏 + 快捷键。
5. 预览显示当前草稿（切预览前已 flush）。
6. 改动面尽量小：视图内部重写 + 一处项目切换清空 + 写口一个小字段。

### 3.2 非目标

- 保存为模版、从模板新建；
- 引用式链接（`[文字][id]` + `[id]: url`）；
- 粘贴图片自动上传；
- WYSIWYG、语法高亮、多光标、可视化表格编辑；
- 表格增删行列、图片缩放、版本历史；
- 跨浏览器刷新保留草稿（自动保存已把落盘窗口压到 5s 内）；
- 关闭 tab 时的未保存拦截（正常路径已由自动保存覆盖；冲突态草稿留在 store，重开同一文件可见）。

---

## 4. 状态模型与草稿存储

新增 `packages/app/src/center/views/richtext/draft-store.ts`。**模块级信号**，按项目相对路径存，写法与 `session-edits.ts` 同族（组件测试用 `清空草稿()` 收尾）。

```ts
export type 草稿状态 = "clean" | "dirty" | "saving" | "error" | "conflict"

export interface 草稿 {
  path: string
  content: string            // 编辑器手上这份
  base: string               // 盘上那份原样（保存并发基准）
  mode: "edit" | "preview"
  status: 草稿状态
  savedAt?: number
  message?: string           // 服务端拒绝原话 / 冲突说明
  selection: { start: number; end: number }
  save?: SaveFileContent     // 视图挂载时注入；卸载后自动保存仍能跑
  load?: LoadFileContent
}
```

### 4.1 对外接口

```ts
取草稿(path): 草稿 | undefined
登记出口(path, 出口: { save?: SaveFileContent; load?: LoadFileContent }): void
开始编辑(path, 初始: { content: string; base: string }): void
改草稿(path, content: string, selection: { start: number; end: number }): void
立即保存(path): Promise<boolean>
切预览(path): Promise<boolean>
记盘上版本(path, 盘上: { content: string; base: string }): void
清空草稿(): void
设自动保存参数(参数: { 延迟?: number; 上限?: number } | undefined): void  // 测试注入，生产默认 800 / 5000
```

- 视图挂载时调 `登记出口`，把注入的 `save` / `load` 存进条目；条目已存在就更新出口，不重置内容。
- `开始编辑`：条目已存在就保留 `content` / `selection`，只把 `mode` 改成 `edit`；条目不存在才用传进来的 `content/base` 建条目。

### 4.2 生命周期

- 第一次打开文件：视图挂载时 `登记出口`；预览态下 `BinaryView` 读回内容后调 `记盘上版本`，store 建条目（`mode: "preview"`，`status: "clean"`）。
- 点「编辑」：`开始编辑`；条目已存在就保留正文与光标，只改 `mode`，没有条目才用 `content = base` 建。
- 切走再回来：视图重挂，store 条目还在 ⇒ 直接按 `mode` 渲染，正文与光标原样恢复。
- 换项目：`workspace-entry.tsx` 现有的「项目变了就 `center.clear()`」effect 里，**先 `清空草稿()` 再 `center.clear()`**——先取消定时器，避免拿旧项目倒计时去存。
- 草稿条目活到换项目为止；正常保存后也不主动删（同一文件再打开直接复用，代价是一份文本的内存）。v1 不做淘汰。

### 4.3 同一文件在两栏打开

共享同一份草稿：盘上只有一个文件，不能有两个真相。拖动分屏不会重挂视图；两栏都按 store 渲染。

---

## 5. 保存语义与自动保存

### 5.1 状态机

```
preview ──点编辑──▶ edit(clean)
edit(clean) ──输入──▶ dirty ──800ms/5s──▶ saving ──成功──▶ clean
                                          saving ──STALE──▶ conflict
                                          saving ──其它拒──▶ error
dirty ──切预览──▶ 立即保存：成功才切 preview；失败留在 edit 并显示说法
error/conflict ──用户点重试──▶ saving
```

- **编辑态常驻**：`mode` 按路径记住；保存只改 `status`，不动 `mode`。
- **保存中再编辑**：`saving` 期间收到输入 ⇒ 内容更新、状态回到 `dirty`，当前这一笔完成后若内容已变，再排一次保存。
- **重入守卫**：同一路径同时只有一笔保存在飞（事件处理器里守卫，不靠置灰按钮——`LEARNINGS #006-16`）。

### 5.2 自动保存节奏

- 停止输入 **800ms** 落盘；
- 连续输入时**最多每 5s** 落一次（上限丢字窗口）；
- `Ctrl/Cmd+S`：立即 flush，重置定时器；
- 切预览：先 `await 立即保存`，成功才切；
- 视图卸载**不取消**定时器：定时器活在 store 里，切 tab 后照样到点保存；
- 换项目：`清空草稿()` 取消全部定时器。

### 5.3 base 由写口回报，不靠前端猜

- 写口 `handleWrite` 成功时返回 `{ path, base: 落盘.trim() }`。`落盘` 是刚写下去的完整文本（含 BOM / 首尾空白 / 行尾风格），`.trim()` 与读口 `content: text.trim()` 完全同口径。
- 原因：textarea 交 LF，服务端按盘上多数派把行尾还原成 CRLF；用 `content.trim()` 当新 base 会在第二次保存时假冲突。
- 写口在 openhive 自己的模块，不增加上游冲突面。

### 5.4 冲突（STALE）

- 写口对陈旧回中文原话 + 机器可读 `code: "STALE"`（`badRequest(message, "STALE")`）。
- 客户端把 `code` 带到 `SaveFileResult.ok === false` 上；store 据此置 `conflict`，**暂停自动保存**。
- 草稿原样留着；提示条显示服务端原话，提供：
  - 「重试」：再存一次；
  - 「载入盘上版本」：确认后调条目里登记的 `load(path)` 重新取盘上正文，取到才 `content = base = 盘上正文` 并回到 `clean`；取不到（读失败）就不动草稿、只报错。用户可先把正文复制走；
  - 编辑框本身可选中复制。
- v1 不做「另存冲突副本」（P1）。

### 5.5 AI 改了同一份文件

- 预览态、无未保存改动：`记盘上版本` 直接换新（现有圆点重载行为保留）。
- **编辑态 / 有未保存改动**：`记盘上版本` 发现盘上正文与 `base` 不同 ⇒ 不更新 `base`，置 `conflict` 并提示。绝不出现「自动保存静默盖掉 AI 的改动」。
- 编辑态且视图没重挂时，`onContent` 不会回来；由下一次自动保存撞 STALE 暴露，结局相同：草稿不丢。

---

## 6. 编辑器动作（纯函数）

新增 `packages/app/src/center/views/richtext/markdown-actions.ts`。输入输出都是纯数据，不碰 DOM：

```ts
export interface 编辑快照 { value: string; start: number; end: number }

export function 包裹(快照: 编辑快照, 动作: "bold" | "italic" | "strike" | "code" | "link"): 编辑快照
export function 切行首(快照: 编辑快照, 动作: "h1" | ... | "h6" | "ul" | "ol" | "quote"): 编辑快照
export function 插入(快照: 编辑快照, 动作: "hr" | "code-block" | "table"): 编辑快照
export function 插入引用(快照: 编辑快照, 动作: "image" | "attachment", 路径: string, 文字?: string): 编辑快照
```

语义：

| 动作 | 有选区 | 无选区 |
|---|---|---|
| bold / italic / strike / code | 包住并选中原文；已包住则拆掉 | 插入标记，光标放中间 |
| link | `[原文](url)`，选中 `url` 占位 | `[](url)`，光标在 `[]` 内 |
| h1–h6 | 选区内逐行：先剥掉已有 `#{1,6} `，再按同级切换（同级再点 = 退回正文） | 当前行 |
| ul / ol | 逐行切换 `- ` / `1. `；有序列表重编号 | 当前行 |
| quote | 逐行切换 `> ` | 当前行 |
| hr | 插入 `---`，保证前后空行 | 同左 |
| code-block | 用 ``` 围住选区 | 插入空代码块，光标在围栏内 |
| table | 插入 `列1/列2` 两列表头 + 分隔行 + 一行空行，选中 `列1` | 同左 |
| image | `![原文](路径)` | `![](路径)` |
| attachment | `[原文](路径)`（原文缺省取文件名） | `[文件名](路径)` |

- 标记切换必须精确：`italic` 不能把 `**粗体**` 误判成已加斜体（检查单 `*` 且相邻不是 `*`）。
- 多行操作只处理选区覆盖的行；空行跳过行首标记（列表/标题），避免往空行塞 `- `。

---

## 7. 工具栏与快捷键

新增 `packages/app/src/center/views/richtext-toolbar.tsx`。

### 7.1 渲染条件

- 只有注入了 `save` 的宿主才渲染（storybook / 只读宿主 DOM 不变）；
- `.md`：完整工具栏；
- `.txt`：只保留 撤销/重做、编辑/预览、保存、保存状态、A±（纯文本没有 Markdown 动作）。

### 7.2 布局（一行，窄栏允许换行）

```
撤销 重做 | B I S | 标题▾ | 无序 有序 引用 — | <> ``` | 链接 表格 | 图片 附件 | 保存 | 预览
右侧：A- A+  状态文字
```

- 最右那颗是**模式开关**：编辑态显示「预览」，预览态显示「编辑」。
- 预览态且还没读到内容（`base` 未就位）时，「编辑」不渲染——沿用现有「底本没到位一颗编辑钮都不给」的行为。
- 进编辑态后聚焦 textarea，并恢复 store 里记的光标位置；没有记录时落到正文末尾。
- 标题用原生 `<select>`：正文 / H1 / H2 / H3 / H4 / H5 / H6（可访问、零依赖）。
- 每个按钮带 `data-action`，供组件测试与真栈定位。
- 按钮 `onMouseDown={e => e.preventDefault()}`：编辑框不失焦、选区不丢。
- 状态文字：`已保存 14:32` / `保存中…` / `未保存` / `保存失败：<服务端原话>` / `盘上已改动，自动保存已暂停`。
- 冲突时在工具栏下方显示提示条（沿用现有 `richtext-editor-note` 的位置）。

### 7.3 快捷键（在 textarea 上）

| 键 | 动作 |
|---|---|
| `Ctrl/Cmd+S` | 立即保存 |
| `Ctrl/Cmd+B` | 粗体 |
| `Ctrl/Cmd+I` | 斜体 |
| `Ctrl/Cmd+K` | 链接 |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | 原生撤销 / 重做（不拦截） |

- `mod` = `metaKey || ctrlKey`。
- 撤销/重做工具栏按钮：先聚焦 textarea，再 `document.execCommand("undo"/"redo")`；调用后用微任务读一次 `textarea.value` 与选区同步进 store（兼容不派 `input` 的情况）。真栈验不过再退回 store 内历史栈。

### 7.4 图片 / 附件

- **拖入**：从左侧文件树拖到编辑框，沿用 `file:<路径>` 载荷；textarea 上要有 `onDragOver` 的 `preventDefault`（否则浏览器不允许 drop），drop 时读 `text/plain`、剥掉 `file:` 前缀。图片扩展名（`.png .jpg .jpeg .gif .webp .bmp .svg`）插 `![](路径)`，其它插 `[文件名](路径)`；文件名取路径最后一段。
- **按钮**：打开一个轻量文件选择弹层，读 `@/project/project-files` 的 `projectFiles()`，搜索 + 点选。目录项不可选。
- 插入的是**项目相对路径**；路径口径与中栏 tab 的 `path` 一致。

---

## 8. 预览

### 8.1 模式切换

- `mode === "edit"`：渲染 textarea（内容来自 store）。
- `mode === "preview"`：渲染现有 `BinaryView`（读盘、`marked` + DOMPurify）。
- 切预览前 flush；所以预览看到的是刚存下的正文，不会出现「预览是旧版」。
- 切回编辑：store 里的 `content` / `base` 已在保存成功时对齐，不需要重新读盘。

### 8.2 图片渲染（必要补丁）

`marked` 产出的 `<img src="附件/图.png">` 会被浏览器当成应用 URL 请求，项目内图片显示不出来。故 `renderMarkdown` 增加可选第三参：

```ts
renderMarkdown(bytes, container, 选项?: { path?: string; load?: LoadFileContent })
```

- 解析净化的 HTML 挂进容器后，对每个 `<img>`：
  - 绝对 `http(s)` / `data:` / `blob:` 原样保留；
  - 项目相对路径（含以 `/` 开头的项目根写法）经 `解析项目路径(当前文件目录, href)` 归一，再用 `load` 取字节；
  - 取到二进制 ⇒ `new Blob([bytes], { type: mimeType ?? 按扩展名猜 })` ⇒ `URL.createObjectURL` ⇒ 写回 `src`；
  - 取不到 ⇒ 保留原 `src`（浏览器自然显示破图，不阻塞正文）。
- 返回 cleanup：撤销所有 object URL；异步链用一个 `alive` 标志，cleanup 后到点的结果立即 revoke。
- `renderMarkdown` 的渲染器身份必须**稳定**：在 `RichtextView` 里用 `createMemo` 按 `path/load` 缓存闭包，避免 `BinaryView` 的 effect 因 `props.render` 每次换身份而重跑重读（`binary-view.tsx:120-177`）。

### 8.3 链接点击

- 挂一个容器级点击监听（cleanup 时摘掉）：
  - `http(s)` / `mailto` ⇒ `preventDefault` + `window.open(href, "_blank", "noopener,noreferrer")`；
  - 项目相对路径 ⇒ `preventDefault`，v1 不跳转（避免整页导航丢掉工作区状态；下一版再接「在中栏打开」）。
- 理由：当前预览里点链接会把整个应用导航走，正文与草稿全丢——与本期主题直接冲突。

---

## 9. 写口与接缝改动

### 9.1 服务端（openhive 自有模块）

`packages/opencode/src/server/openhive/file.ts`：

- `badRequest(message, code?)` ⇒ body 增加可选 `code`；
- `handleWrite` 陈旧：`badRequest(STALE, "STALE")`；
- `handleWrite` 成功：返回 `{ path, base: 落盘.trim() }`（其余出口仍走 `Made`）。

### 9.2 客户端接缝

`packages/app/src/center/file-content.ts`：

```ts
export type SaveFileResult =
  | { ok: true; base: string }
  | { ok: false; message: string; code?: string }
```

`packages/app/src/project/openhive-file-ops.ts`：`FileOpOutcome` 的 `done` 带可选 `base`、`rejected` 带可选 `code`；`outcomeOf` 从响应体读。

`packages/app/src/project/openhive-file-saver.ts`：成功透传 `base`（旧内核没回时兜底 `content.trim()`）；拒绝透传 `code`。

### 9.3 视图

`packages/app/src/center/views/richtext-view.tsx` 变薄：

- 读 store；按 `mode` 渲染 textarea 或 `BinaryView`；
- `onContent` ⇒ `记盘上版本`；
- 工具栏、快捷键、图片/附件插入接线；
- 保留现有阅读字号（`--richtext-size`）与 `.txt` 纯文本渲染。

### 9.4 项目切换

`packages/app/src/workspace/workspace-entry.tsx` 的「项目变了」effect 加一行 `清空草稿()`，放在 `center.clear()` 之前。

---

## 10. 错误处理与边界

- **保存被拒**：状态 `error`，显示服务端原话；不自动重试，下一次输入或点保存再试。
- **保存抛错**（网络断）：同上，`console.warn` 留痕（现有做法）。
- **没项目 / 没 save**：不排自动保存；工具栏照旧只在有 `save` 时出现。
- **binary 文件**：沿用现有「底本 undefined ⇒ 一颗编辑钮都不给」。
- **文件被外部删除**：服务端回「文件不存在」，进入 `error`，草稿保留。
- **CRLF / BOM**：base 由写口回报，前端不猜；测试覆盖 CRLF 文件连续两次保存。
- **IME 组合输入**：不特殊处理；800ms 静默后才保存，组合串中间态即使落盘也会被后续输入覆盖。
- **空文件**：`base = ""`，首次保存合法（服务端 `文本.trim() === base`）。
- **超大文件**：不做额外限制；textarea 在几 MB 内可用，超出留给下一版。

---

## 11. 测试策略

### 11.1 纯函数单测

`markdown-actions.test.ts`：

- 每个动作 × 有/无选区；
- 多行标题/列表/引用；空行；有序列表重编号；
- 切换语义（再点一次拆掉）；
- `**粗体**` 不被 italic 误判；
- CRLF 输入不把 `\r` 带进插入结果；
- 表格骨架、代码块、链接占位、图片/附件路径。

`richtext-path.test.ts`（若路径解析独立成文件）：

- `./`、`../`、以 `/` 开头的项目根写法、中文名、百分号编码；
- 越出项目根 ⇒ `undefined`；
- `http(s)` / `data:` / `blob:` / `#anchor` ⇒ `undefined`（不当作项目文件）。

### 11.2 草稿 store 单测

- 800ms 后保存；连续输入最多 5s 一次；`立即保存` 重置定时器；
- 保存中再编辑 ⇒ 完成后补存；
- 成功 ⇒ `base` 用写口回报值；
- STALE ⇒ `conflict` + 暂停；
- 其它拒 ⇒ `error` + 暂停；
- `记盘上版本`：clean 换新；dirty 且盘上变了 ⇒ `conflict` 且不覆盖 base；
- 视图卸载后定时器仍触发（用注入的 0ms 参数 + 手动 flush 验）；
- `清空草稿` 取消全部定时器。

### 11.3 组件测试

`richtext-view.test.tsx`（更新现有用例，保留阅读字号、净化、binary 不可编辑等）：

- 编辑 → 输入 → 切到另一个 path 再切回：正文与光标还在；
- 保存后仍在编辑态；
- 自动保存真的调用注入的 `save`（参数是 `path/content/base`）；
- 工具栏粗体包选区，再点拆掉；
- `Ctrl+S` 调 save；
- 切预览前 flush；保存失败不切；
- 冲突提示出现、草稿仍在；
- `.txt` 不渲染 Markdown 工具栏。

### 11.4 真栈 E2E

`e2e/real-stack/richtext-editor-real.spec.ts`：

- 输入 → 等自动保存 → 直接查盘（内核读口）确认正文变了；
- 切 tab 再回来：正文与光标在；
- 点保存：仍在编辑态；
- 粗体包选区的 DOM 结果；
- 撤销按钮真的回退；
- 预览显示当前草稿；
- 项目内图片在预览里真的显示（`<img>` 的 `naturalWidth > 0`）；
- 外部链接点击不导航走当前页（`window.open` 替身或新页计数）。

### 11.5 变异验证（关键用例）

- 去掉 `dirty` 判断 ⇒ 「AI 改动不覆盖草稿」用例必须红；
- 把定时器移回组件 `onCleanup` ⇒ 「切 tab 后仍保存」必须红；
- 去掉 `base` 回报、改用 `content.trim()` ⇒ CRLF 连续保存用例必须红；
- 去掉 `execCommand` 后的 DOM 同步 ⇒ 撤销用例必须红。

### 11.6 门禁

- `cd packages/app && bun test src/center/views/richtext*`：0 失败；
- 受影响 package 的 typecheck（`packages/app`、`packages/opencode`）；
- 仓库根 `bun run lint`（或对改动文件跑 oxlint）：0 新增错误；
- 真栈 spec 通过。

---

## 12. 明确不做（P1，后续单独立项）

- 保存为模版 / 从模板新建；
- 引用式链接；
- 粘贴图片自动上传；
- WYSIWYG、语法高亮、多光标；
- 可视化表格编辑、图片缩放；
- 冲突副本另存；
- 跨刷新草稿恢复、关闭 tab 拦截。

---

## 13. 风险与缺口

| 风险 | 处置 |
|---|---|
| `document.execCommand` 在新浏览器被移除 | 真栈先验；不行退回 store 内历史栈（影响仅撤销/重做按钮） |
| 图片 `load` 返回 text（误判）| 只在 `decodeBytes` 成功且 `mimeType` 像图片时用 object URL；否则保留原 src |
| 两栏同文件预览与编辑短暂不一致 | 自动保存 800ms 内收敛；冲突时以 store 为准并提示 |
| 旧内核没回 `base` | `createSaveProjectFile` 兜底 `content.trim()`；日志留痕，CRLF 文件可能假冲突 |
| 草稿只活在内存 | 自动保存把丢字窗口压到 5s 内；刷新前最多丢最近一段；已登记为缺口 |

---

## 14. 完成判据（开工前用户认可）

1. 单测与组件测试全绿（§11.1–11.3），且关键变异按 §11.5 变红；
2. `packages/app` / `packages/opencode` typecheck 通过；
3. 改动文件 oxlint 0 新增错误；
4. 真栈 spec（§11.4）通过，并把实际输出贴进验收记录；
5. 老行为不回归：binary 不可编辑、阅读字号、DOMPurify 净化、`.txt` 纯文本渲染、分屏不重挂。
