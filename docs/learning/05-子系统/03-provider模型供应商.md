# 05 · 子系统 · provider 模型供应商

> provider 体系是 opencode「跟各家模型打交道」的抽象层。理解它，你就知道「opencode 怎么支持这么多模型」「怎么接一个自己的模型」。

---

## 一、provider 是什么

「模型供应商」——OpenAI、Anthropic、Google、本地 Ollama…… opencode 把「接哪家模型」抽象成 provider 概念，让你在一个工具里自由切换。

用「加油站」类比：opencode 是汽车，provider 是不同品牌的加油站，model 是具体的油品标号。车不关心油从哪来，只要能加。

---

## 二、四层来源（模型清单从哪来）

provider 的「供应商目录」来自四层叠加（`provider.ts` 的 `layer` 合并）：

| 层 | 来源 | 说明 |
|---|---|---|
| ① models.dev 在线目录 | `core/src/models-dev.ts:160` | 从 `https://models.opencode.ai/api.json` 拉取，**75+ provider**，缓存 5 分钟、60 分钟后台刷新 |
| ② 内置 AI SDK 包 | `provider.ts:107-134` 的 `BUNDLED_PROVIDERS` | 已绑定的 SDK 工厂（anthropic/openai/google/azure/bedrock/groq…） |
| ③ 内置 provider 插件 | `core/src/plugin/provider.ts:36-71` | 35 个插件，提供 auth/SDK/language 钩子 |
| ④ 自定义加载器 | `provider.ts:168-963` 的 `custom()` | 每个 provider 的模型选择、baseURL 变量、默认 header |

**关键机制**：`DynamicProviderPlugin`（`core/src/plugin/provider/dynamic.ts:6-31`）让**任何没在 `BUNDLED_PROVIDERS` 里的 npm 包**，都能运行时 `npm.add()` 动态安装并 import，找到 `create*` 工厂构造 SDK。**这就是「配置一个自定义 provider 不用改代码」的底层原因。**

---

## 三、领域模型

运行时核心在 `packages/opencode/src/provider/provider.ts`：

- `Provider.Info`（`:1053-1062`）：`{ id, name, source, env[], key?, options, models }`
  - **`source` 标记来源**：`env` / `config` / `custom` / `api` 四类
  - `env` 是它读取的环境变量名数组（如 OpenAI 读 `OPENAI_API_KEY`）
- `Model`（`:1036-1051`）：`{ id, providerID, api, name, family?, capabilities, cost, limit, options, headers, variants? }`

---

## 四、配置方式

### 1. 配置文件（`opencode.json`）

```jsonc
{
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",   // SDK 包
      "name": "My AI Provider",
      "options": { "baseURL": "https://api.myprovider.com/v1" },
      "models": { "my-model": { "name": "My Model" } }
    }
  },
  "model": "myprovider/my-model"            // 设默认模型
}
```

### 2. 环境变量
每个 provider 在 models.dev 目录里声明它依赖的 env 变量名（如 `ANTHROPIC_API_KEY`），`layer` 的 `load env` 阶段遍历这些名字，找到第一个非空值作为 key。

### 3. API key 存储
凭证存在 `~/.local/share/opencode/auth.json`（`provider/auth.ts` 管理，`/connect` 命令写入，支持 OAuth / API key）。

### 4. baseURL / 自定义端点
`resolveSDK`（`:1698-1719`）：`options.baseURL` 优先，否则用 `model.api.url`，支持 `${VAR}` 占位符替换。

---

## 五、模型解析选择流程

1. `parseModel()`（`:1997`）：把 `"provider/model"` 字符串切成 `{providerID, modelID}`
2. session 决定用哪个模型（`session/prompt.ts`）：命令 model → agent model → 用户输入 model → `currentModel()`（读 session 表 → 最近消息 → 回退 default）
3. `defaultModel()`（`:1947`）：`cfg.model` → 最近使用记录 → 第一个已配置 provider → 按权重排序第一个
4. `getModel()`（`:1811`）：在 `providers[providerID].models` 里查，找不到抛 `ModelNotFoundError`
5. `getLanguage()`（`:1835`）：把 `Model` 变成可调用的 `LanguageModelV3`，内部 `resolveSDK` 拼 options、缓存 SDK 实例、命中 `BUNDLED_PROVIDERS` 或用 `DynamicProviderPlugin` 动态安装

---

## 六、如何新增一个 provider

### 绝大多数情况：只改配置，不写代码 ✅

标准 OpenAI 兼容 / 本地模型（Ollama / llama.cpp / LM Studio），只需在 `opencode.json` 写三要素：

```jsonc
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "llama3": {} }
    }
  }
}
```

生效原理：配置被合并进 catalog → `DynamicProviderPlugin` 运行时 `npm.add()` 装包 → 调 `create*` 工厂构造 SDK。

### 需要写代码的情况（特殊需求）❌

如果新 provider **不是** OpenAI 兼容协议、需要 OAuth、自定义响应转换、动态发现模型，才需要写代码：

1. 在 `packages/core/src/plugin/provider/` 新增插件文件（参照 `openai.ts`）
2. 在 `plugin/provider.ts:36-71` 的 `ProviderPlugins` 数组注册
3. 如需要，加到 `BUNDLED_PROVIDERS`（`provider.ts:107-134`）和 `custom()`（`:168-963`）

---

## 七、小结

```
models.dev 目录 + 内置 SDK 包 + 插件 + 自定义加载器
  → 合并成 provider 目录
  → 读配置/环境变量/auth 补齐 key 和 baseURL
  → parseModel 解析 "provider/model"
  → getLanguage → resolveSDK → 动态装包构造 SDK
  → 发起请求（对接 04-数据流/04-模型调用层）
```

provider 体系的设计精髓：**「配置即 provider」**——标准协议的新模型接入零代码，只有非标协议才需要写插件。这也是 openhive 想接私有模型时的最大便利。
