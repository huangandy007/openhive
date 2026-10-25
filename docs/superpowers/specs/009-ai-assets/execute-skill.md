# T015 · 详情页「▶ 让 AI 助手执行此 skill」填入指令

> 任务：`tasks.md` T015 `[FE·新增] 实现详情页「▶ 执行此 skill」填入指令 [FR-010] [T007]`
> 依据：`spec.md` FR-010 / 2026-09-12 设计 §1.4 / `openhive-DESIGN.md` §4.10
> 提交：见 `state.md` 「已完成 · T015」

## 1. 交互与语义

详情页头部队列右侧渲染一颗主按钮（`variant="contrast"`，`data-slot="asset-detail-execute"`）：

| 条件 | 行为 |
|---|---|
| `asset.type === "skill"` | 渲染「▶ 让 AI 助手执行此 skill」 |
| 其他类型（`mcp` / `knowledge_base`） | **不渲染**——文案写的是 skill，MCP / 知识库上没有「执行」这件事 |
| 点击且右栏有会话 | 一句话以**替换**方式写进右栏输入框，焦点交还输入框（`controller.restoreFocus()`，既有行为） |
| 点击但右栏没开会话 | 弹「先在右栏开一个会话」，不静默吞掉 |

设计原文：「点击把一句指令填入右栏 AI 助手输入框（skill 名 + 当前上下文），可编辑后发送。
与右栏指令卡「点卡片 = 填入一句话」同一机制。」——本实现就是照这句做的取舍（见 §3）。

## 2. 指令内容

`execute-skill.ts` 的 `执行skill指令(asset)` 是纯函数，只收 `name` + `description`：

```
有描述：请使用「资金流向研判」这个 skill：按账户汇总资金往来
无描述：请使用「资金流向研判」这个 skill。
```

- **描述取 `trim()` 后的值**；空 / 全空白 ⇒ 走无冒号那句（不留「：」尾巴）。
- 生成的句子**不以 `!` / `/` / 空白 `@` 开头**：`capabilities.ts` 的输入框有形状特判
  （`!` 走 shell、整句 `/…` 走命令、空白领起的 `@` 弹提及面板），指令句不能被误判成这三类。
- **当前上下文**：资产中心这一层今天拿不到「中栏选中的账户 / 文件」（那是业务模块的事，
  D0-6 的已知残差），所以上下文只取资产自己的描述——**不编造**（`#005-47` / `#008-04`）。

## 3. 接缝设计

### 3.1 复用现成的跨栏接线盒，不新增 Provider

`ai-assets/asset-detail.tsx` 与 `ai-session/session-panel.tsx` 互不相识，已有的接缝是
`ai-session/send-to-session.ts`（模块级收件口，`center → ai-session` 先例）。T015 直接复用：

- 新增方向 `ai-assets → ai-session`，与 `center → ai-session` 同向，**不成环**。
- 不加 Provider：给组件加 `useXxx()` 前提会让一串「只是借这个前提」的既有测试集体改
  （`#005-27`）。
- 跨栏接缝**仍然只有一条**（`#002-06`）：本任务只是给这条接缝加了一个参数，没有开第二条路。

### 3.2 写入方式：`追加` / `替换`

`发送到会话(文本, 方式 = "追加")`：

| 方式 | 来源 | 语义 |
|---|---|---|
| `追加`（默认） | 中栏拖拽 / 右键（既有） | 内容插在光标处（`addText`） |
| `替换` | 详情页「▶ 执行此 skill」（T015） | 整段替换（`setText`），与指令卡 `onPick` 的 `input.changed` 同义 |

为什么执行指令用替换：追加会把指令粘在用户原有半句后面，拼成
「我原来写的半句请使用「…」这个 skill：…」这种谁也读不通的句子。代价是用户已打的半句被顶掉
——这是「点了执行」这个动作自己的含义，不是意外。

`替换` 走的是上游 `createPromptInputV2Store` 门面的 `setText`（保留非文本 part、光标移到末尾），
**没有在面板里另写一份「清空再写」**。

行数上限（50 行）对两种方式**同一条判据**：它管的是「一次塞多少行」，与追加 / 替换无关。

## 4. 改动落点

| 文件 | 改动 |
|---|---|
| `packages/app/src/ai-assets/execute-skill.ts` | 新增：`执行skill指令()` 纯函数（含边界注释） |
| `packages/app/src/ai-assets/asset-detail.tsx` | 头部渲染按钮（仅 skill）；`执行skill` 处理器只透传，判据与提示文案取自接线盒 |
| `packages/app/src/ai-session/send-to-session.ts` | `写入方式` 类型；收件口签名加方式；`发送到会话` 第二参数（默认 `追加`） |
| `packages/app/src/ai-session/session-panel.tsx` | 收件口按方式分派：`替换` → `setText`，否则 `addText`；`restoreFocus()` 两条路都有 |

## 5. 用例

