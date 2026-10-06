# Feature Specification: 项目管理（工作空间轴）

**Feature Branch**: `005-project-management`

**Created**: 2026-09-26

**Status**: Draft

**Input**: PRD §6 F5 项目管理 + design-v2 §13（共享项目）/§8.3（左栏）+ `2026-09-11-项目管理-design.md`

---

## User Scenarios & Testing

### User Story 1 - 项目列表与新建切换（Priority: P1）

左栏顶部是「项目锚点」（项目名 + 成员数 + 下拉 + 新建），点项目名滑出项目面板：新建私有/共享项目，按「最近 / 全部 / 已归档」三 tab 浏览，点项目切换当前项目。

**Why this priority**: 项目是唯一隔离边界与工作单元容器，民警必须先看清「我在哪个项目干活」，这是整个工作空间轴的入口。

**Independent Test**: 点项目名 ▾ 滑出项目列表，新建一个项目并切换，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 民警进入左栏项目管理，**When** 观察顶部，**Then** 看到「项目名 + 成员数 + ▾ + ＋」的项目锚点行
2. **Given** 民警点项目名 ▾，**When** 项目面板滑出，**Then** 显示「＋新建（私有/共享）」+ 最近/全部/已归档三 tab
3. **Given** 民警新建一个私有项目，**When** 提交，**Then** 项目创建成功并成为当前项目
4. **Given** 民警在「全部」tab 切换项目，**When** 点某项目，**Then** 切换为当前项目，左栏文件树/会话随之切换

---

### User Story 2 - 文件树操作（Priority: P1）

项目文件树支持新建、重命名、删除、复制、移动、上传、下载完整操作。高频操作走工具栏，低频操作走右键菜单；删除需二次确认。

**Why this priority**: 文件树是民警管理案件材料、研判产物的工作区，是「看改」的核心载体。

**Independent Test**: 在文件树新建/重命名/删除一个文件，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 文件树选中某文件，**When** 点工具栏「重命名」，**Then** 可重命名该文件
2. **Given** 文件树选中某文件，**When** 点「删除」，**Then** 弹出二次确认，确认后删除
3. **Given** 文件树右键某文件，**When** 打开右键菜单，**Then** 可执行复制/移动/上传/下载/备份/拉回等完整操作
4. **Given** 工具栏未选中任何项，**When** 观察「重命名/删除」图标，**Then** 置灰不可点（防止误删）

---

### User Story 3 - 共享项目成员管理（Priority: P1）

共享项目按「微信群模型」管权限：谁建谁 owner；owner 与 member 均可邀请（被邀者 role=member）；仅 owner 能移除成员；member 可退群、owner 不能退群；不设只读角色。

**Why this priority**: 成员权限是共享协作的安全边界，权责不清会导致误删/越权。

**Independent Test**: owner 邀请一个成员、移除一个成员，member 退群，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 共享项目 owner 点 👥，**When** 成员面板侧滑出，**Then** 显示成员列表 + 邀请入口 + 退出项目
2. **Given** owner 输入警号邀请成员，**When** 提交，**Then** 该成员加入，role=member
3. **Given** member 尝试移除其他成员，**When** 操作，**Then** 被拒（仅 owner 能移除）
4. **Given** member 点「退出项目」，**When** 确认，**Then** 该 member 退出（删自己）；owner 无退群入口

---

### User Story 4 - 文件 ↔ MinIO 备份拖拽（Priority: P1）

文件在「沙箱目录」与「MinIO 备份」两个文件树之间拖拽互移：拖到下树 = 备份，拖回上树 = 拉回沙箱。双树默认收起，点底部 MinIO 窄条展开。

**Why this priority**: 云端备份是数据安全兜底（沙箱文件丢失可恢复），也是归档的基础能力。

**Independent Test**: 把一个文件从沙箱树拖到 MinIO 树完成备份，再拖回拉回，即可独立验证。

**Acceptance Scenarios**:

1. **Given** 当前在「文件」tab，**When** 点底部 MinIO 窄条，**Then** 展开上下双树（沙箱 / MinIO 镜像路径）
2. **Given** 从沙箱树拖文件到 MinIO 树，**When** 完成拖拽，**Then** 文件备份到 MinIO，已备份文件标 ✓
3. **Given** 当前在「会话」tab，**When** 点 MinIO 窄条，**Then** 自动切到「文件」tab 再展开双树

---

### User Story 5 - 项目归档与找回（Priority: P2）

项目可手动归档，或 `last_accessed_at` 超过 3 个月无操作触发归档；归档 = 沙箱文件全部上传 MinIO + 删除沙箱文件 + 标记 archived。归档后可手动「找回」（MinIO 文件全部下载回沙箱）。归档后成员失权，owner 保留找回权。

**Why this priority**: 归档释放沙箱空间、管理项目生命周期，但非上线阻断项，故列 P2。

**Independent Test**: 归档一个项目（移入「已归档」），再找回（回到「最近/全部」），即可独立验证。

**Acceptance Scenarios**:

