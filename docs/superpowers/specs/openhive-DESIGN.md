# OpenHive DESIGN.md — 前端设计系统全貌

> 本文档是 openhive 前端视觉规范的**真理来源之一**（另一个是 opencode 原生 `theme.css` 的语义变量）。
> 由 `front/`（Figma Make 设计产物）+ `discussions/视觉规范/` 提炼而成。
>
> - **创建**：2026-09-27
> - **来源**：`front/src/index.css` + `front/src/components/` + `docs/superpowers/discussions/视觉规范/2026-09-06-蜂巢前端设计建议.md` + `2026-09-06-蜂巢logo规范.md`
> - **关系**：宪法（constitution）记**方向**，本文档记**值**。具体 hex / token 以本文档为准。

---

## 0. 设计哲学

**蜂巢 = 蜂蜜金 × 六边形 × 暖白专业风。** 面向民警（非技术用户），做「政务专业感」：稳重、可信、克制，但入口友好、对话优先。

| 来源 | 借鉴 |
|---|---|
| Cloudflare OS | 六边形品牌、暖白底、单一品牌色纪律、克制圆角、线性图标 |
| 千问办公 | 对话优先（Hero 输入）、冷启动引导、阴影分层（卡片浮起） |
| 蜂巢自己 | 蜂蜜金品牌色、六边形蜂巢 logo、深色登录背景 |

- **薄界面 + 厚 skill**：界面只做「浏览 + 操作」，分析能力由 skill 承载。
- **三栏**：左导航 / 中浏览（内容工作区）/ 右 AI 会话。

---

## 1. Colors

### 1.1 品牌色（蜂蜜金三档）

| Token 语义 | 色值 | 用途 |
|---|---|---|
| 品牌浅金 | `#F59E0B` | 蜂窝渐变起点、标签底色、选中态浅底、深色版描边/文字 |
| 品牌主金 | `#D97706` | logo 外六边形描边（浅色版）、高亮、链接、图标、选中态、tab 激活顶边 |
| 品牌深金 | `#B45309` | 蜂窝渐变终点、hover 加深 |

> **落到的 v2 语义变量**（T017 换皮）：三档金在 `packages/ui/src/v2/styles/theme.css` 的品牌块里
> **只定义一次**——`--v2-brand-gold-light` / `--v2-brand-gold` / `--v2-brand-gold-deep`；其余槽位一律引用它，
> 不重复 hex：`--v2-background-bg-accent`、`--v2-text-text-accent(-hover)`、`--v2-icon-icon-accent(-hover)`、
> `--v2-border-border-focus`（琥珀焦点环）。品牌图形标用三档金本身（描边主金、蜂窝浅金→深金）。

### 1.2 中性色（暖色调）

| Token 语义 | 色值 | 用途 |
|---|---|---|
| 主背景（暖白） | `#FCFCFC` | 主界面底色，长时间工作不累眼 |
| 主文字（暖黑） | `#1C1A18` | 正文、标题、主 CTA 底 |
| 灰阶（辅助） | slate 系 | 边框 `slate-200`、次级文字 `slate-500/600`、分隔 `slate-100` |

### 1.3 语义色（数据/状态，来自 front 组件实况）

| 语义 | 色值 | 用途 |
|---|---|---|
| 进账 | 蓝 `#3B82F6`（浅底 `blue-50`） | 资金明细「贷(进账)」行浅蓝底 + 蓝字 |
| 出账 | 白底（`white`） | 资金明细「借(出账)」行白底 |
| 高危 | 红 `red-100/red-700` | 风险标记「高危」 |
| 极危 | 紫 `purple-100/purple-700` | 风险标记「极危」 |
| 已导入/完成 | 绿 `emerald-100/emerald-800` | 关注清单「已导入」状态 |
| 选中态 | 浅金 `#FEF3C7`（≈ `#F59E0B` 低透明度） | 图标栏/列表选中底色（v2：`--v2-background-bg-accent-soft`） |
| 话单模块色 | 蓝 `--v2-avatar-bg-blue` | 话单 tab 的模块图标色（按模块着色的取值见 §4.5；**不是**文字徽章） |

