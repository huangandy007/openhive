export * as ModelResolve from "./model-resolve"

import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Effect, Schema } from "effect"

/**
 * openhive 模型解析的唯一入口（2026-11-08，模型统一配置设计 §3.1）。
 *
 * ## 为什么后台任务不调用 `provider.defaultModel()`
 *
 * 默认兜底会落到「最近用过的模型」或「排序后的第一个模型」，全程不校验可达性——
 * 真实事故就是兜底到 `openai/gpt-5.6-terra-pro`，4 个切片 × 3 次重试全部 ECONNREFUSED。
 * 后台任务要花钱、要可复现，所以 `task` 只认配置：`task_model` → `model`，都没有就是
 * `no_config`，绝不猜。
 *
 * ## 为什么不在这里探活
 *
 * 「解析得出」与「调得通」是两件事：探活会在启动期发网络请求（内网网关尚未就绪就起不来），
 * 且失败粒度是网络错误而不是配置错误。启动期只查配置完整性，可达性由作业期的 `getModel`
 * 与真正的模型调用暴露。
 */

export type Purpose = "chat" | "task"

export type ModelSource = "session" | "task_model" | "model" | "fallback"

export interface ResolvedModel {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
  readonly source: ModelSource
}

export class ModelUnavailable extends Schema.TaggedErrorClass<ModelUnavailable>()("ModelUnavailable", {
  // 这个 effect 版本里 `Schema.Literal` 只收一个值；多值用 `Schema.Literals([...])`
  // （`config.ts:63` 的单值先例 ＋ `Schema.d.ts:3431` 的多值签名）。
  purpose: Schema.Literals(["chat", "task"]),
  // ⚠️ `unknown_provider` 本模块**不产生**：启动期拿不到 auth / models.dev 的 provider 目录
  // （见「实施期细化」第 2 条），provider 是否存在由作业期 `provider.getModel` 判。枚举里留着它，
  // 是为了作业期把那个错误映射回同一个 reason 词表；不要在解析器里补一个假的来源判定。
  reason: Schema.Literals(["no_config", "bad_format", "unknown_provider", "unknown_model"]),
  detail: Schema.String,
}) {}

/** 旧环境变量：只用于「检测到就告警」，**不再读取**。 */
export const 旧抽取模型ENV = "OPENHIVE_CASE_EXTRACT_MODEL"

/**
 * 拆 `provider/model`。provider 取第一段，其余并回模型名（模型名本身可以含 `/`，
 * 与 `provider/parseModel` 同口径）。首段为空或模型名为空算格式错；
 * 夹在中间的 `//` 不在此处拒绝——那属于「模型名写错」，由作业期 `getModel` 判。
 */
export function 拆模型(值: string): { providerID: ProviderV2.ID; modelID: ModelV2.ID } | undefined {
  const [providerID, ...rest] = 值.split("/")
  const modelID = rest.join("/")
  if (providerID === "" || modelID === "") return undefined
  return { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(modelID) }
}

/**
 * 只看配置的解析。无服务依赖，启动自检与单元测试直接用它。
 *
 * `explicit` 只对 `chat` 有意义（会话里用户选的模型永远最高优先级）。
 */
