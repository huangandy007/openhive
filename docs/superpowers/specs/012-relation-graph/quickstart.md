# Phase 1 Quickstart：关系图产物（`.hgraph`）

**Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/](./contracts/)

本文件是**验收脚本**，不是实现说明。字段与错误码见 [data-model.md](./data-model.md) 与 [contracts/](./contracts/)，本文件只给「跑什么命令、看到什么算过」。

---

## 0. 前置

- 仓库根：`D:\project\study\openhive\openhive`（当前工作分支 `multi-tenant`；本 feature 在 `012-relation-graph` 分支/worktree 上做）。
- 依赖已装好，**不要**跑 `bun install`（本机 `~/.npmrc` 指向镜像，会污染 `bun.lock`；万一跑了：`git diff --stat bun.lock` 必须为空，否则 `git checkout -- bun.lock`）。
- 全部命令前缀 `timeout 300`；退出码 `124` 立即停、不重试（`#bound-test-runs-with-timeout`）。
- **仓库根禁止 `bun test`**（脚本 `exit 1`）；只在受影响 package 内跑。
- 前端测试必须带两个 preload：`--conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts`。

```bash
cd D:/project/study/openhive/openhive/packages/app
```

下面所有「app」命令都默认带这两个参数。

---

## 1. 自动化验收（每个 Task 的红/绿都跑这里）

### 1.1 服务端纯函数（`packages/opencode`）

```bash
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/case-hgraph-file.test.ts
```

| 期望 | 时机 |
|---|---|
| `格式 != 1` ⇒ `BAD_VERSION`；`格式: 2` ⇒ `NEWER_VERSION` 且只读 | P0 红→绿 |
| 解析失败 ⇒ `BAD_JSON`，且 `应用并写回` 拒绝（文件字节不变） | P0 |
| 未知键往返保留（顶层 + 节点内嵌 + 数组元素内嵌） | P0 |
| `性质=事实` 无 `出处`/`证据` ⇒ `FACTS_NEED_SOURCE` | P0 |
| `来源.kind=推断` 无 `依据` ⇒ `INFERENCE_NEEDS_BASIS`；无 `可信度` ⇒ `INFERENCE_NEEDS_CONFIDENCE` | P0 |
| 出处语法：`材料#表#行` 三段；工作表名含 `#`；区间 `12-40` 合法、`40-12` 拒绝 | P0 |
| 出处 > 50 行压缩成区间（`材料#表#12-80`） | P0 |
| id 分配：`n` 取现有最大 + 1；临时 id 映射为正式 id；`DUPLICATE_ID` 不出现 | P0 |
| 删节点连带删边，且 `删除.边` 计入同一数 | P0 |
| `合并节点`：端点重指、出处/证据/备注并集、`来源.并入` 追加 | P2 |

**变异验证（TR-006，每项都要照 `#003-03` 记成三类之一）**：把 `校验来源` 的事实分支删掉 ⇒ `FACTS_NEED_SOURCE` 那条必须红；把区间压缩阈值改回 100 ⇒ 压缩那条必须红。

### 1.2 服务端写入者（`packages/opencode`，真实临时目录）

```bash
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/case-hgraph-ops.test.ts
```

| 期望 | 时机 |
|---|---|
| `init` 对 0 字节写骨架；对非空**不覆盖**（`写入:false`，内容原样） | P0 |
| `read` 返回 `{内容, 版本}`；版本 = sha256 前 16 字节 hex，且**同一内容稳定、改一个字节就变** | P0 |
| `ops` 带过期 `版本` ⇒ `409 VERSION_CONFLICT` + `最新版本`；文件字节不变 | P0 |
| `ops` 不带 `版本`（AI 路径）⇒ 以盘上最新为基线写入成功 | P0 |
| 路径闸：`../` 逃逸 / 项目外绝对路径 ⇒ `OUTSIDE_PROJECT`；指向 `.git` ⇒ 拒绝 | P0 |
| 后缀 `.HGRAPH`（大写）照常接受；`.md` ⇒ `NOT_HGRAPH` | P0 |
| 同 `幂等键` 重放 ⇒ 第二次 `重放:true`、`版本` 相同、只写了一行内容不变 | P0 |
| 批量 30 条中第 30 条不合格 ⇒ 文件字节哈希不变（V-13） | P0 |
| 共享成员写图落到**属主**目录（`projectDirectory(root, 属主, id)`） | P0 |
| `export`：非成员 403；成员 200 + 文件名格式 `<项目名>-<图名>-<YYYYMMDD-HHmm>.png` + 留痕一行 | P1 |

