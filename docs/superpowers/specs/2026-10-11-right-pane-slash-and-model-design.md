# 右栏 AI 会话框：补齐 `/` 命令面板与模型选择器（设计 · 2026-10-11）

> 状态：**待用户审定**。本文只谈「做成什么样」，不含实现步骤；审定后走 `writing-plans`。

## 0. 缘起与已定裁定

用户拿原生 opencode 的 AI 会话框截图指出两处缺失，要求「在右栏的 AI 会话对话框复用这些功能」：

1. 输入 `/` 后**不会弹出对应的命令**；
2. 底部**没有模型选择功能**。

随后四项裁定（用户逐项选定）：

| # | 问题 | 裁定 |
|---|---|---|
| 1 | `/` 列表里应该有哪几类 | **和原生完全一样**（真实 skill 全集 ＋ 上游内建斜杠命令 ＋ 选中即执行） |
| 2 | 模型选择器管多大范围、记多久 | **管这场会话，且记住**（走 `serverSync` 的 session.model，不动 provider 边界） |
| 3 | `/` 池子放大后那条已知崩溃（F3） | **本轮修掉** |
| 4 | 底部控制栏本轮做到哪一步 | **只做模型**（不做 agent / Effort） |

---

## 1. 实测（不是推演）

### 1.1 真栈读数（2026-10-11，探针 `e2e/real-stack/slash-probe-real.spec.ts`，1 passed）

右栏 Hero 输入框打一个 `/` 之后：

| 读项 | 实得 |
|---|---|
| 右栏 `/` 面板条数 | **2** |
| 那两条是什么 | `/effect`、`/rtl-aware-development`（`MANIFESTS` 里那 2 条开发工具 skill） |
| 弹层出现没有 | **出现了**（`[data-suggestion-id]` 有节点） |
| 弹层几何 | 盒 `{x:1094, y:665, w:326, h:80}`，输入框盒 `{x:1094, y:753, w:326, h:60}`，视口 `1440×900` ⇒ 弹在输入框**正上方**、**完全在视口内** |
| Hero 里的控件 | 只有 `prompt-attach`、`prompt-submit` —— **没有任何模型控件**（落点已定位到 `view.model` 这道空位，见 §3.2） |

同一个真栈上直接问内核 `GET /command?directory=…`：

| 读项 | 实得 |
|---|---|
| 条数 | **118** |
| 构成（抽样） | `init(command)`、`review(command)`、`customize-opencode(skill)`、`xlsx(skill)`、`write-as-huzhou-gongan(skill)`、`wechat-article-writer(skill)`、`speckit-specify(skill)`、`prd-writer(skill)` … 绝大多数 `source:"skill"` |

**⇒ 2 条 vs 118 条。**

### 1.2 三条假设的判别

| 假设 | 判 |
|---|---|
| H1「连弹层都不出现」（线没接上） | **不成立** —— 弹层出现了 |
| H2「弹了，但池子只有两条」 | **成立** —— 实得 2 条 |
| H3「弹了但被裁掉 / 跑到视口外」 | **不成立** —— 几何盒在视口内、正对输入框 |

---

## 2. 根因

### 2.1 `/` 面板：线是接上的，**池子接错了源**

右栏今天喂给 controller 的是**本地投影**：

- `packages/app/src/ai-session/session-panel.tsx:284`
  `const 命令集 = createMemo(() => skillCommands(props.projection.all))`
- `packages/app/src/ai-session/ai-session-slot.tsx:149`
  `const 投影 = createMemo(() => projectCapabilities(MANIFESTS, center.module()))`
- `packages/app/src/ai-session/capabilities.ts` 的 `MANIFESTS` 只有 **1 个模块（`GENERIC_MODULE`）共 2 条 capability**（`effect` / `rtl-aware-development`），`group` 都写「开发工具」。

而**原生**的 `/` 池子是**两源合并**（`packages/app/src/components/prompt-input-v2.tsx:292-320`，逐字）：

```ts
const slashCommands = createMemo(() => [
  ...sync().data.command.map((item) => ({ id: `custom.${item.name}`, trigger: item.name, …, type: "custom" })),
  ...command.options
    .filter((item) => !item.disabled && !item.id.startsWith("suggested.") && item.slash)
    .map((item) => ({ id: item.id, trigger: item.slash!, …, type: "builtin" })),
])
```

