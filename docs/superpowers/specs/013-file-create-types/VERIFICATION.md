# 013 · 验收记录

**日期**：2026-11-16　**分支**：`worktree-013-file-create-types`（基线 `557f778b97` = `multi-tenant`）

## 1. 门禁实得（本机，均 `timeout 300`）

| 项 | 命令 | 实得 |
|---|---|---|
| 后端模板 + create | `cd packages/opencode && bun test --timeout 30000 test/server/openhive-file-templates.test.ts` | **14 pass / 0 fail / 69 expect** |
| 后端 create 全量 | 同上，`test/server/openhive-file-ops.test.ts` 单独跑 | **118 pass / 0 fail / 669 expect** |
| 前端弹窗 | `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-create-dialog.test.tsx` | **29 pass / 0 fail / 62 expect** |
| 前端清单 + 常量 | 同上，`src/project/file-create-catalog.test.ts src/center/file-type-extensions.test.ts` | **23 pass / 0 fail**（两文件合计；含全量快照与导出键校验） |
| 注册表 + 文件树 | 同上，`src/center/views/index.test.tsx src/project/file-tree.test.tsx` | **207 pass / 0 fail / 499 expect** |
| app typecheck | `cd packages/app && bun run typecheck` | `tsgo -b` **EXIT=0** |
| opencode typecheck | `cd packages/opencode && bun run typecheck` | `tsgo --noEmit` **EXIT=0** |
| oxlint（本轮改动文件） | `bunx oxlint <10 个改动文件>` | **0 error / 0 warning** |
| 仓库级 lint | `bun run lint` | 6838 warnings / **1 error**，错误在 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（八进制转义）——**既有**，本轮未触碰该包（`git diff --name-only` 无 session-ui） |

未跑：根目录 `bun test`（脚本 `exit 1`，项目禁止）；`bun install`（未跑，`bun.lock` 无 diff）。

## 2. 变异验证

### 2.1 实现者报告（T1/T3 各三段，均「定向红 → 原样恢复」）

| # | 拆哪一处 | 红在哪 | 归类（`#003-03`） |
|---|---|---|---|
| T1-A | `handleCreate` 模板写入拆回 `""` | `openhive-file-ops.test.ts`「.docx 非 0」红（Received: 0）；模板模块单测直测函数、**仍绿**（如实记录） | 类① 定向 |
| T1-B | PDF `startxref` 偏移改 0 | 模板测试 PDF 结构用例红（Expected "xref" / Received "%PDF"） | 类① 定向 |
| T3-A | 点击逻辑改成只选中（不可取消） | 弹窗「再点已勾的后缀 ⇒ 取消」红 | 类① 定向 |
| T3-B | 大类高亮判据恒 false | 弹窗「勾 .docx ⇒ 所属大类高亮」红 | 类① 定向 |
| T3-C | `提交名()` 去掉 `补类型后缀` | 弹窗追加/补后缀用例红 | 类① 定向 |

### 2.2 本轮复审修复的独立变异（协调者亲手执行）

| # | 拆哪一处 | 实得 |
|---|---|---|
| M1 | `data-selected` 从 `"true"/"false"` 退回 `"true"/undefined` | **3 条红**：「默认一个都没勾」「勾 .docx…」「再点已勾…」，Received: `undefined` / `false`；恢复后 29 pass |
| M2 | 后缀按钮两个 class 分支改成同一串 | **恰 1 条红**：「勾中的后缀与未勾的样式类不同」；恢复后 29 pass |

## 3. 代码审查裁定（2026-11-16，整支 diff 557f778b97..HEAD）

审查结论：**需修后合并**，0 Critical、3 Important、12 Minor。逐条处置：