### 1.3 MCP 5 个工具（`packages/opencode`，in-memory transport）

```bash
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/case-hgraph-tools.test.ts
```

| 期望 | 时机 |
|---|---|
| `graph_list`：列出全部 `.hgraph`；坏文件照列且 `打不开:true` | P1 |
| `graph_read`：不带 `路径` 且只有 1 张图 ⇒ 用它并在返回里明写 `路径` | P1 |
| 不带 `路径` 且 0 张 ⇒ `not_found`；≥2 张 ⇒ `ambiguous_path`（**不猜**） | P1 |
| `graph_add`：51 条 ⇒ `too_many`；第 50 条不合格 ⇒ 全部不写 | P1 |
| `graph_add`：同名同类型已有 ⇒ 返回 `复用`，不新建；同名不同类型 ⇒ 新建 | P1 |
| `graph_add`：无坐标 ⇒ `放置` 给出不与既有节点重叠的位置 | P1 |
| `graph_update` 把 `性质` 改成「推断」但没给依据/可信度 ⇒ 整批拒绝 | P1 |
| `graph_remove` 删不存在 id ⇒ `not_found`（不静默成功） | P1 |
| 非属主调用 `graph_add` ⇒ `forbidden`（属主门在分发之前） | P1 |
| 5 个工具**不套**七字段信封；查库工具信封行为不变 | P1 |

### 1.4 前端纯函数（`packages/app`）

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/file.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/ops.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/undo.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/export.test.ts
```

| 期望 | 时机 |
|---|---|
| 前端解析与后端同一套判定（同一份坏 JSON 两边都拒） | P0 |
| 逆操作：加 ⇒ 删、删 ⇒ 带副本还原、移动 ⇒ 回原位、改字段 ⇒ 旧值 | P2 |
| 撤销栈 20 步上限；同 `批次` 合并成一步；外部重载清栈 | P2 |
| 双向边偏移 `k×8px`；线宽档按阈值取档；外环档按连接数取档 | P2 |
| `隐藏计数` = 总数 - 可见数（隔离与筛选共用一个口径） | P2 |
| BFS 最短路径：给两节点返回路径；不通 ⇒ 明确「不连通」 | P2 |
| 导出文件名格式与 `-2`/`-3` 追加；未绑库节点在附录里标「未绑定」 | P1 |

### 1.5 组件（`packages/app`）

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/editor.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/inspector.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/present.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/entity-picker.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-create-dialog.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-tree.test.tsx
```

| 期望 | 时机 |
|---|---|
| 拖动中不发请求；`dragend` 恰好发一次 `ops`（含 `移动`） | P1 |
| 保存失败 ⇒ 检查器字段回到改前值 + 显示「没存上」（**不假装成功**） | P1 |
| 409 ⇒ 询问「重新载入？」；重载后撤销栈为空 | P2 |
| 快捷键只在画布聚焦时生效；焦点在输入框时 `Delete` 不删节点 | P1 |
| 演示：空格下一步 / Backspace 上一步 / Esc 退出并恢复编辑态 | P1 |
| 未写 `出现序` 的节点在演示里算第 0 步（先于所有显式序号） | P1 |
| `出现序` 数字框失焦即存，一次改动 = 一步撤销；清空 = 删该键（不是 0） | P1 |
| 选择器：取不到属性时节点照建 + 明写「库中无记录属性」 | P1 |
| 类型胶囊只有「关系图」一项；名字带 `.md` ⇒ 落成 `张三.md.hgraph` | P1 |
| 文件树右键「导出 PNG」与工具栏走同一函数（同一份文件名与留痕） | P1 |
| 隐藏时写「已隐藏 N 个」；隔离与筛选共用同一计数 | P2 |

