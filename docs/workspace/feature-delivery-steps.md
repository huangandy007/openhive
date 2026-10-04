# Feature 交付操作步骤 · openhive

**适用范围**：openhive 项目 F1–F10 全部 feature，从「建分支」到「推送」的完整操作链路
**版本**：v1.0 · 2026-09-30
**用法**：**照着走**。每一步都写清「在哪执行 / 敲什么命令 / 说什么提示词 / 什么时候停」。

**与 `feature-delivery-sop.md` 的分工**：

| 文件 | 讲什么 |
|---|---|
| `feature-delivery-sop.md` | **为什么**——七阶段模型、依赖链、环境已知坑、铁律 |
| **本文件** | **怎么做**——第一步到第十步，可照抄 |

本文件是**仓库内的操作手册**，随代码一起版本化。

---

## 全局约定

### 占位符

| 占位符 | 含义 | 例（F3） |
|---|---|---|
| `<NNN>` | 三位 feature 编号 | `003` |
| `<slug>` | feature 短名（不含编号） | `multi-tenant-isolation` |
| `<NNN>-<slug>` | 完整 feature 名 | `003-multi-tenant-isolation` |
| `<repo>` | 内层仓库根 | `D:/project/study/openhive/openhive` |
| `<workspace>` | 外层工作区 | `D:/project/study/openhive` |

### 三条路径锚点（背下来）

```
外层工作区   <workspace>              D:\project\study\openhive\        ← 不是 git 仓库
内层仓库根   <repo>                   D:\project\study\openhive\openhive\  ← 唯一的 git 仓库
宪法         <workspace>\.specify\memory\constitution.md              ← 在外层！
```

### 三道硬闸门（过不去就停，不许硬闯）

| # | 闸门 | 出现在 |
|:-:|---|---|
| ① | 基点验不过 → 停，**严禁自行 `git reset`** | 第三步 |
| ② | 门禁红灯 → 修复后重跑，**不绕过** | 第五步 |
| ③ | 审查有缺陷 → 回炉，**直到 0 缺陷** | 第六步 |

### 另外两处「必须停下来问」

- `plan.md` / 执行细则里标注「**未定**」的决策点命中 —— 别自行拍板
- 任何**不确定**的事 —— 停下来问

---

## 第一步 · 备齐规格三件套与执行细则

**在哪**：`<repo>`（规格）+ `<workspace>`（执行细则在用副本）

**前提**：feature 还没有分支。这一步是给它准备地图。

### 1.1 生成规格三件套

在 `<repo>` 内依次执行（spec-kit 命令）：

```
/speckit-specify     →  产出 docs/superpowers/specs/<NNN>-<slug>/spec.md
/speckit-clarify     →  澄清写回 spec.md
/speckit-checklist   →  产出 checklists/requirements.md（规格质检）
/speckit-plan        →  产出 plan.md
/speckit-tasks       →  产出 tasks.md
```

**产物落点**：

```
<repo>/docs/superpowers/specs/<NNN>-<slug>/
├── spec.md        规格（做什么 / 为什么）
├── plan.md        技术方案 + 风险点 R1…Rn
├── tasks.md       任务清单（含 Prerequisites、标签 [BE]/[FE]/[INT]）
├── state.md       开工时建，随开发更新
└── session.md     收尾时标记完成
```

### 1.2 生成执行细则 `dev_tdd.<NNN>.md`

以 `dev_tdd.v2.md` 为骨架，替换 feature 专属内容。**双副本**：

| 副本 | 位置 | 角色 |
|---|---|---|
| 在用 | `<workspace>/tmp/dev/dev_tdd.<NNN>.md` | 你实际读的那份 |
| 模板 | `<repo>/docs/workspace/dev_tdd.<NNN>.md` | 随仓库版本化，**新会话靠它才读得到** |

**必须替换的 feature 专属内容**（SOP 附录 C）：

