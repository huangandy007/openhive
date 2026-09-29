# Feature 交付 SOP · openhive

**适用范围**：openhive 项目 F1–F10 全部 feature 的交付循环
**版本**：v1.0 · 2026-09-29
**状态**：可执行。从 003 起，每个 feature 照此走一遍。

**配套文档**：

| 文档 | 位置 | 效力 |
|---|---|---|
| 宪法 | `D:\project\study\openhive\.specify\memory\constitution.md` | **最高**，冲突以它为准 |
| feature 规格 | `openhive\docs\superpowers\specs\<NNN>-<slug>\{spec,plan,tasks,state,session}.md` | 逐 feature |
| feature 执行细则 | `tmp\dev\dev_tdd.vN.md` | 逐 feature（002 起有） |
| 本 SOP | `tmp\dev\feature-delivery-sop.md` | 通用循环 |

> 📌 **双副本惯例**：本文件在外层工作区（`D:\project\study\openhive\tmp\dev\`）**正在使用**，
> 同时镜像到内层仓库 `openhive\docs\workspace\feature-delivery-sop.md` 作为**模板**。
> 两边改动请保持同步——惯例见 `docs/workspace/README.md`。

---

## 0 · 一句话总览

> 在 `multi-tenant` 主检出上，**依次**为 F1…F10 各开一个 worktree + 一条新分支；
> 每个 feature 都从**当时最新的 `multi-tenant`** 拉出；开发完走完**门禁 + 审查**，
> 由主检出 `merge --ff-only` 合回并打 tag；前一个合完，后一个才有正确的地基。

**串行，不可并行，不可跳序。**

---

## 1 · 核心模型：一个书库，多张桌子

| 概念 | 是什么 |
|---|---|
| 仓库 | `openhive\.git`，**全项目唯一** |
| 分支 | 一枚**书签**，贴在某个提交上 |
| 工作区 / 检出 | 把书按某书签**摊开在桌上** |
| worktree | 在同一书库上**再支一张桌子** |

**两条推论**：

1. 几张桌子**共用同一书库** → 一边提交，另一边立刻可见，不需要 push/pull。
2. 同一枚书签**不能同时摊在两张桌子上** → 这就是「merge 必须由主检出执行」的根因。

### 三张桌子的固定分工

| 桌子 | 目录 | 分支 | 纪律 |
|---|---|---|---|
| **主检出** | `openhive\` | `multi-tenant` | **永远不动**，只做合并与打 tag |
| **当前工作台** | `openhive\.claude\worktrees\feat-<NNN>-<slug>\` | `worktree-feat-<NNN>-<slug>` | 一次只开一个 |
| 历史工作台 | 同上，旧 feature | — | 留着当路标，不删 |

### 命名规则（全部由 `claude --worktree <名字>` 自动生成）

| 对象 | 规则 | 例（F2） |
|---|---|---|
| 你输入的名字 | `feat-<NNN>-<slug>` | `feat-002-auth-account` |
| worktree 目录 | `.claude/worktrees/feat-<NNN>-<slug>` | 同左 |
| **实际 git 分支** | **`worktree-feat-<NNN>-<slug>`** | `worktree-feat-002-auth-account` |
| tag | `v0.1.0-<slug>` | `v0.1.0-auth-account` |

⚠️ `plan.md` 里那行 `**Branch**: <NNN>-<slug>` **只是 spec-kit 模板留下的文档标签**，
与真实分支名不一致——001/002 均如此，别被它误导。

---

## 2 · 依赖链（必须串行的理由）

| # | Feature | 依赖 | 交付的关键能力 |
|:-:|---|---|---|
| F1 | 001-platform-foundation | — | 设计 token、三栏工作台骨架 |
| F2 | 002-auth-account | — | 登录、`X-User-ID` 注入 |
| F3 | 003-multi-tenant-isolation | F2 | 每用户独立 db + 沙箱目录 |
| F4 | 004-access-control | F2, F3 | RBAC 三层拦截 |
| F5 | 005-project-management | F1, F3 | 项目＝隔离边界 |
| F6 | 006-ai-session | F1, F4 | 右栏指令卡 |
| F7 | 007-fund-analysis | F1, F3, F4 | 资金分析 |
| F8 | 008-call-analysis | F7 | 话单分析（复用 F7 模式） |
| F9 | 009-ai-assets | F4, F6 | AI 资产 |
| F10 | 010-governance-console | F2, F4, F9 | 治理后台 |

**依赖来源**：各 `docs/superpowers/specs/<NNN>-*/tasks.md` 的 `Prerequisites` 字段。

### ⚠️ 已知文档缺陷（待修）

F8/F9 的 `Prerequisites` 编号对不上内容，**执行顺序不受影响**，但读到时别被误导：

| Feature | 文档写的 | 按内容应为 |
|---|---|---|
| 008-call-analysis | "F6 资金分析已落地" | **F7**（F6 是 AI 会话） |
| 009-ai-assets | "F8 指令卡已落地" | **F6**（F8 是话单分析） |

### 为什么不能跳序

依赖不是文档上的形式，是**代码上的事实**。

> 例：F3 要「中间件填 `X-User-ID`」，那个头是 F2 的 T018 交付的。
> F2 没合进 `multi-tenant`，F3 拉出来就是空地基，T003 直接卡死。

### 为什么不能并行

1. **共享文件会撞车**：`bun.lock` / `package.json` 两边都动必冲突。
   实例：002 的 T001 一次改动 `bun.lock` **6467 行**（新增 workspace 成员导致锁文件重排）。
   这种冲突不是逻辑冲突，是纯文本地狱。
2. **门禁基线互相污染**：两条线的 `typecheck` / `lint` 基线不同，容易误判。
3. **项目铁律明令禁止**（见 §5）。

---

## 3 · 交付循环 · 七个阶段

```
Phase 0  开工前检查（主检出）
Phase 1  开工作台
Phase 2  逐 task 开发
Phase 3  质量门禁
Phase 4  代码审查
Phase 5  收尾 + 交接（工作台内）
Phase 6  合并 + 打 tag（主检出，你亲手）
Phase 7  回到 Phase 0，开下一个
```

---

### Phase 0 · 开工前检查（在**主检出**执行）

```bash
cd D:/project/study/openhive/openhive

