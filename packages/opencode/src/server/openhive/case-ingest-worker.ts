export * as OpenhiveCaseIngestWorker from "./case-ingest-worker"

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Cause, Effect, Layer } from "effect"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { claimNextJob, runJob } from "./case-ingest"
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

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const pg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config

    // 一份坏文件不许把循环打停：`runJob` 自己已经把失败收成「有问题」，
    // 这里再兜一层是防**它之外**的意外（例如库连接当场断）。
    const 跑一个 = Effect.suspend(() =>
      Effect.promise(async () => {
        const db = pg.pg()
        const job = await claimNextJob(db)
        if (job === undefined) return
        await runJob(
          db,
          { readFile: async (sourcePath) => new Uint8Array(await readFile(join(config.root, ...sourcePath.split("/")))) },
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