---

## 2. Typography

### 2.1 字体栈（**系统字体，内网零加载**）

> 视觉规范 §3 明确：**不用 Google Fonts**（内网不通）、不用纯拉丁字体。front `index.css` 第 1 行的 Google Fonts `@import` 是**待删死代码**。

| 用途 | 字体栈 |
|---|---|
| 正文 / UI | `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif` |
| 等宽（账号/流水号/金额/代码） | `"JetBrains Mono", "SF Mono", Consolas, monospace`（内网优先系统等宽 Consolas / SF Mono） |

### 2.2 字号/字重/行高（front 组件实测）

| 层级 | 字号 | 字重 |
|---|---|---|
| 表格/正文/工作区 | 14px（工作区默认 14px，可调 12~24px） | 400~500 |
| 标题/卡片标题 | 14~16px | 600~700 |
| 品牌字「OpenHive」 | 24px | 700 |
| 品牌字「蜂巢」标签 | 13px | 600 |
| 徽章/标签/辅助 | 9~11px | 600~700 |

---

## 3. Spacing & Radius

### 3.1 圆角（调和 Cloudflare 8px 与千问 24px）

| 元素 | 圆角 |
|---|---|
| 卡片（中栏内容卡） | 12~16px |
| 输入框（右栏对话 Hero 输入） | **沿用 opencode 原生外壳的 10px**（`prompt-input-v2` 的 `rounded-xl`；见 §4.7.5）——那个外壳是原生组件，改成 12~16px 只能靠 app 级 CSS 覆盖，代价是多一处会漂的联姻 |
| 按钮 | 8~10px |
| 弹窗 / 大容器 | 16px |

### 3.2 信息密度

- 左栏导航 14px 小字，弱化；中栏白底卡片 + 柔和阴影，内容为主。
- 表格紧凑、`sticky` 表头、`font-mono` 显示账号/金额/流水号。
- 中栏 tab 高 40px，激活态顶边 2px 蜂蜜金 `#D97706`。

---

## 4. Components

### 4.1 三栏布局

| 栏 | 宽度 | 职责 | 视觉 |
|---|---|---|---|
| 左图标栏（rail） | 56px | 五入口 + 系统设置 | 白底，选中浅金底 + 左侧金色竖条 |
| 左项目侧栏 | 280px（可拖 160~50%） | 项目/文件树/会话/资金节点树 | 浅底，13px 小字 |
| 中栏（内容工作区） | 自适应 | 浏览 + 操作（四视图 / 文件编辑） | 白底卡片 + 柔和阴影 |
| 右栏（AI 会话） | 360px（可拖 240~2/3） | 对话优先，输入框视觉中心 | 借千问 Hero 输入 |

### 4.2 关键 UI 块

| 组件 | 规范 |
|---|---|
| 中栏 tab（文件 tab） | 图标 + 文件名 + 关闭按钮；**无模块徽章**；激活态白底 + 顶边 2px 蜂蜜金 |
| 图标栏五入口 | 项目 / AI 资产 / AI 会话 / 话单分析 / 资金分析；单色线性图标 |
| 数据四视图 | 明细 / 聚合统计 / 关注清单 / 桑基图（资金）；通话关系图（话单）；由内容区 Sub View Switcher 切换，**不作顶层 tab** |
| 主 CTA 按钮 | 暖黑底 `#1C1A18` + 白字，10px 圆角，600 字重 |
| 次要按钮 | 灰底 `rgba(28,26,24,0.07)`，10px 圆角 |
| 链接 / 高亮 | 蜂蜜金 `#D97706` |
| 卡片 | 白底 `#FFF` + 阴影 `0 1px 2px + 0 4px 12px` 柔和投影，16px 圆角 |
| 选中态 | 浅金底 `#F59E0B` @ 10% 透明度 |
| 输入框 | 白底 + 大圆角 16px + 柔和阴影 |
| 数据表格 | 紧凑、sticky 表头、进账浅蓝底/出账白底、风险标记红/紫 |

### 4.3 信息密度原则