# ① 站位正确？
git rev-parse --abbrev-ref HEAD          # 必须输出 multi-tenant

# ② 上一个 feature 已合并？
git log --oneline -3
git merge-base --is-ancestor worktree-feat-<前置NNN>-<slug> multi-tenant \
  && echo "✅ 前置已合并" || echo "❌ 前置未合并，停"

# ③ 工作区状态（60 个 T 属已知无害，见 §4.1）
git status --short
```

**同时确认**：

- [ ] `worktree.baseRef` = `head`（见 §4.2）
- [ ] 本 feature 的执行细则 `tmp/dev/dev_tdd.vN.md` 已生成（以 002 那份为模板，替换 feature 专属内容）
- [ ] 本 feature 的 `spec.md` / `plan.md` / `tasks.md` 已定稿

---

### Phase 1 · 开工作台

```bash
# 仍在主检出目录下执行
claude --worktree feat-<NNN>-<slug>
```

**进去后第一件事——验基点**：

```bash
git merge-base --is-ancestor multi-tenant HEAD \
  && echo "✅ 基点正确" \
  || echo "❌ 基点错误 —— 停下来问，严禁自行 git reset"
```

> 001 曾因基点错误被迫 `git reset --hard`。`worktree.baseRef` 已配好（§4.2），
> 但**这道验证照做**——它同时确认你确实站在 `multi-tenant` 上。

`.worktreeinclude` 会自动复制这 4 个文件进工作台：
`.env` / `.env.local` / `.env.development` / `.credentials.yaml`

---

### Phase 2 · 逐 task 开发

**每个 task 开始前必读**：

1. 宪法 —— ⚠️ **必须用绝对路径**
   `D:\project\study\openhive\.specify\memory\constitution.md`
   （写 `../.specify/...` 会解析到 `.claude/worktrees/.specify/…`，**读不到**）
2. `openhive-DESIGN.md`（视觉真理源）+ 本 feature 的 `plan.md` + `tasks.md`

**执行**：

- 取**最小依赖且未完成**的 task
- 用 Superpowers 的 `test-driven-development` skill（RED → GREEN → REFACTOR）
- 遇到 plan 标注「未定」的决策点 —— **停下来问，不要自行拍板**

**每个 task 完成后**：

```
① 勾选 tasks.md 该 task 的 checkbox
② 更新 state.md
③ commit（message 含 `<NNN>-<slug>/T0XX`）
④ ⏸ STOP —— 等「next」再继续下一个 task
```

---

### Phase 3 · 质量门禁

全部通过才进 Phase 4。

```bash
# ① 单测 —— 在【受影响的 package 内】跑
#    ⚠️ 根目录 bun test 会强制 exit 1（根 scripts.test = echo 'do not run tests from root' && exit 1）
cd packages/<受影响包> && bun test

