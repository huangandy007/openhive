# feature 011 实现报告（上传只落盘 · 入库唯一入口 · 下架实体页签）

- 分支：`feat-011-ingest-entry-entity-tab`（worktree 隔离，base `multi-tenant @ 2854447725`）
- 日期：2026-11-15
- 范围：tasks.md T001–T017 全部完成；四次复审（T009 / T010 / T011 / T014）与两条复审修复（T010-fix / T011-fix）记录见 `.superpowers/sdd/plan/progress.md`（gitignored）。

---

## 0. 交付摘要（finish branch）

本分支共 **22 个提交**（base `multi-tenant @ 2854447725` → HEAD），三项主交付：

### 交付一：上传只落盘（FR-001/002）
- 上传接口不再建材料行、不排作业，只把文件写到盘上（`file.ts:815/848`）；上传完成弹窗加一行弱化提示「右键…解析入库」，下载弹窗不加。
- 入库入口因此收敛为唯一一个：右键「解析入库」。

### 交付二：入库唯一入口（FR-003～FR-011）
- 右键「解析入库」支持**文件 / 文件夹 / 多选 / 混选**；候选判据只有一份（`文件待入队`），目录展开与选中集展开共用；混选按归一键去重，同一文件只入队一次。
- 界面区分三个数：**K**（选中集大小，触发项右侧）、**N**（候选文件数，确认框正文）、**M**（被排除的选中项数，正文）。多选时其余四项统一置灰并给同一句原因；「解析入库」只看「状态已接入且已读到」，0 候选仍弹确认框、确认键置灰。
- 批量执行逐份串行、失败不中断；收尾重拉一次，报告成功 S / 失败 F（S+F=N）、前 3 条原因与「重试只补没成功的、不会重复」。
- win32 路径归一：服务端清单是 `\`、树节点是 `/`，目录展开前统一归一、候选回写 posix 形。
- 服务端零新接口、零迁移；批量只活在前端，逐份复用 `POST /openhive/case/parse`。

### 交付三：下架实体页签（FR-013/014）
- 左栏只保留「会话 / 文件 / 能力」三个页签，← → 环绕顺序相应调整；`EntityPanel`、`entityApi` 注入、stories 与 398 行测试全部清理。
- 下架界面不等于下架能力：实体详情页、实体伪路径、共用取数底座与 AI 查询实体保持可用（`entity-api` 6 / `case-route` 9 / `entity-profile` 56 全绿）。

### 验证与门禁
- app 受影响测试 **492 pass**（file-tree 192 + case-materials-view 33 + transfer-dialog 8 + sidebar-tabs 21 + workspace-entry 238），server **169 pass**（file-ops 117 + case-materials 38 + upload-ingest 14），实体能力 **71 pass**（entity-api 6 + case-route 9 + entity-profile 56）；两包 typecheck `EXIT=0`。
- 根 lint：`EXIT=1`，**6232 warnings / 1 个既有 error**（`session-ui/prompt-input/index.tsx:163`，非本 feature 引入）；本轮改动文件无新增 error。
- 缺口（如实登记，未写成已覆盖）：真栈 M1–M11 未执行（未启动真栈）；v2 toast 真栈外观未验（组件级已覆盖）；`汇总全部` 的 win32 缺陷属 feature 010 遗留，另立条目。

---

## 1. 静态检索（T017）

工作目录 = worktree 根，2026-11-15 实测：

```text
$ rg -n 'EntityPanel' packages/app/src || echo "OK: 0 命中"
OK: 0 命中

$ rg -n '\bentityApi\b' packages/app/src || echo "OK: 0 命中"
OK: 0 命中

