import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"
import { resolveModel } from "@/server/openhive/model-resolve"
import { Slug } from "@opencode-ai/core/util/slug"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const COPY_NAME_AGENT: Agent.Info = {
  name: "project-copy-name",
  mode: "primary",
  permission: [],
  options: {},
  native: true,
  prompt: "",
}

export const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "projectCopyName", (handlers) =>
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service

    const generateName = Effect.fn("ProjectCopyHttpApi.generateName")(function* (context: string | undefined) {
      const text = context?.trim()
      if (!text) return Slug.create()
      // 【保留的定制 · 同步上游时不要丢】2026-11-08（模型统一配置 D5）：与案件抽取共用
      // 同一个解析入口。原实现先取 `getSmallModel()` 小模型、再 `defaultModel()` 兜底，
      // 那条优先级已按设计**有意取消**——操作员钉住的 task_model 必须真的被用上，别再合回来；
      // 没有配置就回落 slug，命名失败不该阻断「复制项目」这件正事。
      const 槽位 = yield* resolveModel("task").pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (槽位 === undefined) return Slug.create()
      const model = yield* provider.getModel(槽位.providerID, 槽位.modelID)
      const sessionID = SessionID.descending()
      const result = yield* llm
        .stream({
          agent: COPY_NAME_AGENT,
          user: {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: COPY_NAME_AGENT.name,
            model: { providerID: model.providerID, modelID: model.id },
          },
          system: [],
          small: true,
          tools: {},
          model,
          sessionID,
          retries: 2,
          messages: [{ role: "user", content: `Generate a short 2-3 word name that describes this task:\n${text}` }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
        )
      const output = result.trim()
      return output ? slugify(output.split(/\s+/).slice(0, 3).join(" ")) : Slug.create()
    })

    return handlers.handle("generateName", (ctx) =>
      generateName(ctx.payload.context).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project copy name generation failed", {
            projectID: ctx.params.projectID,
            cause,
          }).pipe(Effect.as(Slug.create())),
        ),
        Effect.map((name) => ({ name })),
      ),
    )
  }),
)

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
