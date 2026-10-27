import { InstanceStore } from "@/project/instance-store"
import { Effect, Option } from "effect"

/**
 * 丢掉某个项目目录的实例缓存（`#010-03` 的反面：改完目录不丢缓存，改动在重启前不生效）。
 *
 * 内核的 skill 清单是 `InstanceState` 按**目录**缓存一次（`skill/index.ts` 的
 * `Skill.discovery`）⇒ 目录变了不丢缓存，用户会看到「点了启用、问了还是不会用」。
 * 进程内唯一有效的杠杆是 `InstanceStore.disposeDirectory`：真栈实测过
 * `POST /instance/dispose` 是**静默 no-op**（回 200 但不销毁实例）。
 *
 * 两处调用方（项目级启停 / 治理侧下线撤回）共用这一份，避免各写一套 Option 判空与告警。
 *
 * ⚠️ 它会打断在跑实例（前端收到 `server.instance.disposed` 后重拉该目录状态）。
 * 只允许在**目录真的变了**之后调用，别加进「每次请求都跑」的路径。
 */
export function disposeInstanceDirectory(
  store: Option.Option<InstanceStore.Interface>,
  directory: string,
  场景 = "实例层缺席，跳过缓存丢弃；变更在重启前不生效",
) {
  if (Option.isNone(store)) {
    return Effect.logWarning(场景, { directory })
  }
  return Effect.promise(() => Effect.runPromise(store.value.disposeDirectory(directory))).pipe(
    Effect.catchCause((cause) => Effect.logError("实例缓存丢弃失败", { directory, cause })),
  )
}