即：**服务端命令**（§1.1 那 118 条；真实 skill 在服务端就是命令 —— `command/index.ts` 把 `skill.all()` 注册成 `source:"skill"`）＋ **前端内建斜杠命令**。

⇒ 右栏看到的「2 条开发工具」正是「池子接了本地 `MANIFESTS` 投影」的结果，与「有没有接上」无关。

### 2.2 模型选择器：**根本没有**，且原因不是「没接」而是「没写」

真栈实读 Hero 控件清单 = `prompt-attach` / `prompt-submit`，**没有第三个**。

而右栏与原生在这一点上的差别是**结构性**的：原生 composer 把模型控件作为 `modelControl` **prop** 注入上游组件（`prompt-input-v2.tsx:61-75`）；右栏只传了 `controller`（`session-panel.tsx:612` 的 `<PromptInputV2 controller={controller} />`），没传 `modelControl`，**也没给 `view.model` 供数据**（`PromptInputV2` 在缺省 `modelControl` 时还有 `view.model` 这条 fallback，见 §3.2）⇒ 模型控件在右栏**从来不渲染**。

### 2.3 F3 崩溃：可达性是**代码级可证的**

- 上游 `packages/app/src/components/prompt-input/submit.ts:79-98`：正文首段以 `/` 开头**且命中服务端命令**时，走一条**解引用 `input.draft.model.modelID`** 的分支。
- 右栏 `packages/app/src/ai-session/submit-prompt.ts:122-124`：会话没记过 model 时传的是 `undefined`（注释里写明这是当时**唯一正确**的表达：编一个空 `{providerID:"",modelID:""}` 在服务端是**真值**，比不传更坏）。
- 服务端 `packages/opencode/src/session/session.ts:499-523`（`createNext`）：会话的 `model` **只来自请求体**。
- 客户端建会话处 `packages/app/src/components/prompt-input/submit.ts:404`：`api.session.create({ location: { directory } })` —— **不带 model**。

⇒ **「刚建好、还没发过任何消息的会话」的 `model` 必为空**；此时若第一条正文以 `/` 命中服务端命令，就落在 `undefined.modelID` 上。

服务端确实会在第一条 user 消息时把模型写回会话（`packages/opencode/src/session/prompt.ts:679-693` 的 `setAgentModel`）—— 但那是**这条消息发出去之后**的事，救不了这一条。

> ⚠️ 上一版注释里写着「它何时触发，我没实测过」。本节的结论是**代码级证据**（读的是三处真身），**不是真栈实测**；真栈复现留到实现期作为 ② 步的 RED 之一。据实记。

---

## 3. 设计

### 3.1 ① `/` 面板的池子 —— 与原生同源同形

**数据源**：右栏改成与原生一致的两源合并：

| 源 | 出处 | 右栏可达性 |
|---|---|---|
| 服务端命令（含真实 skill 全集） | `DirectorySync.data.command` | **已在手**：`ai-session-slot.tsx:118` 的 `dataFor` 就是 `serverSync().ensureDirSyncContext(目录).data`，它已经作为 `props.data` 传给 `SessionPanel`。这条读取**今天就在生产里跑**：`components/prompt-input/submit.ts:79` 的 `input.sync.data.command`，而 `input.sync` 正是 `ensureDirSyncContext(目录)`（`ai-session-slot.tsx:138`）。命令由 `context/server-sync.tsx:366-367` 的 `loadCommands(...)` 写进该目录的 store ⇒ **`props.data.command` 就是那 118 条** |
| 前端内建斜杠命令 | `useCommand().options` 里 `slash` 非空、未 `disabled`、非 `suggested.` 前缀的那批 | **可达**：`CommandProvider` 在 `app.tsx:314-322` 的 `SharedProviders` 里，该处注释原文是 *"These live in the shared shell (router root) so they stay mounted regardless of the active server/route"* —— 右栏就住在 router root |

**形状**：产出的每一条仍是 `PromptInputV2Suggestion`（`kind:"command"`、`label:"/<trigger>"`），与 `command-palette.ts` 今天的形状同形 —— controller 那一侧**不用改**。

