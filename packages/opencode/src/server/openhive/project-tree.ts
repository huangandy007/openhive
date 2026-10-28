export * as OpenhiveProjectTree from "./project-tree"

/**
 * 项目文件树**批量取数**：`GET /openhive/project/tree`（2026-10-28，Task 2）。
 *
 * ## 它替掉的那条链
 *
 * 前端 `openhive-files.ts` 的 `listProjectFiles` 原本是**一个目录一条 `GET /file`**：真栈实测单趟
 * 46–72ms，测试1027 那个项目 370 个目录 ⇒ 光排队 17–27 秒。本端点把整条链收成**一趟**：
 * 遍历规则（顺序 / 空目录补自己 / ignored / 隐藏根）在 `project-tree-scan.ts`（Task 1，纯函数、
 * 15 条用例钉着），本文件只做**接线**——把 `FileSystem.list` 与 `ignore` 规则喂进去。
 *
 * ## 目录从哪来：**不由客户端说了算**
 *
 * 本层拿不到 `InstanceState.context`（那是 `HttpApiBuilder.group` 里的特权，
 * `packages/core/src/database/router.ts` 的 `hook` 注释实测：「请求 fiber 的 context 里没有 app 层
 * 服务」）。目录改从 `?directory=` 读——`projectLocationLayer` 在处理下游之前，已经把它与
 * `x-opencode-directory` **双双击成项目目录**（`middleware/project-location.ts` 的 `rewriteRequest`）。
 *
 * ⚠️ **但不能直接信它**：没有项目通道时它不会被改写，会停在锚定层写的**沙箱根** `{根}/{本人 id}`
 * ——而沙箱根底下是这个人**所有项目**的目录。直接遍历会交回「跨项目的一棵树」，看起来正常、其实是错的。
 * 所以必须**按形状认**（见下面 handler 里那段判据），与 `projectIdOfSessionDirectory` 同形。
 *
 * ## 所有服务都在层构造期取、请求期用闭包
 *
 * 同 `./project` 的取向（那里有实测记录）：请求 fiber 里没有 app 层服务。身份是**唯一**例外
 * ——它由身份门**每请求**注入，所以 `Effect.serviceOption(User.Service)` 在请求期取。
 *
 * ⚠️ **`LocationServiceMap` 不在本层 provide**：由 `server.ts` 外层的 `locationServiceMapV2` 供上。
 * 再 provide 一次会建出第二个服务图，文件系统实例就与 `handlers/file.ts` 不是同一份了。
 *
 * ## `扫树` 是 Promise 的，`读目录` 用 `Effect.runPromise` 过桥
 *
 * 这在本仓是既有做法（`src/acp/event.ts`、`src/effect/bridge.ts`、`src/cli/cmd/attach.ts`）。
 * **别把 `扫树` 改成 Effect 的**：它那 15 条顺序用例是纯 Promise 写法，改成 Effect 只会让用例翻倍
 * 变长，换不到任何东西。
 */

import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import ignore from "ignore"
import path from "node:path"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 扫树, type 条目, type 读目录 } from "./project-tree-scan"

