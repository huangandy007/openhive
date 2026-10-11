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

### 3.2-bis ②／④ **已被推翻**（2026-10-11 第二轮 · 用户裁定 **A：右栏自挂 `LocalProvider`**）

> ⚠️ **上面 §3.2 与 §4 的两条否决（「`ModelSelectorPopoverV2` 不可复用 ❌」「右栏第二个 `LocalProvider` 实例 ✗」）
> 已作废。** 本节记录推翻的理由与新的接线，**实施以本节为准**。留着上面那两段是为了留下「为什么当时那么判」，
> 不是让后来人照做。

**推翻它的是一场用户报的缺陷**（原话：「点击后列表无法滚动选择，同时还没有管理模型和搜索模型的功能，
体验感很差」）。§3.2 选的那条路（喂 `view.model`、走原生 fallback）**确实是零新 UI**，代价也**已在 §3.2
第 3 条据实写过**——但那条「代价」在使用者眼里就是缺陷本身：`PromptInputV2ConfiguredSelect`
（`session-ui/v2/components/prompt-input/index.tsx:551-599`）是一列平铺 `RadioGroup`，
**没有搜索框、没有按 provider 分组、没有「管理模型」、也没有滚动容器**。当时判「可接受」，
是把它当**外观**代价；实际是**功能**缺口（36 个候选挤在一列看不见的盒子里）。

**新方案**：右栏**自己挂一层 `SDKProvider` ＋ `LocalProvider`**（`ai-session-slot.tsx`），
底栏那颗钮改喂 `modelControl`（`session-panel.tsx:681`），内容是 `model-control.tsx` 的
`右栏模型控件` —— 上游 `ModelSelectorPopoverV2` 的**平抄**（搜索 / 分组 / 滚动 / 管理模型全在）。

| 当时否决的理由 | 推翻它的实测 / 裁定 |
|---|---|
| 要一份完整 `ModelState`，「造一份＝把 `local.model` 抄一遍」 | **不必造**：右栏**就在 `LocalProvider` 之内**取 `useLocal().model`，拿到的就是**真身**（`model-control.tsx:77` 的 `model={local.model}`）⇒ 一个字都没抄 |
| 右栏挂第二个 `LocalProvider` ＝ 两个写入者写同一把钥匙（后写覆盖先写） | ① 用户裁定 **A（右栏自挂）**，并明确「允许在槽内部再挂一层」；② 实测那把钥匙**不是** (scope, 目录) 一份，而是 **server scope ＋ 目录 ＋ 会话 id**（`context/local.tsx:264-276` 的 `write()`）⇒ 两份实例写的是**同一场会话的同一条账**，值相同、相互覆盖无损；③ **代价据实记**：两份实例的 signal 是**独立**的，右栏选中的模型，被藏起来的中栏那一份**要重挂才看得到**——今天中栏在会话路由下**点不到**（`center-content.tsx` 只藏不卸）⇒ **无实测后果**，但记在 `ai-session-slot.tsx` 文件头备查 |
| 提 `LocalProvider` 上来要动上游 `app.tsx` / `layout-new.tsx`（违第一号约束） | **仍然成立**——所以**不动上游**，改成**在右栏槽内部再挂一层**：那是「加」不是「改」（`CLAUDE.md` 定制化三原则 ①） |

**这一轮同时退掉的一级**：显示值的来源里那级 **「会话记的」**（服务端 `session.model`）**不再参与判断**。
新的「当前模型」**只有一处判断**——上游 `local.model.current()`（`context/local.tsx:233`：
本场选的 → 本场 agent 默认 → 配置的 / 最近用过的 / 默认）。右栏只把那一项拆成 `{providerID, modelID}`
（`ai-session-slot.tsx` 的 `现在认的模型`），**不重算**（`#002-06`）。
⚠️ 服务端 `session.model` **仍然写**（提交时随 `draft.model` 带出去，同 §3.3），只是不再作为**显示**来源；
中栏本来也没读过它 ⇒ 右栏这一改是**与上游对齐**，不是功能丢失。「记住」改由原生那套承担
（`context/local.tsx:264-276` 的 `write()` ⇒ `localStorage`，键含 server scope ＋ 目录 ＋ 会话 id），
**T7 已实测**：选中 ⇒ 钮上当场变；重开页面 ⇒ 还是它（`right-pane-slash-and-model-real.spec.ts`）。