| 编号 | 优先级 | 处置 |
|---|---|---|
| R1 弹窗写死 368px、9 大类只看得到约 2 类 | Important | **已修**：`DialogV2 fit` + `containerClass="max-h-[calc(100vh-2rem)]"` + body `!overflow-y-auto`；清单去掉自身 `max-h`（单一滚动区）；补结构用例「确定按钮不在滚动清单里」。真实观感进缺口表 |
| R2 前后端模板表缺成对闸 | Important | **已修**：`file-create-catalog.test.ts` 加**全量快照**（9 类 64 后缀逐字）——新增后缀必红，逼迫确认后端模板 |
| R3 T4 证据未落盘 | Important | **已修**：本文件 |
| R4 `关系图后缀 = 扩展名[0]` 怕重排 | Minor | **已修**：按值 `find(".hgraph")`，取不到**导入时抛错** |
| R5 折叠与选中并存无用例 | Minor | **已修**：裁定「折叠是看的动作，不清选中」并补用例（收起后提交名仍补 `.ts`、标题仍高亮） |
| R6 高亮只断 aria、不断视觉同源 | Minor | **已修**：补「勾中/未勾样式类不同」用例（变异 M2 证明有判别力） |
| R7 `data-selected` / `data-picked` 语义不一致 | Minor | **已修**：两者统一为 `"true"/"false"` |
| R8 无障碍：缺 group/aria-controls | Minor | **已修**：后缀容器 `role="group"` + `aria-labelledby`，toggle 加 `aria-controls`；48 个 Tab 停留点进缺口表 |
| R9 缓存 Promise，失败永久缓存 | Minor | **已修**：只缓存成功字节、在飞表失败即删。⚠️ **无自动化用例**（生成路径没有可注入的失败点） |
| R10 xlsx 惰性 import 的性能声明不实 | Minor | **已修**：注释改为「不挂静态依赖、两条路互不牵连」，删掉省加载时间的说法 |
| R11 `file.ts` 头注释仍写「空文件」 | Minor | **已修** |
| R12 弹窗头注释数字（13 种胶囊）不实 | Minor | **已修**：9 大类 / 64 后缀（代码 48 项） |
| R13 spec §6 数字与 xmind 措辞 | Minor | **已修**：48/64；xmind 改为「结构断言，未调 parseMindmap」 |
| R14 常量测试只断表长 9 | Minor | **已修**：命名空间 import 断言导出键集合逐项相等 |
| R15 标题不可点只断标签名 | Minor | **已修**：补行为用例（点标题后无勾选、提交名不变） |

## 4. 缺口（本机验不了，如实登记）

| 缺口 | 原因 | 谁来补 |
|---|---|---|
| `.docx` 模板在真 Word / docx-preview 真栈里的渲染 | 本机只做 zip 结构断言；审查者在 happy-dom 里另跑过 docx-preview 能出「正文」 | 真栈验收 |
| `.xlsx` 在真 Excel / 真栈表格视图 | 本机用 SheetJS 读回 `Sheet1` 成功；真栈未开 | 真栈验收 |
| `.pdf` 在真 pdf.js / 真查看器 | 结构断言（xref 逐条回对象头）通过；审查者另用 pdfjs 解析成功（1 页 595×842） | 真栈验收 |
| 图片 6 类在浏览器/查看器里解码 | 本机只验 magic；审查者用 PIL 逐张解码 1×1 | 真栈验收 |
| `.xmind` 在真 XMind 客户端 | 只验 zip 内 `content.json` 结构 | 真栈 + XMind |
| 弹窗真实布局（footer 固定、9 大类滚动、窄屏） | happy-dom 不算 CSS，只钉了 DOM 结构 | 真栈视觉验收 |
| 代码大类 48 项的键盘 Tab 次数 | 组件测试量不了焦点链 | 真栈 a11y 验收 |
| 模板缓存「生成失败后可重试」路径 | 无可注入失败点，无自动化用例 | 人工 review + 后续真栈异常演练 |

## 5. 参考教训

`#002-06`（单一出处） `#003-03`（变异三类） `#005-18`（假绿四问） `#012-01`（回写照抄旧预期） `#003-04`（实测当场复现）

