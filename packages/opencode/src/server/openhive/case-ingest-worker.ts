export * as OpenhiveCaseIngestWorker from "./case-ingest-worker"

import { readFile } from "node:fs/promises"
import { Cause, Effect, Layer } from "effect"
import { Config as CoreConfig } from "@/config/config"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 建调用模型 } from "./case-extract-ai"
import { 建表头识别器 as 建表头识别器AI } from "./case-header-ai"
import { claimNextJob, runJob, 作业项目目录, 沙箱内路径, type ClaimedJob } from "./case-ingest"
import { 解析启动模型 } from "./model-resolve"
import { OpenhivePg } from "./pg"

/**
 * 单 worker 顺序消费（设计 §6.5）。
 *
 * ## 轮询而不是通知
 *
 * 入队发生在上传请求里、消费发生在后台，两者之间不必耦合。间隔 2 秒——人拖完文件到
 * 看见 ✓ 之间本来就有解析时间，2 秒延迟看不出来，而空转开销只有一条 SQL。
 *
 * ## 形状照 `mcp-config-sync.ts`
 *
 * `Layer.effectDiscard` ＋ `Effect.forkScoped`，在 `server.ts` 的 `Layer.mergeAll` 里挂一次。
 * 一次性起一个循环，不占路由。
 *
 * ## 读盘只用 `沙箱根 + source_path`
 *
 * 项目目录恒为 `{root}/{userId}/{projectId}`，`source_path` 就是这一段相对路径 ——
 * 作业不必反查用户与项目，进程重启后照跑。
 */
export const 轮询间隔ms = 2000

/** `connect(env)` 拼连接串要的变量。缺任一 ⇒ 这台部署不接业务 PG。 */
const PG_ENV = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

/**
 * 显式开关（启动期静态值，与 `PG_ENV` 同一类判据）：值为 `"0"` 时不 fork 消费循环。
 *
 * 测试建**真应用**（`HttpApiApp.routes`）时后台 worker 会认领**同一个测试库**的作业，
 * 把用例插进去的东西悄悄跑掉/改态（I7）。生产不设这个变量，默认开。
 */
export const 消费开关ENV = "OPENHIVE_CASE_INGEST_WORKER"

