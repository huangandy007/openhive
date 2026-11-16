# 013 · 任务清单

> 判据与裁定见同目录 `spec.md`。每条走六步轨道（证据 → 红用例 → 绿 → 变异 → 门禁 → 同类落点）。

## T1 后端：按后缀写预置模板

- [x] `packages/opencode/src/server/openhive/file-templates.ts`：`模板字节(name): Promise<Uint8Array | undefined>`
      - `.docx`（zip：`[Content_Types].xml` / `_rels/.rels` / `word/document.xml`，含一行「正文」）
      - `.xlsx`（`xlsx` 惰性 import 生成一个空工作簿，含 `Sheet1`）
      - `.xmind`（zip：`content.json`，含一张画布、rootTopic「中心主题」）
      - `.pdf`（手写最小单页 PDF，xref 偏移**按实际字节计算**）
      - `.png/.jpg/.jpeg/.gif/.bmp/.webp`（1×1 空图；`.bmp` 代码生成，其余静态常量）
      - `.html/.htm`（`<!DOCTYPE html>` 骨架，UTF-8）
      - 其余 ⇒ `undefined`（含 `.hgraph`、`.md/.txt/.csv`）
      - 结果按后缀缓存（`Map`），只算一次
- [x] `handleCreate`：文件分支写 `模板字节(name) ?? ""`，仍是 `flag:"wx"`；目录分支不变
- [x] `packages/opencode/test/server/openhive-file-templates.test.ts`：逐类结构断言（见 `spec.md` §3.1）
- [x] `handleCreate` 用例补：`.hgraph` / `.md` 仍是 0 字节；`.docx` 非 0 且以 `PK` 开头

## T2 前端：扩展名常量单一出处

- [x] 新建 `packages/app/src/center/file-type-extensions.ts`（零依赖）：把 `views/index.ts` 里各处
      `extensions: [...]` 的数组提成导出常量（文档/表格/PDF/图片/图文/思维导图/关系图/网页/代码）
- [x] `views/index.ts` 改为引用这些常量；`表格扩展名` 的对外导出**移至常量模块**，
      `open-file.ts` 改从 `./file-type-extensions` 取（原写「保持对外导出」已按实现回写）
- [x] 守卫 `views/index.test.tsx` 仍绿（loader 仍是动态 import）
- [x] parity：清单里的后缀与注册表逐一对得上（用例放 T3）

## T3 前端：清单模块 + 弹窗重写

- [x] `packages/app/src/project/file-create-catalog.ts`：`新建大类`（9 类，顺序见 spec §5）、
      `补类型后缀(name, 后缀)`（从 `file-create-types.ts` 迁来，签名改为收后缀字符串）；
      `file-create-types.ts` 只留 `关系图后缀`（`file-tree.tsx` / `openhive-file-ops.ts` 的 import 不变）
- [x] `file-create-catalog.test.ts`：9 类顺序；后缀并集 ⊆ 注册表；无重复归属
- [x] 弹窗重写类型区：`data-slot="file-create-catalog" | "file-create-category" | "file-create-category-title" | "file-create-suffix" | "file-create-suffix-check" | "file-create-category-toggle"`
      - 标题是纯文本（非 button）；勾选框在标签**前**；互斥；再点取消；选中「V」+ 高亮；大类联动高亮
      - 代码默认折叠（`aria-expanded=false`，无 `.ts` 行），点「展开」出现；列表区 `max-h` 滚动
      - 文件夹弹窗不渲染清单
- [x] `file-create-dialog.test.tsx`：胶囊用例改写成勾选用例，其余用例原样保留

## T4 收尾

- [x] 文档：本目录 `VERIFICATION.md`（门禁实得 + 变异记录 + 审查裁定 + 缺口表）；`file-create-types.ts` 头注释改写
- [x] 门禁：两包 `bun run typecheck`、受影响测试文件逐个跑、根 `bun run lint`（仅 1 个既有 error，在 session-ui）
- [x] `grep` 同类落点（`#002-06`）：`file-create-type` / `可新建类型` / `补类型后缀` / `关系图后缀` 全部落点已核