**选中行为**（用户裁定「选中即执行」，照原生 `prompt-input-v2.tsx:359-364` 逐字）：

- 内建（`builtin`）⇒ `command.trigger(id, "slash")`（**执行**该命令）；
- 服务端命令（`custom`，含全部真实 skill）⇒ **只把 `/<名字>` 插进输入框**，不执行 —— 服务端命令的语义就是「发一条以它为正文的消息」。

**语义变更（重要，请一并审定）**：`projection.all` 的原始定位是 FR-005「`/` 面板的匹配池 = **当前模块**的 skill 全集」。改成服务端全集后，`/` 面板**不再按模块过滤**，与原生一致（跨模块）。

- 「更多 skill」抽屉（`projection.drawer`，按 `group` 分组的模块轴）**不受影响** —— 模块轴留在抽屉那一层。
- `projection.all` 若因此不再有消费者，**保留字段但标注「已无生产消费者」**，不删（它是纯函数输出的一部分，删它会牵动 `projection.test.ts` 与四层的对称性；是否删留给实现期按「本轮不清理别人的东西」的口径决定）。

### 3.2 ② 模型选择器 —— 复用原生那个控件，只补数据

**控件：不新建任何控件，走原生 `view.model` 这条 fallback（零新 UI）**。三条结论：

1. **`ModelSelectorPopoverV2` 仍然否决**（理由不变）：它的 controller 第一行是 `const model = input.model ?? useLocal().model`（`components/dialog-select-model.tsx:260`）⇒ 复用**必需要一份完整的 `ModelState`**（`ReturnType<typeof useLocal>["model"]`，同文件 `:29`）＝ 把 `local.model` 抄一遍（`#002-06`）。详见 §4。
2. **零新 UI、不改上游任何文件**：`PromptInputV2` 在 `props.modelControl` **缺省**时会用 `view.model` 渲染它自己的 `PromptInputV2ConfiguredSelect`（`packages/session-ui/src/v2/components/prompt-input/index.tsx:228-244`，逐字见下）。右栏只需给 `view.model` 供数据——`PromptInputV2SelectControl` 只要四项：`options` / `current` / `onSelect` / `keybind?`（同目录 `interaction.ts:22-27`）。

   ```tsx
   <Show
     when={props.modelControl}
     fallback={
       <Show when={view.model} keyed>
         {(control) => (
           <PromptInputV2ConfiguredSelect title={i18n.t("ui.promptInput.chooseModel")} keybind={["Mod", "M"]} control={control} model />
         )}
       </Show>
     }
   >
     {props.modelControl}
   </Show>
   ```
3. **代价（据实写）**：拿到的是**扁平单选**——触发器 = 当前模型名 ＋ provider 图标 ＋ chevron-down，菜单 = 全部候选的 radio 列表（`PromptInputV2ConfiguredSelect`，`index.tsx:527-549`；`PromptInputV2Select`，`index.tsx:551-603`）；**不是**原生 `modelControl` 那颗带 provider 分组的富弹层（`ModelSelectorPopoverV2`）。

**值**：

| 项 | 来源 |
|---|---|
| 当前值 | 三级：`本栏选的 → 会话记的 → 应用默认`（逐级定义见下表下） |
| 候选列表 | `useProviders(目录)`（`packages/app/src/hooks/use-providers.ts:20`，走 `useServerSync()`，右栏同层可达） |

- **本栏选的**：本栏信号（用户本次选的）。
- **会话记的**：`当前会话()?.model`（服务端记的；`session-panel.tsx:175` 已有 `当前会话()`）。
- **应用默认**：`useProviders(目录).defaultModel()` —— **服务端归一化后给出的那一份**（`NormalizedProviderListResponse.defaultModel`，形状 `{providerID, modelID}`；`packages/session-ui/src/context/data.tsx:8-11`）。右栏只**取**它，不自己推导。

**「记住」怎么落地（裁定 #2）**：提交时把选中的模型随 `draft.model` 传给服务端；服务端在 `createUserMessage` 里比对并 `setAgentModel` **写回会话**（`prompt.ts:679-693`）⇒ 下次右栏打开这场会话，初值就是它。**不新增持久化、不新增 API、不动 provider 边界。**

