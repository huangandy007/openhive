# 012 关系图产物（`.hgraph`）· 验收记录

**日期**：2026-11-16 | **分支**：`012-relation-graph`（worktree，基底 `9a03c48031` = `multi-tenant` tip）
**范围**：`9a03c48031..0d661432e6`，70 个提交，71 文件（+26644 / −280）

本文件只记录**实际跑过的命令与实得输出**；未执行的项目在「缺口」里逐条写明，不写成已覆盖。

---

## 1. 自动化门禁（实得）

### 1.1 typecheck

```bash
cd packages/opencode && timeout 300 bun run typecheck   # $ tsgo --noEmit   → EXIT=0
cd packages/app      && timeout 300 bun run typecheck   # $ tsgo -b          → EXIT=0
```

### 1.2 lint（仓库根）

```bash
cd <repo-root> && timeout 300 bun run lint
# Found 6712 warnings and 1 error.  EXIT=1
```

- 唯一 error：`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（`'0'-prefixed octal literal`）。
  该文件自基底 `9a03c48031` 起**未被本分支改动**（`git diff --stat 9a03c48031..HEAD -- <该文件>` 为空），属**基线既有**。
- 本轮改动文件的 oxlint：各任务审查逐次实跑，均 **0 error**、无新增 warning（任务报告内记有行号）。

### 1.3 后端测试（`packages/opencode`）

```bash
timeout 300 bun test \
  test/server/case-hgraph-edit.test.ts test/server/case-hgraph-file.test.ts \
  test/server/case-hgraph-ops.test.ts  test/server/case-hgraph-tools.test.ts \
  test/server/openhive-case-citation.test.ts test/server/openhive-case-mcp-server.test.ts \
  test/server/openhive-case-mcp-tools.test.ts
# 261 pass / 0 fail / 1159 expect() calls
```

### 1.4 前端测试（`packages/app`，命令均带 `--conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts`）

| 批次 | 实得 |
|---|---|
| 17 个文件同批（`graph` + hgraph 纯函数/组件，除 editor、present、file-tree） | **416 pass / 0 fail / 1601 expect** |
| `hgraph/editor.test.tsx` | **127 pass / 0 fail / 760 expect**（T019d 后，88.09s） |
| `hgraph/present.test.tsx` | **25 pass / 0 fail / 163 expect** |
| `center/views/hgraph-view.test.tsx` | **13 pass / 0 fail / 45 expect**（T019d 后） |
| `project/file-tree.test.tsx` | **195 pass / 0 fail / 467 expect** |

**测试隔离注记**：18 个文件同进程一次跑时，`present.test.tsx #5（焦点在输入框：空格/Backspace/Esc 都不生效）` 会红；
单跑该文件 25/0 绿，其余 17 文件同批 416/0 绿。属**跨文件测试污染**（`#005-34` 同类），不是产品缺陷；
最终门禁按「逐文件或小批」执行。

**T019d 后的最终门禁复跑（本机实得，全部 `timeout 300`）**：

| 批次 | 实得 |
|---|---|
| 组件 8 文件（`graph` / `canvas` / `entity-picker` / `legend` / `inspector` / `hgraph-view` / `views/index` / `file-create-dialog`，browser 条件） | **187 pass / 0 fail / 1038 expect** |
| `editor.test.tsx`（单文件） | **127 pass / 0 fail / 760 expect**（88.14s） |
| `present.test.tsx`（单文件） | **25 pass / 0 fail / 163 expect** |
| `file-tree.test.tsx`（单文件） | **195 pass / 0 fail / 467 expect** |
| `export.test.ts`（单文件；**必须** browser 条件） | **15 pass / 0 fail / 67 expect** |
| 纯函数 7 文件（`file`/`geometry`/`graphops`/`history`/`undo`/`hgraph-api`/`openhive-file-ops`，solid 条件） | **214 pass / 0 fail / 497 expect** |
| `packages/app` typecheck（`tsgo -b`） | **EXIT=0** |
| 本轮 5 个改动文件 oxlint | **226 warnings / 0 errors，EXIT=0**（warning 全为既有风格项） |

一次把 `export.test.ts` 混进 solid 条件批时出现 `Export named 'jsxDEV' not found`（1 fail + 1 error），
按 `#009-02` 换成 browser 条件后 15/0 全绿——是**跑法错**，不是产品缺陷；记录在此以免下次误判。

### 1.5 quickstart §1.8 六条 grep（实得）

