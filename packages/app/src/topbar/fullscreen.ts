/**
 * 顶栏的「全屏」切换（FR-003）。
 *
 * 抽成独立函数是为了让浏览器 API 可被断言——组件里直接摸 `document` 的话，
 * happy-dom 没有全屏实现，这条需求就只能靠手测。参数用结构类型而非 `Document`，
 * 是为了让测试能直接给个假对象、不必做类型断言。
 */
export type FullscreenHost = {
  fullscreenElement: Document["fullscreenElement"]
  documentElement: Pick<HTMLElement, "requestFullscreen">
  exitFullscreen: Document["exitFullscreen"]
}

export function toggleFullscreen(host: FullscreenHost = document) {
  if (host.fullscreenElement) return host.exitFullscreen()
  return host.documentElement.requestFullscreen()
}
