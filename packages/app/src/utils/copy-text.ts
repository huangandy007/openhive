/**
 * 把一段文本放进系统剪贴板，回「成没成」。
 *
 * ## 为什么是一支独立工具，而不是直接 import 上游那个
 *
 * 上游**已经有**一份同样的事：`src/pages/session/use-session-commands.tsx:150` 的 `write()`
 * （会话分享链接、`session-header.tsx` / `open-in-app.tsx` 的复制目录都走它）。但它是
 * **那个 hook 内部的闭包**——没有导出口，import 不到。而 `src/pages/**` 是上游文件，
 * 本项目**不私改**（`CLAUDE.md`：改动要最小化与官方合并的冲突）。
 *
 * 所以这里**逐字镜像**那份算法的分支顺序：**先**临时 `textarea` ＋ `document.execCommand("copy")`
 * （不挑上下文、老浏览器也认），**不成就退** `navigator.clipboard.writeText`（要安全上下文）。
 * ⚠️ 上游那份若改了分支顺序或收尾方式，**这里要跟着改**——两处同一件事（`LEARNINGS #002-06`：
 * 同一个判断在两处各写一份，漂了不报错）。`#003-05` 那句「镜像要写成可被上游变更惊醒的样子」
 * 说的就是这个文件头。
 *
 * ## 与上游的**一处有意不同**：调用 `execCommand` 之前多一句守卫
 *
 * 上游直接 `document.execCommand("copy")`，因为它只在真浏览器里跑。本仓的组件/单元测试环境是
 * happy-dom，2026-10-11 实测它**没有** `execCommand`（`typeof === "undefined"`）——照抄上游那句，
 * 测试里走的就不是「退给 clipboard」而是「抛 TypeError」，被下面的 `catch` 接住后**恰好也是**
 * 退给 clipboard ⇒ **行为一样、路径不同**，一旦 catch 被谁拿掉就会静默变成「测试里复制永远失败」。
 * 所以这里显式 `typeof … === "function"` 判一句：**这套环境没有它**是一个说得出口的事实，
 * 不该靠异常兜。
 *
 * `catch` 仍留着（不是为 happy-dom）：`execCommand` 在某些环境下会**抛**（权限策略 / 已废弃的
 * 实现），而那不属于「复制失败」，属于「这条路走不通」——照样退给下一条。
 */
export async function 复制文本(text: string): Promise<boolean> {
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    let 成了 = false
    try {
      textarea.select()
      if (typeof document.execCommand === "function") 成了 = document.execCommand("copy")
    } catch {
      成了 = false
    } finally {
      // 收尾在 `finally` 里：抛的那条路同样不许留孤儿节点。
      textarea.remove()
    }
    if (成了) return true
  }

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.writeText) return false
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}