**仍然成立、不因本轮而变的一条**：`useProviders()` 里的 `useParams()` 在右栏不抛（上一条待验 ① 的结论）——
而且它正是本方案的前提：`useLocal()` 的 `id()` 取的就是 `useParams().id`（`context/local.tsx:70`，
`@solidjs/router@0.15.4` 的 `useParams = () => useRouter().params` ⇒ 读的是**路由器全局**那份，
不是最近一层 `<Route>` 的）。选中因此写进 `saved.session[<本场 id>]` —— 正是裁定 #2 要的「管这场会话，且记住」。
⚠️ 这与 `route-session.ts` 文件头那句「拿不到 `:id` 这个路由参数」**字面相反**；那句是对 `useParams()` 的误记
（它拿不到的是最近一层 `<Route>` 的上下文，那是 `useRoute()`）。**没有改它**：它按 URL 解析的做法仍然对、
用例仍然绿，不动才是外科式的。

**用户可见的代价（据实写）**：右栏自挂的目录级 provider 目录要几秒才 `ready`
（`useProviders(() => sdk().directory)`，`explicit: true`）⇒ 冷启动那几秒 `current()` 恒空、
钮上是占位文案（`dialog.model.select.title`）。真栈实测时间线：`+2992ms` 开弹层时
`data-selected-model` **0 条** → `+3052ms` 目录那条 `GET /provider?directory=…` 响应 → `+5253ms` 钮上见字。
**未修**（是上游目录作用域 catalog 的固有延迟，不是右栏引入的），真栈判据一律**等条件不等时间**
（`等钮落定`）。

### 3.3 ③ F3 与 F4 —— 让那两格不可达，且不复制服务端的回退链

**同根因的两处落点，都在客户端上游 `packages/app/src/components/prompt-input/submit.ts`**（「右栏不传 model」，而上游那两处都假设它必有值）：

| 落点 | 位置 | 读法 | 症状 |
|---|---|---|---|
| **F3** | 命令分支 `submit.ts:94-98`（`:95` 读 `input.draft.model.modelID`、`:96` 读 `providerID`） | `draft.model` 为 `undefined` 时**当场解引用** | 抛 `Cannot read properties of undefined (reading 'modelID')` |
| **F4** | normal 分支 `submit.ts:136` `model: { ...input.draft.model, variant: input.draft.variant }` | `draft.model` 为 `undefined` 时展开得 `{}`（**真值**）⇒ 服务端 `input.model ?? ag.model ?? currentModel(…)` 的回退链被顶掉 ⇒ 拿空对象去 `provider.getModel(undefined, undefined)` | 报错（`state.md` 缺口表已登记为「类型谎言」） |

三件事合起来做：

1. **本栏恒给**：`draft.model` ＝ **本栏现在认的那一支**。⚠️ **2026-10-11 第二轮起，这一支的出处改了**（§3.2-bis）：**不再**是本文件自己的三级源（本栏选的 → 会话记的 → 应用默认），而是**上游 `local.model.current()`** 给出的那一项（本场选的 → 本场 agent 默认 → 配置的 / 最近用过的 / 默认），由 `ai-session-slot.tsx` 的 `现在认的模型` 拆成 `{providerID, modelID}`。有值就把它原样交给 `submitRightPanePrompt`。
2. **认不出就不发**：三级一个都解析不出来 ⇒ `submitRightPanePrompt` 在组 `draft` 之前就 `return false`（正文留在输入框里），**不是**「传 `undefined` 交给服务端缺省」——那条老路正是 F3/F4 的成因。这个分支只在「一个 provider 都没接入」时才走到（缺口表 G8）。
   - 这条**不吞异常**：没有 catch 上游，而是在调用上游**之前**就把语义补齐（恒给）或明确拒绝（不发）。