# ② 前端组件测试 —— .test.tsx 必须走这条
#    ⚠️ packages/app 的 test:unit 带 --path-ignore-patterns="**/*.test.tsx"，
#       .test.tsx 进不了 test:unit，漏跑 = 白写
cd packages/app && bun run test:components

# ③ 视觉契约门（扫 packages/app/src/{rail,center,topbar,workspace}）—— 退出码必须 0
cd D:/project/study/openhive/openhive && bun run lint:openhive

# ④ 全量 lint —— 只判「本次新增/改动文件 0 命中」
bun run lint

# ⑤ 全量 typecheck —— 退出码 0
bun run typecheck
```

**关于 ④ 的特别说明**（否则每个 task 都会被卡死）：

> 全局有 **1 个已登记的「上游」error**（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`，
> 裁定为不私改、登记待上报）→ **全局退出码恒为 1**。
> 判据是「**本次新增/改动文件 0 命中**」，不是全局退出码 0。
> **不要为它改上游代码，也不要拿它当阻断。**

---

### Phase 4 · 代码审查

用 Superpowers 的 `requesting-code-review` skill 触发，**至少覆盖这 6 类**：

| # | 类别 | 要点 |
|:-:|---|---|
| ① | 韧性缺陷 | 缺重试 / 缺超时 / 缺熔断器 |
| ② | 横切一致性 | 鉴权 / 限流 / 日志是否覆盖**所有**接口（"4 个接口里 3 个有鉴权"是经典翻车） |
| ③ | 防御性编码 | 未处理的 null / 缺输入校验 / 缺幂等键 |
| ④ | 数据库迁移 | 是否有回滚脚本 + 是否分批操作 |
| ⑤ | 前端换皮一致性 | 硬编码本应走 token 的 hex / 把 front 的 React 搬进 SolidJS / 手改 colors.css / 未对齐 `openhive-DESIGN.md` |
| ⑥ | **上游侵入面** | 本 feature 改了上游行为的任务，是否 fail-open、是否走配置而非改 core 源码 |

**输出格式**（用 `receiving-code-review` skill 消化）：

```
| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |
```

**判定**：

- 0 个缺陷 → 进 Phase 5
- 有缺陷 → 回对应 task 走 TDD 修复 → **重新走一次审查**，直到 0 缺陷

---

### Phase 5 · 收尾 + 交接（在**工作台内**）

```
① final commit —— message 含 "Closes <NNN>-<slug>"
② 更新 docs/superpowers/specs/<NNN>-<slug>/session.md 标记完成
③ ⚠️ 不 merge、不打 tag（这两步工作台做不了，见下）
④ 输出合并命令交给主检出
```

**为什么 merge 做不了**：

> `multi-tenant` 已在主检出被 checkout。**一个分支不能 checkout 两次**，
> 且隔离会话对共享检出的 git 操作会被拦。
> 001 就是这么收的，已验证可行。

**本阶段报告**（交给用户）：

