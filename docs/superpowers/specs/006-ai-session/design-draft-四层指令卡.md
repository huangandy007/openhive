# 起草件：`openhive-DESIGN.md` §4.7「AI 会话 · 四层指令卡」

> **状态：草案，未生效。** 2026-10-07 裁定 U6：本节的取值只能来自 `theme.css` 语义变量与原生组件
> 的既有档位；起草件先放本 feature 目录，**交用户审过之后**才移入 `docs/superpowers/specs/openhive-DESIGN.md`
> 作为 **§4.7**（接在 §4.6 之后，同其写法：表格 ＋ 行级约束 ＋「不新增 hex」＋「待设计侧复核项」）。
>
> **为什么需要这一节**：T004 是本 feature 第一个有视觉值的任务，而参照物取样不到——
> `docs/superpowers/specs/design-reference/figma-export/` 里**只有 logo 与一份 shadcn 模板 tokens.css**，
> 没有页面子目录；`front/RightAIChat` 不在本仓。⇒ 取值只能靠① `packages/ui/src/v2/` 的原子组件与
> `packages/session-ui/src/v2/` 的分子组件、② `theme.css` 的语义变量、③ 本仓已有的换皮先例
> （`rail.tsx` / `tab-bar.tsx` / `degraded-view.tsx`）。本节即是这三者的成文。

---

## §4.7 正文（待移入）

### 4.7 AI 会话 · 四层指令卡（右栏）

右栏的指令卡与 skill 入口是**同一套机制的四个出口**（design-v2 §8.2）：投影框架
（`app/src/ai-session/projection.ts` 的纯函数）把「当前模块的能力清单」投成四支，四个出口各取一支。
**四支的形状由框架定，长相由本节定**——本节只写长相，不重复框架的契约。

| 层 | 取投影的哪一支 | 位置 | 常驻 | 落地文件 |
|---|---|---|---|---|
| 常用操作 | `common` | 右栏顶部，固定一行 | 是 | `ai-session/common-cards.tsx` |
| 上下文指令 | `context` | 常用操作**下方**，无上下文时整段不渲染 | 否 | `ai-session/context-cards.tsx` |
| 更多 skill | `drawer`（按 `group` 分组） | 右栏内浮层（见下） | 否 | `ai-session/skill-drawer.tsx` |
| `/` 命令面板 | `all`（模糊匹配全集） | Hero 输入框上方浮层 | 否 | `ai-session/command-palette.tsx` |

四条共同的规矩，先说在前面：

- **同一张卡的语法只有一个。** 常用操作与上下文指令**长相完全相同**（同一 `InstructionCard` 渲染），
  来源不同不靠长相区分，靠**分组标题**。FR-001 要的是「机制通用」，给两层两种长相就是把
  「通用」在视觉上又拆回两份。
- **卡面不带图标。** 不是审美取舍：`capabilities.ts` 的文件头已记明，skill 的**图标 / 分类 / 标签
  今天没有客观来源**（`SKILL.md` frontmatter 只有 `name` / `description` / `slash`；009 §11 的资产
  元数据还没落地）。给卡面配图标就是**造数据**。等 009 的资产元数据落地后再议。
- **状态提示配文字，不只靠颜色**（§4.3）。本节的层级差异一律**同时**由位置（第几行）与字号表达，
  颜色只做加强。
- **不新增 hex、不新增 token**。下文出现的每个名字都在 `packages/ui/src/v2/styles/theme.css` 里，
  或取自 Tailwind 的既有刻度（`rounded-lg` / `w-24` / `size-6` 这类）。

#### 一行里的取用纪律（**先读这条，再读下表**）

`theme.css` 的 v2 名字要经生成物 `packages/ui/src/styles/tailwind/colors.css` 的 `--color-v2-*`
才能当 Tailwind 工具类用（生成物开头就是 `--color-*: initial`，把 Tailwind 默认调色板整个清空）。
**那 51 条孪生不覆盖全部 token**——实测（2026-10-07）：