### 1.6 抽出布局的回归（P0 的第一条，必须先绿）

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx
```

| 期望 | 时机 |
|---|---|
| 抽出 `graph-layout.ts` **之前**全绿（基线） | 动手前 |
| 抽出 **之后**同一文件、**未改任何断言**，仍全绿 | 抽出提交（单独 commit） |

### 1.7 门禁（每个 package 收尾都跑，仓库根 `#004-10`）

```bash
cd D:/project/study/openhive/openhive/packages/opencode && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive/packages/app && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive && timeout 300 bun run lint
```

期望：typecheck `EXIT=0`；oxlint 0 errors，warning 数与改动前对比**不新增**。

### 1.8 grep 收尾（单一写路径 / 单一判定）

```bash
cd D:/project/study/openhive/openhive
rg -n "HGRAPH_READONLY" packages/opencode/src               # 通用写口拒绝 .hgraph 的守卫，恰 1 处
rg -n "writeFile\(|writeFileSync\(|\.writeFile\(" packages/opencode/src/server/openhive | rg "hgraph"  # 只应命中 hgraph-ops.ts
rg -n "解析出处|校验来源" packages/opencode/src             # 定义各 1 处；get_citation 调它
rg -n "材料.*#.*工作表" packages/opencode/src | rg -v test   # 不应出现第二份内联解析
rg -n "window.addEventListener\(.*keydown" packages/app/src/center/case-views/hgraph  # 0 命中（快捷键挂容器）
rg -n "\.hgraph" packages/app/src | rg -v "test|hgraph/"    # 只应有 views/index.ts 注册与 hgraph-api
```

期望：最后一条除 `views/index.ts` 的注册、`file-create-types.ts` 的 `.hgraph` 后缀、`hgraph-api.ts` 外无其它落点——代表没有第二条写入通道。

---

## 2. 真栈手工验收

启动方式见仓库根 `CONFIG.md`；本机必须带 `REAL_STACK_DB=remote`（`D:\openhive-dev-db-remote-postgres`）。**不要**删除 `%TEMP%\openhive-real-stack-state` / `D:\openhive-stack-state` / `D:\assets`，**不要**另起第二套栈。真栈不热重载：改源码后必须重启才看得到。

| # | 步骤 | 期望 |
|---|---|---|
| M1 | 文件树新建 → 类型选「关系图」→ 名字 `张三资金流向` | 出现 `张三资金流向.hgraph`；双击打开是空画布（不是 JSON 文本）；文件树里显示为文件 |
| M2 | 双击空白加 3 个节点、拖开；从节点拖到另一个节点连线 | 线上出现箭头；工具栏/右键/double-click 三条路径都能加节点 |
| M3 | 关掉标签页再打开 | 节点位置与连线原样（`dragend` 已落盘）；文件在资源管理器里是合法 JSON |
| M4 | 拖一个节点到新位置 | 拖动过程中无网络请求（F12 Network 只看得到 `dragend` 后一次 `ops`） |
| M5 | 右侧检查器「从库加入」搜一个人 → 加入 | 节点带名称/类型/可信态；点「出处」能跳到材料那一行；检查器「库里现在」与档案一致 |
| M6 | 把一条边的性质改成「推断」但不写依据 | 被拒 + 提示「推断必须写明依据」；文件不变；撤销栈里没有这一步 |
| M7 | 工具栏「演示」→ 空格 / Backspace / Esc | chrome 收起；按 `出现序` 步进；Esc 回到编辑态；演示中按 `Delete` 不删节点 |
| M8 | 在检查器给一个节点填 `出现序 = 1`，另一个填 `2`，第三个留空 | 演示时留空那个排最前（第 0 步）；失焦即存，关掉重开值还在 |
| M9 | 让 AI（会话里）说「在 张三资金流向 里加一个节点：李四，人员，手写；并连一条 张三→李四 转账（事实，出处 mat_x#Sheet1#12）」 | AI 调 `graph_list` → `graph_add`；节点出现且不重叠；**一次** `Ctrl+Z` 整批消失；图里不出现同一批写两遍 |
| M10 | 再让 AI 加一条「转账（事实）」但不说出处 | 工具返回拒绝（模型如实转述「没存上」），文件不变 |
| M11 | 工具栏「导出 PNG」→ 默认 2 倍屏；再导出一次 A3 300DPI | 两份文件都下载成功（3508×4961 那份打开清晰）；同名不覆盖（`-2`）；`.md` 证据附录同次下载；附录里每条事实都有「材料#表#行」 |
| M12 | 文件树右键同一张图 →「导出 PNG」 | 走同一套授权与文件名；非项目成员账号试一次 ⇒ 拒绝 |
| M13 | 用浏览器 devtools 或第二台机器同时打开同一张图，各改一处并保存 | 后保存的一方看到「这份图在你打开之后被改过」+「重新载入？」；**不**静默覆盖；重载后撤销栈清空 |
| M14 | 手工把文件改成非法 JSON（先备份），再打开 | 只读报错 + 「以文本方式打开」；编辑入口全禁用；让 AI 再改这张图 ⇒ 拒绝 |
| M15 | 两节点之间画一条 `A→B` 和一条 `B→A` 转账 | 两条边都保留，平行显示不重合（偏移 8px）；少画一条不会被"合并" |