/**
 * 旧环境变量 `OPENHIVE_CASE_EXTRACT_MODEL` 已废弃（2026-11-08，模型统一配置 D5）：
 * 只保留一条启动 WARN，见 `model-resolve.ts` 的 `解析启动模型`。模型统一在
 * `opencode.jsonc` 的 `task_model` / `model` 里声明，改完重启生效。
 */

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (process.env[消费开关ENV] === "0") {
      yield* Effect.logDebug("案件导入消费未启用：OPENHIVE_CASE_INGEST_WORKER=0")
      return
    }

    // 没配 PG 的部署**不起循环**（复审 I3）：配置是启动期静态值，不配就是永远不配；
    // 起了的话每 2 秒一条 WARN、一天 43200 条，把真正的告警淹掉。
    // 与 `mcp-config-sync` 的 `已启用` 同一条判据形状。
    if (!PG_ENV.every((key) => process.env[key])) {
      yield* Effect.logDebug("案件导入消费未启用：未配置 PG")
      return
    }

    // 启动自检（设计 §3.3）：配了 PG 就必须有可解析的后台模型，否则**拒绝启动**。
    // 只查配置完整性，不探网：内网网关尚未就绪不应阻止进程起来，可达性留给作业期暴露。
    //
    // ⚠️ 用 `getGlobal()` 而不是 `get()`：`get()` 走 `InstanceState`，启动期没有
    // `InstanceRef`（那也是作业期才有的东西）。后台模型是**部署级**配置，读全局那份正合适；
    // 项目级 `opencode.jsonc` 里的 task_model 不参与启动自检。
    const coreConfig = yield* CoreConfig.Service
    const 启动模型 = yield* 解析启动模型(yield* coreConfig.getGlobal(), process.env).pipe(
      Effect.catch((error) => Effect.die(new Error(`后台任务模型不可用：${error.detail}`))),
    )

    const pg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    const provider = yield* Provider.Service
    const instances = yield* InstanceStore.Service

    /**
     * 表头模型的样例脱敏开关。`case_table_mask_samples` 全仓只有这一个读者（文本抽取
     * 不读它）——别写成「与文本抽取共用」。
     */
    const 脱敏 = (yield* coreConfig.getGlobal()).case_table_mask_samples === true

    /**
     * 按作业的项目目录取语言模型——抽取器与表头识别器**共用这一份**。
     *
     * 模型在**启动期**已解析并缓存（`启动模型`），这里只做两件事：在本作业的实例上下文里
     * `getModel` 校验它确实存在，然后拿到调用入口。项目级 `opencode.jsonc` 能覆盖 provider，
     * 所以 `getModel` 仍不能省——它是「配置说存在」与「这个实例里真的存在」之间唯一的一道门。
     *
     * 失败处理只在这里写一次（`Effect.catchCause` 只取错误名）：这条文案会经 `runJob`
     * 落进 `parse_detail.reason` 并回给前端，`Cause.pretty` 的正文可能带连接串。
     */
    const 取语言 = async (job: ClaimedJob) => {
      const 目录 = 作业项目目录(config.root, job.sourcePath, job.projectId)
      if (目录 === undefined) throw new Error(`作业的落点不合法：${job.sourcePath}`)
      return Effect.runPromise(
        instances
          .provide(
            { directory: 目录 },
            Effect.gen(function* () {
              const resolved = yield* provider.getModel(启动模型.providerID, 启动模型.modelID)
              return yield* provider.getLanguage(resolved)
            }),
          )
          .pipe(
            Effect.catchCause((cause) => {
              const 原因 = Cause.prettyErrors(cause)
                .map((error) => error.name)
                .join("、")
              return Effect.die(
                new Error(
                  `后台任务模型不可用：${启动模型.providerID}/${启动模型.modelID}（source=${启动模型.source}；原因：${原因}）`,
                ),
              )
            }),
          ),
      )
    }

    const 建抽取器 = async (job: ClaimedJob) => ({
      调用: 建调用模型(await 取语言(job)),
      模型标识: `${启动模型.providerID}/${启动模型.modelID}`,
      模型来源: 启动模型.source,
    })

    /** 表头模型兜底（Task 7 的识别器）：样本按配置脱敏。 */
    const 建表头识别器 = async (job: ClaimedJob) =>
      建表头识别器AI(await 取语言(job), { 脱敏 })

    // 一份坏文件不许把循环打停：`runJob` 自己已经把失败收成「有问题」，
    // 这里再兜一层是防**它之外**的意外（例如库连接当场断）。
    const 跑一个 = Effect.suspend(() =>
      Effect.promise(async () => {
        const db = pg.pg()
        const job = await claimNextJob(db)
        if (job === undefined) return
        await runJob(
          db,
          {
            readFile: async (sourcePath) => {
              // `source_path` 是库里的数据，先过沙箱闸（复审 I4）：`..` / 绝对路径一律拒。
              const 落点 = 沙箱内路径(config.root, sourcePath)
              if (落点 === undefined) throw new Error("作业的落点越出沙箱根")
              return new Uint8Array(await readFile(落点))
            },
            建抽取器,
            建表头识别器,
          },
          job,
        )
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        // 只记类型名：PG 的 pretty 文本可能带连接串（同 `mcp-config-sync.ts`）。
        Effect.logWarning("案件导入消费跳过", {
          error: Cause.prettyErrors(cause).map((error) => error.name),
        }),
      ),
    )

    yield* Effect.forkScoped(Effect.forever(Effect.sleep(轮询间隔ms).pipe(Effect.andThen(跑一个))))
  }),
)