**代价（据实写）**：选了但**没提交**就刷新页面 ⇒ 这次选择丢失，回到会话上一次记的值。这是「走服务端记」的必然代价，也正是裁定 #2 选择的形态。

**上一版文档里挂着的两条待验，已量完（2026-10-11）**：

1. **`useProviders` 在右栏安全 ✅** —— `useProviders` 里那句 `useParams()`（`hooks/use-providers.ts:22`）落到 `@solidjs/router@0.15.4` 的 `const useParams = () => useRouter().params`（`dist/routing.js:130`），而 `useRouter` 的卫兵查的是 **`RouterContextObj`**（`dist/routing.js:9`）—— 那是 `<Router>` 提供的，**不是 `<Route>`**。右栏住在 router root ⇒ 不抛。
2. **`ModelSelectorPopoverV2` 不可复用 ❌** —— 它的 controller 第一行是 `const model = input.model ?? useLocal().model`（`components/dialog-select-model.tsx:260`），而 `model` 的类型是 `ReturnType<typeof useLocal>["model"]`（同文件 `:29`）。右栏没有 `LocalProvider` ⇒ **必须**喂一份 `ModelState` 才不碰 `useLocal`；而 `local.model` 有 `ready/current/recent/list/cycle/set/visible/setVisibility/variant{configured,selected,current,list,set}/…` 十几个成员，造一份完整的**就是把 `local.model` 抄一遍**（`#002-06`）。详见 §4。

### 3.3 ③ F3 与 F4 —— 让那两格不可达，且不复制服务端的回退链

**同根因的两处落点，都在客户端上游 `packages/app/src/components/prompt-input/submit.ts`**（「右栏不传 model」，而上游那两处都假设它必有值）：

| 落点 | 位置 | 读法 | 症状 |
|---|---|---|---|
| **F3** | 命令分支 `submit.ts:94-98`（`:95` 读 `input.draft.model.modelID`、`:96` 读 `providerID`） | `draft.model` 为 `undefined` 时**当场解引用** | 抛 `Cannot read properties of undefined (reading 'modelID')` |
| **F4** | normal 分支 `submit.ts:136` `model: { ...input.draft.model, variant: input.draft.variant }` | `draft.model` 为 `undefined` 时展开得 `{}`（**真值**）⇒ 服务端 `input.model ?? ag.model ?? currentModel(…)` 的回退链被顶掉 ⇒ 拿空对象去 `provider.getModel(undefined, undefined)` | 报错（`state.md` 缺口表已登记为「类型谎言」） |

三件事合起来做：

1. **本栏恒给**：`draft.model` ＝ 三级解析出来的那一支（本栏选的 → 会话记的 → 应用默认）。有值就把它原样交给 `submitRightPanePrompt`。
2. **认不出就不发**：三级一个都解析不出来 ⇒ `submitRightPanePrompt` 在组 `draft` 之前就 `return false`（正文留在输入框里），**不是**「传 `undefined` 交给服务端缺省」——那条老路正是 F3/F4 的成因。这个分支只在「一个 provider 都没接入」时才走到（缺口表 G8）。
   - 这条**不吞异常**：没有 catch 上游，而是在调用上游**之前**就把语义补齐（恒给）或明确拒绝（不发）。
3. **右栏「＋ 新会话」带上当前选择**（若已选）：`session-actions.ts:63-64` 的 `建会话` 加一个可选 `model` 参数。
   - 触发这条改动的直接依据：该处注释写着「`agent` / `model` 同样可选，本处**不传**：**右栏没有选择器**」——**这条前提正是本轮推翻的**（`LEARNINGS #002-06`：谁在按同一个前提做同一件事）。
   - 效果：右栏建出来的会话**从出生起就有 model**，第 2 条兜底基本走不到。

**⇒ 修法收敛成一句话：本栏恒有模型**（模型控件给出的「本栏选的 → 会话记的 → 应用默认」），**解析不出来就不发**（`submitRightPanePrompt` 在组 `draft`（`submit-prompt.ts:111`）之前 `return false`）。F3 与 F4 同时消失，且 `submit-prompt.ts` 里那两个 `as` 少掉一个（`model` 那处不再需要：`FollowupDraft.model` 是必填，而守卫之后 `input.model` 已被收窄）。