3. **右栏「＋ 新会话」带上当前选择**（若已选）：`session-actions.ts:63-64` 的 `建会话` 加一个可选 `model` 参数。
   - 触发这条改动的直接依据：该处注释写着「`agent` / `model` 同样可选，本处**不传**：**右栏没有选择器**」——**这条前提正是本轮推翻的**（`LEARNINGS #002-06`：谁在按同一个前提做同一件事）。
   - 效果：右栏建出来的会话**从出生起就有 model**，第 2 条兜底基本走不到。

**⇒ 修法收敛成一句话：本栏恒有模型**（＝上游 `local.model.current()` 的那一项，见 §3.2-bis），**解析不出来就不发**（`submitRightPanePrompt` 在组 `draft`（`submit-prompt.ts:111`）之前 `return false`）。F3 与 F4 同时消失，且 `submit-prompt.ts` 里那两个 `as` 少掉一个（`model` 那处不再需要：`FollowupDraft.model` 是必填，而守卫之后 `input.model` 已被收窄）。

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
| 复用 `ModelSelectorPopoverV2`（原生那颗控件） | ~~它的 controller 写着 `const model = input.model ?? useLocal().model`（`dialog-select-model.tsx:260`）⇒ 复用**必需要一份 `ModelState`**。~~ ⚠️ **已推翻**（§3.2-bis）：右栏自挂 `LocalProvider` 之后**不必造**，`useLocal().model` 直接就是真身 ⇒ **本轮正是复用这一颗**。 |
| 把 `LocalProvider` 上提到能罩住右栏 | 上游文件（`packages/app/src/context/local.tsx` 与 `pages/directory-layout.tsx` 都在 `upstream/dev` 里）结构改动大 ＝ 与「最小化上游冲突」这条第一号约束正面对撞。**仍然不做**——但**改为在右栏槽内部再挂一层**（那是「加」，不动上游任何文件，§3.2-bis）。 |
| 右栏自建选择器并复算回退链 | `#002-06`：同一个判断两处各写一份。**仍然不做**（新方案也不重算，只读上游 `local.model.current()`）。 |
| 右栏第二个 `LocalProvider` 实例 | ~~两个写入者写同一把钥匙~~ ⚠️ **已采纳**（用户裁定 A，2026-10-11）：实测那把钥匙含**会话 id**（`local.tsx:264-276`）⇒ 两份实例写同一条账、无损；两套 signal 独立的代价据实记（§3.2-bis）。 |
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
| G2 | `ModelSelectorPopoverV2` 的完整入参 | ~~**已验：不可复用**~~ → ⚠️ **第二轮再变**（§3.2-bis）：**已复用**——右栏自挂 `LocalProvider`，`local.model` 直接就是真身（不必造 `ModelState`）。② 的落点是 `model-control.tsx` 的 `右栏模型控件`（上游那颗的平抄，只去掉「未付费」那一支） |
| G3 | 「选了没提交就刷新 ⇒ 丢」 | ~~**接受**（裁定 #2 的必然代价）~~ → ⚠️ **不再成立**（§3.2-bis）：原生那套在**选中的那一刻**就 `write()` 进 `localStorage`（`local.tsx:264-276`）⇒ 没提交也不会丢。**真栈 T7 实测**：选中 ⇒ 钮上当场变；`page.goto` 重开 ⇒ 还是它 |
| G4 | 真栈复现 F3（新会话第一条 `/命令`） | **未做**；实现期作为 ② 步的 RED 之一 |
| G5 | `projection.all` 改成无消费者后的去留 | 本轮只标注，不删 |
| G6 | 服务端命令里 118 条是否会因目录不同而变 | 今天只量了一个目录；真栈验收用例**改成两侧各取一次数**，不写死 |
| G7 | 内建命令的键位提示没搬过来（原生弹层每项右侧显示 `Mod+M` 这类键位，右栏不显示）——`右栏斜杠命令` 没给 `keybind` 字段 | 纯外观，真栈 spec 会读到实况 |
| G8 | 无任何已接入 provider 时，模型控件的候选为空、触发器文字为空串，且提交会被守卫挡下（返回 false、正文留在框里、**没有提示**） | 本机没有可复现的环境（不配 provider 连原生的底栏也是空的）⇒ 据实挂账，不写「已覆盖」 |
| G9 | 「内建命令选中即执行」的**真执行**只在单元层钉（`右栏选中命令` 返回动作）＋ 组件层钉（spy 被调用）；真栈只钉到「池子里有内建」与「服务端命令选中后 token 留在框里」 | 真执行会在沙箱里跑 `/init` 这类有副作用的命令 ⇒ 真栈不跑 |
| G10 | **唯一与原生不同字的一处**：`title`。能对上号的 skill 用中文显示名（用户裁定 2026-10-11，为保住「民警打中文搜得到」），其余用命令名 | `id`/`label`/`trigger`/次序与原生逐条一致 |
| G11 | §3.2 值表第三级「应用默认」`useProviders(目录).defaultModel()`（⚠️ §3.2-bis 之后由上游 `local.model.current()` 的第三级承担，**同一个值、同一处来源**）在 **v1 下拿不到值**（`bootstrap.ts:234` 只传一参给 `normalizeProviderList`，v1 生成类型无 `defaultModel` 字段 ⇒ 恒 `undefined`）——新会话「本栏没选过 ＋ 会话没记过」时三级全空 ⇒ `submit-prompt.ts:89` 静默 `return false`（正文留框、零提示，民警打字回车无反应）；会话记过 model 时不受影响 | 视觉层见 `state.md` F7；功能后果即终审 I-1。**待用户裁定**（v1 兜底 / 可见提示 / 维持现状）；代码面本轮不修（改 `context/global-sync/**` 违 Global Constraint 1、在 `ai-session/**` 自复算违 §3.2） |