| 检查 | 结果 |
|---|---|
| `HGRAPH_READONLY` | 恰 1 处：`server/openhive/file.ts:1305` |
| `writeFile(...)` 且含 `hgraph` | 仅 `server/openhive/hgraph-ops.ts:332`（其余通用写口不命中） |
| `解析出处` / `校验来源` | 定义各 1 处：`citation.ts:30` / `hgraph-file.ts:540`；调用点均指向该处 |
| `材料.*#.*工作表`（排除 test） | 无第二份内联解析；命中均为注释/话术/键拼接，唯一解析器在 `citation.ts` |
| `window.addEventListener(...keydown)`（hgraph 目录） | **0 命中** |
| `.hgraph`（`packages/app/src`，排除 test/hgraph 目录） | 仅注册（`center/views/index.ts`）、后缀常量与判定（`project/file-create-types.ts`）、创建对话框/文件树菜单/`openhive-file-ops` 初始化接缝、`hgraph-view` 注释；**无第二写通道** |

### 1.6 锁文件与只读文件

```bash
git diff --stat 9a03c48031..HEAD -- bun.lock                              # 空
git diff --stat 9a03c48031..HEAD -- packages/app/src/project/entity-api.ts # 空（全程未改）
```

---

## 2. TDD 与变异（摘要）

每个任务均按「先红后绿」推进：实现者报告含红/绿实得值，任务审查者独立重跑关键变异并还原。
累计覆盖的承重变异（举例，明细见 `.superpowers/sdd/tasks/task-*-report.md` 与 `progress.md`）：

- 幂等锁键的**路径维度**：去掉父路径 ⇒ 同工具跨图用例红（`重放 Expected false / Received true`）。
- 撤销「整批一步」：改成每颗独立批次 ⇒ 红（`Expected 3 / Received 4`）。
- AI 一步还原的 diff 基线：改回 `文档()` ⇒ 重载后 `Ctrl+Z` 改写内容（T016a I-1）。
- 可见集/选中并集：拆掉并集 ⇒ 隔离后搜索命中隐藏节点不渲染（T017b R104）。
- 图例事件守卫：拆掉 `[data-slot=hgraph-legend]` ⇒ 点图例清空选中、双击真建节点、拖动平移画布。
- 保存失败/409/重放语义、出处校验、形状映射、度数口径等各有对应变异记录。

### 2.1 最终审查后的修复轮（T019d，`1563d0665c` + `0d661432e6`）

整分支最终审查（Critical 0 / Important 4 / Minor 2）指出四条 Important 都集中在「保存/打开失败语义与
`spec.md` FR-049 不一致」。协调者按「`spec.md` > `data-model.md`」裁定（R113）并做**一次**修复派发：

| 项 | 落地 | 红 → 绿实得（摘要） |
|---|---|---|
| I-1 可重试失败保留改动 | 网络/未知 code 失败不回滚：批放回 `待发`、草稿逆操作/副本/弹出顺次恢复、`clearTimeout` + 不排发；状态栏出「重试」按钮 | 原用例 12 红；新 6 条先红（如 `Expected "translate(180 100)" / Received "translate(100 100)"`），后 127/0 |
| I-2 409 明示冲突 | 文案「这份图在你打开之后被改过」+ 打开「重新载入？」+ 一次 `读` 填 `待重载` | 询问条断言 `Received: null` → 绿 |
| I-3 外部删除终态只读 | `发送` / `应用` 双闸、停轮询、`hgraph-gone`「文件已不存在」 | `Expected 3 / Received 4` → 绿 |
| I-4 以文本方式打开 | `hgraph-view` 解析失败态加 `hgraph-open-as-text` + `<pre data-slot="hgraph-raw">`（只读） | 按钮断言 `Received: null` → 绿 |
| m-1 后缀单一出处 | `file-tree.tsx` 改用 `关系图后缀` | — |
| m-2 白名单镜像 | **按裁定挂账**（契约条目已登记，不做跨包断言） | — |

变异（实现者 4 条 + 复审复核 6 条，均还原后复绿）：

- 删可重试分支的 `return` ⇒ 「写次数」用例红：`Expected 1 / Received 3`（自动重发两次）。
- 删 `应用` 的 `文件已不存在` 闸 ⇒ `Expected 3 / Received 4`。
- 删 409 的 `set询问重载(true)` ⇒ `hgraph-reload-ask` 为 null（两条用例红）。
- 组合口径改回字面 AND ⇒ #11 `撤销键.disabled` `Expected true / Received false`。
- 删 `hgraph-open-as-text` ⇒ 按钮 null。
- 复审另做两条「无用例防守」变异：删 `发送` 入口终态闸、可重试分支塞 `set选中([])` ⇒ **127/0 仍全绿**
  （`#003-03` 第三类，见缺口表）。

范围复审结论：**可收口**，Critical 0 / Important 0 / Minor 4（均属用例覆盖与边缘口径，已挂账）。


---

## 3. 真栈手工验收（quickstart §2 M1–M15）