export const resolveModelFromConfig = (
  config: Config.Info,
  purpose: Purpose,
  explicit?: { readonly providerID: string; readonly modelID: string },
): Effect.Effect<ResolvedModel, ModelUnavailable> =>
  Effect.gen(function* () {
    if (purpose === "chat" && explicit) {
      return {
        providerID: ProviderV2.ID.make(explicit.providerID),
        modelID: ModelV2.ID.make(explicit.modelID),
        source: "session" as const,
      }
    }

    // 空串按「未设置」处理：`task_model: ""` 回落到 `model`，`model: ""` 视为未配置。
    // 与 `resolveModelWith` 里 `config.model !== ""` 的「有配置」判据保持同一语义。
    // 口径与设置页的「槽位视图」一致（空串 = 未设置、task 缺省回落 model）；改一处要同时改另一处。
    const 槽位原文 = purpose === "task" ? (config.task_model || config.model) : config.model
    const 槽位 = 槽位原文 === "" ? undefined : 槽位原文
    if (槽位 === undefined) {
      return yield* new ModelUnavailable({
        purpose,
        reason: "no_config",
        detail:
          purpose === "task"
            ? "未配置后台任务模型：请在 opencode.jsonc 设置 task_model 或 model（形如 provider/model）"
            : "未配置聊天模型：请在 opencode.jsonc 设置 model（形如 provider/model）",
      })
    }

    const 解析 = 拆模型(槽位)
    if (解析 === undefined) {
      return yield* new ModelUnavailable({
        purpose,
        reason: "bad_format",
        detail: `${purpose === "task" ? "task_model" : "model"}="${槽位}" 不是 provider/model 形式`,
      })
    }

    // 只在「配置文件自己声明了这个 provider 且声明了 models」时校验模型名。
    // provider 来自 auth / models.dev 时，这里离线看不到它的模型目录；放行，
    // 由作业期的 `provider.getModel` 报错，错误名原文进作业错误文案。
    const 声明 = config.provider?.[解析.providerID]
    const 模型表 = 声明?.models
    if (模型表 !== undefined && Object.keys(模型表).length > 0 && 模型表[解析.modelID] === undefined) {
      return yield* new ModelUnavailable({
        purpose,
        reason: "unknown_model",
        detail: `模型 ${解析.providerID}/${解析.modelID} 不在配置的 provider.${解析.providerID}.models 里`,
      })
    }

    return {
      ...解析,
      source: purpose === "task" ? (config.task_model ? "task_model" : "model") : "model",
    }
  })

/**
 * 把兜底作为 Effect 注入，而不是在函数体里直接 `yield*` 某个服务。
 *
 * 这样「task 绝不调兜底」可以由单测钉住：注入一个一调用就 die 的 fallback，
 * task 路径必须连碰都不碰它。否则这条约束只能靠读代码保证——
 * 而它正是这次事故的根因（隐式兜底），必须有一条会红的用例守着。
 */
export const resolveModelWith = (
  config: Config.Info,
  purpose: Purpose,
  explicit: { readonly providerID: string; readonly modelID: string } | undefined,
  fallback: Effect.Effect<{ readonly providerID: ProviderV2.ID; readonly modelID: ModelV2.ID }, unknown>,
): Effect.Effect<ResolvedModel, ModelUnavailable> =>
  Effect.gen(function* () {
    if (purpose === "task" || explicit !== undefined || (config.model !== undefined && config.model !== "")) {
      return yield* resolveModelFromConfig(config, purpose, explicit)
    }
    const 兜底 = yield* fallback.pipe(
      Effect.mapError(
        (error) =>
          new ModelUnavailable({ purpose, reason: "no_config", detail: `没有可用的聊天模型：${String(error)}` }),
      ),
    )
    return { providerID: 兜底.providerID, modelID: 兜底.modelID, source: "fallback" as const }
  })

/**
 * 统一入口。`chat` 且没有显式模型、配置也没有 `model` 时，保持现状走 `defaultModel()`。
 */
export const resolveModel = (
  purpose: Purpose,
  explicit?: { readonly providerID: string; readonly modelID: string },
): Effect.Effect<ResolvedModel, ModelUnavailable, Config.Service | Provider.Service> =>
  Effect.gen(function* () {
    const config = yield* (yield* Config.Service).get()
    return yield* resolveModelWith(config, purpose, explicit, (yield* Provider.Service).defaultModel())
  })

/**
 * 启动期解析：把旧环境变量的存在变成一条 WARN，然后把实际生效的模型记进 INFO。
 * 返回的 `ResolvedModel` 在 worker 的层作用域里缓存，作业执行期复用（不再重读配置）。
 */
export const 解析启动模型 = (
  config: Config.Info,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ResolvedModel, ModelUnavailable> =>
  Effect.gen(function* () {
    if (env[旧抽取模型ENV] !== undefined && env[旧抽取模型ENV] !== "") {
      yield* Effect.logWarning(`${旧抽取模型ENV} 已废弃且被忽略：请改用 opencode.jsonc 的 task_model`)
    }
    const 模型 = yield* resolveModelFromConfig(config, "task")
    yield* Effect.logInfo("案件抽取模型已解析", {
      model: `${模型.providerID}/${模型.modelID}`,
      source: 模型.source,
    })
    return 模型
  })