---

## 8. 第二轮实施出参（2026-10-11 · 用户裁定 A 之后）

### 8.1 改动面（全部在 fork 自己的文件上；**上游文件一个字没改**）

| 文件 | 动作 | 一句话 |
|---|---|---|
| `packages/app/src/ai-session/model-control.tsx` | **新增** | `右栏模型控件`：上游 `PromptInputV2ModelControl`（`components/prompt-input-v2.tsx:471`，**未导出**）的平抄，两处差别写在文件头（去掉「未付费」那一支；Tooltip 文案/键位在右栏现取） |
| `packages/app/src/ai-session/ai-session-slot.tsx` | 改 | 拆成「外层挂 provider」＋「`右栏主体` 本体」两层；挂 `SDKProvider` ＋ `LocalProvider`；`现在认的模型()` 改读 `local.model.current()` |
| `packages/app/src/ai-session/model-selection.ts` / `.test.ts` | **删除** | fork 自造的 `模型选项` / `当前模型键` / `从键` 三个纯函数——它们正是「同一判断的第二处写法」（`#002-06`），原生 `useLocal()` 已经全有 |
| `packages/app/src/ai-session/session-panel.tsx` | 改 | `模型控件` 的类型从 `PromptInputV2SelectControl` 改成 **`JSX.Element`**；controller 的 `view.model` 摘掉；`<PromptInputV2 controller modelControl={props.模型控件} />` |
| `packages/app/src/ai-session/session-panel.test.tsx` | 改 | 24 处夹具改成 `<button data-probe="模型控件">`；「底栏模型控件」组重写成两条（原样落在 Hero / 原生口优先） |
| `packages/app/src/ai-session/submit-prompt.ts` · `session-actions.ts` · `session-panel.stories.tsx` | 改 | 注释里「`model-selection.ts` 的 `当前模型键`」→「上游 `local.model.current()`」；storybook 的假控件换成占位元素（**它要 `useLocal()`，storybook 这一层没有**） |
| `packages/app/e2e/real-stack/right-pane-slash-and-model-real.spec.ts` | 改 | T3–T7 判据整轮换成**原生弹层**的记号（`[data-option-key]` / `[data-scrollable]` / `搜索框` / `action:manage`）＋ 三条条件等待 |

### 8.2 真栈读数（本轮实测，`bunx playwright test --config <临时复用配置> right-pane-slash-and-model-real`）

