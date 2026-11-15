# 契约 · 前端接缝（视图 / 动作 / 快捷键 / 检查器）

**目的**：把「谁调谁」定死，避免同一个动作在工具栏、右键菜单、检查器各写一份（FR-025）；也让组件能被单独挂起来测。

---

## 1. 视图注册

**文件**：`packages/app/src/center/views/index.ts`

```ts
viewRegistry.register({
  extensions: [".hgraph"],
  load: () => import("./hgraph-view").then((m) => m.HgraphView),
})
```

**约束**：

- 扩展名走 `extensionOf`（`view-registry.ts:85-90`，最后一个点之后、小写）——与 `path.extname` 语义一致；`.hgraph` 当前无占用者，注册表对重复扩展名会抛错。
- `.hgraph` **不进** `case-view.tsx` 的 `case://` 伪路径：它是**文件视图**（有写口），不是「数据轴视图」。
- `HgraphView` 的 props 是 `ViewProps { path, load? }`（`view-registry.ts:14`）：
  - `path` 是项目内相对路径；
  - `load` 用于「以文本方式打开」的兜底（只读展示），**不用于写入**；
  - 读写一律走 §2 的 `hgraph-api`。

---

## 2. 数据接缝

**文件**：`packages/app/src/project/hgraph-api.ts`（新）

复用 `entity-api.ts` 的范式：`默认发送` / `请求`（带错误体）/ `TIMEOUT_MS` / 超时重试一次；`PREFIX = "/openhive/hgraph"`；**项目 id 在调用时读 `currentProject()`**（同 `openhive-file-saver.ts`）。

```ts
export interface HgraphApi {
  readonly 读: (input: { projectId: string; path: string }) => Promise<结果<{ 内容: string; 版本: string }>>
  readonly 初始化: (input: { projectId: string; path: string }) => Promise<结果<{ 内容: string; 版本: string; 写入: boolean }>>
  readonly 写: (input: { projectId: string; path: string; 版本?: string; 操作: 操作[]
                       批次?: string; 幂等键?: string }) => Promise<结果<写结果>>
  readonly 导出许可: (input: { projectId: string; path: string }) => Promise<结果<{ 允许: true; 文件名: string }>>
}
```

- **不注入 `SaveFileContent`**：通用存盘口对 `.hgraph` 会拒绝（`HGRAPH_READONLY`），且语义不对（research R1）。
- 轮询用既有 `GET /openhive/file/stat`（可经 `openhive-file-ops` / 项目层取数），只比 `mtime/size`。

---

## 3. 动作单一出口

**规则**：同一件事只存在于一个函数里；工具栏、右键菜单、键盘、检查器都只调它。

| 动作函数 | 工具栏 | 右键菜单 | 键盘 | 检查器 |
|---|---|---|---|---|
| `加节点(位置?)` | ✅ | 空白 → 加节点 | 双击空白 | — |
| `加边(从, 到)` | 连线模式拖拽 | — | — | — |
| `删除所选()` | ✅ Delete | 节点/边/文字 → 删除 | `Delete` | 批量 → 删除 |
| `重命名(id)` | — | 节点 → 重命名 | `F2` | 名称输入 |
| `改字段(类别, id, 补丁)` | — | 边 → 改标签/改性质 | — | ✅ |
| `复制()` / `粘贴()` / `原地复制()` | ✅ | 节点 → 复制 / 空白 → 粘贴 | `Ctrl+C/V/D` | — |
| `锁定切换(ids)` | ✅ | 节点 → 锁定/解锁 | — | — |
| `对齐(边, ids)` / `等距(轴, ids)` | ✅ | — | — | 批量 → 对齐/等距 |
| `自动布局(模式?)` | ✅ | 空白 → 自动布局 | — | — |
| `合并(ids)` | ✅ | 节点 → 合并所选 | — | 批量 → 合并 |
| `只看邻居(id)` | ✅ | 节点 → 只看邻居 | — | ✅ |
| `查找路径(a, b)` | ✅ | 空白 → 查找路径 | — | — |
| `适配全部()` / `适配选中()` | ✅ | 空白 → 适配全部 | `Ctrl+0` | — |
| `打开档案(id)` | — | 节点 → 打开档案（未绑库灰显） | `Alt+双击` | ✅ |
| `导出PNG(选项)` | ✅ | **文件树**右键 → 导出 PNG | — | — |
| `演示切换()` | ✅ | — | `Esc` 退出 | — |

`导出PNG` 的两个入口共用**同一个函数**（`hgraph/export.ts` 导出），文件树那一侧只是用当前路径调它（不需要打开图也走同一套授权）。

---

## 4. 快捷键归属

- 全部挂在**画布容器**的 `keydown`（容器 `tabindex="0"`，进入时聚焦）；**不** `window.addEventListener`（FR-040）。
- 演示态：`空格` 下一步 / `Backspace` 上一步 / `Esc` 退出。
- 编辑态：`Delete` 删除、`F2` 重命名、`Ctrl+Z` / `Ctrl+Shift+Z` 撤销重做、`Ctrl+C/V/D`、`Ctrl+0` 适配全部、`Alt+←` 回退视角、`Alt+双击` 打开档案。
- 焦点在输入框（检查器/搜索框/文字编辑）时，画布快捷键**不生效**（先判 `target`）。

---