- [ ] **Step 0** —— baseRef 提示（已配好则保留验证步骤）
- [ ] **Step 3** —— `[FE]` / `[BE]` / `[INT]` 的**本 feature 落点与红线**
- [ ] **Step 4** —— 门禁的本 feature 专属例外（如某类测试豁免）
- [ ] **Step 5 ⑥** —— 「上游侵入面」换成该 feature 实际改上游行为的任务
- [ ] **Step 6** —— tag 名与 feature 名
- [ ] **未定项清单** —— 该 feature `plan.md` 里标「未定」的决策点

### 1.3 同步进仓库

```bash
cp <workspace>/tmp/dev/dev_tdd.<NNN>.md <repo>/docs/workspace/dev_tdd.<NNN>.md
```

> ⚠️ 执行细则里凡引用路径，**都假设「当前工作目录 = worktree 根」**——它要在 worktree 会话里被执行。写完自己读一遍，确认没有指向外层的裸相对路径。

**本步产出检查**：`spec.md` / `plan.md` / `tasks.md` 定稿 + `dev_tdd.<NNN>.md` 双份一致。

---

## 第二步 · 开工前检查（主检出）

**在哪**：`<repo>`，主检出（分支 `multi-tenant`）

```bash
cd D:/project/study/openhive/openhive

# ① 站位正确？必须输出 multi-tenant
git rev-parse --abbrev-ref HEAD

# ② 工作区干净？
git status --short

# ③ 前置 feature 已合进主线？
git merge-base --is-ancestor <前置分支名> multi-tenant \
  && echo "✅ 前置已合并" || echo "❌ 前置未合并 —— 停"

# ④ 主线最近三个提交
git log --oneline -3

# ⑤ 查真实分支名（合并时要填，别凭记忆）
git worktree list
git branch -vv
```

**同时确认三件事**：

- [ ] `worktree.baseRef` = `head`
      —— 位置 `C:\Users\Administrator\.claude\settings.json`，**是 Claude Code 的设置项，不是 git config**（用 `git config worktree.baseRef` 查会显示为空，别据此以为「没配」）
- [ ] 本 feature 的 `spec.md` / `plan.md` / `tasks.md` 已定稿
- [ ] `dev_tdd.<NNN>.md` 已生成且**双份同步**

**⚠️ 若 ② 跑出几十行 `T`（typechange）**：那是 60 个符号链接资产被降级成了「内容是目标路径的文本文件」。修法见 SOP §4.1。

> 配置（`core.symlinks`）是**仓库级共享**的，但**物化不是**——**每个检出要各修一次**。
> 001 就吃过这个亏：worktree 里修好了、主检出漏了，此后两天主检出的 typecheck 一直是红的。

**判定 / 停点**：以上任何一项不符 → **停下来问**，不要「顺手修」。

---

## 第三步 · 开工作台（建分支）

**在哪**：仍在 `<repo>` 主检出目录下执行

### 3.1 开工作台

```bash
claude --worktree feat-<NNN>-<slug>
```

例：

```bash
claude --worktree feat-003-multi-tenant-isolation
```

**它会做三件事**：在 `.claude/worktrees/feat-<NNN>-<slug>/` 建一份独立检出、从当前 HEAD 切一条新分支、把新会话的工作目录设在那儿。

**同时自动复制**（按 `.worktreeinclude`）：

```
.env  /  .env.local  /  .env.development  /  .credentials.yaml
```

> 这几个文件在 `.gitignore` 里，普通检出带不过去，但开发要用 —— 这是 Claude Code 的机制。

### 3.2 进去后第一件事 —— 验基点

```bash
git merge-base --is-ancestor multi-tenant HEAD \
  && echo "✅ 基点正确" \
  || echo "❌ 基点错误 —— 停下来问，严禁自行 git reset"
```

> **为什么必须验**：`worktree.baseRef` 若为默认值 `fresh`，会从 `origin/dev`（**上游官方代码**）切，而不是本地开发主线。001 就是这么栽的，被迫 `git reset --hard` 才回到自己的代码上。配置虽已改为 `head`，**这道验证照做**——它同时确认你确实站在 `multi-tenant` 上。

### 3.3 对新会话说这句提示词

```
请帮我执行 D:\project\study\openhive\openhive\docs\workspace\dev_tdd.<NNN>.md 中的提示词
```