| token | 有工具类孪生？ | 所以只能这么写 |
|---|---|---|
| `--v2-background-bg-{base,accent,layer-01..04}` | 有 | `bg-v2-background-bg-base` |
| `--v2-background-bg-accent-soft` | **无** | `bg-[var(--v2-background-bg-accent-soft)]` |
| `--v2-overlay-simple-overlay-{hover,pressed}` | 有 | `bg-v2-overlay-simple-overlay-hover` |
| `--v2-text-text-{base,muted,faint,accent}` | 有 | `text-v2-text-text-muted` |
| `--v2-icon-icon-{base,muted,accent}` | 有 | `text-v2-icon-icon-muted` |
| `--v2-border-border-{base,muted,strong,focus}` | 有 | `border-v2-border-border-muted` |
| `--v2-state-*`（12 条） | 有 | `bg-v2-state-bg-danger` |
| `--v2-elevation-*` | **无**（0 条） | `shadow-[var(--v2-elevation-raised)]` |
| `--v2-avatar-*`（19 条） | **无** | （本节不用；§4.5 的模块色按那条既有办法走） |

> ⚠️ **`shadow-v2-elevation-floating` 这种写法一定会红**。`workspace/design-token-refs.test.ts`
> 对工具类形态的引用**要求孪生存在**（它的正则捕获组必须以 `v2-` 开头，抓到 `shadow-v2-…` 就去查
> `--color-v2-…`），而生成物里 `--color-v2-elevation-*` **一个都没有**。任意值写法
> `shadow-[var(--v2-elevation-…)]` 走的是另一条正则（`var(--v2-…)`），只查「名字存不存在」⇒ 合法。
> 这不是绕测试：本仓既有代码（`auth/change-password.tsx`、`prompt-input/slash-popover.tsx`）
> 用的就是任意值写法。**新增视觉值前先对这张表，别先写再跑。**
>
> ⚠️ 同一条纪律的另一半：**任意值里的 `text-[13px]` / `rounded-[10px]` 这类不查 token**
> （正则的捕获组要求以 `v2-` 开头）。所以「任意值合法」**不等于**「任意值随便写」——
> 尺寸仍受下面各表约束。

#### 4.7.1 指令卡（常用操作 / 上下文指令共用）

| 项 | 规范 |
|---|---|
| 形状 | 白底卡片：`bg-v2-background-bg-base` + `shadow-[var(--v2-elevation-raised)]` + `border border-v2-border-border-muted` |
| 宽 | 定宽 `w-24`（96px）。**必须定宽**——见下方「溢出」 |
| 高 | `h-8`（32px） |
| 圆角 | `rounded-lg`（8px，§3.1 的按钮档） |
| 卡面文字 | 13px，`text-v2-text-text-base`，**单行截断**（`truncate`） |
| 行内间距 | `gap-2`（8px） |
| hover 态 | `hover:bg-v2-overlay-simple-overlay-hover` |
| 选中态 | `bg-[var(--v2-background-bg-accent-soft)]`（§1.3 选中态浅金） |
| 行底色 | 右栏底面 `bg-v2-background-bg-layer-01` |

三点说明：

- **圆角取 8px 而非 §3.1 的「卡片 12~16px」**：§3.1 那档是给中栏的**大内容卡**写的。这里是 360px
  栏内一行里的紧凑卡片，一行要放得下两张以上；16px 圆角会让一行卡看起来像两颗按钮球。8px 是 §3.1
  的**按钮档下沿**，也在 Tailwind 既有刻度上（`--radius-lg: 8px`）。⚠️ 这条属**待设计侧复核项**。
- **右栏底面取 `layer-01` 而非白**：卡片本身是白底。同白相叠时 §4.2 那条「柔和阴影」无处着力，
  卡片与底面糊成一片。给底面降一档，阴影才有分层的对象。⚠️ 同样属**待设计侧复核项**。
