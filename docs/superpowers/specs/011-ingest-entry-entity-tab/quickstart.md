# Phase 1 Quickstart：解析入库入口收敛与实体页签下架

**Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md) | **Contracts**: [contracts/ui-contracts.md](./contracts/ui-contracts.md)

本文件是**验收脚本**，不是实现说明。每条都给出可复跑的命令与期望，实现细节见 [plan.md](./plan.md) Task 1–12。

## 0. 前置

- 仓库根：`D:\project\study\openhive\openhive`（当前工作分支 `multi-tenant`）。
- 依赖已装好，**不要**跑 `bun install`（会污染 `bun.lock`）。
- 所有命令前缀 `timeout 300`；退出码 `124` 立即停、不重试。
- 包内**单文件**跑测试，禁止仓库根 `bun test`（根脚本 `exit 1`）。

## 1. 自动化验收（每个 Task 的「红 / 绿」都跑这里）

### 1.1 服务端（`packages/opencode`）

```bash
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/openhive-file-ops.test.ts
timeout 300 bun test ./test/server/openhive-case-materials.test.ts   # 既有守门用例，不新建
timeout 300 bun test ./test/server/openhive-file-upload-ingest.test.ts # `入队材料` 库函数，不改
```

| 期望 | 时机 |
|---|---|
| `file-ops` 的 `上传真 .xlsx …` 用例（`:3146`）**FAIL**，实得「材料 1 / 作业 1」 | Task 1（红） |
| 同上用例 **PASS**，断言「材料 0 / 作业 0」 | Task 3 后 |
| `case-materials` 的「入队一份新表格…」用例（`:452`）**先绿留基线**，Task 3 后**仍绿** | Task 2 基线 + Task 3 回归 |
| `file-upload-ingest` **全绿**（`入队材料` 本身语义不变） | 全程 |

### 1.2 前端纯函数（`packages/app`，文件是 `.test.tsx`，须带两个 preload）

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/case-materials-view.test.tsx
```

| 期望 | 时机 |
|---|---|
| 既有 `目录下待入队` 用例 **全绿**（基线） | Task 4 前 |
| 抽出 `文件待入队` 后既有用例 **原样全绿**（未改断言） | Task 4 后（TR-005） |
| 新增四条 `选中集待入队` 用例 **先红后绿** | Task 5 |
| 变异：去掉「已跳过」排除 ⇒ 对应用例 **红** | Task 5（TR-006） |

### 1.3 组件（`packages/app`，必须带两个 preload）

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-tree.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-transfer-dialog.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/sidebar-tabs.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/workspace/workspace-entry.test.tsx
```

| 期望 | 时机 |
|---|---|
| 多选菜单：四项灰 + 统一原因；`解析入库` 按候选亮；右侧「已选 K 项」 | Task 7 先红后绿 |
| 确认框：N / M 正确；N=0 仍弹出且确认键禁用 | Task 8 |
| 批量：第 2 份失败 ⇒ 第 3 份仍发出；收尾含失败原因；`reload` 恰 1 次 | Task 9 |
| 下载用例 **原样全绿**（`判菜单目标` 改名后） | Task 6 |
| 上传完成有提示、下载完成无提示 | Task 10 |
| 三页签 + 键盘 3 步环绕；实体注入不再存在 | Task 11 |

### 1.4 门禁

```bash
cd D:/project/study/openhive/openhive/packages/app && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive/packages/opencode && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive && timeout 300 bun run lint
```

期望：typecheck EXIT=0；oxlint 0 errors（warning 数与改动前对比，不新增）。

### 1.5 grep 收尾（FR-013 / 唯一入口）

```bash
cd D:/project/study/openhive/openhive
rg -n 'EntityPanel' packages/app/src || echo "OK: 0 命中"
rg -n '\bentityApi\b' packages/app/src || echo "OK: 0 命中"
rg -n '入队材料\(' packages/opencode/src
```

期望：前两条 0 命中；第三条只剩 `case-parse.ts` 的调用点（定义处 `file.ts:740` 不算调用）。

## 2. 真栈手工验收（MVP：US1 + US2；US3 同批）

按项目既有真栈方式启动（见仓库根 `CONFIG.md`；本机需 `REAL_STACK_DB=remote`）。**不要**删除 `%TEMP%\openhive-real-stack-state` / `D:\openhive-stack-state` / `D:\assets`。

| # | 步骤 | 期望 |
|---|---|---|
| M1 | 上传一份从未见过的 `.xlsx` | 文件树出现该文件、状态「未入队」；解析队列 0 条；库里 `case_material` 无新增 |
| M2 | 看上传完成弹窗 | 摘要下有「右键…解析入库」提示 |
| M3 | 右键该文件 →「解析入库」 | 产生 1 条材料 + 1 条排队作业；解析照既有流程走 |
| M4 | 下载任意文件，看完成弹窗 | **没有** M2 的提示 |
| M5 | 右键一个含 ≥10 份表格的文件夹 →「解析入库」 | 确认框「将解析这个文件夹下的 N 个文件」；只需右键 + 确认两次点击；逐份入队 |
| M6 | Ctrl 多选 3 份（含 1 份已解析）→ 右键 | 其余四项灰 + 统一原因；`解析入库` 右侧「已选 3 项」；确认框 N=2、正文「另有 1 个选中项不在本次范围」 |
| M7 | 同时选中文件夹 A 与 A 内的文件 B | B 只入队一次 |
| M8 | 选中集全不可入队 → 右键 | 确认框仍弹出、确认键灰、说明原因 |
| M9 | 批量中途断网 / 让某份失败 | 后续继续提交；收尾报 S / F 与前 3 条原因；S+F=N |
| M10 | 左栏 | 只有 会话 / 文件 / 能力；← → 3 步环绕 |
| M11 | 直接打开一个实体详情伪路径 | 档案页 + 图谱 / 时间线 / 资金三子视图照常渲染 |

## 3. 缺口表（本机 / 本轮验不了的，如实登记，不写成已覆盖）

| 缺口 | 原因 | 处置 |
|---|---|---|
| 真栈 M6 的 Ctrl 多选手势 | 自动化组件测试覆盖逻辑，真栈手势需人眼确认 | 手工执行并记录截图/结论 |
| 第 2 份失败的真实触发（M9） | 需构造服务端 500 或断网；不做故障注入的设备改动 | 组件测试用 `假材料状态({ parse })` 守「继续 + 报告」；真栈只做一次断网抽样 |
| 批量在 100+ 文件时的实际耗时 | 串行 N 次往返，未做压测 | 记录实测起点（10 份）并注明未覆盖百份 |
| 上传同名同内容两份先后解析改写老材料路径 | 既有行为，本 feature 不修 | 记录为已知限制 |
| 实体详情页入口可达性 | 页签下架后无 UI 入口（`07` §9.5） | 已知；直接 URL 验证能力仍在 |
