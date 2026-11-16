# 013 · 「新建文件」类型选择（大类 + 后缀勾选）

**状态**：已开工（2026-11-16 用户确认设计与完成判据）
**前置**：012 关系图（类型胶囊机制由本轮替代）

## 1. 背景与目标

现状：新建文件弹窗里只有一个「关系图」类型胶囊（012 · T007）。用户要按**大类**选文件类型，
点下去就能建出一份**能直接打开**的文件（现在建出来的都是 0 字节，`.docx/.xlsx/.pdf/图片`
打开只会显示「空文件」或解析失败）。

目标：
1. 弹窗里按 9 大类列出支持的后缀，**后缀前勾选框**，选定高亮并显示「V」，所属大类标题也高亮；
2. 新建时按所选类型**写入最小可用的预置模板**，双击打开即可继续编辑。

## 2. 用户决策（2026-11-16，逐条确认）

| 决策点 | 结论 |
|---|---|
| 大类顺序 | 文档、表格、图文、关系图、思维导图、PDF、图片、网页、代码 |
| 大类标题 | **纯分组标题**（不可点、不承担选择） |
| 后缀交互 | 每个后缀**前面**一个勾选框；同一时刻**至多一个**后缀被勾选 |
| 选中态 | 选中的后缀高亮并显示「V」；其所属大类标题**同时高亮** |
| 再点已选后缀 | 取消勾选 ⇒ 回到普通文件（名字原样） |
| 名字后缀 | **追加**（沿用 `补类型后缀`：已带同后缀且大小写不敏感 ⇒ 不重复加；`张三.md` + `.xlsx` ⇒ `张三.md.xlsx`） |
| 代码大类 | **默认折叠**（可展开），列表区域可滚动 |
| 内容 | **全列 + 预置模板**：列出的后缀都建得出可打开的文件 |
| 其它 | 按专业建议裁定（见 §4） |

## 3. 完成判据（命令 + 期望）

1. `cd packages/opencode && timeout 300 bun test --timeout 30000 test/server/openhive-file-templates.test.ts test/server/openhive-file-ops.test.ts`
   ⇒ 0 fail；模板测试逐类断言**结构性有效**（zip 条目齐全 / xlsx 可被 `xlsx` 读回 / PDF xref 偏移落在 `N 0 obj` / 图片 magic+IHDR）。
2. `cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/file-create-dialog.test.tsx`
   ⇒ 0 fail；覆盖：9 类顺序、标题不可点、勾选框在标签前、互斥、取消勾选、大类联动高亮、代码默认折叠可展开、追加语义、文件夹弹窗无清单。
3. `cd packages/app && timeout 300 bun test --conditions=solid --preload ./happydom.ts src/project/file-create-catalog.test.ts`
   ⇒ 0 fail；覆盖：清单后缀**全部**在视图注册表里有归属（parity，`#002-06`）。
4. 两个 package `bun run typecheck` 均 EXIT=0；仓库根 `bun run lint` 改动面 0 error。
5. 变异验证（`#003-03`）：拆掉「模板写入」「互斥」「大类高亮」各一处，对应用例必须红，并记录红成什么样。

## 4. 专业裁定（用户授权「其他按你的专业建议走」）

1. **`.doc` / `.xls` 不列**（legacy 二进制，无可靠模板生成器）；`.doc/.xls` 既有文件仍由注册表打开。
2. **`.ppt/.pptx` 不列**（视图未注册，见 001 FR-007 ③ / T018）。
3. **模板按后缀隐式生效**（不新增请求字段）：`POST /openhive/file/create` 命中已知后缀就写模板字节，未命中仍写 0 字节。理由：勾选的结果就是「名字带该后缀」，语义无歧义；API 契约不变 ⇒ 与官方合并冲突面最小。
4. **`.hgraph` 不在后端模板表**：骨架仍由前端 `createEntry` 调 `/hgraph/init` 生成（012 既有链路，勿双写）。
5. **文本类不做内容模板**：`.md/.txt/.csv` 留空（编辑器/表格打开即可写）；`.html` 写一行最小骨架（`<!DOCTYPE html>…`）便于直接预览。
6. 后缀清单**单一出处**：把注册表的扩展名数组提到零依赖模块 `center/file-type-extensions.ts`，
   `views/index.ts`（注册）与 `project/file-create-catalog.ts`（弹窗）都引用它。
7. 勾选语义用 `role="checkbox"` + `aria-checked`（互斥由行为保证；`radio` 无法表达「再点取消」）。

## 5. 数据结构

```
新建大类 { 名称, 后缀们, 默认折叠? }
新建大类[] = [
  文档: .docx
  表格: .xlsx .csv
  图文: .md .txt
  关系图: .hgraph
  思维导图: .xmind
  PDF: .pdf
  图片: .png .jpg .jpeg .gif .bmp .webp
  网页: .html .htm
  代码(默认折叠): 代码扩展名（注册表同源）
]
```

## 6. 缺口（本机验不了，如实登记）

| 缺口 | 原因 | 谁来补 |
|---|---|---|
| docx/xlsx/pdf/图片模板在**真查看器**里打开的效果 | 本机仅做结构校验；`docx-preview`/`pdf.js`/图片解码的真栈打开需起栈 | 真栈验收（起栈后逐类新建并打开） |
| `.xmind` 模板在**真 XMind** 里打开 | 本机只做 zip 条目与 `content.json` 的**结构**断言（未调 `parseMindmap`，也未开 XMind） | 真栈 + XMind 客户端 |
| 代码大类 48 项（全清单 64 项）在窄屏下的观感与键盘 Tab 次数 | 组件测试量不了视觉/焦点链 | 真栈视觉与 a11y 验收 |
| 弹窗 `fit` + body 滚动的真实布局（footer 固定、9 大类可滚） | happy-dom 不算 CSS；只钉了 DOM 结构 | 真栈视觉验收 |