```
本 feature 共 N 个 task / M 个 [FE] / K 个 [BE] / 审查发现 X 个缺陷已全部修复
合并命令：git merge --ff-only worktree-feat-<NNN>-<slug>
```

---

### Phase 6 · 合并 + 打 tag（在**主检出**，用户亲手执行）

```bash
cd D:/project/study/openhive/openhive

# ① 站位正确
git rev-parse --abbrev-ref HEAD        # 必须输出 multi-tenant

# ② 合并
git merge --ff-only worktree-feat-<NNN>-<slug>

# ③ 验：主线应与该 feature 分支同一提交
git log --oneline -3

# ④ 打 tag —— 必须在 merge 之后
git tag v0.1.0-<slug>
```

#### 为什么用 `--ff-only`

1. **保证主线历史是一条直线**，不合出额外的 merge commit。
2. **它是安全阀**：若主线在该 feature 开工后动过，`--ff-only` 会**直接报错拒绝**，
   而不是悄悄合出一段乱历史。报错 = 提醒你先查清楚。

#### ⚠️ 为什么 tag 必须打在 merge 之后

> 001 的教训：tag 打在了「收尾提交」，结果**后面又冒出来补测提交**，
> tag 没覆盖到最终状态。放在 merge 之后打，才能 100% 确定「这后面不会再有提交了」。

---

### Phase 7 · 回到 Phase 0，开下一个

```
Phase 6 完成 → multi-tenant 前进一格 = 下一个 feature 的新地基 → 回 Phase 0
```

### 全部 10 个 feature 完成之后

`multi-tenant` 即完整产品。收尾动作需另行决定：

```
multi-tenant  →  push 到 origin/multi-tenant
              →  是否合回 main？（现 main 落后较多）
              →  打大版本 tag
```

---

## 4 · 环境已知坑

### 4.1 符号链接伪文件（60 个 `T` 状态）

**现象**：主检出 `git status` 常年有 **60 个 `T`**（typechange）文件，如
`packages/console/app/public/email`。

**根因**：仓库含 60 个 symlink 资产（git 里 mode `120000`），但本机检出时
`core.symlinks=false`，被写成了「内容是目标路径的普通文本文件」→ git 视为类型变更。

**影响**（2026-09-29 在主检出实测，**比「不阻断切分支」严重**）：

- **`typecheck` 直接红**：`packages/app/src/custom-elements.d.ts` 与
  `packages/enterprise/src/custom-elements.d.ts` 被 tsgo 当 TS 解析 → `error TS1128`，
  这两个包的 typecheck 跑不过。
- **`turbo` 可能报假绿把它盖住**：推送时 `.husky/pre-push` 的 `bun typecheck` 实测报
  「31 successful / 31 cached」，**同一时刻** `--force` 重跑立刻 FAILED。
  **判据**：怀疑 typecheck 结果时用
  `bunx turbo typecheck --filter=<包名> --force`，**不要信 cached 的绿**。
  （假绿的机理未查清——别照某个说法去解释它。）
- 切分支**确实**不受影响（这 60 个文件在两分支间零差异），但**别据此当成无害**。

**修复**（需要时，⚠️ **必须对每个检出各做一次**）：

```bash
git config core.symlinks true        # 已设为 true（仓库本地配置，不进版本库）
# 删掉那 60 个伪符号链接文件，再重新物化
git status --short | grep '^ T' | awk '{print $2}' | xargs -d '\n' rm -f
git checkout -- .
git status --short                   # 应当为空
```

> ⚠️ **这条真踩过**：001 收尾时按上面做了、也验过，但**只在 `.claude/worktrees/` 里那个
> worktree 做的**，主检出被漏下——`001/state.md` 写着「工作区回到 clean（60 个 `T` 全部
> 消除）」，而主检出在此后两天里仍有 60 个 `T`、typecheck 仍是红的。
> **配置（`core.symlinks`）是仓库级共享的，物化不是**——配好 ≠ 各检出都修好了。
> 做完**在每一个检出上**各跑一次 `git status --short` 确认。

### 4.2 `worktree.baseRef` 必须为 `head`