---

## 3. 缺口表（本机 / 本轮验不了的，如实登记，不写成已覆盖）

| 缺口 | 原因 | 处置 |
|---|---|---|
| 1000 节点拖动帧率 | 需真栈 + 真浏览器测帧率；组件测试环境（happy-dom）量不出 fps | 真栈手工记录实测值；<30fps 写进实现报告并注明降级（隐藏标签/简化线条），**不写成已达标** |
| 1000 节点导出 ≤3 秒 | 同上；canvas 在 happy-dom 里是空实现 | 真栈导出一次并计时；超时则按 SC-005 降级并在报告里写明实测秒数 |
| A3 300DPI 下的中文字体 | 依赖本机字体；缺字会掉成方框 | 真栈导出后**人工看图**；掉字则记录并改用系统无衬线字体族（不引入字体文件） |
| `graph_add` ≤50 条与预算 12 次窗口的交互 | 预算按 `(userId, projectId)` 计，图工具共用同一预算（research R14） | 保留现状；在同一项目内连续让 AI 改图 13 次，确认第 13 次被预算拦并有提示——若体验不可接受，另行裁定 |
| 共享成员经 route A 调案件工具 | 已知限制：恒 `identity_required`（既有门，不在本 feature 修） | 图工具同此门；真栈用**属主**账号验收 AI 改图 |
| 多机并发同一路径的跨进程锁 | 只做**进程内** per-path 串行 + 内容哈希 CAS；两台机器同时写最后靠 CAS 检出 | 不承诺跨进程互斥；M13 验的是 CAS 路径，两台机器同毫秒写同一文件的极端情形记为已知限制 |
| 拖拽/框选/连线的**手势**本身 | 组件测试覆盖逻辑，真手势需人眼 | M2/M4/M15 手工执行并记录结论 |
| 演示态投屏效果 | 需真投屏 | 仅验逻辑（M7/M8）；视觉效果真栈截图，不写成已验收 |
| 上游 `graph.tsx` 布局函数在官方 `dev` 上的后续改动 | 抽出后官方若重写布局，合并时会冲突 | 抽出保持 `graph.tsx` 同名 re-export，冲突面只剩 import；同步时按「保留本地定制」处理 |

---

## 4. 完成判据（一条一句，跑出什么算过）

1. §1.1–§1.5 全部用例绿，且每条「先红后绿」有红/绿两次实得输出。
2. §1.6 的抽出提交前后 `graph.test.tsx` 全绿且断言未改。
3. §1.7 三条门禁 `EXIT=0` / 0 errors。
4. §1.8 六条 grep 结果与期望一致（尤其「没有第二份出处解析」「没有第二处写 `.hgraph`」）。
5. §2 的 M1–M15 手工过一遍，结果逐条记录；§3 的缺口如实登记，**不勾成已覆盖**。
6. `git diff --stat bun.lock` 为空。
