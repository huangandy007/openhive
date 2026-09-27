# 实施进度 · 平台底座（三栏工作台）

## 当前任务
T002 已完成。**T003 待启动**（等用户说「next」）。

## 已完成
- **T001** [FE·换皮] 定位三栏真实组件 → 产出 `refactor-targets.md`
  - 三栏真实组件已定位，但 **rail / 左栏全在 legacy 布局**（`pages/layout.tsx` + `pages/layout/sidebar-shell.tsx`）
  - **legacy 已被上游退休（死代码）**：`settings.tsx:63` `oldInterfaceSunset = new Date(2026, 8, 14)` 已过 → `:251` `oldInterfaceRetired = true` → `:129` `resolveNewLayoutDesigns` 无条件返回 `true`
  - 运行时恒走 new 布局 `pages/layout-new.tsx`（仅 49 行：Titlebar + 单个 `<main>`，**无 rail、无左栏、无 tab 容器**）
  - 右栏 `SessionSidePanel` 在 new 布局存活，但职责是「文件树 + review」，非 AI 会话
  - 顶栏 `titlebar.tsx:614` 在 v2 分支**有现成注入点** `#opencode-titlebar-right`（站内信可挂）
  - 换皮靶子须由 legacy `--xxx` 改为 `--v2-*`（`packages/ui/src/v2/styles/theme.css`）
- **T002** [FE·新增] 建 `packages/app/src/{rail,center,topbar,workspace}/` 目录骨架
  - 4 目录各含空 `.gitkeep`（git 不跟踪空目录，故需占位文件；仓库原无 `.gitkeep` 先例）
  - 不变量测试 `packages/app/src/openhive-module-dirs.test.ts`（RED→GREEN，4 expect）——下游 002–010 按这些路径 import，误删/改名为静默破坏
  - **未写任何投机性 stub**：`rail/entries.ts`、`center/*`、`topbar/*`、`workspace/three-pane.tsx` 分别由 T006/T004/T005/T007/T003 交付（Simplicity First）

## 阻塞项
**无。** 原阻塞（「三栏建在哪套布局」）已决策：

| 方案 | 说明 | 结果 |
|---|---|---|
| **A. 建在 new 布局** | 在 `layout-new.tsx:41` 的 `<main>` 上下游新增三栏骨架；换皮对 `--v2-*` | ✅ **已采纳**（合宪法 I/V） |
| B. 改回 legacy 布局 | 改 `newLayoutDesigns` 判定逻辑，换皮 legacy 三栏 | ⛔ 违反宪法 I/V，且 legacy 将被上游删除 |
| C. 双轨 | 两套都做 | ⛔ 不推荐 |

决策后已按宪法 §六完成**同步修订**（`refactor-targets.md` §6 清单 1–4 全部 ✅）：
- `plan.md`：修订记录 + Summary + 文件结构 + 换皮区 ①② 表 + ④ 汇总 + R4/R5/R6 + 宪法 Check V
- `spec.md`：修订记录 + FR-001…010 承载物标注 + Assumptions
- `tasks.md`：修订记录 + T003/T006 换皮→新增 + T007/T009/T017 落点
- `refactor-targets.md` §4 标注不适用、§6 标注已决策

## 质量门禁（T002 实测，2026-09-27）
> 工作基点：`multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）。**三项门禁中两项在基点即为红，均与 001 的改动无关。**

| 门禁 | 结果 | 归因 |
|---|---|---|
| `packages/app` `bun run test:unit` | ✅ **725 pass / 0 fail**（104 files） | 干净（基线 724 + T002 新增 4 expect） |
| `bun run lint`（oxlint，根目录） | ❌ **exit 1**：4902 warnings / 1 error | **既有上游**：唯一 error 在 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（Tailwind 类里的 `'\200B'` 八进制转义）；该文件与基点逐字节相同；本次新增文件在 lint 输出中 **0 命中** |
| `bun run typecheck`（turbo） | ❌ **exit 1** | **既有环境问题**：`@opencode-ai/enterprise` / `@opencode-ai/app` 因 `src/custom-elements.d.ts` 报 TS1128 |

### 门禁红的两处根因（已定位，均非本次改动引入）
1. **lint error（跨平台真实存在）**：上游 `prompt-input/index.tsx:163` 的 `content-['\200B']`。修它需改上游文件 → 违反宪法 I（最小化合并冲突），**建议上报上游 / 暂记为已知红**，不在本项目内私改。
2. **typecheck error（Windows 检出产物，Linux 不会有）**：`git ls-files -s` 显示 `packages/app/src/custom-elements.d.ts` 与 `packages/enterprise/src/custom-elements.d.ts` 的 git mode 为 **120000（符号链接）**，内容是指向 `../../ui/src/custom-elements.d.ts` 的**路径文本**；本机 `core.symlinks=false`（Windows 默认）故被检出为纯文本 → tsgo 解析报 TS1128。**主仓库同样如此**。仓库共 60 个 symlink 条目（含 `packages/app/public/favicon*.svg` 等，与 T017 品牌化相关）。**待用户决策**：开 Windows 开发者模式 + `git config core.symlinks true` 重新检出，或接受 typecheck 门禁本机不可用（依赖 CI）。

## 环境备忘
- worktree：`.claude/worktrees/feat-001-platform-foundation`，分支 `worktree-feat-001-platform-foundation`
- ⚠️ worktree 创建时默认基点取的是 `origin/dev` 尖端（v1.18.18），**已 `git reset --hard multi-tenant` 对齐**；后续重建 worktree 需注意 `worktree.baseRef` 未设（默认 `fresh`），应显式从 `multi-tenant` 切出
- `bun install` 后 `tree-sitter-powershell` 原生构建失败（node-gyp），**主仓库同样如此，属既有问题**，不影响 `packages/app` 测试与 typecheck
- ⚠️ **本机 `bun install` 会污染 `bun.lock`**：它把每个包的空 registry 字段改写成本机 `https://registry.npmmirror.com/...` 显式地址（纯 churn，3201 行）。**每次 `bun install` 后须 `git checkout -- bun.lock` 回退**，否则会把本机镜像源配置提交进仓库

## 最后更新
2026-09-27（T002 完成；质量门禁实测发现 lint / typecheck 在基点即红，待决策）