**明确不做**：不在前端**自己复算** `configuredModel ?? recentModel ?? defaultModel` 那条**链**（那条链 `local.tsx:180` 已经写着一份，再写就是同一判断的第二处写法，`#002-06`；`submit-prompt.ts:81-82` 已经论证过为什么不行，那段论证不因本轮而失效）。⚠️ **不**禁「取服务端归一化后的 `defaultModel()`」——那是 §3.2 值表里的「应用默认」，是单一来源、不是一条链。

### 3.4 接线总图

```
ai-session-slot.tsx
  ├─ dataFor(目录) = serverSync().ensureDirSyncContext(目录).data   ──┐
  │     .command  ──► ① / 面板的池子（服务端命令那半）              │ 已是 props.data
  │     .session  ──► ② 当前会话的 model（服务端记的那半）           │
  └─ 投影 = projectCapabilities(MANIFESTS, module)  ──► 抽屉/指令卡（模块轴不动）

session-panel.tsx
  ├─ useCommand()  ──► ① / 面板的池子（内建斜杠命令那半）
  ├─ useProviders(目录) ──► ② 候选模型列表          ← 已验：右栏在 router root，取得到
  ├─ 模型信号 ──► ② 当前值；onSubmit 时交给 submit-prompt
  └─ PromptInputV2(controller) —— view 里补 model（view.model 供数据）  ← 原生 fallback，零新 UI

submit-prompt.ts（fork 边界）
  ├─ draft.model = 三级解析出来的那一支             ③-1
  └─ 认不出 ⇒ 不发（return false）                  ③-2

session-actions.ts
  └─ 建会话(…, model?)                              ③-3
```

---

## 4. 备选与拒绝理由

| 备选 | 拒 |
|---|---|
| 复用 `ModelSelectorPopoverV2`（原生那颗控件） | 它的 controller 写着 `const model = input.model ?? useLocal().model`（`dialog-select-model.tsx:260`）⇒ 复用**必需要一份 `ModelState`**。而 `ModelState = ReturnType<typeof useLocal>["model"]`（同文件 `:29`）是个十几个成员的对象（`local.tsx:280-360`：`ready/current/recent/list/cycle/set/visible/setVisibility/variant{…}`）。**造一份完整的＝把 `local.model` 抄一遍**（`#002-06`）；造一份**残缺的再强转**＝给上游留一排运行时静默洞（上游哪天多动一个成员就炸，且不报错）。两条都不合仓训 ⇒ 不造新控件，改给 `view.model` 供数据、走原生 fallback（§3.2），只取它真正的数据源 `useProviders(目录)` 一个。 |
| 把 `LocalProvider` 上提到能罩住右栏 | 上游文件（`packages/app/src/context/local.tsx` 与 `pages/directory-layout.tsx` 都在 `upstream/dev` 里）结构改动大 ＝ 与「最小化上游冲突」这条第一号约束正面对撞；且 `local.tsx:75-83` 的 `persisted` 是**按 (scope, 目录) 存的单份 localStorage**，右栏再挂一个实例就是**两个写入者写同一把钥匙**（后写覆盖先写）。**不做。** |
| 右栏自建选择器并复算回退链 | `#002-06`：同一个判断两处各写一份。**不做。** |
| 右栏第二个 `LocalProvider` 实例 | 同上，两个写入者。**不做。** |
| 只把 `MANIFESTS` 补到 118 条 | 那是**手工镜像**服务端的 skill 清单 —— 服务端一变就静默过期。**不做。** |
| 把 F3 交给上游修 | 用户裁定「本轮修掉」。且上游那条分支的写法在 fork 侧无法改（上游文件）。**改为在 fork 边界修。** |

---

## 5. 验证策略（实现期的判据）

**RED 先写，且每条都在 fork 自己的文件上**：