1. **Given** owner 对某项目执行归档，**When** 完成，**Then** 项目文件全部上传 MinIO、沙箱文件删除、项目移到「已归档」tab
2. **Given** 项目在「已归档」tab，**When** owner 点「找回」，**Then** 项目回到「最近/全部」，MinIO 文件全部下载回沙箱
3. **Given** 项目已归档，**When** 原 member 访问该项目，**Then** 失权不可访问；owner 保留找回权
4. **Given** 项目 3 个月无操作，**When** 达到阈值，**Then** 触发归档提醒（待 owner 确认后归档）

---

### Edge Cases

- 会话（session）彻底私有：每个成员和 AI 的对话只存自己 db，任何人（含 owner）看不到别人的会话。
- 文件并发靠 git：各自 commit、冲突 merge，不做实时协同编辑。
- 自动归档形态已确定为「先提醒、owner 确认后归档」——超期不直接归档，先提醒 owner 确认。

---

## Requirements

### Functional Requirements

- **FR-001**: 左栏 MUST 顶部常驻「项目锚点」——项目名 + 成员数 + 下拉（▾）+ 新建（＋）。
- **FR-002**: 项目面板 MUST 提供「＋新建（私有/共享）」置顶 + 「最近 / 全部 / 已归档」三 tab，按 `last_accessed_at` 排序。
- **FR-003**: 系统 MUST 支持新建私有项目与共享项目，新建后成为当前项目。
- **FR-004**: 项目成员权限 MUST 遵循微信群模型——谁建谁 owner；owner 与 member 均可邀请；仅 owner 能移除；member 可退群、owner 不能退群；不设只读角色。
- **FR-005**: 文件树 MUST 支持新建 / 重命名 / 删除 / 复制 / 移动 / 上传 / 下载完整操作。
- **FR-006**: 文件删除 MUST 二次确认；重命名/删除图标选中后点亮、未选中置灰。
- **FR-007**: 文件 MUST 支持沙箱 ↔ MinIO 拖拽备份/拉回（文件级，上下双树，已备份标 ✓）。
- **FR-008**: 项目归档 MUST 支持手动归档 + 超期（3 个月无操作）自动触发提醒（owner 确认后才归档）；归档 = 沙箱文件全部上传 MinIO + 删除沙箱文件 + 标记归档。
- **FR-009**: 项目找回 MUST 为手动——`archived` 恢复 + MinIO 文件全部下载回沙箱。
- **FR-010**: 归档后成员 MUST 失权，owner 保留找回权。（落地口径 Q3 裁定 2026-10-06：归档状态是**项目级共享态**，落业务 PG 的 `project_archive` 表、**不**落每用户库——否则「成员失权」推不出来。）
- **FR-011**: 会话 MUST 彻底私有——成员会话只存自己 db，任何人（含 owner）不可见。
- **FR-012**: 文件并发 MUST 靠 git（各自 commit、冲突 merge），不做实时协同编辑。

### Key Entities

- **项目（project）**：type（private/shared）、project_type（单案/串并/专项行动/考核督导/内勤文字）、shared_directory、last_accessed_at、archived、archived_at。（落点 Q3 裁定 2026-10-06：前四项是**个人态**落每用户库 `project_ext`；`archived` / `archived_at` 是**共享态**落业务 PG `project_archive`。）
- **项目成员（project_member）**：project_id + user_id + role（owner/member），唯一约束 (project_id, user_id)。
- **案件（case）**：项目下的业务实体，结构化属性落业务 PG，通过 project_case 与项目多对多关联。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 民警能快速定位「我在哪个项目」，切换项目时左栏文件树/会话随之切换。
- **SC-002**: 文件树操作（增删改查 + 沙箱↔MinIO 拖拽备份）完整可用，删除有二次确认。
- **SC-003**: 共享项目成员权限符合微信群模型，权责边界清晰（仅 owner 能移除、member 可退群）。
- **SC-004**: 项目归档/找回全程留痕，文件不丢失。

---

## Assumptions

- 项目是唯一隔离边界，复用 opencode 原生 project 概念（F3 已落地沙箱）。落地口径（Q1/Q2 裁定 2026-10-06）：项目是**用户沙箱之内**的子目录（`/workspaces/{userId}/{project}/`，锚定两段一字不动），**文件各存一份**；「共享」发生在一个 **bare git 仓库** `/shared/{projectId}.git` 上——成员各自 clone / commit / push，FR-012「各自 commit、冲突 merge」由此成立。**不经 HTTP**，锚定不变量不破。
- 数据轴的资金项目/话单项目（`fund_project` / `call_project`）不在本 feature 范围，由 F6/F7 展开；`project_member` 只管工作空间轴。
- MinIO 备份是 opencode 原生「三个缺失功能」之一（design-v2 §8.1），本 feature 补齐。
- 文件树复用 opencode 原生 SolidJS 文件树，不引入新树控件（design-v2 §8.1 / 项目管理-design §6.4）。落地口径（D0-2 裁定 2026-10-06）：**包一层**——上游 `components/file-tree.tsx` 一字不动，在 `app/src/project/` 新建、底座取 v2 的纯函数 model。「不引入新树控件」仍然成立，但实测上游该组件**没有**工具栏 / 右键菜单 / 新建 / 重命名 / 删除 / 上传下载 ⇒ 这些能力是**新增**，不是换皮。
- 自动归档形态已确定为「先提醒、owner 确认后归档」（超期触发提醒，owner 确认后才归档）。