```
【T1 池子条数】126 条（自定义 118 / 内建 8）
【T3 模型钮】当前显示「Select model」，候选 14 条
【T4 过滤】全量 14 → 空词 0 → 还原 14 → 搜「Ling」1 条
【T5 滚动槽】scrollHeight=478 clientHeight=220 overflowY=auto
【T5 滚动选最后一条】「DeepSeek V4 Pro」 → 「DeepSeek V4.1 Flash」（末条「DeepSeek V4.1 Flash」）
【T6 管理模型】对话框文案："Manage models\n\nCustomize which models appear in the model selector.…"
【T7 记忆】「DeepSeek V4 Pro」 → 「DeepSeek V4.1 Flash」；重开页面仍是「DeepSeek V4.1 Flash」

  7 passed (1.0m)
```

⇒ 用户报的三件事逐条对上：**搜索框在**（T3/T4）、**滚得动且能选到末条**（T5）、
**「管理模型」点开是原生那个对话框**（T6）。

### 8.3 ④ 变异验证（据实记，`#003-03` 三类都记）

| 变异 | 拆什么 | 实得 |
|---|---|---|
| **A** | `session-panel.tsx` 的 `<PromptInputV2 controller modelControl={props.模型控件} />` ⇒ `modelControl={undefined}` | **恰红 1**，正是「喂进来的那个节点原样落在 Hero 输入框里」。⚠️ **同组第二条**（`喂了 modelControl ⇒ 原生那颗平铺控件一条都不渲染`）**照旧绿**——上游那句 `Show` 的 fallback 还要 `view.model` 也在才画，而本轮已把 `view.model` 摘掉 ⇒ 两个分支都不画。**据实记成「第③类：这条不是那次改动的守护者」**，并写进该用例的注释（`#005-15`：别让注释比断言强） |
| **B** | 把改动**整份退回**（`modelControl` 不给 ＋ controller 的 `view.model` 加回来） | **64 pass / 1 fail**（钝变异：一次性把两条判据的前提都翻掉，读不出谁是谁的守护者） |
| **C** | `等候选到齐(page)`（T4/T5/T6 各一处调用）整体拿掉 | **冷启动那一跑天然红过**：`scrollHeight=50 clientHeight=50` ＋ Playwright 快照里滚动区只有 `No model results`（见 §3.2-bis 的冷启动窗口）。⚠️ **诚实的边界**：这是个**时间窗**，不是确定性缺陷 ⇒ 拿掉等待**不一定每次红**（暖跑会绿）。修前红 / 修后绿是**同一环境下的前后对**，但**不能**承诺「拿掉必红」 |

### 8.4 门禁（**串行**、仓库根，`#003-01`）

```
bun run typecheck     → Tasks: 31 successful, 31 total          (EXIT=0)
packages/app 内 bun run test → 1115 pass / 41 pass / 814 pass / 0 fail (EXIT=0)
bun run lint:openhive → Found 37 warnings and 0 errors          （本轮新增行零命中）
git diff --stat bun.lock → 空
```

### 8.5 本轮新增 / 更新的缺口

| # | 缺口 | 现状 |
|---|---|---|
| G12 | **两份 `LocalProvider` 实例的 signal 独立**：右栏选中的模型，被藏起来的中栏那一份要**重挂**才看得到 | 中栏在会话路由下**点不到**（`center-content.tsx` 只藏不卸）⇒ **无实测后果**；记在 `ai-session-slot.tsx` 文件头备查 |
| G13 | **冷启动窗**（目录级 provider 目录就绪前，钮上是占位文案） | 未修（上游目录作用域 catalog 的固有延迟）。真栈判据已全部改成**等条件不等时间**；真栈日志里 T3 那一行 `当前显示「Select model」` 就是这个窗口的实况 |
| G14 | **「会话记的服务端 `session.model`」不再参与显示**（§3.2-bis） | 已对齐上游（中栏本来就不读它）；服务端**仍然写**。记进 `state.md` 缺口表 |
| G15 | **整目录真栈套件跑出一个 7 failed**（`ai-session-real.spec.ts` 6 条 ＋ 本 spec 的 T5 1 条；41 passed / 9.8m） | T5 那条已归因修掉（§8.3-C）。`ai-session-real.spec.ts` 那 6 条**本轮没查**——它们是**同一条 `ai-session-real` 文件**在**长跑（9.8 分钟、48 条）**里的红，单跑本 spec 时 6/7 绿。**据实挂账**，不写成「已知 flake」，也不写成「已修」 |