- 状态提示配图标/文字，不只靠颜色（可访问性）。
- 正文对比度 ≥ 15:1（暖黑对暖白）。
- 焦点状态补蜂蜜金 focus ring。

### 4.4 顶栏（topbar）

复用 opencode 原生 `titlebar.tsx` 的注入点挂载（**不改 Titlebar 主体**，见 §八 组件基底约束）。
四要素自左至右：

| 要素 | 规范 |
|---|---|
| 品牌 Logo | 图形标（六边形蜂窝，24×28）+ 文字标「OpenHive」+「蜂巢」标签；详见 §5.1 |
| 站内信 | 图标按钮；有未读时附红点，**未读数以数字呈现**（§4.3 不只靠颜色） |
| 全屏 | 图标按钮，切换浏览器全屏 |
| 用户下拉 | 首字头像 + 姓名 + 警号；下拉项：个人信息 / 修改密码 / 用户管理（限管理员）/ 退出登录 |

- 高度**沿用 opencode 原生 v2 顶栏（36px）**，不另设高度、不另设底色。
- 底色 / 分隔线 / 图标色一律引用 `theme.css` 语义变量，**不新增 hex**；品牌金等值待 v2 token 换皮后自动生效。
- 品牌名与标签文案**走配置**（`VITE_OPENHIVE_BRAND_NAME`），源码只留兜底默认值。

### 4.5 中栏 tab 栏（内容视图 tab）

**与顶栏 session tab 条的分工**（两条 tab 系统并存，互不搬运）：

| | 顶栏 session tab 条 | 中栏 tab 栏（本节） |
|---|---|---|
| 位置 | 原生 `titlebar.tsx` 的 `TitlebarTabStrip` | 三栏的中栏顶部 |
| 承载 | **opencode 会话** tab（一个会话一张） | **内容视图** tab：模块动作打开的明细 / 图 / 文档 / 图谱 |
| 状态 | `context/tabs.tsx`（session / draft） | openhive 自有 `center/tab-store.ts`（跨模块累积，FR-004） |
| 溢出 | 横向滚动 + 两端渐隐 | 行末「⋯」（FR-005） |

两者**不共享状态、不互相搬运**；顶栏空间不足时收窄的是 session tab 条，不是中栏 tab 栏（plan.md R5）。

| 项 | 规范 |
|---|---|
| tab 结构 | 模块图标 + 文件名 + 关闭按钮；**无模块徽章**（§4.2） |
| tab 高 | 40px（§3.2） |
| 激活态 | 白底 + 顶边 2px 蜂蜜金（§3.2 / §4.2） |
| 来源模块标识 | **按模块着色**（FR-005）：tab 的模块图标取该模块的**实体身份色**（下表）。着色**不是**徽章——不加文字胶囊，且模块图标本身形状各异，故「形状 + 颜色」双通道区分（配合 §4.3「不只靠颜色」） |
| 溢出 | 放不下时尾部 tab 收进行末「⋯」，**不用横向滚动条**（FR-005） |

**模块 → 实体身份色**（取值一律引用 v2 语义变量 `--v2-avatar-bg-*`——设计系统里「每个实体一个稳定色」的那套轮转，与 `ProjectAvatar` 同源；**不新增 hex**）：

| 模块 | token |
|---|---|
| 项目管理 `project` | `--v2-avatar-bg-gray` |
| AI 资产 `ai-assets` | `--v2-avatar-bg-purple` |
| AI 会话 `ai-session` | `--v2-avatar-bg-cyan` |
| 话单分析 `cdr-analysis` | `--v2-avatar-bg-blue`（沿用 §1.3「话单 = 蓝」） |
| 资金分析 `fund-analysis` | `--v2-avatar-bg-green` |
| 未知 / 未登记的模块 | `--v2-avatar-bg-gray`（兜底，不抛错、不留白） |

> ⚠️ 这套「模块 → 色」的**取值**属待设计侧复核项：只有「话单 = 蓝」有 §1.3 的既有依据，其余五个是我按色相可区分性挑的。改色只动本表 + `center/module-color.ts` 一处映射，组件不用改。

### 4.6 内容区的「看不了」呈现（降级面板）