**配置位置**：`C:\Users\Administrator\.claude\settings.json`

```json
"worktree": { "baseRef": "head" }
```

**为什么重要**：`fresh`（默认值）= 从 `origin/dev` 切，那是**上游官方代码**
（v1.18.18 之类），**不是**多租户主线。001 踩过，被迫 `git reset --hard`。

**现状**：✅ 已于 2026-09-28 22:52 设为 `head`。
（`dev_tdd.v2.md` Step 0.1 那句「本机当前未配置」**已过期**。）

### 4.3 宪法在外层，必须用绝对路径

```
✅ D:\project\study\openhive\.specify\memory\constitution.md
❌ ../.specify/memory/constitution.md   → 解析到 .claude/worktrees/.specify/…，读不到
```

### 4.4 前端换皮「三段真相链」

**落点链**：

```
packages/ui/src/v2/styles/theme.css 的 `:root` + `[data-color-scheme="light"]` 两处逐字镜像
   ↓ 然后重跑生成器
packages/ui/src/theme/themes/oc-2.json（生成物，绝不手改）
```

⚠️ **只改 `theme.css` 会静默失效**：`ThemeProvider` 把 `oc-2.json` 的 `v2Overrides`
写进一个**不带 `@layer`** 的 `<style id="oc-theme">`，无层级样式压过 `theme.css` 所在的
`@layer theme`——**与顺序无关**。漏掉第三步时，构建 / typecheck / 既有测试**全绿**。

⚠️ **不是** `packages/ui/src/styles/theme.css`——那是 v1 legacy 文件。
⚠️ **绝不手改** `colors.css`（`script/tailwind.ts` 生成）。
⚠️ **绝不硬编码**新 hex / token：优先引用已有 token；若 DESIGN.md 已覆盖但无对应 token
→ 新增语义 token，并**先在 `openhive-DESIGN.md` 补记映射**再引用（宪法 §八）。

### 4.5 `.test.tsx` 进不了 `test:unit`

`packages/app` 的 `test:unit` 带 `--path-ignore-patterns="**/*.test.tsx"`。
含 `[FE·新增]` 的 feature **必产** `.test.tsx` → 必须跑 `bun run test:components`，
漏跑等于测试白写。

### 4.6 `lint:openhive` 的扫描范围有限

当前只扫 `packages/app/src/{rail,center,topbar,workspace}`。
**若新前端落在这四个目录之外，这道门扫不到** → 落地时须告知并扩范围。

---

## 5 · 铁律

来自 `dev_tdd.v2.md`「节奏铁律」+ 宪法第九章：

1. **逐 task 停**：每个 task commit 后 STOP，等「next」确认。
2. **一个 feature 跑完停下来等审**，再下一个。
3. **严禁多 agent 并发跑多个 feature。**
4. **遇到 plan 标注「未定」的决策点，先停下来问，不要自行拍板。**
5. **`specs/<NNN>-<slug>/` 永不删除**（CI 种子 + 下一个 feature 的上下文）。
6. **绝不手改生成物**（`oc-2.json` / `colors.css`）。
7. **绝不私改上游代码**——登记待上报，不要为它阻断门禁。

---

## 6 · 速查卡

