/**
 * 数据项目权限页（010 T008 / FR-007 / US4 / DESIGN §4.11.9）。
 *
 * 左表是**全部**数据项目（含已归档——US4 场景②），点「成员」在下面展示名单。
 * 业务专家在这里做两件**兜底**动作：
 *
 * 1. **撤销普通成员**——owner 调离或长期不在时，管理员替他把不该再进来的人摘掉；
 * 2. **归档项目**——owner 调离（僵尸账户）时收回整个项目：全员转存备份、沙箱清空、项目冻结。
 *
 * ## 这一层不判「谁能做什么」
 *
 * 「创建人撤不掉」「已归档不能改名单」都是**服务端**回的 409（`governance-projects.ts` 文件头
 * 写了为什么兜底 ≠ 撤掉 owner）。本页只做两件防误点的事：**创建人那一行不画撤销按钮**、
 * **已归档项目不画任何动作按钮**——按了也会被服务端拒，提前不画只是少一次无谓的往返
 * （宪法 §IV：界面过滤不是门）。因此这里的规则与内核是同一句话的两种写法，漂了不会静默：
 * 多画出来的按钮点下去拿 409，并被原样显示出来。
 *
 * ## 动作必须过确认框，失败不关框
 *
 * 两个动作都不可逆（撤销后人打不开项目；归档后全员失权、本地文件被清空）。确认文案写清后果，
 * 403 / 409 留在框里让人看清——关掉再弹一条提示容易错过（与账号 / 资产两页同一条纪律）。
 *
 * ## 代次守卫
 *
 * 切项目、撤销完成、归档完成都会重读；先发的请求可能后回。回包不是最新那一代就丢掉
 * （`#008-03`：`await` 之后读到的东西可能已经过期——尤其「切到 B 之后 A 的成员回包」）。
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import {
  PROJECT_TYPE_LABELS,
  ROLE_LABELS,
  type MemberRow,
  type ProjectApi,
  type ProjectRow,
} from "./project-api"

export interface DataProjectPermProps {
  api: ProjectApi
}

/** 确认框里的一次动作：撤销某个人，或归档整个项目。 */
type 确认目标 =
  | { readonly kind: "remove"; readonly project: ProjectRow; readonly member: MemberRow }
  | { readonly kind: "archive"; readonly project: ProjectRow }