- **选中态 = 「输入框里那句话来自这张卡」**。它与 hover **必须不同色**（选中浅金、hover 灰 overlay）
  ——这条约定与 005 已落地的 `rail.tsx` / `project/file-tree.tsx` 一致，别在两处各写一套。
  ⚠️ 若 T004 判定这个态不稳定（输入框一改就掉），**就删掉这条引用**，不要留一条永不命中的分支
  （`LEARNINGS #003-03` 第 ③ 类：全绿的分支是多余的，处理是删代码不是补测试）。

#### 4.7.2 分组标题与溢出

| 项 | 规范 |
|---|---|
| 分组标题（「常用操作」「上下文指令」） | 11px，`text-v2-text-text-muted`（§2.2 的「徽章/标签/辅助 9~11px」档） |
| 溢出钮 | 与 `center/tab-bar.tsx` 同一颗：字形 `⋯`（U+22EF，原生图标集**没有** ellipsis 一档）、`size-6`、`rounded`(4px)、`text-v2-icon-icon-muted`、`hover:bg-v2-overlay-simple-overlay-hover` |
| 溢出菜单 | 用原生 `MenuV2`（`@opencode-ai/ui/v2/menu-v2`），**不自己写一份**：浮层 chrome 由 `menu-v2.css` 给（min-width 160px / padding 2px / radius 6px / `box-shadow: var(--v2-elevation-floating)` / `z-index: 60`） |
| 可见几张 | 走**纯函数**（形态同 `center/tab-overflow.ts` 的 `splitTabOverflow(条数, 可用宽, {卡宽, 溢出钮宽})`，它的宽度已是参数 ⇒ 天然通用），**不读 `clientWidth`** |

- **可见数为什么必须是纯函数**：happy-dom **没有 CSS 引擎**，`clientWidth` 恒为 0、`getComputedStyle`
  拿不到真值。任何「靠量出来的宽度算能放几张」的写法在本仓的测试环境里**测不了**——把它做成
  入参为宽度的纯函数，才有一条能红的断言。这是**测试可行性**决定的形状，不是审美偏好。
- 若 T004 发现卡片与 tab 的截断策略要分家（比如卡片不留尾缝），**另写一个同形的纯函数**，
  不改 `center/tab-overflow.ts`——那份已经在守 005 的 FR-005。
- **「⋯」与「更多 skill」是两件事，界面必须分开**：`⋯` 装的是**本行放不下的那几张卡**；
  「更多 skill」打开的是**整个 skill 全集**。两者收纳范围差一个数量级，合成一个入口会让民警以为
  「⋯」里就是全部 skill。

#### 4.7.3 更多 skill 抽屉（右栏内浮层）

| 项 | 规范 |
|---|---|
| 形态 | **只盖右栏**的面板：右栏容器 `relative`，面板 `absolute inset-0` |
| 底面 / 圆角 / 阴影 | `bg-v2-background-bg-base` / 10px / `shadow-[var(--v2-elevation-overlay)]` |
| 分组 | 只做**按 skill 分组**（U8 裁定）；组标题同上表 11px `text-v2-text-text-muted` |
| 条目 | 两行：`name` 13px `text-v2-text-text-base` ＋ `description` 11px `text-v2-text-text-muted`（单行截断）；**无图标**（同上「造数据」那条） |
| 行高 | ≥ 40px |
| 「收藏」「最近使用」 | 本轮**不做**，挂 009（见 `spec.md` US3 的更正文） |

- **不采用 `app/src/components/ui/drawer.tsx`**（corvu，`fixed inset-y-[6px] end-[6px] w-[560px]`
  ＋ overlay）——它的宽度与**阻断语义**是按应用级侧栏设计的。塞进 360px 右栏要么改宽要么去掉
  overlay，改它等于把它掰成另一个组件（该文件头部注释自己也写着「only used in one place hence
  not a v2 component yet」）。