$ rg -n '入队材料\(' packages/opencode/src
packages/opencode/src\server\openhive\case-parse.ts:303:        入队材料(deps.pg(), {
packages/opencode/src\server\openhive\file.ts:740:export async function 入队材料(

$ rg -n '判下载目标' packages/app/src || echo "OK: 0 命中"
OK: 0 命中
```

结论：
- `EntityPanel` / `entityApi` 在 `packages/app/src` **0 命中**（前端已无实体页签接线）。
- `入队材料(` 只剩 `case-parse.ts:303` 的**调用**；`file.ts:740` 是定义（`export async function 入队材料(`），不是调用 —— 符合「入库唯一入口 = 右键解析入库」。
- `判下载目标` 0 命中（T008 改名后无残留）。

`entity-api.ts` 未改动，`git diff 2854447725..HEAD -- packages/app/src/project/entity-api.ts` 为空。

---

## 2. 真栈手工验收（M1–M11）：**本轮未执行（未启动真栈）**

### 2.1 探测（非破坏性，只记录）

```text
$ netstat -ano | grep LISTENING   # 全量监听端口，常见真栈端口无一在听
（3010/3011/4711/4712/4700/4096 均无监听）

$ tasklist | grep -iE "bun|node"
（无 bun 进程；只有与本 feature 无关的 node 进程）

$ curl --max-time 2 http://127.0.0.1:<port>/   （3010 / 3011 / 4711 / 4712 / 4700 / 4096）
全部：连接失败（curl 退出码 7 / http_code 000）
```

状态目录（未删除、未改写）：

```text
$ ls -d "$TEMP/openhive-real-stack-state" "D:/openhive-stack-state" "D:/assets"
ls: cannot access 'C:\Users\ADMINI~1\AppData\Local\Temp/openhive-real-stack-state': No such file or directory
D:/assets/
D:/openhive-stack-state/
```

`%TEMP%\openhive-real-stack-state` 当前**不存在**（本机未保留该临时态）；`D:\openhive-stack-state` 与 `D:\assets` 存在。按 T017 brief：真栈未运行 ⇒ **不启动**，M1–M11 全部登记为「本轮未执行」。

### 2.2 M1–M11 逐条结论

| # | 验收点 | 结论 | 依据 / 复跑方式 |
|---|---|---|---|
| M1 | 上传 `.xlsx` 只落盘：树出现文件、状态「未入队」、队列 0 条、`case_material` 无新增 | **未执行（未启动真栈）** | 服务端已由 `openhive-file-ops.test.ts` 的「上传只落盘，不建材料行、不排作业」守住（材料 0 / 作业 0）；复跑见 quickstart §2 |
| M2 | 上传完成弹窗有「右键…解析入库」提示 | **未执行（未启动真栈）** | 组件测试 `file-transfer-dialog.test.tsx` 断言提示含「右键」「解析入库」 |
| M3 | 右键「解析入库」⇒ 1 材料 + 1 排队作业 | **未执行（未启动真栈）** | 服务端 `openhive-case-materials.test.ts` 覆盖入队；组件测试覆盖菜单与确认框 |
| M4 | 下载完成弹窗**没有** M2 提示 | **未执行（未启动真栈）** | 组件测试有负向断言（下载 done 无提示节点） |
| M5 | 文件夹批量：确认框 N、两次点击逐份入队 | **未执行（未启动真栈）** | 组件测试覆盖确认框与批量调用序列 |
| M6 | Ctrl 多选 3 份（含 1 已解析）：四项灰 + 统一原因、标「已选 3 项」、N=2 / M=1 | **未执行（未启动真栈）** | 组件测试覆盖菜单三项与 N/M 正文；真实 Ctrl 手势未验（见缺口表） |
| M7 | 同时选中文件夹 A 与其中文件 B：B 只入队一次 | **未执行（未启动真栈）** | 组件测试覆盖去重候选（按归一键） |
| M8 | 全不可入队：确认框仍弹、确认键灰、说明原因 | **未执行（未启动真栈）** | 组件测试覆盖 `aria-disabled="true"` 与正文 |
| M9 | 批量中途失败：继续、S/F、前 3 条原因、S+F=N | **未执行（未启动真栈）** | 组件测试用 `假材料状态({ parse })` 覆盖；真实断网未验（见缺口表） |
| M10 | 左栏三页签；← → 3 步环绕 | **未执行（未启动真栈）** | 组件测试 `sidebar-tabs.test.tsx` 21 pass 覆盖列表与正反向环绕 |
| M11 | 实体详情伪路径：档案页 + 三子视图 | **未执行（未启动真栈）** | `entity-profile.test.tsx` 56 pass、`case-route.test.ts` 9 pass（伪路径解析） |

---

## 3. 缺口表（与 quickstart §3 对齐；不把未跑写成已覆盖）

| 缺口 | 本轮状态 | 原因 | 处置 / 复跑 |
|---|---|---|---|
| 真栈 M1–M11 全部 | **未执行** | 本机未启动真栈（探测无监听、无 bun 进程）；T017 brief 明确禁止盲目启动 | 按 `quickstart.md` §2 在真栈起来后逐条执行；仓库根 `CONFIG.md`，本机需 `REAL_STACK_DB=remote` |
| 真栈 M6 的 Ctrl 多选手势 | 未验 | 需要人眼/真实手势 | 手工执行并记录结论 |
| 第 2 份失败的真实触发（M9） | 未验 | 需构造服务端 500 / 断网；不做故障注入的设备改动 | 组件测试已守「继续 + 报告」；真栈只做一次断网抽样 |
| 批量 100+ 文件实际耗时 | 未压测 | 串行 N 次往返 | 真栈记录 10 份起点，注明未覆盖百份 |
| 上传同名同内容两份先后解析改写老材料路径 | 未验 | 既有行为，本 feature 不修 | 记录为已知限制 |
| 实体详情页入口可达性 | 已下架 UI 入口 | T014 按 spec 下架；能力保留 | 直接 URL / 伪路径验证能力仍在（`entity-profile` / `case-route` 测试绿） |
| 全仓 lint warning 基线 | **无基线数** | T001 只记录了测试基线，未记录 lint warning 数 | 以「改动文件逐个 lint 0 error、仅既有 warning」替代；**不写成「已与基线对比」** |
| v2 toast 落屏 | **组件级已覆盖**（2026-11-15 复审修复轮 2） | 此前组件测试只走 legacy `ToastRegion(v2={false})`；生产入口 `layout-new.tsx:138/271` 设 v2 | 新增用例 `setV2Toast(true)` + `<ToastRegion v2 />` 断言 S/F、前 3 条与尾句；变异 `description: undefined` ⇒ 红。**真栈外观仍未验** |
| M 的 0 候选文件夹（FR-007） | **已覆盖**（2026-11-15 复审修复轮 2） | 此前 M 断言只有 `M=0` 与「已解析**文件**」的 `M=1`，目录展开为空 ⇒ M+1 无断言 | 新增纯函数用例：变异 `本项候选.length === 0` 加 `&& 文件 !== undefined` ⇒ `Expected: 1 / Received: 0` |
| win32 目录行汇总（`汇总全部`） | **未修（预存在）** | `汇总全部` 仍按原始清单 `/` 切分；win32 下目录键、行状态（已解析被当未入队）、根进度计数三处都会错 | 属 feature 010 既有缺陷，超出 011 范围；`目录展开` 已在 T010-fix 修真；建议另立条目 |

---

## 4. TDD 证据索引

各任务的实测引用块在 `tasks.md` 对应条目下（红 Expected/Received、绿 pass 数、变异红成什么样）。

| 任务 | commit | 关键实测 |
|---|---|---|
| T001 | `5effc4aa2d` | 基线：file-ops 117 / case-materials 38 / upload-ingest 14 / file-tree 176，0 fail |
| T002 | `3d9f922c3d` | 红：材料/作业 Expected 0 / Received 1 |
| T003+T004 | `29cffa496d` | 上传只落盘；回归全绿 |
| T005 | `2ff2ead948` | 红 Expected「右键」/ Received 空；绿 8 pass |
| T006 | `45a1f8f288` | 红 Export not found；绿 22 pass |
| T007 | `e3d693f61f` | 绿 26 pass；变异红 `Expected [] / Received ["资料/跳过.xlsx"]` |
| T008 | `10e2a4678e` | 纯改名；176 pass 前后一致；`判下载目标` 0 命中 |
| T009 | `7ee8c50081` | 红 4 条；绿 207 pass；三次变异各红 3 条 |
| T010 | `cb29aabde0` | 红 2 条（无弹窗）；绿 file-tree 183 / view 27；两次变异各红 1 条 |
| T010-fix | `bdd062396d` | 红 4 条均 `Received: []`；绿 view 31 / file-tree 189；两次变异 4 fail / 1 fail |
| T011 | `2192370745` | 红 3 条（旧 `break`）；绿 189 pass；三次变异 3/2/2 |
| T011-fix | `aaa00ceb6d` | 补串行 pin；绿 190 pass；去掉 `await` 变异 1 fail |
| T012 | `9ff93adfca` | 红 15 pass / 6 fail（多出一个实体） |
| T013 | `b83409c399` | 绿 21 pass；变异回加 entity 6 fail |
| T014 | `010697a909` | typecheck 红 5 条 → 绿 EXIT=0；workspace-entry 238 pass |
| T015 | `cd2e1ea038` | entity-api 6 / case-route 9 / entity-profile 56，全绿 |
| T016 | `46ee9ea072` | 两包 typecheck EXIT=0；受影响测试全绿；lint 1 error（既有） |
| T017 | 本提交 | 静态检索 0 命中；真栈未执行（缺口表） |

---

## 5. 裁定与实现口径（摘要）

1. **多选菜单亮灯**：selection 作用域下，「状态已读到」即保持「解析入库」可点（0 候选仍弹确认框、确认键置灰），其余四项统一灰 + 同一句原因。依据 spec US2 场景 4，覆盖 contracts C3 的「length>0 才亮」。
2. **任务编号**以 tasks.md T001–T017 为准（plan.md 的 Task 1–12 是分组叙述）。
3. **T008 虽标 [P]**，与 T009–T011 同改 `file-tree.tsx`，按序执行。
4. **T010-fix**：`目录下待入队` / `选中集入队范围` 统一按归一分隔符比较、行表按归一键查、候选回写 posix 形。理由：win32 清单是 `\`、树节点是 `/`，不统一则文件夹展开恒为空（N=0）。
5. **T011 串行 pin**：复审发现「逐份串行」无用例可区分并发，补事件序列用例。
6. 任务级复审：T009 / T010 / T011 / T014 各派一次独立 reviewer，均 PASS；其中 T010 复审的中等问题由 T010-fix 关闭、T011 复审的中等问题由 T011-fix 关闭。

### 5.7 终审修复轮（2026-11-15，D1–D7）

终审结论 CHANGES_REQUESTED，**不改生产行为**；本轮只做文档/规格对齐与一条测试补齐（commit `docs(011): 终审对齐规格与契约，补 FR-011 截断用例`）。

| 项 | 处置 | 落点 |
|---|---|---|
| D1 N 的位置 | spec 追加 2026-11-15 修正（标题＝动作名，N/M 在正文） | `spec.md` FR-010 下方、US2 场景 2；`contracts/ui-contracts.md` C4 表格与「数字契约」 |
| D2 C3 与裁定相反 | C3 selection 行改为「`rowsLoaded` 且已接入即保持可点」；函数名改 `选中集入队范围` | `contracts/ui-contracts.md` C3 |
| D3 入口表述 | 改为「材料行由 `case/parse`（`入队` 或 `跳过`）新建；作业只由 `入队` 新建」 | `contracts/ui-contracts.md` C7 后 |
| D4 0 候选枚举 | C4 改为「正文概括说明，并至少点名已解析 / 已跳过」 | `contracts/ui-contracts.md` C4 |
| D5 前 3 条原因无 pin | 新增 5 份全失败用例：只点名前 3 条、第 4/5 条不出现 | `packages/app/src/project/file-tree.test.tsx` |
| D6 死导出 | `选中集待入队` JSDoc 标注「生产侧已改用 `选中集入队范围`，保留给 T007 用例」 | `case-materials-view.ts` |
| D7 报告口径 | 复审次数、§5.6 结论、缺口表措辞修正 | 本文件 §开头 / §3 / §5.6；`tasks.md` T016 证据块 |

D5 实测（2026-11-15）：

```text
$ cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-tree.test.tsx
191 pass / 0 fail / 449 expect，EXIT=0   （新增 1 条）

变异：去掉执行器里的 `.slice(0, 3)`
1 fail / 190 filtered out，EXIT=1
  Expected to not contain: "资料/四.xlsx"
  Received: "成功 0 份；5 份未能入队资料/一.xlsx：…；资料/四.xlsx：…；资料/五.xlsx：…。重试只补没成功的、不会重复"
恢复后全绿。
```

### 5.8 复审修复轮 2（2026-11-15，D8–D12）

两位复审（Review A 规格 / Review B TDD）结论均为 PASS_WITH_FIXES。本轮**只改文档 / 注释 / 测试**，生产可执行逻辑零改动；完整命令与输出见 `.superpowers/sdd/plan/fix-round-2-report.md`。

| 项 | 处置 | 落点 |
|---|---|---|
| D8 spec FR-009 | 可用性改由「材料状态已接入且已读到」判定；候选集只决定 N 与确认键；追加 2026-11-15 修正块（D2） | `spec.md` FR-009、US2 场景 4 |
| D8 spec FR-007 | 加 N > 0 条件；N = 0 时正文概括说明并点名已解析 / 已跳过（对齐契约 C4） | `spec.md` FR-007 |
| D9 下游旧口径 | N 从「确认框标题」改为「正文」；「按候选亮」改为「状态已读到即保持可点」 | `data-model.md:74`、`research.md:84`、`quickstart.md:58`、`plan.md:182`、`tasks.md:162` |
| D10 C7 措辞 | 作业由 `case/parse` 的 `入队` / `重新解析` 经 `入队材料` 新建 | `contracts/ui-contracts.md:87` |
| D10 同族注释 | 6 处改为「011 起上传只落盘、不再入队」；另发现并修正 `script/openhive-case-stage0.ts:46`（「上传 / 入队 / 视图」→「系统侧入队 / 右键入队 / 视图」） | `workspace-entry.tsx:538`、`workspace-entry.test.tsx:3830`、`case-ingest.ts:98`、`case-parseable.ts:6`、`file-upload-ingest.test.ts:37`、`case-ingest.test.ts:1873`、`case-stage0.ts:46` |
| D11 补测 | 新增「0 候选文件夹算 1 个被排除选中项」与 posix 尾分隔符 `资料/` 两条纯函数用例 | `case-materials-view.test.tsx` |
| D12 补测 | 新增生产 v2 toast 落屏用例（`setV2Toast(true)` + `<ToastRegion v2 />`） | `file-tree.test.tsx` |

实测（2026-11-15）：

```text
$ cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-tree.test.tsx ./src/project/case-materials-view.test.tsx
225 pass / 0 fail / 556 expect，EXIT=0   （此前 222：file-tree 191 + view 31）

D11 变异：`if (本项候选.length === 0)` → `if (本项候选.length === 0 && 文件 !== undefined)`
32 pass / 1 fail / 99 expect，EXIT=1
  Expected: 1
  Received: 0
恢复后全绿。

D12 变异：`description: entry.options.description` → `description: undefined`
0 pass / 1 fail（其余 191 条 filtered out），EXIT=1
  Expected to contain: "资料/一.xlsx"
  Received: "成功 0 份；5 份未能入队"
恢复后全绿；`git diff --stat packages/ui packages/app/src/project/case-materials-view.ts` 为空。
```