例（003）：

```
请帮我执行 D:\project\study\openhive\openhive\docs\workspace\dev_tdd.003.md 中的提示词
```

> ⚠️ **必须在 `--worktree` 起的新会话里说这句**。执行细则第 3 行假设「当前工作目录 = worktree 根」；在外层工作区说，里面所有相对路径都会对不上。

**判定 / 停点**：3.2 不通过 → 停，交给用户判断。

---

## 第四步 · 逐 task 开发（循环）

**在哪**：worktree 内

### 4.1 每个 task 开始前必读三份

| 读什么 | 路径 |
|---|---|
| **宪法** | `D:\project\study\openhive\.specify\memory\constitution.md` |
| **视觉真理源** | `<repo>/docs/superpowers/specs/openhive-DESIGN.md` |
| 本 feature | `plan.md` + `tasks.md` |

> ⚠️ 宪法**必须用绝对路径**。它在外层工作区、不在仓库里。在 worktree 里写 `../.specify/memory/constitution.md` 会解析到 `.claude/worktrees/.specify/…`，**读不到**。
> **冲突以宪法为准。**

### 4.2 Task 标签

| 标签 | 含义 | 纪律 |
|---|---|---|
| `[BE]` | 后端 / core | 侵入是「**加**」不是「改」；改造点**单独提交**并在 message 标注「这是要保留的定制」 |
| `[FE]` | 前端换皮 | 只写 **SolidJS**，绝不搬 React；走「三段真相链」（漏一处**静默失效**） |
| `[INT]` | 集成验收 | 必须在对应 `[FE]`/`[BE]` 都绿后启动，**跑真实端到端，不 mock** |

### 4.3 每个 task 的固定四拍

```
① 取「最小依赖且未完成」的 task
② TDD：RED → GREEN → REFACTOR
   （用 superpowers 的 test-driven-development skill）
③ 勾 tasks.md 该 task 的 checkbox → 更新 state.md → commit
   （message 含 <NNN>-<slug>/T0XX）
④ ⏸ STOP —— 等用户说「next」
```

### 4.4 用户在这阶段的提示词

每收到一个 task 的完成报告后，回一句：

```
next
```

**判定 / 停点**：

- 命中 `plan.md` 或执行细则 Step 0.5 里标「**未定**」的决策点 → **停下来问**，别自行拍板
- 全部 task 完成后 **STOP**，等审整个 feature（不要自行进入下一步）

---

## 第五步 · 质量门禁

**在哪**：worktree 内。**全部通过才准进第六步。**

```bash
# ① 单测 —— 在【受影响的 package 内】跑
cd packages/<受影响包> && bun test

# ② 前端组件测试 —— 凡有 .test.tsx 必跑这条
cd packages/app && bun run test:components

# ③ 视觉契约门 —— 退出码必须 0
cd D:/project/study/openhive/openhive && bun run lint:openhive

# ④ 全量 lint
bun run lint

# ⑤ 全量 typecheck —— 退出码 0
bun run typecheck
```

### 五条最容易踩的判据

| 门 | 坑 | **正确判据** |
|:-:|---|---|
| ① | 根目录 `bun test` 被 scripts 强制 `exit 1` | 进 package 内跑，**禁止根目录跑** |
| ② | `test:unit` 带 `--path-ignore-patterns="**/*.test.tsx"` | `.test.tsx` **进不了** `test:unit`；漏跑 = **测试白写** |
| ③ | 只扫 `packages/app/src/{rail,center,topbar,workspace}` | 前端落点在这四个目录**之外 → 这道门扫不到**，必须告知并扩范围，**别当成「过了」** |
| ④ | 全局有 **1 个已登记的上游 error** → **退出码恒为 1** | 判据是「**本次新增/改动文件 0 命中**」，不是全局 0；**不要为它改上游代码，也不要拿它当阻断** |
| ⑤ | turbo 可能报**假绿**（"31 cached"） | 存疑时 `bunx turbo typecheck --filter=<包名> --force`，**不要信 cached 的绿** |

