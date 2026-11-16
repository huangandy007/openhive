# Quickstart：怎么跑、怎么验

> 目标是「一条命令证明一层」。所有命令从仓库根 `D:\project\study\openhive\openhive` 起算、按每节 `cd` 到对应 package；所有测试都带超时（同步死循环 bun 自己拦不住，见 LEARNINGS 的 timeout 纪律）。

## 0. 前置

- `bun install` 之后**必须** `git diff --stat bun.lock` 为空（只要非空就 `git checkout -- bun.lock`）。
- 后端测试用 PGlite/内存夹具，不需要真 PG。
- 真栈验收需要远端 PG：启动栈时**必须**带 `REAL_STACK_DB=remote`（缺了就静默走错库）；栈不热重载，改完源码必须重启。

## 1. 后端（写路径 + 格式闸）

```bash
cd packages/opencode
timeout 420 bun test test/server/case-hgraph-file.test.ts test/server/case-hgraph-edit.test.ts test/server/case-hgraph-ops.test.ts test/server/case-hgraph-tools.test.ts
```

**改前基线（实测 2026-11-17）**：`case-hgraph-edit.test.ts` 27 pass / 0 fail / 3.43s。

**期望**：0 fail。新增用例至少覆盖：

- 同批两个同名节点 ⇒ `新增 2`、两个不同 id；
- AI 工具同名 ⇒ 复用（开关只在 AI 路径为真）；
- `kind="事件"` 通过；缺 `来源.实体` ⇒ `BAD_SHAPE`；不要求 `依据`；
- 同载荷重试复用幂等键、异载荷换键（重放 `重放: true`）。注意 `批次` 每次发送都自增（`editor.tsx:854`），**不是**幂等键；服务端窗口是进程内 10 分钟（`hgraph-ops.ts:350`）。

## 2. 前端（交互 + 事件 + 面板）

用 `test:components` 那一套参数跑整个目录（**本目录不能按扩展名拆**：`export.test.ts` 虽是 `.ts` 也 import JSX，在 `--conditions=solid` 下会 `SyntaxError: Export named 'jsxDEV' not found`）：

```bash
cd packages/app
timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph
```

**改前基线（实测 2026-11-17）**：**475 pass / 0 fail，96.82s，17 文件**。两条纪律：① 路径过滤器必须带 `./` 前缀，否则 bun 当名字匹配、报「did not match any test files」；② `bunfig.toml` 只 preload `happydom.ts`，`solid-jsx.ts` 必须命令行补，缺了就 `jsxDEV` 报错。

**期望**：0 fail。新增用例至少覆盖：

- 滚轮：`deltaY: 3.75` 改 `scale`；`deltaX:120, deltaY:0` 只平移；
- 空格/手模式光标；拖到名字标签松手建边；空白松手有提示；
- 删除键：点过工具栏后仍能删，且写盘批次 = 1；输入框内只删字；演示态静默；
- 事件卡：`[data-node-shape="event-card"]` 存在，两行文本逐字匹配；
- 两态：绑定事件九格无输入框；手写事件有；
- 布局：控件把模式原样传给 `布局目标`；
- 强度过滤：N=3 时 1–2 档边不渲染、提示条数正确、可恢复；
- 布局几何：搜索/筛选/计数 `rect.y` 在工具栏底与画布顶之间；画布高 ≥ 改前同窗口实测值。

**动了共享面板常量（`面板宽/面板边距`）时另跑邻域图**——它钉住了 304 / `w-[280px]` / 292 三个口径。改前基线（实测 2026-11-17）：**73 pass / 0 fail，4.20s**。

```bash
cd packages/app
timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx
```

## 3. 门禁（在仓库根）

```bash
bun run typecheck
bun run lint
```

**期望**：两者退出码 0；`bun run lint` 改动面 0 error。

## 4. 真栈主流程（MVP 完成判据）

重启真栈后，用既有 `111.hgraph` 走一遍：

1. 工具栏「加事件」⇒ 视口中心出现事件卡（不切模式、不新增文字块）；
2. 从事件卡拖到实体 ⇒ 建立角色边（填角色 + 依据 + 可信度）；
3. 保存 ⇒ 「已保存」出现，盘上文件含该事件节点与边；
4. 关闭重开 ⇒ 事件卡两行文本与边标签原样；
5. 撤销一次 ⇒ 整批（事件 + 边）一起消失，不是只撤一半。

**任一步失败 ⇒ MVP 未完成**（spec SC-018）。记录每步实际结果，不写「应该没问题」。

## 5. 变异验证（每个切片必做）

按 `#003-03` 三类记录：拆哪一处 → 红哪几条 → 红成什么样。至少覆盖：

- 拆掉 `同名复用` 开关 ⇒ 同名用例红；
- 拆掉幂等键 ⇒ 超时重试用例红；
- 拆掉键盘监听上移 ⇒ 删除键用例红；
- 拆掉事件来源闸 ⇒ 半绑定事件用例红；
- 拆掉强度过滤 ⇒ 计数用例红。

## 6. 本机验不了的（写缺口表，不假装覆盖）

真实触控板 `deltaY`/`deltaMode`、200% 缩放下标签 LOD、A3 300DPI 出图、窄屏 1280/1440 观感、共享常量改动后邻域图观感、深色主题（宪法不启用）。见 spec §Assumptions 与设计文档 §6。

另有一条**必须真栈验**的：现网 `case_event_participant.role` 是否已按角色词表写入（`case-card-template.ts:34`）。PGlite 夹具里造得出，但不代表现网数据就是这样——真栈打开一个绑定事件看「角色」列，空/自由文本就记缺口。