内容区拿不到画面时**不许白屏、也不许一句「出错了」糊过去**（FR-007 / US3 AC3）：必须说得出
**是哪种**看不了。五档的差别不是措辞偏好——每一档指向**民警的下一个动作**不同（换工具 / 补内容 /
去要密码 / 重新取证 / 重开标签），混成一档就等于把人往错的方向指。

| 档位（`reason`） | 何时 | 图标 | 标题 |
|---|---|---|---|
| `unsupported` | 认得出格式，但这条路没接（老 `.doc`、XMind 8、压缩方式/zip64） | `circle-ban-sign` | 这种格式暂时看不了 |
| `empty` | 内容源没取到东西（不是文件的问题） | `dash` | 没有取到这个文件的内容 |
| `encrypted` | **文件锁着**（加密 PDF / 加密的 Word 文档 / 加密工作簿 / 加密 zip 条目） | `shield` | 这个文件是加密的 |
| `error` | 真故障：损坏、结构不对、超出安全上界 | `warning` | 这个文件打不开 |
| `load-failed` | **我们**这边的预览功能没加载出来 | `warning` | 这次没能打开预览 |

说明（detail）统一带**文件名**（`{name}` 是**末段文件名、不带路径**——`D:\案件\2026-0912\卷宗.pdf`
那种前缀塞进这句话只会让人更看不出它说的是哪份），让民警一眼认出「是哪个看不了」；五档各一句话：

| 档位 | detail |
|---|---|
| `unsupported` | 「{name}」还没有对应的预览视图。 |
| `empty` | 没有取到「{name}」的内容。 |
| `encrypted` | 「{name}」需要密码才能预览。 |
| `error` | 「{name}」的内容读不出来，可能已经损坏。 |
| `load-failed` | 打开「{name}」要用的预览功能没有加载成功，重新打开这张标签试试。 |

- 三件套 = 图标 + 标题 + 说明（§4.3：状态提示配图标/文字，不只靠颜色）。图标名取自 opencode
  原生图标集（**无 lock/key 一档**，加密档取 `shield`：同一风险语义里最贴的一个）。
- 图标色由**祖先**注入 `--icon-base`（`icon.css` 给图标自身写了 `color: var(--icon-base)`，
  写在图标上的 `text-v2-icon-*` 到不了它）；取值 `--v2-icon-icon-muted`。**不新增 hex**。
- 文件名是**不可信输入**（来自文件名 / 内容键）：只当文字，永不进 HTML。**只取末段**（见上表上方
  的说明）：各调用点都按这个形状给——中栏（`center-content.tsx`）给 tab 标题，字节型视图
  （`binary-view.tsx`）与代码视图（`code-view.tsx`）切 `path` 的末段。**不记调用点数目**：这份
  清单的条数已经错过一次，点名字比记数目耐改。
- ⚠️ 措辞（五档标题与说明的具体字句、`shield` 这个图标选型）属**待设计侧复核项**，同 §4.5 的
  模块配色注记；改文案只动 `center/degraded-view.tsx` 的 `说法` 一处。

### 4.7 AI 会话 · 四层指令卡（右栏）

右栏的指令卡与 skill 入口是**同一套机制的四个出口**（design-v2 §8.2）：投影框架
（`ai-session/projection.ts` 的纯函数）把「当前模块的能力清单」投成四支，四个出口各取一支。
**四支由框架定，长相由本节定**——本节只写长相，不重复框架的契约。

| 层 | 取投影的哪一支 | 位置 | 常驻 | 落地文件 |
|---|---|---|---|---|
| 常用操作 | `common` | 右栏顶部，固定一行 | 是 | `ai-session/common-cards.tsx` |
| 上下文指令 | `context` | 常用操作**下方**，无上下文时整段不渲染 | 否 | `ai-session/context-cards.tsx` |
| 更多 skill | `drawer`（按 `group` 分组） | 右栏内浮层（§4.7.3） | 否 | `ai-session/skill-drawer.tsx` |
| `/` 命令面板 | `all`（模糊匹配全集） | Hero 输入框上方浮层 | 否 | `ai-session/command-palette.tsx` |

