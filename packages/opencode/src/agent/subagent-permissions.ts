import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 *
 * openhive customization (keep on upstream merge): the parent's `allow` rules are
 * also carried over when the same permission is blanket-denied by the parent —
 * see `blanketDenied` below. This is a pure addition; with no such deny present
 * the behavior is byte-identical to upstream.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")

  /*
   * openhive: permissions the parent blanket-denies (`{ permission, "*", deny }`).
   *
   * Upstream drops every parent `allow`, on the grounds that a subagent's own
   * `agent.permission` should decide its capabilities — correct, because upstream
   * has no blanket denies to lose. openhive's RBAC ships each governed permission
   * as a *pair*: a blanket deny plus per-resource allows. Propagating the deny
   * while dropping its paired allows turns "granted" into a hard `deny` for every
   * subagent session (not a prompt — a denial, silent and functional).
   *
   * So: keep the parent's allows *for exactly those permissions a propagated
   * blanket deny would otherwise kill*. Nothing else is restored — a parent allow
   * with no blanket deny behind it is still dropped, as upstream intends.
   */
  const blanketDenied = new Set(
    input.parentSessionPermission
      .filter((rule) => rule.action === "deny" && rule.pattern === "*")
      .map((rule) => rule.permission),
  )

  return [
    ...input.parentSessionPermission.filter(
      (rule) =>
        rule.permission === "external_directory" ||
        rule.action === "deny" ||
        (rule.action === "allow" && blanketDenied.has(rule.permission)),
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