- **不做全屏遮罩**：民警用抽屉时多半在**看着中栏选中的东西**挑 skill（那正是上下文指令存在的理由）。
  带 scrim 的 modal 会盖住他正在看的东西，把「随用随现」变成「先记下来再开面板」。
- 圆角取 10px 是**右栏内浮层的唯一一档**——原生 `PromptInputV2Popover` 与 `PromptPopover`
  都写 `rounded-[10px]`。同一栏里两套浮层圆角不一致会露破绽。§3.1 的「弹窗 16px」指**应用级对话框**
  （实测先例 `auth/change-password.tsx` 的 `rounded-2xl`），是另一档，别混。

#### 4.7.4 `/` 命令面板

| 项 | 规范 |
|---|---|
| 唤起 | 输入框内打 `/` |
| 形态 | **照搬**原生 `PromptPopover`：`absolute inset-x-0 -top-2 -translate-y-full`、`max-h-80`、`p-2`、`rounded-[10px]`、`bg-v2-background-bg-base`、`shadow-[var(--v2-elevation-raised)]` |
| 条目 | 原生逐字：`flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover`，当前项 `bg-v2-overlay-simple-overlay-hover` |
| 匹配 | 模糊匹配 **skill 全集**（FR-005）；**不做**前端授权过滤（U2 裁定，宪法 §四） |

> ⚠️ **T007 开工第一件事是先核一件事**：若 T008 用的是原生 `v2/prompt-input`，而它**自带的**
> 那个弹层（`PromptInputV2Popover` / `PromptPopover`）本来就挂在 `/` 上——那 T007 可能只是
> **换一个数据源**（`SkillCapability` 全集 → 原生 `SlashCommand` 形状），而不是新写一个浮层。
> **能换数据源就不新写**（第一号约束：与上游的冲突面越小越好）。本节上表就是那个弹层当前的**实况**，
> 换数据源时按它对齐即可。

#### 4.7.5 右栏会话（Hero 输入）

| 项 | 规范 |
|---|---|
| 输入框 | 原生 `v2/prompt-input` 的外壳**原样**：`rounded-xl`(10px) + `bg-v2-background-bg-base` + `shadow-[var(--v2-elevation-raised)]` + `min-h-[96px]` |
| 消息流 | `SessionTurn` 逐个渲染（T001 实测：`MessageTimeline` 有 20 个 props、内部直接用页面级 context，**不搬**） |
| 会话管理 | 新建 / 切换走 SDK `session.create` / `session.list` |

> ⚠️ **这里与 §3.1 有一处冲突，需裁定**。§3.1 写「卡片 / 输入框（右栏对话 Hero 输入）12~16px」，
> 而原生 `prompt-input-v2` 的外壳是 `rounded-xl`＝**10px**。两条路：
> **(A) 沿用原生 10px**（本草案采用的），并把 §3.1 该行的右栏口径改成「沿用原生 10px」——
> 不新增任何覆盖层，少一处将来会漂的联姻；**(B) 用 app 级 CSS 覆盖到 16px**——正例是
> `components/dialog-command-palette-v2.css` 就把原生 dialog 容器覆盖成了 12px，技术上可行。
> 推荐 (A)：§3.1 的 12~16px 来自 front 参考（千问 16px），那个值落不到原生外壳上而不动上游。
> **请裁定 A 或 B**；选 B 则本节要补一条覆盖清单，并说明它为什么值得多一处联姻。

---

## 三件要请用户裁定的事