前两层（常用操作 / 上下文指令）的**长相住在同一个文件**里：`ai-session/instruction-cards.tsx`
——卡片本身、分组标题、行末溢出「⋯」都在那儿（下面 §4.7.1 / §4.7.2 的全部规矩都落在那一个文件上）。
`common-cards.tsx` / `context-cards.tsx` 只做一件事：**取投影的哪一支 ＋ 叫什么标题**。
这是「同一张卡的语法只有一个」在文件层面的落法——两层各写一份卡面就是把它拆回两份。

四条共同的规矩，先说在前面：

- **同一张卡的语法只有一个。** 常用操作与上下文指令**长相完全相同**（同一个 `InstructionCard`
  渲染），来源不同不靠长相区分，靠**分组标题**。FR-001 要的是「机制通用」，给两层两种长相就是把
  「通用」在视觉上又拆回两份。
- **卡面不带图标。** 不是审美取舍：`ai-session/capabilities.ts` 的注释里已记明，skill 的
  **图标 / 分类 / 标签今天没有客观来源**（`SKILL.md` frontmatter 只有 `name` / `description` /
  `slash`；009 §11 的资产元数据还没落地）。给卡面配图标就是**造数据**。等 009 落地后再议。
- **状态提示配文字，不只靠颜色**（§4.3）。本节的层级差异一律**同时**由位置（第几行）与字号表达，
  颜色只做加强。
- **不新增 hex、不新增 token。** 下文每个名字都在 `packages/ui/src/v2/styles/theme.css` 里，
  或取自 Tailwind 的既有刻度（`rounded-lg` / `w-24` / `size-6` 这类）。

#### 4.7.0 一行里的取用纪律（**先读这条，再读下表**）

`theme.css` 的 v2 名字要经生成物 `packages/ui/src/styles/tailwind/colors.css` 的 `--color-v2-*`
才能当 Tailwind 工具类用（生成物开头就是 `--color-*: initial`，把 Tailwind 默认调色板整个清空）。
**那 51 条孪生不覆盖全部 token**——2026-10-07 实测：

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
>
> ⚠️ **上面那张表别照抄进源码注释**（2026-10-07 实测踩到）：那个测试扫的是**文件全文**，
> 注释里写下的反例——把 `bg-` 或 `shadow-` 前缀直接接上无孪生的名字——**一样算「写了工具类形态」**、
> 一样判红。本表在本文档里没报错，只因为**文档不在扫描范围内**（它只扫 `packages/app/src` 下那七个目录）。
> 要在源码里说这件事，就把前缀与名字**拆开写**（写成「`shadow-` ＋ 后者」），别连着写。

#### 4.7.1 指令卡（常用操作 / 上下文指令共用）

| 项 | 规范 |
|---|---|
| 形状 | 白底卡片：`bg-v2-background-bg-base` + `shadow-[var(--v2-elevation-raised)]` + `border border-v2-border-border-muted` |
| 宽 | 定宽 `w-24`（96px）。**必须定宽**——见 §4.7.2 |
| 高 | `h-8`（32px） |
| 圆角 | `rounded-lg`（8px，§3.1 的按钮档） |
| 卡面文字 | 13px，`text-v2-text-text-base`，**单行截断**（`truncate`） |
| 行内间距 | `gap-2`（8px） |
| hover 态 | `hover:bg-v2-overlay-simple-overlay-hover` |
| 选中态 | `bg-[var(--v2-background-bg-accent-soft)]`（§1.3 选中态浅金） |
| 行底色 | 右栏底面 `bg-v2-background-bg-layer-01` |
| 行内排序 | 跨模块那支（`GENERIC_MODULE`）的卡排在**模块自己**的卡**前面**——常数在前才形成肌肉记忆：第一张卡永远在同一位置 |

三点说明：

- **圆角取 8px 而非 §3.1 的「卡片 12~16px」**：§3.1 那档是给中栏的**大内容卡**写的。这里是 360px
  栏内一行里的紧凑卡片，一行要放得下两张以上；16px 圆角会让一行卡看起来像两颗按钮球。8px 是 §3.1
  的**按钮档下沿**，也在 Tailwind 既有刻度上（`--radius-lg: 8px`）。
