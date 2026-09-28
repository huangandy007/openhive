# 会话交接 · 平台底座（三栏工作台）

## 状态：✅ 已完成（2026-09-28）

本 feature（`001-platform-foundation`）全部 task 已实现、测试全绿，Step 4 代码审查已收敛。

- **范围**：18 个 task = **16 个 `[FE]`** + **1 个 `[INT]`**（T008）+ **0 个 `[BE]`**；
  T018（PPT 预览）已裁决**移出本 feature**，无代码。
- **门禁**（最后一批实测）：`test:unit` **794 pass / 0 fail**（114 files / 3137 expect）、
  `test:components` **181 pass / 0 fail**（19 files / 472 expect）、
  `test:browser` **41 pass / 0 fail**（14 files / 100 expect）、
  `tsgo -b` 通过、定向 oxlint（⚠️ 须从仓库根跑）**22 warnings / 0 errors / 49 files**、
  `bun run build`（⚠️ 须在 `packages/app` 下跑）通过。
- **Step 4 审查**：共 **14 轮**复检，逐轮 **0 Critical**，全部缺陷已修复；
  逐轮范围、判定与修复提交见 `state.md`。
- **交付内容**：三栏工作台骨架（`rail` / `center` / `topbar` / `workspace`）、
  降级呈现（`DegradedReason` **5 档**，每档指向民警**不同的下一步动作**）、
  各类预览视图（PDF / Office / 压缩包 / 思维导图 / 代码 / 二进制）。

## 下次会话要做的事

1. 先读宪法：`D:/project/study/openhive/.specify/memory/constitution.md`（在**外层**工作区）。
2. 读 `state.md` —— 里面有 Step 4 十四轮复检的**完整记录**、**全部待决项**与**未验证项**。
3. 起下一个 feature：新 feature 用 `/speckit-specify`；实现已就绪的 feature 用 `run-feature` skill。
   ⚠️ **一次只跑一个 feature**，跑完停下等审。

## 本 feature 遗留的待决项（未在 001 内做）

见 `state.md` 的「待决项」小节，包括但不限于：

- 渲染器的**加载器接缝**（让 `document-view.tsx` 那条同性质分支可测）；
- M-4-3 图片魔数认不出（保持 `error` + 登记）；
- **C-2 pdfjs / C-3 SheetJS** 的「浏览器待验证」标记；
- 文档层条目（C-5 / I-10 / I-5）；
- `test:components` 加 `--isolate` 的代价（实测 3.66s → 14.02s，≈3.8×）。

## 禁止重新规划

`plan.md` 已经定稿，`tasks.md` 已经锁定。
直接执行，不要再 re-plan。