## 5. 检查器（右侧浮动面板）

**形态**：`position: absolute; right: 24px; top: 24px; width: 280px`（复用 `graph.tsx` 的 `面板宽 = 280` / `面板边距 = 24` 常量），**不改变画布尺寸**；可收起。

**三段竖排 + 底部一条**：

| 段 | 内容 | 可编辑 |
|---|---|---|
| 图上记的 | 名称 / 类型 / 细类 / 外环（档 + 颜色）/ 备注 / `出现序`（数字输入，失焦即存） | ✅ 失焦即存，一次改动 = 一步撤销 |
| 图上记的（只读区） | 来源、属性、出处（可点 → 跳到材料那一行）、首末时间 | ❌ |
| 库里现在 | 值 / 类型 / 可信态 / 时间；与快照不同则说明「文件里记的是 X，库里现在是 Y」；按钮「刷新此节点」 | ❌（刷新是显式动作） |
| 底部一条 | 「打开档案」（未绑库灰显 + 「这条不在库里」）/「绑定到库实体」（手写/推断节点） | 动作 |

**多选（≥2）**：整块换成批量操作（对齐 / 等距 / 删除 / 合并），不显示单个详情（FR-028）。

**保存失败**：该字段回滚到改前值，并就地提示「没存上」；**不**假装成功、**不**静默重试。

---

## 6. 从库加入（选择器）

**入参**：`{ projectId, onAdd(nodes|edge) }`；**不新增后端接口**。

| 区域 | 实现 |
|---|---|
| 搜索框 | `EntityApi.list({ projectId, q })`（`q` 只匹名称/别名） |
| 结果列 | 名称 / 类型 / 细类 / 可信态 / 关联数；**类型列头可点筛**（前端过滤当前页结果，不改搜索条件） |
| 多选 → 加入 | 对每个选中项 `GET /case/entity?id=` 取快照（`引用` 拼出处、`关系/事件` 聚合首末时间），转成 `加节点` 操作 |
| 「关系」页 | 选中实体后 `GET /case/graph?id=<实体>&跳数=1` 列既有关系；勾选一条 → `GET /case/facts?type=relation&id=` 取 `citations` + `firstAt/lastAt` → 转成 `加边`（证据与出处成对） |
| 取不到时 | 节点照建，`属性` 空 + 界面明写「库中无记录属性」/「未取到出处」——**不拦、不伪造** |

选择器**不提供**全项目关系搜索（FR-031；08 §0.1.3 后置）。

---

## 7. 新建弹窗的类型行

**文件**：`file-create-dialog.tsx`（改）+ `file-create-types.ts`（新）

- 名字框下面一行胶囊，数据来自 `可新建类型`；本期数组只有 `{ 标签: "关系图", 后缀: ".hgraph" }`。
- 提交：名字已带该后缀（大小写不敏感）⇒ 不重复加；带**其它**后缀（如 `.md`）⇒ 按名字处理 ⇒ `张三.md.hgraph`（本期只有一种类型，无「按后缀切换类型」）。
- 建文件仍走既有 `POST /openhive/file/create`；`.hgraph` 成功后立即 `POST /openhive/hgraph/init`（失败则提示「已建文件但没写进初始内容，双击打开时会补上」——打开 0 字节文件也会再 init 一次，幂等）。

---

## 8. 视觉与无障碍（只做第一版）

- **浅色**：颜色只引用 `theme.css` 语义变量 / `openhive-DESIGN.md` token；**不做深色适配**（宪法 §八、FR-048）。
- 类型**同时**用形状 + 类型首字区分（`graph-icons.tsx` 的 `图标图形`/`节点图标`）；颜色不是唯一通道。
- 图例常驻可折叠，四条说明：线粗=关系强弱、环粗=连接多少、实线=事实/虚线=推断、箭头=方向。
- 每个图标按钮都有 `aria-label` 与 `title`（`title` 里带快捷键，如「删除（Delete）」）；演示态与菜单可键盘操作。
- 隐藏节点/边必须写「已隐藏 N 个」，隔离与筛选共用同一个计数（FR-047）。

---

## 9. 组件清单（props 契约）

```text
hgraph-view.tsx            props: { path, load? }                → 组装 api + editor
hgraph/editor.tsx          props: { path, api, 项目名 }           → 文档状态、保存、轮询、冲突、撤销栈
hgraph/canvas.tsx          props: { 文档, 选中, 模式, 视口, 动作回调 } → SVG 渲染与指针交互
hgraph/toolbar.tsx         props: { 动作表, 状态 }                 → 全图标工具栏
hgraph/inspector.tsx       props: { 选中, 快照差异, 动作表 }        → 右侧浮动面板
hgraph/legend.tsx          props: { 设置 }                        → 可折叠图例
hgraph/present.tsx         props: { 文档, 打开, 关闭 }             → 演示态覆盖层（本地信号）
hgraph/export.ts           (纯函数 + 下载) 导出PNG({ 文档, 画布元素, 选项, 项目名, 导出人 })
hgraph/entity-picker.tsx   props: { projectId, onAdd }            → 从库加入
```

**状态归属**：只有 `editor.tsx` 持有文档与撤销栈；其余组件只收 props + 回调（单向数据流，`#005-48`：读口读整份对象，不要在子组件里 memo 局部引用后判断相等）。
