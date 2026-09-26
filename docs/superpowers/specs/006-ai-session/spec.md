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

「更多 skill」抽屉收纳其他有权 skill（按 skill 分组 + 最近使用上浮 + 收藏加权排序）；`/` 命令面板模糊匹配任意有权 skill，输入 `/` 唤起。

**Why this priority**: 抽屉与命令面板是「skill 能力可发现性」的兜底——指令卡只放高频，其余能力靠抽屉/命令面板找到。

**Independent Test**: 打开抽屉看到有权 skill 分组，输入 `/` 模糊匹配 skill，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警点「更多 skill」抽屉，**When** 打开，**Then** 收纳有权 skill，按分组 + 最近使用 + 收藏加权排序
2. **Given** 民警输入 `/`，**When** 唤起命令面板，**Then** 模糊匹配任意有权 skill，可快速选择

---

### User Story 4 - 右栏 AI 会话（复用原生）（Priority: P1）

右栏复用 opencode 原生会话能力：会话消息流、会话管理（新建/切换/重命名/删除/导出）。

**Why this priority**: 会话是 AI 干活的基础载体，复用原生避免重复造轮子。

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

1. **Given** AI 遇到确定性查询/统计，**When** 执行，**Then** 走确定性路径（MCP），不滥用 AI 生成
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
- **FR-004**: 「更多 skill」抽屉 MUST 收纳有权 skill，按 skill 分组 + 最近使用上浮 + 收藏加权排序。
- **FR-005**: `/` 命令面板 MUST 模糊匹配任意有权 skill，输入 `/` 唤起。
- **FR-006**: 指令卡框架 MUST 机制通用——各模块 skill 只需声明能力清单，框架自动投影，不重画一遍。
- **FR-007**: 点指令卡 MUST = 填入一句话，AI 执行并展示过程。
- **FR-008**: AI MUST 只执行「确定性查询/统计」与「需要专家经验的研判」，不滥用 AI 做确定性的事。
- **FR-009**: 高风险动作（删除数据、判定涉案）MUST 强制人确认。
- **FR-010**: 右栏 MUST 复用 opencode 原生会话能力（会话消息流、会话管理、导出会话）。

### Key Entities

- **指令卡**：类型（常用操作 / 上下文指令）、关联 skill、投影模块。
- **skill 能力清单**：各模块 skill 声明的能力列表，供指令卡框架投影。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 点指令卡填入一句话，AI 执行并展示过程（AC-F8-01）。
- **SC-002**: 上下文指令随中栏选中动态浮现 / 取消选中消失。
- **SC-003**: 高风险动作（删除数据 / 判定涉案）100% 强制人确认。
- **SC-004**: 有权 skill 在抽屉 / 命令面板可被发现。

---

## Assumptions

- 指令卡通用机制是 harness 提供的通用 UI，各模块 skill 声明能力清单后框架自动投影。
- 右栏会话复用 opencode 原生 SessionSidePanel（会话管理、消息流、导出会话）。
- 各模块特定指令卡内容（资金/话单的「清洗/关联分析」等）已在 F6/F7 定义，本 feature 定义通用机制。
- skill 本身的治理（分类/生命周期/授权）在 F9 展开，本 feature 只定义「指令卡 = skill 能力的可发现入口」。
- 收藏（个人偏好）作为抽屉排序的加权因子，其存储与治理在 F9。