- **右栏底面取 `layer-01` 而非白**：卡片本身是白底。同白相叠时 §4.2 那条「柔和阴影」无处着力，
  卡片与底面糊成一片。给底面降一档，阴影才有分层的对象。
- **选中态 = 「输入框里那句话来自这张卡」**。它与 hover **必须不同色**（选中浅金、hover 灰 overlay）
  ——这条约定与 `rail.tsx` / `project/file-tree.tsx` 一致，别在两处各写一套。
  ⚠️ 若哪天判定这个态不稳定（输入框一改就掉），**就删掉这条引用**，不要留一条永不命中的分支。

> ⚠️ 圆角（8px）、右栏底面（`layer-01`）、卡宽（96px）三处属**待设计侧复核项**，同 §4.5 的模块
> 配色注记：改它们只动 `ai-session/instruction-cards.tsx` 的 class 串（卡面与溢出的那一份共享语法），
> 不动上游。

#### 4.7.2 分组标题与溢出

| 项 | 规范 |
|---|---|
| 分组标题（「常用操作」「上下文指令」） | 11px，`text-v2-text-text-muted`（§2.2 的「徽章/标签/辅助 9~11px」档） |
| 溢出钮 | 与 `center/tab-bar.tsx` 同一颗：字形 `⋯`（U+22EF，原生图标集**没有** ellipsis 一档）、`size-6`、`rounded`(4px)、`text-v2-icon-icon-muted`、`hover:bg-v2-overlay-simple-overlay-hover` |
| 溢出菜单 | 用原生 `MenuV2`（`@opencode-ai/ui/v2/menu-v2`），**不自己写一份**：浮层 chrome 由 `menu-v2.css` 给（min-width 160px / padding 2px / radius 6px / `box-shadow: var(--v2-elevation-floating)` / `z-index: 60`） |
| 可见几张 | 走**纯函数**（形态同 `center/tab-overflow.ts` 的 `splitTabOverflow(条数, 可用宽, {卡宽, 溢出钮宽})`，它的宽度已是参数 ⇒ 天然通用），**不读 `clientWidth`** |

- **可见数为什么必须是纯函数**：happy-dom **没有 CSS 引擎**，`clientWidth` 恒为 0、
  `getComputedStyle` 拿不到真值。任何「靠量出来的宽度算能放几张」的写法在本仓的测试环境里
  **测不了**——把它做成入参为宽度的纯函数，才有一条能红的断言。这是**测试可行性**决定的形状，
  不是审美偏好。
- 若发现卡片与 tab 的截断策略要分家（比如卡片不留尾缝），**另写一个同形的纯函数**，不改
  `center/tab-overflow.ts`——那份已经在守 FR-005。
- **「⋯」与「更多 skill」是两件事，界面必须分开**：`⋯` 装的是**本行放不下的那几张卡**；
  「更多 skill」打开的是**整个 skill 全集**。两者收纳范围差一个数量级，合成一个入口会让民警以为
  「⋯」里就是全部 skill。

#### 4.7.3 更多 skill 抽屉

| 项 | 规范 |
|---|---|
| 形态 | **只盖右栏**的面板：右栏容器 `relative`，面板 `absolute inset-0` |
| 底面 / 圆角 / 阴影 | `bg-v2-background-bg-base` / 10px / `shadow-[var(--v2-elevation-overlay)]` |
| 分组 | 只做**按 skill 分组**；组标题同上表 11px `text-v2-text-text-muted` |
| 条目 | 两行：`name` 13px `text-v2-text-text-base` ＋ `description` 11px `text-v2-text-text-muted`（单行截断）；**无图标**（同 §4.7 开篇那条） |
| 行高 | ≥ 40px |

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
| 匹配 | 模糊匹配 **skill 全集**；**不做**前端授权过滤（宪法 §四，授权在执行层） |