| # | 事项 | 我的建议 | 影响面 |
|---|---|---|---|
| 1 | Hero 输入圆角：沿用原生 10px（A）还是覆盖成 16px（B） | **A** | 选 B 要改 `§3.1` 并新增 app 级覆盖 |
| 2 | 右栏底面 / 卡面圆角 / 卡宽（96px）三处 ⚠️ 待复核项 | 按草案 | 只影响 `ai-session/` 的 class 串，不动上游 |
| 3 | 常用操作行内排序：「通用」的卡排模块自己的卡前面还是后面 | **前面**——常数在前才形成肌肉记忆（第一张卡永远在同一位置），模块的是变量 | `common-cards.tsx` 一处；`projection.ts` 有意不钉（只保证集合，见 T003 出参） |

## 与既有裁定的对齐（自查）

- **U6**：本节取值只来自 `theme.css` 与原生既有档位，无新 hex / 新 token；起草件在 feature 目录。✓
- **U7（暗色挂账）**：本节所有取值都在 **light 档**。`--v2-background-bg-accent-soft`（选中态浅金）
  在 **dark 档没有覆盖**（品牌浅金在暗底上对比度 1.99:1，2026-10-07 005 裁定）⇒ 本节同 §6.2：
  **不启用暗色**。这一条**两处各记一次**：本草案 ＋ 006 的 `state.md` 缺口表。✓
- **U2**：`/` 命令面板匹配**全集**，前端不过滤。✓
- **U8**：抽屉只做分组，另两个加权因子挂 009。✓
- **U9**：`ai-session` 已在 `design-token-refs.test.ts` 的 `自有目录` 里（本草案提到的每个 token
  名都会被它查）——所以草案里写的名字**必须**是真的，这正是本节先对表再写字的理由。✓

## 落点文件（本节生效后 T004–T008 据此写码）

| 文件 | 消费本节的哪几节 |
|---|---|
| `packages/app/src/ai-session/common-cards.tsx` | 4.7.1、4.7.2 |
| `packages/app/src/ai-session/context-cards.tsx` | 4.7.1、4.7.2 |
| `packages/app/src/ai-session/skill-drawer.tsx` | 4.7.3 |
| `packages/app/src/ai-session/command-palette.tsx` | 4.7.4 |
| `packages/app/src/ai-session/session-panel.tsx` | 4.7.5 |

## 核对记录（本节每条取数的来源，便于复核时重跑）

| 说法 | 取数命令（在仓库根跑） |
|---|---|
| 桥接类 51 条及其名单 | `grep -o '^\s*--color-v2-[a-z0-9-]*' packages/ui/src/styles/tailwind/colors.css \| sort` |
| `--color-v2-elevation-*` 为 0 | `grep -c 'color-v2-elevation' packages/ui/src/styles/tailwind/colors.css` |
| 正则只收 `v2-` 开头的捕获组 | `packages/app/src/workspace/design-token-refs.test.ts` 的 `名` / `变量引用` / `工具类引用` |
| 右栏 360px / 240~2/3、tab 40px、选中态浅金 | `openhive-DESIGN.md` §4.1 / §3.2 / §1.3 |
| 原生 Hero 外壳 `rounded-xl`＋`min-h-[96px]`＋`elevation-raised` | `packages/session-ui/src/v2/components/prompt-input/index.tsx` 的 `<form data-component="prompt-input-v2">` |
| 原生 `/` 弹层逐字 class | `packages/app/src/components/prompt-input/slash-popover.tsx`、`.../v2/components/prompt-input/index.tsx` |
| `⋯`＝U+22EF、`size-6`、`rounded` | `packages/app/src/center/tab-bar.tsx` |
| `splitTabOverflow(条数, 可用宽, {…})` 宽度是参数 | `packages/app/src/center/tab-overflow.ts` |
| 原生浮层 10px / 应用级 dialog 16px（12px 覆盖） | `slash-popover.tsx` / `auth/change-password.tsx:72` / `components/dialog-command-palette-v2.css` |
| skill 无图标/标签元数据 | `packages/app/src/ai-session/capabilities.ts` 文件头 |
| 影子先例 `shadow-[var(--v2-elevation-raised)]` | `packages/app/src/components/prompt-input/slash-popover.tsx:64` |