| 文件 | 条数 | 钉住什么 |
|---|---|---|
| `ai-assets/execute-skill.test.ts` | 4 | 有描述 / 空描述 / 描述首尾换行 trim / 不以 `!` `/` 开头 |
| `ai-assets/asset-detail.test.tsx`（新增 describe） | 3 | 按钮文案 + 点击后收件口收到 `{文本, 方式:"替换"}`；非 skill 类型无按钮；无会话时弹提示 |
| `ai-session/send-to-session.test.ts`（新增 describe） | 3 | 默认 `追加`；显式 `替换` 透传；替换也受 50 行上限（超限不调收件口） |
| `ai-session/session-panel.test.tsx`（新增 1 条） | 1 | 真输入框：先有旧文本作对照，`替换` 后正文**全等**新指令（追加变异会红） |

断言口径：非 skill 那条用布尔比较 `expect(执行按钮(host) === null, …).toBe(true)`，**不把 DOM
节点喂给 `expect`**——失败时 bun 的 diff 会序列化节点并把用例挂住（`#005-01`，本次实测约 6 分钟）。

## 6. 变异验证（拆完即还原）

| # | 拆掉什么 | 红 |
|---|---|---|
| M1 | `asset-detail.tsx` 把方式从 `"替换"` 改成默认（不传） | 1（详情「方式: 替换」） |
| M2 | `Show when={props.asset.type === "skill"}` 改 `when={true}` | 1（非 skill 资产不该有按钮） |
| M3 | `session-panel.tsx` 收件口忽略方式、恒 `addText` | 1（真输入框正文全等） |
| M4 | `execute-skill.ts` 去掉 `.trim()` | 2（空描述用例 + 描述换行用例） |
| M5 | `asset-detail.tsx` 去掉失败 toast | 1（无会话弹提示） |
| M6 | `send-to-session.ts` 去掉默认值 `= "追加"` | 1（单测「默认追加」）——面板用例仍绿，因为它显式传了 `"替换"` |

按 `#003-03` 分类：M1–M5 均「只红对应判据」；M6 为**部分覆盖**（默认值只在单测层面被钉住，
既有调用方若不传参就会变成 `undefined`，但今天的四个调用点里两个显式传参、两个依赖默认，
面板那条恰好走了显式路径，故未连带变红）——故 M6 只记 1 条红，不夸大。

## 7. 门禁（实得输出）

| 门 | 命令 | 实得 |
|---|---|---|
| 新增 / 改动单测 | `bun test --conditions=solid --preload ./happydom.ts src/ai-assets/execute-skill.test.ts src/ai-session/send-to-session.test.ts` | **20 pass / 0 fail** |
| 组件用例 | `bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/ai-assets/asset-detail.test.tsx src/ai-session/session-panel.test.tsx` | **104 pass / 0 fail**（详情 14 + 面板 90） |
| 全量组件 | `bun run test:components` | **1360 pass / 0 fail** |
| 全量单测 | `bun test --conditions=solid --preload ./happydom.ts --path-ignore-patterns="**/*.test.tsx" ./src` | **1193 pass / 27 fail**；27 条为**既有**红（见 §8 对账） |
| typecheck | `bun run typecheck`（`tsgo -b`） | 0 errors |
| oxlint | `bunx oxlint <8 个改动文件>` | 0 errors / 2 warnings（`session-panel.test.tsx:111`、`:174`，均为**既有**告警，本任务 diff 从 2350 行起） |
| 锁文件 | `git diff --stat bun.lock` | 空 |

既有 27 条红的对账方法（`#002-02`，不当成已覆盖）：临时用 `git show HEAD:…send-to-session.ts`
还原本任务改动的模块、并排除本任务新增用例（备份在 /tmp，跑完即恢复）⇒ 基线 **1177 pass / 27 fail**；
带改动 **1193 pass / 27 fail**，红的**集合相同**（项目数据上传下载、draft-store 等旧红）。

## 8. 缺口（本任务未覆盖，如实记录）

| 缺口 | 后果 | 归属 |
|---|---|---|
| 指令里用的是**显示名**，不是 SKILL.md frontmatter 的 `name` | 两者不同名时，内核 skill 工具要靠搜索工作区才能找到它 | 需给资产加列（元数据变更），不在 T015 |
| 描述里若有「空白领起的 `@`」，拼进输入框会弹提及面板 | 用户会看到一次多余面板；**不静默改写用户内容**（静默换字符更难查） | 后续在 `capabilities.ts` 侧统一处理，或资产描述校验时拦 |
| `usageCount` 未 +1 | 使用次数不因「点执行」而增长（今天也没有资产 HTTP 接口可写） | T017 / 资产 API |
| 真栈未验证 | 详情页今天在真栈上吃的是空态（中栏资产列表未接真源，见 `state.md` 阻塞项），本任务只到组件层 | T017 |

## 9. 同类落点（`#002-06` 全量 grep）

- `发送到会话` 调用点 3 处：`ai-assets/asset-detail.tsx:184`（显式 `替换`）、
  `ai-session/session-panel.tsx:567`（拖拽 / 右键，默认 `追加`）、
  `center/content-menu.tsx:58`（右键菜单，默认 `追加`）。
- `订阅会话输入` 登记点仅 `ai-session/session-panel.tsx:588`（`onCleanup` 收回）。
- 「按资产类型决定渲染」的判据只有本任务的 `type === "skill"` 一处；
  `asset-card.tsx` 只有 `onOpen`，没有第二颗「执行」CTA。
