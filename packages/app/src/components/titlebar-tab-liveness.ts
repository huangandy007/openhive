import { httpStatus } from "@/utils/http-error"
import { isLocalSessionNotFoundError, isSessionNotFoundBody, isSessionNotFoundError } from "@/utils/server-errors"

/**
 * 复探会话失败之后：**这个标签该不该剪掉**。
 *
 * ## 现象（2026-10-11 用户报的那串 F12 报错）
 *
 * `localStorage` 的 `opencode.window.browser.dat:tabs` 里存着 23 个会话标签，全都指向已经
 * 消失的临时沙箱；每次加载标签条都会逐个复探（`titlebar-tab-strip.tsx` 的 `loadedSession`），
 * 而失败被 `.catch(() => undefined)` 吞掉、标签**永不清理** ⇒ 每刷新一次就再来 23 条 404。
 *
 * ## 判据为什么**只能是状态码**（不能看 `.message`）
 *
 * 见 `utils/http-error.ts` 文件头：被包过之后，403 与 404 两条的 `.message` **都像人话**
 * （一条是 `GET … → 403 Forbidden`，另一条是 `Session not found: …`）。拿 `.message` 判
 * 会同时错两边——把归档的标签剪掉（用户以为会话没了）、把真没了的留在那儿（报错照旧）。
 *
 * ## ⚠️ 403（归档）**绝不能剪**
 *
 * 归档是**冻结**不是**删除**（`project-location.ts` 的 T015 D1：「归档项目的会话整体冻住……
 * 连 `GET /session/:id` 也是 403」，找回项目之后这场会话要**原样回来**）。剪掉它，用户
 * 唯一的反应是「我的会话哪去了」——而这是**静默**的：标签消失不像报错那样有人会去查。
 *
 * ## 没有状态码时为什么还要留谓词分支（三条，各是一种投影）
 *
 * 1. `context/server-session.ts` 的 v1 分支在「响应里没有 data」时会**自己合成**一个同文案的错
 *    （`sessionNotFoundError`）——没有 `cause.status`、但语义与 404 是同一件事。
 * 2. v2 的「会话不存在」是**已声明状态** ⇒ 生成客户端 `throw await json(response)`，抛出来的是
 *    **裸体** `{name:"NotFoundError",…}`：不是 `Error`、没有 `cause`、**没有状态码**
 *    （实测打印见 `e2e/regression/right-pane-unavailable.spec.ts` 文件头）。
 *    少了它，v2 下这一步**恒判否**——不报错、不变红，只是幽灵标签永远清不掉。
 * 3. 两条**否定**判据：**网络错（`TypeError: Failed to fetch`）落到这里必须是 `false`**
 *    ——断网不是「会话没了」，剪了就是静默丢标签。
 *
 * 三种投影 + 两条否定由 `titlebar-tab-liveness.test.ts` 各钉一条（`#004-02`：同一件事的多个
 * 投影，要有一条会红的相等断言）。
 */
export function 标签该剪(error: unknown, sessionID: string): boolean {
  const 状态 = httpStatus(error)
  if (状态 !== undefined) return 状态 === 404
  return (
    isLocalSessionNotFoundError(error, sessionID) ||
    isSessionNotFoundError(error, sessionID) ||
    isSessionNotFoundBody(error)
  )
}
