# Feature Specification: AI 会话（右栏指令卡）

**Feature Branch**: `006-ai-session`

**Created**: 2026-09-26

**Status**: Draft

**Input**: PRD §6 F8 AI 会话 + design-v2 §8.2（通用指令卡机制）/§8.3（右栏会话）

---

## User Scenarios & Testing

### User Story 1 - 通用指令卡机制（Priority: P1）

右栏 AI 助手提供一套**通用指令卡机制**：顶部常驻「常用操作」指令卡、随中栏选中动态浮现的「上下文指令」卡、「更多 skill」抽屉、`/` 命令面板。机制通用、内容随模块——用户在哪个模块，指令卡就投影哪个模块 skill 的能力清单。

**Why this priority**: 指令卡是「薄界面 + 厚 skill」的关键——用通用 UI 暴露各模块 skill 能力，降低民警「不知道问什么」的门槛。

**Independent Test**: 点一张指令卡填入一句话、AI 执行，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警进入任一模块右栏，**When** 观察顶部，**Then** 看到「常用操作」指令卡（当前模块高频能力，固定一行）
2. **Given** 民警点某指令卡，**When** 点击，**Then** 填入一句话，AI 执行并展示过程（AC-F8-01）
3. **Given** 指令卡空间不足，**When** 观察，**Then** 溢出收进行末「⋯」，不用横向滚动条

---

### User Story 2 - 上下文指令动态浮现（Priority: P1）

「上下文指令」卡随中栏选中动态浮现——选中账户/号码、上传文件时才出现对应指令（如选中账户 →「关联分析/资金链追踪/标为涉案」），无上下文即消失。

**Why this priority**: 上下文指令是「随用随现」的情境引导，把指令卡从「固定列表」变成「跟着手上操作走」，是降低门槛的核心。

**Independent Test**: 选中账户后浮现「关联分析」等指令，取消选中后消失，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警选中若干账户，**When** 观察右栏，**Then** 浮现「关联分析/资金链追踪/标为涉案」等上下文指令
2. **Given** 民警取消选中（无上下文），**When** 观察右栏，**Then** 上下文指令消失

---

### User Story 3 - 更多 skill 抽屉 + / 命令面板（Priority: P1）

「更多 skill」抽屉收纳其他 skill（**按 skill 分组**）；`/` 命令面板模糊匹配 **skill 全集**，输入 `/` 唤起。

> ⚠️ **2026-10-07 更正（裁定 U2 / U8）**：本故事原写「有权 skill」「最近使用上浮 + 收藏加权排序」。
> **「有权」**——前端**不做**授权过滤（宪法 §四，授权在执行层），故改为「skill 全集」；「有权」这一半
> 降级挂账（见 SC-004 更正）。**「最近使用」/「收藏」**——本轮只做**分组**，两个加权因子**挂 009**
> （接收方表已记）。

**Why this priority**: 抽屉与命令面板是「skill 能力可发现性」的兜底——指令卡只放高频，其余能力靠抽屉/命令面板找到。

**Independent Test**: 打开抽屉看到 skill 分组，输入 `/` 模糊匹配 skill，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警点「更多 skill」抽屉，**When** 打开，**Then** 收纳 skill，**按 skill 分组**
2. **Given** 民警输入 `/`，**When** 唤起命令面板，**Then** 模糊匹配 skill 全集，可快速选择

---

### User Story 4 - 右栏 AI 会话（最小可用）（Priority: P1）

右栏提供**最小可用会话**（2026-10-07 裁定 U1(c)）：会话消息流 + 会话新建/切换。能力由
`@opencode-ai/session-ui` 的原语组合而成（`session-turn` / `message-part` / `v2/prompt-input`）＋ SDK `session.*`。

**Why this priority**: 会话是 AI 干活的基础载体。**不复用** `SessionSidePanel`——实测它是 review-diff ＋
文件树、不是消息流（见 `state.md` 的 T001 出参），故「最小可用」是本 feature 自建的合理规模。

**Independent Test**: 右栏新建会话、对话、切换会话，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警在右栏输入，**When** 发送，**Then** AI 回复展示在消息流
2. **Given** 民警新建/切换/删除会话，**When** 操作，**Then** 会话管理正常

---

### User Story 5 - 业务规则：AI 不滥用 + 高风险人确认（Priority: P2）

AI 只执行「确定性查询/统计」与「需要专家经验的研判」，不滥用 AI 做确定性的事；高风险动作（删除数据、判定涉案）必须人确认。

**Why this priority**: 这是 AI 使用的安全边界——确定性的事不走 AI，高风险动作留给人，防止 AI 幻觉或越权。

**Independent Test**: 触发高风险动作（判定涉案/删除）强制人确认，即可独立验证。

**Acceptance Scenarios**:

1. **Given** AI 遇到确定性查询/统计，**When** 执行，**Then** 走**工具 / 代码执行路径**，不滥用 AI 生成
   > ⚠️ **2026-10-07 更正（裁定 U5；T011 开工时已按此改写正文）**：原文是「走确定性路径（MCP）」——
   > 「（MCP）」**作废**：本仓没有 MCP server（opencode 只是 MCP **客户端**），照原样写会得到一条
   > **空的**断言（`LEARNINGS #004-13` 的 (b) 类）。落点与出参见 `tasks.md` 的 **T011 更正块**。
2. **Given** 触发高风险动作（删除数据、判定涉案），**When** 执行，**Then** 强制人确认（AI 只提取/查证/预填，不替人下结论）

