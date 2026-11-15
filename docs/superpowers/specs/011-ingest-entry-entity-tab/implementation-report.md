# feature 011 实现报告（上传只落盘 · 入库唯一入口 · 下架实体页签）

- 分支：`feat-011-ingest-entry-entity-tab`（worktree 隔离，base `multi-tenant @ 2854447725`）
- 日期：2026-11-15
- 范围：tasks.md T001–T017 全部完成；三次复审（T009 / T010 / T011 / T014）与一条复审修复（T010-fix）记录见 `.superpowers/sdd/plan/progress.md`（gitignored）。

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
| v2 toast 落屏 | 未覆盖 | 组件测试走 legacy `ToastRegion(v2={false})`；生产入口 `layout-new.tsx` 设 v2 | 文案参数同源，风险有限；真栈 M9 可覆盖外观 |
| win32 目录行汇总（`汇总全部`） | **未修（预存在）** | `汇总全部` 仍按原始清单 `/` 切分；win32 清单带 `\` ⇒ 目录行汇总落不到目录 | 属 feature 010 既有缺陷，超出 011 范围；`目录展开` 已在 T010-fix 修真；建议另立条目 |

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
6. 任务级复审：T009 / T010 / T011 / T014 各派一次独立 reviewer，结论均 `VERDICT: PASS`；T010 复审的中等问题已由 T010-fix 修复，T011 复审的中等问题已由 T011-fix 修复。
