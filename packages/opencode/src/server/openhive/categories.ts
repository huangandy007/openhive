export * as OpenhiveCategories from "./categories"

/**
 * 需求 4 · **使用面**的业务分类出口（`GET /openhive/categories`）。
 *
 * 左栏原来的分类是前端 import 的一份常量（`asset-service/categories.ts` 的 seed）。
 * 需求 4 起分类进库、由管理员维护，所以左栏必须**问服务端**——再读常量就是「管理员改了、
 * 用户看不见」（`#002-06` 的同一形状：两份来源，漂了不报错）。
 *
 * ## 只回启用项
 *
 * 停用 = 「别再让人选它」。管理面另有出口（`governance-categories.ts`）能看到停用项，
 * 否则停用过的分类在后台消失、再也启不回来。
 *
 * ## 登录即可读，不需要治理授权
 *
 * 与 `assets.ts` 同一条口径：民警打开 AI 资产就要看左栏，卡在这里等于整页打不开。
 * 回来的是分类名与顺序，不含任何需要授权的内容。
 *
 * ## 前端另写一份路径字面量（`#003-05`）
 *
 * `packages/app/src/ai-assets/categories-api.ts` 不 import 本文件。
 */

import { listCategories } from "@opencode-ai/asset-service/category-store"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { OpenhivePg } from "./pg"

export const PATH = {
  list: "/openhive/categories",
} as const

const UNAUTHORIZED = 401

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, () => handleList(deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

function handleList(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()

    const categories = yield* Effect.promise(() =>
      listCategories(deps.pg(), { includeDisabled: false }),
    )
    return ok({ categories })
  })
}