## 6. 第二轮（2026-11-16，合并后用户裁定：去 V、金边框、行内排布）

### 6.1 改了什么

| 项 | 改前 | 改后 |
|---|---|---|
| 勾选框 / 「V」 | 每个后缀前一个 `<span data-slot="file-create-suffix-check">`，选中显示 V | **移除**；按钮文本就是后缀 |
| 选中态 | `border-strong` + `bg-layer-03` + 正文色 | `border-v2-border-border-focus`（=`--v2-brand-gold` #D97706）+ `bg-layer-03` + 正文色 |
| 排布 | `section` 纵向：标题一行、后缀下一行 | `grid grid-cols-[4.5rem_1fr]`：左格类名（+折叠开关）、右格后缀流式 |
| 类名 | `13px`、muted（选中才变 base） | `13px font-semibold`，默认 base；选中染 `text-accent` |
| 方框尺寸 | `13px / px-2 py-1` | `12px / px-1.5 py-0.5` |
| 清单高度 | 无自身限高（只靠 body 滚） | `max-h-[45vh] overflow-y-auto`，footer 仍在滚动区外 |
| 折叠开关位置 | 标题行右侧 | 左格类名旁（`11px`） |

### 6.2 门禁实得（本机，均 `timeout 300`）

| 项 | 命令 | 实得 |
|---|---|---|
| 弹窗用例 | `cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-create-dialog.test.tsx` | **34 pass / 0 fail** |
| 清单 + 常量 | 同上，`src/project/file-create-catalog.test.ts src/center/file-type-extensions.test.ts` | **23 pass / 0 fail** |
| app typecheck | `cd packages/app && bun run typecheck` | `tsgo -b` **EXIT=0** |
| oxlint（改动的 2 个文件） | `bunx oxlint <两个文件>` | **0 warning / 0 error** |

### 6.3 变异验证（协调者亲手，均「拆 → 定向红 → 原样恢复」）

| # | 拆哪一处 | 实得 |
|---|---|---|
| M1 | 选中边框 `border-focus` 换回 `border-strong` | **恰 1 条红**：「选中的后缀用蜜蜂金边框」；33 pass |
| M2 | 类名的选中分支改成与默认同一串 | **恰 1 条红**：「大类名…选中后染金」；33 pass |
| M3 | 尺寸回退 `px-2 py-1 text-[13px]`（两个分支一起） | **恰 1 条红**：「后缀方框缩到 12px」；33 pass |
| M4 | 清单去掉 `max-h-[45vh] overflow-y-auto` | **恰 1 条红**：「清单区限高并自己滚」；33 pass |
| M5 | `section` 回退成 `flex flex-col` | **恰 1 条红**：「类名与后缀是同一行的两格」；33 pass |
| M6 | 把勾选框 `<span data-slot="file-create-suffix-check">` 加回去 | **恰 1 条红**：「后缀按钮里没有勾选框…」；33 pass |

### 6.4 本轮发现的环境坑（新）

**`expect(元素).toBeNull()` 在本机出现过假绿**（2026-11-16，bun 1.4.3 + happy-dom + solid-jsx preload）：
同一断言位置，改成 `expect(元素 === null).toBe(true)` 才如实报红；隔离探针（.tsx、连接节点、
两 preload 全带）复现不出来，**成因未定**。处置：该用例改用布尔形式，并把「元素确实在文档里」
立成前提。**结论：本仓库对 DOM 节点做「不存在」断言时，用布尔比较，不用 `toBeNull()`。**

### 6.5 缺口

| 缺口 | 原因 | 谁来补 |
|---|---|---|
| 「一行两格」真实几何（是否同行、4.5rem 够不够宽） | happy-dom 不算 CSS | 真栈视觉验收 |
| 蜜蜂金边框在 dark 配色下的可辨识度 | 只复用既有 token，未做对比度实测 | 真栈视觉验收 |
| 清单 `max-h-[45vh]` 在真实视口下的滚动行为 | 同上 | 真栈视觉验收 |