export function DataProjectPerm(props: DataProjectPermProps): JSX.Element {
  const [项目们, 设项目们] = createSignal<readonly ProjectRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [提示, 设提示] = createSignal<string>()

  const [选中的, 设选中的] = createSignal<ProjectRow>()
  const [成员们, 设成员们] = createSignal<readonly MemberRow[]>()
  const [成员加载, 设成员加载] = createSignal(false)
  const [成员错误, 设成员错误] = createSignal<string>()

  const [确认, 设确认] = createSignal<确认目标>()
  const [动作错误, 设动作错误] = createSignal<string>()
  const [处理中, 设处理中] = createSignal(false)

  /** 两个读口各一个代次（列表与名单的回包互不相关，`#008-03`）。 */
  let 列表代次 = 0
  let 名单代次 = 0

  async function 读项目() {
    const 本次 = ++列表代次
    设加载(true)
    设错误(undefined)
    const out = await props.api.list()
    if (本次 !== 列表代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设项目们(out.value)
    // 选中的那一行跟着最新数据走（成员数 / 归档态会变）；没选过就不自动选。
    const 当前 = 选中的()
    if (当前) 设选中的(out.value.find((row) => row.id === 当前.id))
  }

  async function 读成员(projectId: string) {
    const 本次 = ++名单代次
    设成员加载(true)
    设成员错误(undefined)
    const out = await props.api.members(projectId)
    if (本次 !== 名单代次) return
    设成员加载(false)
    if (out.kind !== "ok") {
      设成员错误(out.message)
      设成员们(undefined)
      return
    }
    设成员们(out.value)
  }

  onMount(() => void 读项目())

  function 选中(row: ProjectRow) {
    设提示(undefined)
    设选中的(row)
    设成员们(undefined)
    void 读成员(row.id)
  }

  function 打开(目标: 确认目标) {
    设提示(undefined)
    设动作错误(undefined)
    设确认(目标)
  }

  function 关确认() {
    设确认(undefined)
    设动作错误(undefined)
  }

  async function 提交() {
    const 目标 = 确认()
    if (!目标) return
    设处理中(true)
    设动作错误(undefined)

    if (目标.kind === "remove") {
      const out = await props.api.removeMember(目标.project.id, 目标.member.userId)
      设处理中(false)
      if (out.kind !== "ok") {
        设动作错误(out.message)
        return
      }
      设确认(undefined)
      设提示(`已撤销成员「${目标.member.name}」`)
      await 读成员(目标.project.id)
      await 读项目()
      return
    }

    const out = await props.api.archive(目标.project.id)
    设处理中(false)
    if (out.kind !== "ok") {
      设动作错误(out.message)
      return
    }
    设确认(undefined)
    设提示(`已归档项目「${项目名(目标.project)}」；成员已全部失去访问权`)
    await 读成员(目标.project.id)
    await 读项目()
  }

  const 确认标题 = () => {
    const 目标 = 确认()
    if (!目标) return "确认"
    return 目标.kind === "remove" ? `撤销成员「${目标.member.name}」` : `归档「${项目名(目标.project)}」`
  }

  const 确认说明文字 = () => {
    const 目标 = 确认()
    if (!目标) return ""
    return 目标.kind === "remove"
      ? `撤销后「${目标.member.name}」不能再打开这个项目；他沙箱里已有的文件不会被删除。`
      : "归档后全员失权：各成员沙箱里的文件转存为备份并清空本地，项目冻结。恢复只能由创建人找回。"
  }

  const 提交文案 = () => {
    const 目标 = 确认()
    if (!目标) return "确认"
    return 目标.kind === "remove" ? "撤销成员" : "归档项目"
  }

  return (
    <div data-section="data-project-perm" data-slot="data-project-perm" class="mt-6 flex flex-col gap-4">
      <div data-slot="project-toolbar" class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] text-v2-text-text-muted">
          数据项目（含已归档）。成员由创建人自己管；这里做兜底：撤销成员、归档项目。
        </span>
        <div class="ml-auto flex items-center gap-2">
          <Show when={加载() && 项目们()}>
            <span data-slot="project-loading-inline" class="text-[12px] text-v2-text-text-muted">
              正在加载…
            </span>
          </Show>
          <ButtonV2 data-slot="project-refresh" type="button" variant="neutral" size="small" onClick={() => void 读项目()}>
            刷新
          </ButtonV2>
        </div>
      </div>

      <Show when={提示()}>
        {(文字) => (
          <div
            data-slot="project-notice"
            role="status"
            class="rounded-lg bg-v2-state-bg-success px-3 py-2 text-[13px] text-v2-state-fg-success"
          >
            {文字()}
          </div>
        )}
      </Show>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="project-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <ButtonV2 data-slot="project-retry" type="button" variant="neutral" size="small" onClick={() => void 读项目()}>
              重试
            </ButtonV2>
          </div>
        )}
      </Show>

      <Show when={!错误() && !项目们() && 加载()}>
        <div data-slot="project-loading" class="py-10 text-center text-[13px] text-v2-text-text-muted">
          正在加载数据项目…
        </div>
      </Show>

      <Show when={!错误() && 项目们()}>
        {(清单) => (
          <Show
            when={清单().length > 0}
            fallback={
              <div
                data-slot="project-empty"
                class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
              >
                <div class="text-sm font-semibold text-v2-text-text-base">还没有数据项目</div>
                <p class="mt-1 text-[13px] text-v2-text-text-muted">民警在资金 / 话单分析里建的项目会出现在这里。</p>
              </div>
            }
          >
            <div class="overflow-x-auto rounded-xl border border-v2-border-border-muted">
              <table data-slot="project-table" class="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr class="h-10 border-b border-v2-border-border-muted text-[12px] text-v2-text-text-muted">
                    <th scope="col" class="px-3 font-normal">
                      项目
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      类型
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      创建人
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      成员
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      状态
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      归档时间
                    </th>
                    <th scope="col" class="px-3 text-right font-normal">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={清单()}>
                    {(row) => (
                      <tr
                        data-slot="project-row"
                        data-id={row.id}
                        data-archived={row.archived ? "true" : "false"}
                        class="h-11 border-b border-v2-border-border-muted last:border-b-0"
                      >
                        <td class="px-3">
                          <div data-slot="project-row-name" class="text-v2-text-text-base">
                            {项目名(row)}
                          </div>
                        </td>
                        <td class="px-3 text-v2-text-text-muted">{类型文案(row)}</td>
                        <td class="px-3 text-v2-text-text-muted">
                          <div data-slot="project-row-owner">{row.ownerName ?? "—"}</div>
                        </td>
                        <td data-slot="project-row-count" class="px-3 tabular-nums text-v2-text-text-muted">
                          {row.memberCount}
                        </td>
                        <td class="px-3">
                          <Tag variant="neutral">{row.archived ? "已归档" : "使用中"}</Tag>
                        </td>
                        <td class="px-3 tabular-nums text-v2-text-text-muted">
                          {row.archivedAt === null ? "—" : 格式化时间(row.archivedAt)}
                        </td>
                        <td class="px-3">
                          <div class="flex justify-end gap-2">
                            <ButtonV2
                              data-slot="project-action-members"
                              data-id={row.id}
                              type="button"
                              variant="neutral"
                              size="small"
                              onClick={() => 选中(row)}
                            >
                              成员
                            </ButtonV2>
                            <Show when={!row.archived}>
                              <ButtonV2
                                data-slot="project-action-archive"
                                data-id={row.id}
                                type="button"
                                variant="danger"
                                size="small"
                                onClick={() => 打开({ kind: "archive", project: row })}
                              >
                                归档
                              </ButtonV2>
                            </Show>
                            <Show when={row.archived}>
                              <span data-slot="project-no-action" class="text-[12px] text-v2-text-text-muted">
                                已归档
                              </span>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>

      <Show when={选中的()}>
        {(项目) => (
          <section
            data-slot="project-members-panel"
            data-project-id={项目().id}
            class="rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base"
          >
            <header class="flex items-center gap-3 border-b border-v2-border-border-muted px-4 py-3">
              <h3 class="min-w-0 flex-1 text-[14px] font-semibold text-v2-text-text-base">
                {项目名(项目())} · 成员
              </h3>
              <Show when={项目().archived}>
                <span data-slot="project-members-frozen" class="text-[12px] text-v2-text-text-muted">
                  项目已归档，名单冻结
                </span>
              </Show>
            </header>

            <Show when={成员错误()}>
              {(message) => (
                <div data-slot="project-members-error" role="alert" class="px-4 py-3 text-[13px] text-v2-state-fg-danger">
                  {message()}
                </div>
              )}
            </Show>

            <Show when={!成员错误() && !成员们() && 成员加载()}>
              <div data-slot="project-members-loading" class="px-4 py-6 text-center text-[13px] text-v2-text-text-muted">
                正在加载成员…
              </div>
            </Show>

            <Show when={!成员错误() && 成员们()}>
              {(清单) => (
                <ul class="divide-y divide-v2-border-border-muted">
                  <For each={清单()}>
                    {(member) => (
                      <li
                        data-slot="project-member-row"
                        data-user-id={member.userId}
                        data-role={member.role}
                        class="flex items-center gap-3 px-4 py-2.5 text-[13px]"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="text-v2-text-text-base">{member.name || member.policeNo}</span>
                          <span class="ml-2 text-[12px] text-v2-text-text-muted">{member.policeNo}</span>
                        </span>
                        <Tag variant="neutral">{ROLE_LABELS[member.role]}</Tag>
                        <span class="w-32 tabular-nums text-[12px] text-v2-text-text-muted">
                          {member.timeCreated === 0 ? "—" : 格式化时间(member.timeCreated)}
                        </span>
                        <span class="w-20 text-right">
                          <Show
                            when={member.role === "member" && !项目().archived}
                            fallback={
                              <span data-slot="project-member-locked" class="text-[12px] text-v2-text-text-muted">
                                {member.role === "owner" ? "不可撤销" : "已冻结"}
                              </span>
                            }
                          >
                            <ButtonV2
                              data-slot="project-member-remove"
                              data-user-id={member.userId}
                              type="button"
                              variant="danger"
                              size="small"
                              onClick={() => 打开({ kind: "remove", project: 项目(), member })}
                            >
                              撤销
                            </ButtonV2>
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
          </section>
        )}
      </Show>

      <Kobalte open={确认() !== undefined} onOpenChange={(开) => !开 && 关确认()}>
        <Kobalte.Portal>
          <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
          <Kobalte.Content
            data-slot="project-confirm"
            class="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          >
            <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
              <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
                {确认标题()}
              </Kobalte.Title>
              <Kobalte.CloseButton
                type="button"
                aria-label="关闭"
                class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                <Icon name="xmark-small" size="small" />
              </Kobalte.CloseButton>
            </div>
            <div class="flex flex-col gap-3 px-5 py-4">
              <p data-slot="project-confirm-text" class="text-[13px] text-v2-text-text-base">
                {确认说明文字()}
              </p>
              <Show when={动作错误()}>
                {(message) => (
                  <div data-slot="project-confirm-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                    {message()}
                  </div>
                )}
              </Show>
            </div>
            <div class="flex justify-end gap-2 border-t border-v2-border-border-muted px-5 py-3">
              <ButtonV2 type="button" variant="neutral" autofocus disabled={处理中()} onClick={关确认}>
                取消
              </ButtonV2>
              <ButtonV2
                data-slot="project-confirm-submit"
                type="button"
                variant="danger"
                disabled={处理中()}
                onClick={() => void 提交()}
              >
                {处理中() ? "处理中…" : 提交文案()}
              </ButtonV2>
            </div>
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
    </div>
  )
}

/** 名字的兜底显示：0006 之前建的项目没有名字行（服务端给 `""`），编一个比留白更难认。 */
export function 项目名(row: Pick<ProjectRow, "name" | "id">): string {
  return row.name.trim() === "" ? `未命名项目（${row.id.slice(0, 8)}）` : row.name
}

/** 类型的兜底说法：`""` = 没有名字行，不是「私有」。 */
export function 类型文案(row: Pick<ProjectRow, "type">): string {
  return PROJECT_TYPE_LABELS[row.type] ?? "—"
}