**判定 / 停点**：有红灯 → 回第四步修复 → **重跑全部五道**。

---

## 第六步 · 代码审查

**在哪**：worktree 内。门禁全绿后触发。

**用什么**：superpowers 的 **`requesting-code-review`** skill

**用户提示词**：

```
审查
```

（或 `请对本次 feature 做代码审查`）

### 至少覆盖 6 类

| # | 类别 | 要点 |
|:-:|---|---|
| ① | **韧性缺陷** | 缺重试 / 缺超时 / 缺熔断器 |
| ② | **横切一致性** | 鉴权 / 限流 / 日志是否覆盖**所有**接口（「4 个接口里 3 个有鉴权」是经典翻车） |
| ③ | **防御性编码** | 未处理 null / 缺输入校验 / 缺幂等键 |
| ④ | **数据库迁移** | 回滚脚本 + 分批操作 |
| ⑤ | **前端换皮一致性** | 硬编码本应走 token 的 hex / 把 React 搬进 SolidJS / 手改生成物 / 未对齐 `openhive-DESIGN.md` |
| ⑥ | **上游侵入面** | 改了上游行为的任务是否 fail-open、是否走配置而非改 core 源码 |

> ⑥ 是每个 feature 的**专属红线**，内容随 feature 变（写在执行细则 Step 5 ⑥）。例：003 改造 `Database` 单例，审查必须确认「真的用『加』而不是『改』」。

### 输出与消化

输出格式：

```
| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |
```

用 `receiving-code-review` skill 消化。

**判定 / 停点**：

- **0 个缺陷** → 进第七步
- **有缺陷** → 回对应 task 走 TDD 修复 → **重新走一次审查**，直到 0 缺陷

---

## 第七步 · 收尾提交

**在哪**：worktree 内

**用户提示词**：

```
收尾
```

**做两件事**：

```
① final commit，message 含 "Closes <NNN>-<slug>"
② ⚠️ 不 merge、不打 tag
```

### ⚠️ 为什么 merge 做不了

`multi-tenant` 已在**主检出**被 checkout。**一个分支不能同时检出到两个地方**，而隔离会话对共享检出的 git 操作会被拦。所以工作台只能交出一条合并命令，由主检出执行。

### 本步要交给用户的报告

```
本 feature 共 N 个 task / M 个 [FE] / K 个 [BE] / 审查发现 X 个缺陷已全部修复
合并命令：git merge --ff-only <第二步 ⑤ 查到的真实分支名>
```

> ⚠️ 分支名**不要凭记忆填**——写「取数命令」而不是写死值（见 `LEARNINGS.md` `#002-06`）。

---

## 第八步 · 复盘沉淀

**在哪**：worktree 内

**用户提示词**：

```
复盘，把这次的经验补进 LEARNINGS
```

| 产物 | 动作 |
|---|---|
| `LEARNINGS.md` | 追加 **1–5 条**，新条目加在**最顶部** |
| `session.md` | 标记 feature 完成 |
| `state.md` | 更新为收尾状态 |
| `specs/<NNN>-<slug>/` | **永不删除**（CI 种子 + 下一个 feature 的上下文） |

### 条目模板

```markdown
## #<NNN>-<序号> · <日期> · <type> · <NNN>-<slug>
**现象 / 决策**：一句话讲清问题。
**应对**：下次怎么做。
**应用范围**：哪类 feature 该回看这条（可选）。
```

`type` 取值：`pitfall` / `decision-rethink` / `pattern` / `tool-quirk` / `ai-stuck` / `arch`

> ⚠️ 条目号分配后**冻结、永不变动**，后续追加只拿新号。号是 **ID 不是顺序**——同一 feature 内分批追加时，「上面那条号大、下面那条号小」属正常。引用时直接写号（「本次绕开 `#001-04`」）。

### 同时核对移交项

本 feature 拆出去 / 推给别处的欠账，是否已落进**接收方的 `tasks.md`**？

> 只写在自己的文档里 = 责任进了黑洞（见 `LEARNINGS.md` `#002-04`）。写完**把接收方的 `Prerequisites` 读一遍**，核对它是不是以为「已经落地了」。