> ⚠️ **开工第一件事是先核一件事**：若右栏会话用的是原生 `v2/prompt-input`，而它**自带的**
> 那个弹层（`PromptInputV2Popover` / `PromptPopover`）本来就挂在 `/` 上——那这一条可能只是
> **换一个数据源**（skill 全集 → 原生 `SlashCommand` 形状），而不是新写一个浮层。
> **能换数据源就不新写**（第一号约束：与上游的冲突面越小越好）。上表就是那个弹层当前的**实况**。

#### 4.7.5 右栏会话（Hero 输入）

| 项 | 规范 |
|---|---|
| 输入框 | 原生 `v2/prompt-input` 的外壳**原样**：`rounded-xl`(10px) + `bg-v2-background-bg-base` + `shadow-[var(--v2-elevation-raised)]` + `min-h-[96px]` |
| 消息流 | `SessionTurn` 逐个渲染（`MessageTimeline` 有 20 个 props、内部直接用页面级 context，**不搬**） |
| 会话管理 | 新建 / 切换走 SDK `session.create` / `session.list` |

> 圆角**沿用原生 10px**（本节即 §3.1 那行「右栏对话 Hero 输入」的口径：原生外壳是 `rounded-xl`，
> 它落不到 12~16px 而不动上游）。**不**新增 app 级 CSS 覆盖——少一处将来会漂的联姻。

---

## 5. Brand

### 5.1 Logo（六边形蜂窝）

| 部分 | 规范 |
|---|---|
| 图形标 | 外**等边六边形**描边 + 中心实心渐变蜂窝；flat-top（上下尖），顶点程序计算（cos/sin 按 60°），**禁手写坐标取整** |
| 文字标 | 「OpenHive」粗体 24px/700 + 「蜂巢」圆角标签 13px/600，间距 8px（转 React 后用 flexbox `gap:8px` 控制） |
| 渐变 | 蜂窝垂直渐变 `#F59E0B → #B45309` |

| 文件 | 用途 |
|---|---|
| `logo-mark.svg` | favicon / 侧栏小图标 / 纯图形 |
| `logo-light.svg` | 主界面、浅色背景 |
| `logo-dark.svg` | 登录页、深色背景 |

### 5.2 品牌色语义

- 品牌金只做 logo / 图标 / 高亮 / 链接 / 选中态，**不做 CTA 底**（金底白字对比度不足）。
- CTA 用暖黑底白字。

### 5.3 图标约定

- 线性（描边）风格，借 Cloudflare 的克制。
- 品牌场景用六边形轮廓包裹（项目图标、资产图标角标）。
- 加载/生成态用旋转的六边形蜂巢图标。

---

## 6. Theme Mode

### 6.1 双色策略（登录 vs 主界面）

| | 登录页 | 主界面 |
|---|---|---|
| 背景 | 深色 `#0F172A` 深蓝黑 + 六边形网格纹理 + 金色光晕 | 暖白 `#FCFCFC` |
| 作用 | 第一印象 = 科技感 + 蜂巢品牌 | 长时间工作不累眼 + 专业 |

> 「深色做门面、浅色做工作」——登录页只停留几秒用深色立品牌，主界面长时间盯着干活必须浅色。

### 6.2 明暗模式

- **openhive 不启用暗色模式**（主界面固定浅色，不做 dark 切换）。
- opencode 原生 `theme.css` 虽内置 light + dark 两套变量，但换皮时**只改 light 一套**；dark 不对外开放，可保留默认或忽略。
- 深色仅用于登录页门面（§6.1），进入主界面后固定暖白浅色。

---

## 附：front 实况与本文档的差异（换皮时要处理的坑）

1. **front 的 `index.css` token 是 shadcn 模板默认值**（`--primary` 蓝色 `221.2 83.2% 53.3%`），不是 openhive 品牌色。真正的品牌色散落在组件 Tailwind 硬编码类（`text-[#D97706]` 等）里。换皮时以本文档 §1 为准。
2. **front 的 Google Fonts `@import` 是内网死代码**，视觉规范 §3 已明确要删，换皮时改用系统字体栈。
3. **front 的中栏 tab 曾带「资金/话单/项目」模块徽章**，视觉规范未要求徽章，应去掉（与项目管理 tab 统一）。
