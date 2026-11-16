# 契约：UI 槽位（供用例与实现对齐）

> 这些 `data-slot` / 选择器是**可测试契约**：用例只认它们，不认 DOM 结构；改结构可以，改槽位名要同步改用例。

## 布局

| 槽位 | 含义 | 判据 |
|---|---|---|
| `hgraph-editor-bar` | 顶栏（撤销/重做/已保存） | 只含这三项；高度维持现状 |
| `hgraph-toolbar` | 工具栏 | 单行，`scrollWidth <= clientWidth` |
| `hgraph-toolbar-group` | 工具栏分组（选择/画/排/找/整） | 组间有分隔线 |
| `hgraph-toolbar-add-event` | 加事件按钮 | 紧接「从库加入」之后 |
| `hgraph-toolbar-layout` | 排列下拉 | 四模式 + 默认环形 |
| `hgraph-canvas-bar` | 画布条（**新**） | 搜索/筛选/计数/图例的包围盒都落在其中 |
| `hgraph-canvas` | 画布 | 可见高度不低于改前同窗口实测值 |
| `hgraph-canvas-chrome` | 画布内浮层容器（模式条已删除） | 不得覆盖任何可交互内容 |
| `hgraph-filter-toggle` | 筛选按钮（放大镜图标） | 位于画布条，不在工具栏 |

## 画布

| 槽位/属性 | 含义 | 判据 |
|---|---|---|
| `hgraph-node-shape` | 节点形状元素 | 实体=圆；事件卡用 `data-node-shape="event-card"` |
| `data-node-shape="event-card"` | 事件卡 | 96×34、rx=6、两行文本 |
| `data-node-id` | 节点命中标识 | 圆与名字标签都带；连线松手命中以此为准 |
| `hgraph-node-label` | 名字标签 | 12px；命中判定必须包含它 |
| `hgraph-edge-label` | 边标签 | 12px + 2px 同底 halo |
| `hgraph-legend` | 图例 | **不得出现在 `hgraph-canvas` 内**；位于画布条右端或浮层 |
| `hgraph-legend-toggle` | 窄宽折叠按钮 | 热区 ≥32×24（触控 44×44） |
| `hgraph-canvas-mode-bar` | 画布内模式条 | **必须不存在** |

## 检查器

| 槽位 | 含义 | 判据 |
|---|---|---|
| `hgraph-inspector` | 检查器容器 | 宽 320、right 0、top 0、高 100% |
| `hgraph-inspector-collapsed` | 收起窄条 | 40px 宽，含「详情」与类型色点 |
| `hgraph-inspector-section` | 四段（头/可改/只读/操作脚） | 只读段有灰底 + 🔒 + 出处 chip |
| `hgraph-inspector-field` | 字段行 | 每行有标签；输入框高 ≥28 |
| `hgraph-inspector-revert` | 行尾 `↩ 撤销此字段` | 仅对最近一次写入字段显示 |

## 事件

| 槽位 | 含义 |
|---|---|
| `hgraph-event-participants` | 面板参与方段 |
| `hgraph-event-participant-row` | 单行参与方（角色 + 名字 + 「未对上档案」标记） |
| `hgraph-picker-tab-event` | 从库加入的「事件」页签（**后续批次**） |

## 强度过滤

| 槽位 | 含义 | 判据 |
|---|---|---|
| `hgraph-strength-filter` | 「只看 ≥ N 档」控件 | 0–4 档 + 关闭 |
| `hgraph-strength-hidden-note` | 角落提示 | 文案含实际隐藏条数，可一键恢复 |

## 不变式

- 模式按钮与动作按钮必须可区分（`aria-pressed` 或等效按下态）。
- 任何浮层：`Esc` 关闭、点外部关闭、层级高于画布右键菜单。
- 槽位只能新增或改名（改名须同步用例），不得「一个槽位两种含义」。