**质检要点**（见 `LEARNINGS.md` `#002-06`）：

- 改完一处，**立刻 grep「谁引用了我刚改掉的东西」**——行号、数字、前提、交叉引用都会在编辑中悄悄失效，不报错、不变红
- 文档里引用源码**不写行号**，写函数名 / 测试名
- 凡「会随编辑或提交而变」的值**都别写死**（行号 / SHA / 提交条数），改写**取数命令**

---

## 第九步 · 合并 + 打 tag（主检出，**用户亲手**）

**在哪**：`<repo>` 主检出。**这一步 Claude 做不了，必须用户执行。**

### 9.1 先查真实分支名

```bash
cd D:/project/study/openhive/openhive
git worktree list        # 看有哪些桌子、各自挂在哪个分支
git branch -vv           # 看分支全名
```

> ⚠️ 不要凭记忆填分支名。SOP §1 记的规则是 `worktree-feat-<NNN>-<slug>`，但**该规则无法从当前仓库状态核实**（历史分支已随合并删除）——**以 `git branch -vv` 的输出为准**。

### 9.2 合并

```bash
# ① 站位正确 —— 必须输出 multi-tenant
git rev-parse --abbrev-ref HEAD

# ② 合并
git merge --ff-only <9.1 查到的真实分支名>

# ③ 验：主线应与该 feature 分支同一提交
git log --oneline -3

# ④ 打 tag —— 必须在 merge 之后
git tag v0.1.0-<slug>
```

### 9.3 为什么用 `--ff-only`

1. **保证主线历史是一条直线**，不合出多余的 merge commit。
2. **它是安全阀**：若主线在该 feature 开工后动过，`--ff-only` 会**直接报错拒绝**，而不是悄悄合出一段乱历史。
   **报错 = 提醒你先查清楚，不是让你加 `--no-ff` 绕过去。**

### 9.4 ⚠️ 为什么 tag 必须打在 merge 之后

> 001 的教训：tag 打在了「收尾提交」上，结果**后面又冒出来补测提交**，tag 没覆盖到最终状态。
> 放在 merge 之后打，才能 100% 确定「这后面不会再有提交了」。

**tag 命名**：现状**不一致**——001 打 `v0.1.0-platform-foundation`（无编号），002 打 `v0.1.0-002-auth-account`（有编号）。**这是未裁定项，命中就问用户。**

### 9.5 可选：清理工作台

```bash
git worktree remove .claude/worktrees/feat-<NNN>-<slug>
```

> 用 `git worktree remove`，**不要直接删目录**——直接删会留下**孤儿目录**：`git worktree list` 不再认它，但整仓库副本（GB 级）还躺在磁盘上。
> 现状：`.claude/worktrees/feat-001-platform-foundation/` 就是这个状态。
> SOP 的惯例是「历史工作台留着当路标，不删」——**留或删由用户定。**

---

## 第十步 · 推送到私有仓库

**在哪**：`<repo>` 主检出

```bash
# 推主线
git push origin multi-tenant

# 推 tag
git push origin --tags
```

> ⚠️ **这条与现行 SOP 有出入，需用户裁定**：
> SOP §3 Phase 7 写的是「**全部 10 个 feature 完成之后**才 push」，理由是别把半成品推上去；
> 但**逐 feature push** 的好处是异地 / 多机可恢复。
> 两条路互斥——**没裁定前停下来问**。

### 顺便：同步官方上游（独立于 feature 循环）

**方向恒为** `upstream/dev → multi-tenant`：

```bash
git fetch upstream          # 只下载，不改本地代码
git merge upstream/dev
# 出现冲突：解决后保留本地定制，再 git add <明确列出的文件> && git commit
git push origin multi-tenant
```

⚠️ 若 `git fetch upstream` 后报 `non-fast-forward`，说明官方做过强推 / 重置 —— **先备份本地定制再 rebase，不要盲目 force**。

### 远程仓库方向（固定）