---

### Edge Cases

- 无上下文时，上下文指令卡消失，不占空间。
- 指令卡空间不足时溢出收「⋯」，不横向滚动。
- AI 被 prompt injection 诱导执行高风险动作时，人确认闸门 + 执行层鉴权（F4）硬拦。

---

## Requirements

### Functional Requirements

- **FR-001**: 右栏 MUST 提供一套通用「指令卡机制」，各模块共用一套 UI，机制通用、内容随模块。
- **FR-002**: 顶部 MUST 常驻「常用操作」指令卡（当前模块高频能力，固定一行，溢出收「⋯」）。
- **FR-003**: 「上下文指令」MUST 随中栏选中动态浮现（选中账户/号码、上传文件），无上下文即消失。
- **FR-004**: 「更多 skill」抽屉 MUST 收纳 skill，MUST 按 skill 分组。（「最近使用上浮」「收藏加权」本轮**不做** → 挂 009，见 US3 更正。）
- **FR-005**: `/` 命令面板 MUST 模糊匹配 **skill 全集**，输入 `/` 唤起。（**不做**前端授权过滤 → 宪法 §四，授权在执行层。）
- **FR-006**: 指令卡框架 MUST 机制通用——各模块 skill 只需声明能力清单，框架自动投影，不重画一遍。
- **FR-007**: 点指令卡 MUST = 填入一句话，AI 执行并展示过程。
- **FR-008**: AI MUST 只执行「确定性查询/统计」与「需要专家经验的研判」，不滥用 AI 做确定性的事。
- **FR-009**: 高风险动作（删除数据、判定涉案）MUST 强制人确认。
- **FR-010**: 右栏 MUST 复用 opencode 原生会话能力（会话消息流、会话管理）。

  > ⚠️ **2026-10-07 更正（裁定 U11 · 笔 3）**：原文第三项「**导出会话**」**作废**——本仓**没有**这个能力。
  > 实测：会话相关只有 CLI `session list` / `session delete`，与 SDK `session.share` / `unshare`；
  > 而 share 的文案是 **`"Publish on web"` /「复制链接」**（`packages/app/src/i18n/en.ts` 的
  > `session.share.popover.title`）——那是**发布到网上**，不是导出；全仓没有任何 export 路由 / 命令。
  > 原出处是 `2026-09-06-openhive-design-v2.md:340`「……会话管理、导出会话——全部原生已有，直接用」，
  > 属**上游文档的泛述**；照抄会得到一条**没有对象**的需求（`LEARNINGS #002-02`）。
  > 故 FR-010 收敛为「**会话消息流 ＋ 会话管理**」。⚠️ 两件事**不因本条更正而被认作已落地**：
  > ① 若业务确需「导出」（本地文件 / PDF…），那是**新需求**，按新 feature 走，不挂 FR-010 名下；
  > ② `session.share` 是**云端发布**，公安数据场景的适用性**未裁定**。

### Key Entities

- **指令卡**：类型（常用操作 / 上下文指令）、关联 skill、投影模块。
- **skill 能力清单**：各模块 skill 声明的能力列表，供指令卡框架投影。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 点指令卡填入一句话，AI 执行并展示过程（AC-F8-01）。
- **SC-002**: 上下文指令随中栏选中动态浮现 / 取消选中消失。
- **SC-003**: 高风险动作（删除数据 / 判定涉案）100% 强制人确认。
- **SC-004**（**已降级 · 2026-10-07 裁定 U2**）: skill 在抽屉 / 命令面板**可被发现**。
  
  ⚠️ 原文是「**有权** skill 在抽屉 / 命令面板可被发现」——「有权」这一半**降级挂账**（接收方 → `009-ai-assets`）。
  本 feature 的 skill 来源是**本机 scanner 扫到的 skill 全集**，前端**没有**「按用户授权过滤」的输入
  （`capability` / `sessionRuleset` / `AccessSession` 在 `packages/app` 里**零引用**，见 `state.md` 的 D0 实测）。
  按宪法 §四，授权在**执行层**强制，前端**不做**隐藏式过滤（隐藏既不阻止调用、也不阻止越权）。
  故本 feature 只对「**可发现**」负责；「**有权**」的可发现性依赖 009 的资产授权元数据。

---

## Assumptions

- 指令卡通用机制是 harness 提供的通用 UI，各模块 skill 声明能力清单后框架自动投影。
- 右栏会话**自建「最小可用右栏会话」**（2026-10-07 裁定 U1(c)）：复用 `@opencode-ai/session-ui`
  的原语（`session-turn` / `message-part` / `v2/prompt-input`）＋ SDK `session.*`（`list` / `create` /
  `messages` / `update`）。**不复用 `SessionSidePanel`**——实测它是 review-diff ＋ 文件树，
  **不是消息流**（取数见 `state.md` 的 T001 出参）；原生消息流 `MessageTimeline` 有 20 个 props、
  过半是页面级滚动机制，挂进右栏等于再造一份页面状态。
- 各模块特定指令卡内容（资金/话单的「清洗/关联分析」等）已在 F6/F7 定义，本 feature 定义通用机制。
- skill 本身的治理（分类/生命周期/授权）在 F9 展开，本 feature 只定义「指令卡 = skill 能力的可发现入口」。
- 收藏（个人偏好）作为抽屉排序的加权因子，其存储与治理在 F9。
