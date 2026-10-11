import { httpStatus, serverErrorText } from "@/utils/http-error"
import { isLocalSessionNotFoundError, isSessionNotFoundBody, isSessionNotFoundError } from "@/utils/server-errors"

/**
 * 右栏「这场会话打不开」⇒ 一句人话（2026-10-11 用户报的「整页空白」缺陷的落点之一）。
 *
 * ## 这个函数在补哪个洞
 *
 * 现象（真栈实测）：打开一个取不到的会话 URL——
 * - 项目已归档 ⇒ 服务端 `403 {"error":"项目已归档，请先找回"}`
 * - 会话不存在 ⇒ 服务端 `404 {"name":"NotFoundError",…}`
 *
 * 而前端**屏幕上一个字都没有**：中栏那一页在会话路由下被 `pageVisible` 藏掉
 * （`center-content.tsx` 的 `display:none`，那是**故意的**——不藏就会出现两个输入框），
 * 本该显示会话的右栏又在「解不出目录」时什么都不渲染（`right-pane-source.ts` 的失败分支）。
 * ⇒ 服务端特意写好给人看的那句话，**到不了屏幕**。
 *
 * ## 分工：判断在这里，渲染在 `right-pane-unavailable.tsx`，接线在 `ai-session-slot.tsx`
 *
 * 判断（哪种失败 ⇒ 说什么）是**纯函数**，因为它是这一小段里唯一有分支的地方；渲染与接线
 * 各占一半，判据分别在 `right-pane-unavailable.test.tsx` 与假后端 spec 里。
 *
 * `t` 是**参数**不是 `useLanguage()`：纯函数读不了 context，读了就只能长在组件里（那正是
 * 「测不到」的老路）。同形先例：`utils/server-errors.ts` 的 `formatServerError(error, translate?)`。
 */
export type 打不开的说法 = {
  /** 屏幕上那行大字。 */
  标题: string
  /** 下面那行小字；`undefined` ⇒ **不画**那一行（不留空 div）。 */
  详情?: string
  /** 那颗「关闭标签页」钮上的字。文案只有这一个来源（`session.error.notFound.closeTab`）。 */
  关闭标签文案: string
}

export function 右栏打不开的说法(
  error: unknown,
  sessionID: string,
  t: (key: string) => string,
): 打不开的说法 {
  const 关闭标签文案 = t("session.error.notFound.closeTab")

  // ① 这场会话**不存在**：状态码 404（两种协议都带得上），或客户端自己合成的同文案错
  //    （v1 分支「响应里没有 data」那一支），或**裸体 `NotFoundError`**（v2 把已声明状态
  //    直接抛体、**不带状态码**，见 `server-errors.ts` 的 `isSessionNotFoundBody`）。
  //    仓里已有现成的两句（标题 ＋ 说明），直接用，不另发明说法（`#004-02`：
  //    同一件事不要有两个投影）。
  if (
    httpStatus(error) === 404 ||
    isLocalSessionNotFoundError(error, sessionID) ||
    isSessionNotFoundError(error, sessionID) ||
    isSessionNotFoundBody(error)
  )
    return {
      标题: t("session.error.notFound"),
      详情: t("session.error.notFound.description"),
      关闭标签文案,
    }

  // ② 会话**在**、但今天打不开（403 归档冻结；`project-location.ts` T015 D1：归档项目的会话
  //    连 `GET /session/:id` 也是 403）。服务端那句话本身就是给用户看的（「请先找回」），
  //    原样上屏——换成通用的「请求失败」就等于把「怎么办」也吞掉。
  const 人话 = serverErrorText(error)
  if (httpStatus(error) === 403 && 人话) return { 标题: 人话, 关闭标签文案 }

  // ③ 说不清的（网络断、500、403 但体里没带话）：通用标题 ＋ **原始信息**进详情——
  //    这一层排不出来的东西，留着让人能截图带走。
  return { 标题: t("common.requestFailed"), 详情: 可读(error), 关闭标签文案 }
}

function 可读(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return undefined
}