| 远程 | 地址 | 作用 |
|---|---|---|
| `upstream` | `https://github.com/anomalyco/opencode.git` | 公有官方，默认分支 `dev`，**只 pull** |
| `origin` | `https://github.com/huangandy007/openhive.git` | 私有仓库，**只 push** |

---

## 第十一步 · 回到第二步，开下一个

```
第九步完成 → multi-tenant 前进一格 = 下一个 feature 的新地基 → 回第二步
```

**全部 10 个 feature 完成后**：`multi-tenant` 即完整产品。收尾动作需另行决定：

```
multi-tenant  →  push 到 origin/multi-tenant
              →  是否合回 main？（现 main 落后较多）
              →  打大版本 tag
```

---

## 速查卡

```
第一步  备料     <repo> 内跑 spec-kit 五连 → 生成 dev_tdd.<NNN>.md → 双份同步
第二步  体检     cd D:/project/study/openhive/openhive
                 git rev-parse --abbrev-ref HEAD     # 必须 multi-tenant
                 git status --short                  # 必须干净
                 git merge-base --is-ancestor <前置分支> multi-tenant
                 git worktree list / git branch -vv  # 记下真实分支名
第三步  开台     claude --worktree feat-<NNN>-<slug>
                 git merge-base --is-ancestor multi-tenant HEAD
                 → 对新会话：「执行 docs/workspace/dev_tdd.<NNN>.md 中的提示词」
第四步  开发     读宪法(绝对路径)+DESIGN+plan/tasks → TDD(RED→GREEN→REFACTOR)
                 → 勾 tasks.md → 更新 state.md → commit → STOP → 说「next」
第五步  门禁     cd packages/<包> && bun test
                 cd packages/app && bun run test:components
                 bun run lint:openhive        # 退出码 0
                 bun run lint                 # 只看本次改动文件 0 命中
                 bun run typecheck            # 退出码 0
第六步  审查     requesting-code-review skill，6 类，0 缺陷才算过
第七步  收尾     final commit "Closes <NNN>-<slug>"  ·  不 merge  ·  不打 tag
第八步  复盘     LEARNINGS 加 1–5 条（最顶部）· session.md 标记完成 · 核对移交项
第九步  合并     【主检出·你亲手】git merge --ff-only <真实分支名> → git tag v0.1.0-<slug>
第十步  推送     git push origin multi-tenant  ·  git push origin --tags
第十一步 循环    回第二步
```

---

## 附录 · 停点一览

| 出现在 | 触发条件 | 动作 |
|---|---|---|
| 第二步 | 站位 / 干净度 / 前置未合并 / baseRef 不符 | **停下来问**，不「顺手修」 |
| 第三步 | 基点验证不通过 | **停下来问**，**严禁自行 `git reset`** |
| 第四步 | 命中标「未定」的决策点 | **停下来问**，不自行拍板 |
| 第四步 | 全部 task 完成 | **STOP**，等审整个 feature |
| 第五步 | 任一门禁红灯 | 修复 → **重跑全部五道** |
| 第六步 | 审查有缺陷 | 回 task 修 → **重新审查**，直到 0 |
| 第九步 | `merge --ff-only` 报错 | **先查清楚**，不绕过 |
| 第九步 | tag 命名不一致 | 问用户选哪种形式 |
| 第十步 | 推送时机（逐 feature 还是最后统一） | **未裁定**，问用户 |
| 全程 | 任何不确定的事 | **停下来问** |

---

## 附录 · 相关文档

| 文档 | 位置 |
|---|---|
| 交付 SOP（为什么） | `docs/workspace/feature-delivery-sop.md` |
| 本文件（怎么做） | `docs/workspace/feature-delivery-steps.md` |
| 执行细则（逐 feature） | `docs/workspace/dev_tdd.<NNN>.md` |
| 工作区级规则 | `docs/workspace/CLAUDE.md` |
| 每日 git 操作 | `docs/workspace/git-daily-workflow.md` |
| 项目教训沉淀 | `<repo>/LEARNINGS.md` |
| 项目级规则 | `<repo>/CLAUDE.md` |
| 宪法 | `<workspace>/.specify/memory/constitution.md` |