**本轮未执行。** 原因：真栈不热重载，验收需重启用户本机持久栈（`%TEMP%\openhive-real-stack-state` /
`D:\openhive-stack-state` / `D:\assets` 与远端 PG），属工作区之外的持久状态变更；未在未获确认时擅自重启。
M1–M15 逐条清单与期望仍以 `quickstart.md` §2 为准；其中多数行为已有组件/服务端用例守（如 M2/M4 的拖动与连线、
M6 的推断校验、M7/M8 的演示步进、M13 的 409 重载、M14 的非法 JSON 只读出口、M15 的平行边偏移），
但**未据此宣称真栈已验收**。M13/M14 的界面链路在 T019d 才补齐（409 询问条、以文本方式打开），
其组件用例已绿；真实浏览器里「轮询停表 + 重试按钮点击」仍属真栈待验项。

---

## 4. 缺口表（如实登记）

| 缺口 | 状态 / 原因 |
|---|---|
| 真栈 M1–M15 全量手工验收 | 未执行（见 §3）；需获准重启真栈后按 quickstart 跑 |
| 1000 节点拖动帧率 | 未测；happy-dom 量不出 fps |
| 1000 节点导出 ≤3 秒 | 未测；canvas 在 happy-dom 为空实现 |
| A3 300DPI 中文字体掉字 | 未人工看图 |
| AI 改图 × 预算 12 次窗口 | 未做真栈连续 13 次验证 |
| 共享成员 route A 调案件/图工具 | 已知恒 `identity_required`（既有门）；本轮未改 |
| 跨进程同路径锁 | 只做进程内 per-path 串行 + 内容哈希 CAS；极端同毫秒写记为已知限制 |
| 拖拽/框选/连线手势与投屏观感 | 只验逻辑，未人眼验收 |
| 边选中 / 线宽档界面入口（设计 §5.6） | 未交付（画布边不可点选），纯函数与文件级档已交 |
| 强度筛选（≥N 档） | 未交付（T018 只交算档；筛选面板仍只有类型/性质） |
| 次数第 5 档并入第 4 档 | 规格内部不一致（类型 `0..4` vs 设计 5 档）；按数据模型为准 |
| FR-040「演示态隐藏网格」 | 画布无背景网格，无对应物可验（R76） |
| R84 老推断边缺 `可信度` | 只能删后重建（不改白名单） |
| R83 残留：同工具换参数复用同幂等键 | 调用方违约仍会重放；未改 |
| 同值补丁仍推进版本（Minor 6） | 服务端语义保留；前端按内容判外部改动兜住 |
| 删节点/文字混合重放 | 只报删除计数、不报名字，且文字数少报（不谎报成功） |
| 契约 §2 与 §6 措辞不一致 | 按 §6 实现；契约未改 |
| `pointercancel` 取消仍提交在途动作 | 已挂账未修（`canvas.tsx`；语义取舍） |
| 搜索下拉收起后 ↑/↓ 移动不可见光标 | 已挂账 Minor |
| `data-center-seq` 观测属性进生产 DOM | 已挂账 Minor（可改 testid） |
| 选择器覆盖层只盖舞台 | 已挂账；保存/撤销/工具栏仍可点 |
| 菜单方向键导航 / Esc 后焦点归还 | 未做（本轮只修「键盘激活后收菜单」） |
| 全屏归属：`requestFullscreen` resolve 前按 Esc | 窄窗口期不关演示，已知取舍（R111） |
| 仓库根 oxlint 1 error | 基线既有，文件自基底未改（见 §1.2） |
| `发送` 入口终态闸（`文件已不存在`）无用例防守 | 复审 M5：删掉后 127 条全绿（`#003-03` 第三类）；需「写在飞 + 计时器已挂 + 回 404」竞态才能触发 |
| 可重试分支「不清理选中/临时 id」无用例防守 | 复审 M7：塞 `set选中([])` 后 127 条仍绿；语义目前只由代码与注释保证 |
| 5xx 码（`WRITE_FAILED`/`DUPLICATE_ID`/`timeout`）无直接用例 | 可重试性由「4xx 补集」写法保证；若有人误把 500 码加进不可重试集，现无红 |
| 保留批 + 继续编辑时「重试」按钮在自动发送排队期仍显示 | 视觉多一颗钮，点击被 `正在发` 兜住，无害；未修 |
| 终态下飞行中应答仍可能改写状态文案；Ctrl+Z 仍可改撤销栈 | 写闸（`应用`/`发送`）不受影响，`hgraph-gone` 常驻；只影响文案/本地栈一致性，未修 |

---

## 5. 复跑方式

见 `quickstart.md` §1；命令一律 `timeout 300`，前端必带两个 preload，仓库根禁止 `bun test`。