| 落点 | 用例 | 变异时应当红在哪 |
|---|---|---|
| `session-panel.test.tsx` | 喂一份含 `data.command` 的假 data ⇒ `/` 面板里出现那些命令（今天只会出现 2 条投影） | 拆「池子来源」⇒ 红 |
| 同上 | 选中**内建**项 ⇒ 触发 `command.trigger`；选中**服务端命令** ⇒ **只插文本**、不触发 | 拆任一半 ⇒ 各红一条 |
| `submit-prompt.test.ts` | 哨兵那条「⚠️ 会话没记过 model ＋ 正文命中命令 ⇒ 当场抛」**改成**「本栏一个模型都认不出 ⇒ **不发**（两个出口都没碰、回话是 `false`）」 | 拆守卫（删 `return false` 那行）⇒ 红 |
| 同上 | 有选择 / 会话有 model ⇒ `draft.model` 就是它 | 拆取值 ⇒ 红 |
| `session-actions.test.ts` | 带 model 建会话 ⇒ `api.create` 的载荷含该 model | 拆传参 ⇒ 红 |

**真栈**：把今天的探针 `e2e/real-stack/slash-probe-real.spec.ts` 升级成验收 spec ——

- 断「右栏 `/` 面板条数 = 内核 `GET /command` 的条数」（**同一次运行里两侧各取一次数**，不写死数字）；
- 断弹层几何在视口内（沿用今天的量法）；
- **模型控件**：可见 ⇒ 选一个 ⇒ 提交 ⇒ 读内核会话的 `model` 确实变了（这一条才钉得住「管这场会话，且记住」）。

**门禁**：仓库根串行（`#003-01`）：受影响 package 的 typecheck ＋ 单测 ＋ 组件测试 ＋ oxlint ＋ `git diff --stat bun.lock` 为空。

**变异**：每条改动的**每一处**各拆一次，按 `#003-03` 三类（恰红 / 假绿 / 全绿）**据实记**，不挑好看的记。

---

## 6. 本轮不做（YAGNI）

- agent 选择器、Effort 选择器（裁定 #4：只做模型）；
- 统一右栏「＋ 新会话」与首页新建的语义（**上一轮已明确划在范围外**）；
- 抽屉/指令卡的模块轴改动（本轮只动 `/` 面板的池子）；
- `pull upstream/dev`。

---

## 7. 缺口与代价（据实，不含糊）

| # | 缺口 | 现状 |
|---|---|---|
| G1 | `useProviders()` 里的 `useParams()` 在 Route 之外会不会抛 | **已验：不抛**（`useRouter` 查的是 `<Router>` 提供的 `RouterContextObj`，右栏在 router root；见 §3.2）。**结论不变**：② 的候选列表就取 `useProviders(目录)` |
| G2 | `ModelSelectorPopoverV2` 的完整入参 | **已验：不可复用**（它要一份完整的 `ModelState`，`dialog-select-model.tsx:260`）。**结论改变**：② 不新建控件，给 `view.model` 供数据、走原生 fallback（§3.2 / §4） |
| G3 | 「选了没提交就刷新 ⇒ 丢」 | **接受**（裁定 #2 的必然代价），文档化即可 |
| G4 | 真栈复现 F3（新会话第一条 `/命令`） | **未做**；实现期作为 ② 步的 RED 之一 |
| G5 | `projection.all` 改成无消费者后的去留 | 本轮只标注，不删 |
| G6 | 服务端命令里 118 条是否会因目录不同而变 | 今天只量了一个目录；真栈验收用例**改成两侧各取一次数**，不写死 |
| G7 | 内建命令的键位提示没搬过来（原生弹层每项右侧显示 `Mod+M` 这类键位，右栏不显示）——`右栏斜杠命令` 没给 `keybind` 字段 | 纯外观，真栈 spec 会读到实况 |
| G8 | 无任何已接入 provider 时，模型控件的候选为空、触发器文字为空串，且提交会被守卫挡下（返回 false、正文留在框里、**没有提示**） | 本机没有可复现的环境（不配 provider 连原生的底栏也是空的）⇒ 据实挂账，不写「已覆盖」 |
| G9 | 「内建命令选中即执行」的**真执行**只在单元层钉（`右栏选中命令` 返回动作）＋ 组件层钉（spy 被调用）；真栈只钉到「池子里有内建」与「服务端命令选中后 token 留在框里」 | 真执行会在沙箱里跑 `/init` 这类有副作用的命令 ⇒ 真栈不跑 |
| G10 | **唯一与原生不同字的一处**：`title`。能对上号的 skill 用中文显示名（用户裁定 2026-10-11，为保住「民警打中文搜得到」），其余用命令名 | `id`/`label`/`trigger`/次序与原生逐条一致 |