```
┌─ Phase 0  主检出  ────────────────────────────────────────┐
│  cd D:/project/study/openhive/openhive                    │
│  git rev-parse --abbrev-ref HEAD      # multi-tenant      │
│  git merge-base --is-ancestor <前置分支> multi-tenant      │
└───────────────────────────────────────────────────────────┘
┌─ Phase 1  开工作台 ───────────────────────────────────────┐
│  claude --worktree feat-<NNN>-<slug>                      │
│  git merge-base --is-ancestor multi-tenant HEAD           │
└───────────────────────────────────────────────────────────┘
┌─ Phase 2  开发 ───────────────────────────────────────────┐
│  读宪法（绝对路径）+ DESIGN.md + plan/tasks                │
│  TDD：RED → GREEN → REFACTOR                              │
│  勾 tasks.md → 更 state.md → commit → STOP 等 next        │
└───────────────────────────────────────────────────────────┘
┌─ Phase 3  门禁 ───────────────────────────────────────────┐
│  cd packages/<受影响包> && bun test                        │
│  cd packages/app && bun run test:components   # .test.tsx │
│  cd <root> && bun run lint:openhive           # 退出码 0  │
│  bun run lint      # 只看「本次改动文件 0 命中」           │
│  bun run typecheck # 退出码 0                             │
└───────────────────────────────────────────────────────────┘
┌─ Phase 4  审查 ───────────────────────────────────────────┐
│  requesting-code-review skill，6 类缺陷，必须 0 缺陷       │
└───────────────────────────────────────────────────────────┘
┌─ Phase 5  收尾（工作台内）────────────────────────────────┐
│  final commit "Closes <NNN>-<slug>"                       │
│  更新 session.md  ·  不 merge  ·  不打 tag                │
└───────────────────────────────────────────────────────────┘
┌─ Phase 6  合并（主检出，你亲手）──────────────────────────┐
│  git merge --ff-only worktree-feat-<NNN>-<slug>           │
│  git tag v0.1.0-<slug>                                    │
└───────────────────────────────────────────────────────────┘
┌─ Phase 7  回 Phase 0 ─────────────────────────────────────┘
```

---

## 附录 A · 路径锚点

| 对象 | 绝对路径 |
|---|---|
| 外层工作区 | `D:\project\study\openhive\` |
| 内层仓库根 | `D:\project\study\openhive\openhive\` |
| 主检出分支 | `multi-tenant` |
| worktree 根 | `D:\project\study\openhive\openhive\.claude\worktrees\` |
| 宪法 | `D:\project\study\openhive\.specify\memory\constitution.md` |
| 视觉真理源 | `<仓库根>\docs\superpowers\specs\openhive-DESIGN.md` |
| feature 规格 | `<仓库根>\docs\superpowers\specs\<NNN>-<slug>\` |
| 执行细则 | `D:\project\study\openhive\tmp\dev\dev_tdd.vN.md` |
| 全局设置 | `C:\Users\Administrator\.claude\settings.json` |

### 远程仓库

| 远程 | 地址 | 作用 |
|---|---|---|
| `upstream` | `https://github.com/anomalyco/opencode.git` | 公有官方，默认分支 `dev`，**只 pull** |
| `origin` | `https://github.com/huangandy007/openhive.git` | 私有仓库，**只 push** |

合并方向恒为 `upstream/dev → multi-tenant`。

---

## 附录 B · 常用诊断命令

```bash
# 看所有桌子
git worktree list

# 看所有本地分支及其指向
git branch -vv

# 某 feature 分支是否已并入主线
git merge-base --is-ancestor <分支> multi-tenant && echo "已合并"

# 某 feature 分支落后/领先主线多少
git rev-list --count <分支>..multi-tenant     # 落后
git rev-list --count multi-tenant..<分支>     # 领先

# 某 feature 改了些什么
git diff <分支>^ <分支>
git log <分支> --oneline

# 主检出 vs 某 feature 分支的差异
git diff multi-tenant <分支>

# 所有 tag
git tag -l "v0.1.0*"
```

---

## 附录 C · 新 feature 开工前的「执行细则」模板

每个 feature 开工前，以 `dev_tdd.v2.md` 为骨架生成 `tmp/dev/dev_tdd.vN.md`，
替换以下 feature 专属内容：

- [ ] **Step 0** —— baseRef 提示（若已配好可保留验证步骤）
- [ ] **Step 3** —— `[FE]` / `[BE]` / `[INT]` 的 feature 专属落点与红线
- [ ] **Step 4** —— 门禁的 feature 专属例外（如 002 豁免隔离测试）
- [ ] **Step 5** —— ⑥「上游侵入面」换成该 feature 实际改上游行为的任务
- [ ] **Step 6** —— tag 名与 feature 名
- [ ] **未定项清单** —— 该 feature `plan.md` 里标注「未定」的决策点