const PATH = "/openhive/project/tree"

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // 构造期取、请求期用（理由见文件头「所有服务都在层构造期取」）。
    const config = yield* AnchorWorkspace.Config
    const locations = yield* LocationServiceMap.Service
    // ⚠️ `FSUtil` **必须**在构造期取：它是全局服务，**不在** `LocationServiceMap` 的层里
    // （实测：请求期 `Effect.provide(层)` 之后 `yield* FSUtil.Service` 抛
    // `Service not found: @opencode/FileSystem`——路由层不是 `HttpApiBuilder.group`，请求 fiber
    // 里没有 app 层服务）。任务书那段把它写在请求期，照抄会 500。
    const raw = yield* FSUtil.Service

    yield* router.add("GET", PATH, (request) =>
      Effect.gen(function* () {
        // 目录由 `projectLocationLayer` 的 `rewriteRequest` 写好——本层**不自己拼**、也不读项目头
        // （它已被那个中间件摘掉）。
        const 目录 = new URL(request.url, "http://localhost").searchParams.get("directory")
        // 形状判据（与 `middleware/project-location.ts` 的 `projectIdOfSessionDirectory` **同形**；
        // 那里不导出，这里写一份并互相指认）。
        // **不能省**：没有项目通道时 `?directory=` 停在**沙箱根** `{根}/{本人 id}`——相对根只有 1 段，
        // 挡不下就会把「跨项目的一棵树」当成这个项目的清单交出去，错得还看不出。
        // ⚠️ 「第一段等于本人 id」那半句本端点**测不到**（与 `projectIdOfSessionDirectory` 同一条不可达
        // 线：目录只有锚定层与项目定位层两个来源、都在本人沙箱里）——留着是为了让判据不依赖一条没有
        // 说出口的前提，不是因为它被覆盖了（`LEARNINGS #002-02`）。
        const user = yield* Effect.serviceOption(User.Service)
        if (目录 === null || Option.isNone(user)) {
          return HttpServerResponse.jsonUnsafe({ error: "没有项目上下文" }, { status: 400 })
        }
        const 段 = path.relative(config.root, 目录).split(/[\\/]/)
        if (段.length !== 2 || 段[0] !== user.value.id) {
          return HttpServerResponse.jsonUnsafe({ error: "没有项目上下文" }, { status: 400 })
        }

        const 层 = locations.get(Location.Ref.make({ directory: AbsolutePath.make(目录) }))

        // ignore 规则**一趟请求读一次**（上游 `/file` 是每请求读一次；本端点整棵树只看一次，
        // 读法与 `handlers/file.ts` 的 `list` 逐字同形——两处漂了就是「树里看得见、列表里看不见」）。
        const 规则 = yield* Effect.gen(function* () {
          const location = yield* Location.Service
          const ignored = ignore()
          for (const 名 of [".gitignore", ".ignore"]) {
            const text = yield* raw
              .readFileString(path.join(location.project.directory, 名))
              .pipe(Effect.catch(() => Effect.succeed("")))
            if (text) ignored.add(text)
          }
          return ignored
        }).pipe(Effect.provide(层))

        const 读: 读目录 = (dir) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const fs = yield* FileSystem.Service
              const location = yield* Location.Service
              // ⚠️ `item.path` 是**相对 `location.directory`** 的（`filesystem.ts` 的 `list`：
              // `path.relative(target.directory, absolute)`），不是相对 `dir`——所以不用再拼 dir。
              // 隐藏根判据 100% 依赖这个前提（见 `project-tree-scan.ts` 的 `条目` 注释）。
              return (yield* fs.list({ path: RelativePath.make(dir) })).map(
                (item): 条目 => ({
                  path: item.path,
                  type: item.type,
                  ignored: 规则.ignores(
                    path.relative(location.project.directory, path.resolve(location.directory, item.path)) +
                      (item.type === "directory" ? "/" : ""),
                  ),
                }),
              )
            }).pipe(
              Effect.provide(层),
              // 这一层读不到 ⇒ `undefined`，由 `扫树` 判「整份取不到」——**不交半棵树**
              // （理由见 design §5：半个清单冒充完整清单是谎）。
              Effect.catch(() => Effect.succeed<readonly 条目[] | undefined>(undefined)),
            ),
          )

        // `扫树` 是 Promise ⇒ 过桥再拿（`Effect.gen` 里不能 `await`；任务书那段是示意，照抄会直接
        // 抛 `"await" can only be used inside an "async" function`）。
        const 结果 = yield* Effect.promise(() => 扫树(读))
        if (结果 === undefined) return HttpServerResponse.jsonUnsafe({ error: "读取文件树失败" }, { status: 500 })
        return HttpServerResponse.jsonUnsafe(结果)
      }),
    )
  }),
)
