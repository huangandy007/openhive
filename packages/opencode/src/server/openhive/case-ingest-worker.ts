export * as OpenhiveCaseIngestWorker from "./case-ingest-worker"

import { readFile } from "node:fs/promises"
import { Cause, Effect, Layer } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { Provider, parseModel } from "@/provider/provider"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 建调用模型 } from "./case-extract-ai"
import { claimNextJob, runJob, 作业项目目录, 沙箱内路径, type ClaimedJob } from "./case-ingest"
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
 * 抽取用的模型（`provider/model`）。不设 ⇒ `provider.defaultModel()`（与内核聊天同一条回退）。
 * 抽取值钱且慢，部署时通常想钉一个比聊天更便宜的模型——这是配置项，不是代码分支。
 */
export const 抽取模型ENV = "OPENHIVE_CASE_EXTRACT_MODEL"

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (process.env[消费开关ENV] === "0") {
      yield* Effect.logDebug("表格导入消费未启用：OPENHIVE_CASE_INGEST_WORKER=0")
      return
    }

    // 没配 PG 的部署**不起循环**（复审 I3）：配置是启动期静态值，不配就是永远不配；
    // 起了的话每 2 秒一条 WARN、一天 43200 条，把真正的告警淹掉。
    // 与 `mcp-config-sync` 的 `已启用` 同一条判据形状。
    if (!PG_ENV.every((key) => process.env[key])) {
      yield* Effect.logDebug("表格导入消费未启用：未配置 PG")
      return
    }

    const pg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    const provider = yield* Provider.Service
    const instances = yield* InstanceStore.Service

    /**
     * 按作业的项目目录建抽取器。
     *
     * 模型的解析要实例上下文（`Provider.defaultModel` 读的是项目配置），而后台作业没有请求的
     * `InstanceRef`；`InstanceStore.provide` 是仓库里给「非请求代码」起实例的正规入口。
     * 这里用 `Effect.runPromise`：effect 自带 `instances.provide` 的上下文，不依赖调用方
     * （`LEARNINGS #010-07` 讲的是「读请求上下文」的那种 runPromise，不是这种自足的）。
     */
    const 建抽取器 = async (job: ClaimedJob) => {
      const 目录 = 作业项目目录(config.root, job.sourcePath, job.projectId)
      if (目录 === undefined) throw new Error(`作业的落点不合法：${job.sourcePath}`)
      const 指定 = process.env[抽取模型ENV]
      return Effect.runPromise(
        instances
          .provide(
            { directory: 目录 },
            Effect.gen(function* () {
              const 引用 = 指定 ? parseModel(指定) : yield* provider.defaultModel()
              const resolved = yield* provider.getModel(引用.providerID, 引用.modelID)
              const 语言 = yield* provider.getLanguage(resolved)
              return { 调用: 建调用模型(语言), 模型标识: `${引用.providerID}/${引用.modelID}` }
            }),
          )
          .pipe(
            Effect.catchCause((cause) => {
              // 原因只取**错误名**：这条文案会经 `runJob` 落进 `parse_detail.reason` 并回给前端，
              // `Cause.pretty` 的正文可能带连接串（与下面消费循环的 catch 同一口径）。
              const 原因 = Cause.prettyErrors(cause)
                .map((error) => error.name)
                .join("、")
              return Effect.die(
                new Error(
                  指定 === undefined
                    ? `没有可用的抽取模型：请设置 ${抽取模型ENV}（形如 provider/model），或在项目配置里设置 model（原因：${原因}）`
                    : `抽取模型不可用：${抽取模型ENV}=${指定} 解析不出可用模型（原因：${原因}）`,
                ),
              )
            }),
          ),
      )
    }

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
          },
          job,
        )
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        // 只记类型名：PG 的 pretty 文本可能带连接串（同 `mcp-config-sync.ts`）。
        Effect.logWarning("表格导入消费跳过", {
          error: Cause.prettyErrors(cause).map((error) => error.name),
        }),
      ),
    )

    yield* Effect.forkScoped(Effect.forever(Effect.sleep(轮询间隔ms).pipe(Effect.andThen(跑一个))))
  }),
)
