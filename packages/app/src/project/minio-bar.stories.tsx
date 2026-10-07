// @ts-nocheck
import { MinioBar } from "./minio-bar"

/**
 * MinIO 常驻窄条（005 T004 · 设计 §2 ④ / §5.1 步骤 1）。
 *
 * story 的存在理由是让 axe 照得到它（同 `project-anchor.stories.tsx` 的说明）。
 * 这条窄条**整条就是一个 `<button>`**，所以它的可访问名称（`aria-label` / 文本内容）
 * 正是 axe 会查的东西——`count` 的三档则是「有名字但语义不同」的三种状态。
 */
export default {
  title: "App/OpenHive/MinioBar",
  id: "app-openhive-minio-bar",
  component: MinioBar,
}

/**
 * **还没有来源**：`count === undefined` ⇒ 不显示数字。
 *
 * `undefined` 与 `0` 在这里必须分开——前者是「不知道」，后者是「明确一件都没备份过」。
 * 把前者画成「· 0 项」是在替后端回答一个它还没回答的问题。
 */
export const NoSource = {
  render: () => <MinioBar onOpen={() => {}} />,
}

/** 明确一件都没备份过：画「· 0 项」。 */
export const Zero = {
  render: () => <MinioBar count={0} onOpen={() => {}} />,
}

/** 已备份 N 项。 */
export const Counted = {
  render: () => <MinioBar count={12} onOpen={() => {}} />,
}

/** 未接线（设计 §5.1 步骤 2 还没落地的那一截）：整条禁用。 */
export const NotWired = {
  render: () => <MinioBar count={12} />,
}
