import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import type { 材料视图 } from "../../project/case-materials-api"
import type {
  CaseTemplateApi,
  模板槽名,
  模板词表,
  模板行,
  槽填法,
  预览输出,
} from "../../project/case-template-api"
import { CardTemplatePreview } from "./card-template-preview"
import {
  从行,
  成定义,
  新表单,
  校验表单,
  是单值槽,
  槽默认角色,
  预览已过期,
  type 表单,
} from "./card-template-form"

/** 下拉里的「无 / 默认」哨兵：字段名是 ASCII、角色名是中文，两个哨兵都不会撞上真实值。 */
const 无选项 = "__无__"
const 默认选项 = "__默认__"

/**
 * 事件类型下拉的空选项哨兵（I1）：`current` 落到 `undefined` 会让 Kobalte 转非受控，
 * 用户点了「不可选」项后触发器会显示它、表单却仍是空。给一个恒定的空值保持受控；
 * `值: ""` 被 Kobalte 的 `Select.Value` 当作空选择（`select-value.tsx:88-93`），仍显示占位符。
 */
const 空事件项 = { 值: "", 可选: true }

export interface CardTemplateEditorProps {
  readonly projectId: string
  readonly api: CaseTemplateApi
  /** 省略 = 新建；给了就载入现有定义。 */
  readonly 行?: 模板行
  /** 内置模板的「查看」/ 停用模板的「预览」：所有输入禁用、无保存。 */
  readonly 只读?: boolean
  /**
   * 只读抽屉是否仍可预览（停用模板用）：默认随 `只读`——内置只读不可预览。
   * 预览是只读操作，停用模板也能安全跑；保存才是被内核拒绝的那个动作（最终广审 I-2）。
   */
  readonly 可预览?: boolean
  /** 打开即跑一次预览（列表行上的「预览」）。 */
  readonly 自动预览?: boolean
  readonly 材料们: readonly 材料视图[]
  readonly onClose: () => void
  readonly onSaved: () => void
}

/** 一个槽的控件：单行（谁/何时/何时止/多少钱）或多行（和谁/何地/其他）。 */
function 槽选区(props: {
  readonly 槽名: 模板槽名
  readonly 词表: 模板词表
  readonly 条们: readonly 槽填法[]
  readonly 只读: boolean
  readonly 多行: boolean
  readonly 含无: boolean
  readonly 换: (条们: readonly 槽填法[]) => void
}): JSX.Element {
  const 字段选项 = () => [...(props.含无 ? [无选项] : []), ...props.词表.槽可选字段们[props.槽名]]
  const 字段标签 = (值: string) => {
    if (值 === 无选项) return "无"
    return props.词表.字段们.find((项) => 项.值 === 值)?.显示名 ?? 值
  }
  const 有角色 = () => props.槽名 === "谁" || props.槽名 === "和谁" || props.槽名 === "何地"
  const 角色选项 = () => {
    const 地点 = props.槽名 === "何地"
    return props.词表.角色们.filter((项) => 项.地点类 === 地点).map((项) => 项.值)
  }
  const 写 = (序: number, 填: 槽填法) => {
    props.换(props.条们.map((旧, 索引) => (索引 === 序 ? 填 : 旧)))
  }
  const 新行 = (): 槽填法 => {
    const 角色 = 槽默认角色(props.词表, props.槽名)
    return 角色 === undefined ? { 字段: "" } : { 字段: "", 角色 }
  }

  return (
    <div data-slot="card-template-slot" data-slot-name={props.槽名} class="flex flex-col gap-1.5">
      <span class="text-[12px] font-semibold text-v2-text-text-base">{props.槽名}</span>
      <Show
        when={props.条们.length > 0}
        fallback={<span class="text-[12px] text-v2-text-text-muted">无</span>}
      >
        <For each={props.条们}>
          {(填: 槽填法, 序) => (
            <div data-slot="card-template-slot-row" class="flex flex-wrap items-center gap-2">
              <SelectV2
                data-slot="card-template-slot-field"
                appearance="base"
                options={字段选项()}
                current={填.字段 === "" && props.含无 ? 无选项 : 填.字段}
                placeholder="请选择字段"
                label={字段标签}
                disabled={props.只读}
                onSelect={(值) => 写(序(), { ...填, 字段: 值 === null || 值 === 无选项 ? "" : 值 })}
              />
              <Show when={有角色()}>
                <SelectV2
                  data-slot="card-template-slot-role"
                  appearance="base"
                  options={[默认选项, ...角色选项()]}
                  current={填.角色 ?? 默认选项}
                  placeholder="角色"
                  label={(值) =>
                    值 === 默认选项 ? `默认（${槽默认角色(props.词表, props.槽名) ?? "无"}）` : 值
                  }
                  disabled={props.只读}
                  onSelect={(值) =>
                    写(序(), {
                      ...填,
                      角色: 值 === null || 值 === 默认选项 ? undefined : 值,
                    })
                  }
                />
              </Show>
              {/* 实体类型只有「谁 / 和谁」能定；「何地」的实体类型由引擎强制为「地点」（内核规则）。 */}
              <Show when={props.槽名 === "谁" || props.槽名 === "和谁"}>
                <SelectV2
                  data-slot="card-template-slot-entity"
                  appearance="base"
                  options={["", ...props.词表.实体类型们]}
                  current={填.实体类型 ?? ""}
                  placeholder="不指定实体类型"
                  label={(值) => (值 === "" ? "不指定实体类型" : 值)}
                  disabled={props.只读}
                  onSelect={(值) => 写(序(), { ...填, 实体类型: 值 === null || 值 === "" ? undefined : 值 })}
                />
              </Show>
              <Show when={props.多行 && !props.只读}>
                <ButtonV2
                  type="button"
                  variant="ghost"
                  size="small"
                  data-slot="card-template-slot-remove"
                  onClick={() => props.换(props.条们.filter((_, 索引) => 索引 !== 序()))}
                >
                  删除
                </ButtonV2>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.多行 && !props.只读}>
        <ButtonV2
          type="button"
          variant="ghost"
          size="small"
          data-slot="card-template-slot-add"
          class="w-fit"
          onClick={() => props.换([...props.条们, 新行()])}
        >
          + 添加一行
        </ButtonV2>
      </Show>
    </div>
  )
}

/**
 * 抽屉编辑器（设计 §5）。新建 / 修改 / 只读查看共用。
 *
 * **不 import `governance/overlay.tsx`**（设计 §7.3）：治理后台的浮层壳与案件页的依赖方向相反，
 * 跨模块 import 会在下一次治理重构时把案件页一起拽红。这里照它的几何写一份最小的 Kobalte 抽屉。
 */
export function CardTemplateEditor(props: CardTemplateEditorProps): JSX.Element {
  const [开, 设开] = createSignal(false)
  onMount(() => 设开(true))

  const [词表, 设词表] = createSignal<模板词表>()
  const [词表错误, 设词表错误] = createSignal<string>()
  const [表单, 设表单] = createSignal<表单>()
  const [初始, 设初始] = createSignal("")
  const [保存中, 设保存中] = createSignal(false)
  const [保存错误, 设保存错误] = createSignal<{ message: string; code?: string }>()
  const [材料id, 设材料id] = createSignal("")
  const [预览, 设预览] = createSignal<预览输出>()
  const [预览错误, 设预览错误] = createSignal<string>()
  const [预览中, 设预览中] = createSignal(false)
  const [预览时, 设预览时] = createSignal<string>()
  /** 预览成功时用的材料 id：换材料后旧结果同样过期（I4）。 */
  const [预览材料, 设预览材料] = createSignal("")
  const [关确认, 设关确认] = createSignal(false)
  /** 可预览与只读是两个概念：停用行只读但可预览；内置行只读且不可预览。 */
  const 可预览 = () => (props.可预览 === undefined ? props.只读 !== true : props.可预览)

  // 代次守卫：关掉抽屉后回来的响应一律丢弃（同 `governance/template-lib.tsx` 的写法）。
  let 代次 = 0
  onCleanup(() => {
    代次 += 1
  })

  onMount(() => {
    void (async () => {
      const 本次 = ++代次
      const 行 = props.行
      const 回 = await props.api.vocab()
      if (本次 !== 代次) return
      if (回.kind === "error") {
        设词表错误(回.message)
        return
      }
      设词表(回.value)
      const 初 = 行 === undefined ? 新表单(回.value) : 从行(行, 回.value)
      设表单(初)
      设初始(JSON.stringify(成定义(初)))
      if (props.自动预览 === true && 可预览()) void 跑预览()
    })()
  })

  createEffect(() => {
    const 首 = props.材料们[0]
    if (材料id() === "" && 首 !== undefined) 设材料id(首.id)
  })

  const 当前定义 = createMemo(() => {
    const 形 = 表单()
    return 形 === undefined ? undefined : 成定义(形)
  })
  const 当前JSON = createMemo(() => {
    const 定义 = 当前定义()
    return 定义 === undefined ? "" : JSON.stringify(定义)
  })
  const 脏 = () => 当前JSON() !== "" && 当前JSON() !== 初始()
  const 校验错 = createMemo(() => {
    const 形 = 表单()
    const 词 = 词表()
    return 形 === undefined || 词 === undefined ? [] : 校验表单(形, 词)
  })
  const 预览过期 = createMemo(() => {
    if (预览() === undefined) return false
    return 预览已过期(预览时(), 当前JSON()) || 预览材料() !== 材料id()
  })

  async function 跑预览() {
    const 形 = 表单()
    const 词 = 词表()
    const 定义 = 当前定义()
    if (形 === undefined || 词 === undefined || 定义 === undefined) return
    const 错 = 校验表单(形, 词)
    if (错.length > 0) {
      设预览错误(错.join("；"))
      return
    }
    const 选材料 = 材料id()
    if (选材料 === "") return
    const 本次 = ++代次
    设预览中(true)
    设预览错误(undefined)
    const 回 = await props.api.preview({ projectId: props.projectId, materialId: 选材料, template: 定义 })
    if (本次 !== 代次) return
    设预览中(false)
    if (回.kind === "error") {
      设预览(undefined)
      设预览错误(回.message)
      return
    }
    设预览(回.value)
    设预览时(JSON.stringify(定义))
    设预览材料(选材料)
  }

  async function 保存() {
    const 定义 = 当前定义()
    if (定义 === undefined) return
    const 行 = props.行
    设保存中(true)
    设保存错误(undefined)
    const 回 =
      行 === undefined
        ? await props.api.create({ projectId: props.projectId, ...定义 })
        : await props.api.update({ projectId: props.projectId, id: 行.id, ...定义 })
    设保存中(false)
    if (回.kind === "error") {
      设保存错误({ message: 回.message, ...(回.code === undefined ? {} : { code: 回.code }) })
      return
    }
    props.onSaved()
  }

  function 请求关闭() {
    if (脏()) {
      设关确认(true)
      return
    }
    props.onClose()
  }

  const 标题 = () => {
    if (props.只读 !== true) return props.行 === undefined ? "新建模板" : "修改模板"
    if (props.行 !== undefined && props.行.disabled_at !== null) return "查看已停用的模板"
    return "查看内置模板"
  }

  return (
    <Kobalte open={开()} onOpenChange={(值) => { if (!值) 请求关闭() }}>
      <Kobalte.Portal>
        <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
        <Kobalte.Content
          data-slot="card-template-editor"
          class="fixed top-0 right-0 z-50 flex h-full w-[480px] max-w-[calc(100vw-2rem)] flex-col border-l border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
        >
          <div class="flex h-14 shrink-0 items-center gap-3 border-b border-v2-border-border-muted px-6">
            <Kobalte.Title class="min-w-0 flex-1 text-[16px] font-semibold text-v2-text-text-base">{标题()}</Kobalte.Title>
            <Kobalte.CloseButton
              type="button"
              aria-label="关闭"
              data-slot="card-template-close"
              class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
            >
              <Icon name="xmark-small" size="small" />
            </Kobalte.CloseButton>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <Show when={词表错误()}>
              {(话) => (
                <p data-slot="card-template-vocab-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                  {话()}
                </p>
              )}
            </Show>
            <Show when={!词表() && !词表错误()}>
              <p data-slot="card-template-loading" class="text-[13px] text-v2-text-text-muted">
                正在读取词表…
              </p>
            </Show>
            <Show when={词表()}>
              {(词) => (
                <Show when={表单()} fallback={<p class="text-[13px] text-v2-text-text-muted">正在准备表单…</p>}>
                  {(形) => (
                    <div class="flex flex-col gap-4">
                      <Show when={props.只读 === true && props.行?.disabled_at !== null}>
                        <p data-slot="card-template-disabled-hint" class="rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-text-text-base">
                          模板已停用：先恢复才能修改
                        </p>
                      </Show>
                      <Show when={props.只读 !== true && props.行?.verified_at !== null && props.行 !== undefined}>
                        <p data-slot="card-template-verified-warning" class="rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-text-text-base">
                          改「哪一列对应哪一项」「事件类型」或「必须填满才产卡片」再保存，会回到未验证，需重新预览并转正；只改名称不影响
                        </p>
                      </Show>

                      {/* `data-slot` 挂在包住输入框的 `<label>` 上：`TextInputV2` 在 `{...inputProps}`
                          之后写死自己的 `data-slot="text-input-v2-input"`，调用方传的名字会被静默覆盖
                          （同 `file-tree.tsx` 的搜索框、`#005-22`）。 */}
                      <label data-slot="card-template-name-field" class="flex flex-col gap-1">
                        <span class="text-[12px] text-v2-text-text-muted">名称（必填）</span>
                        <TextInputV2
                          appearance="large"
                          value={形().name}
                          disabled={props.只读}
                          onInput={(事件) =>
                            设表单((当前) => (当前 === undefined ? 当前 : { ...当前, name: 事件.currentTarget.value }))
                          }
                        />
                      </label>

                      <label data-slot="card-template-event-field" class="flex flex-col gap-1">
                        <span class="text-[12px] text-v2-text-text-muted">事件类型（必填）</span>
                        <SelectV2
                          appearance="large"
                          options={[...词().事件类型们]}
                          current={词().事件类型们.find((项) => 项.值 === 形().eventType) ?? 空事件项}
                          value={(项) => 项.值}
                          label={(项) => (项.可选 ? 项.值 : `${项.值}（不可选）`)}
                          placeholder="请选择事件类型"
                          disabled={props.只读}
                          onSelect={(项) => {
                            if (项 === null || !项.可选) return
                            设表单((当前) => (当前 === undefined ? 当前 : { ...当前, eventType: 项.值 }))
                          }}
                        />
                        <Show when={词().事件类型们.some((项) => !项.可选)}>
                          <p data-slot="card-template-event-hint" class="text-[11px] text-v2-text-text-muted">
                            {词()
                              .事件类型们.filter((项) => !项.可选)
                              .map((项) => `${项.值}：${项.原因 ?? "不可选"}`)
                              .join("；")}
                          </p>
                        </Show>
                      </label>

                      <For each={词().槽们}>
                        {(槽名) => (
                          <槽选区
                            槽名={槽名}
                            词表={词()}
                            条们={形().槽表[槽名]}
                            只读={props.只读 === true}
                            多行={!是单值槽(槽名)}
                            含无={槽名 !== 词().必填恒含}
                            换={(条们) =>
                              设表单((当前) => (当前 === undefined ? 当前 : { ...当前, 槽表: { ...当前.槽表, [槽名]: 条们 } }))
                            }
                          />
                        )}
                      </For>

                      <div class="flex flex-col gap-1.5">
                        <span class="text-[12px] font-semibold text-v2-text-text-base">必须填满才产卡片</span>
                        <div class="flex flex-wrap gap-3">
                          <For each={词().槽们.filter((槽名) => 槽名 !== "其他")}>
                            {(槽名) => (
                              <div data-slot="card-template-required" data-slot-name={槽名}>
                                <CheckboxV2
                                  label={槽名}
                                  checked={形().required.includes(槽名)}
                                  disabled={props.只读 || 槽名 === 词().必填恒含}
                                  onChange={(勾) =>
                                    设表单((当前) => {
                                      if (当前 === undefined) return 当前
                                      const 其余 = 当前.required.filter((项) => 项 !== 槽名)
                                      return { ...当前, required: 勾 ? [...其余, 槽名] : 其余 }
                                    })
                                  }
                                />
                              </div>
                            )}
                          </For>
                        </div>
                      </div>

                      <Show when={校验错().length > 0 && props.只读 !== true}>
                        <ul data-slot="card-template-editor-validation" class="list-disc pl-5 text-[12px] text-v2-state-fg-danger">
                          <For each={校验错()}>{(错) => <li>{错}</li>}</For>
                        </ul>
                      </Show>

                      <Show when={保存错误()}>
                        {(错) => (
                          <div
                            data-slot="card-template-editor-error"
                            role="alert"
                            class="flex items-start gap-2 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-state-fg-danger"
                          >
                            <span class="min-w-0 flex-1">{错().message}</span>
                            <Show when={错().code === "conflict"}>
                              <ButtonV2
                                type="button"
                                variant="ghost"
                                size="small"
                                data-slot="card-template-editor-goto-list"
                                onClick={props.onClose}
                              >
                                关闭并去停用旧模板
                              </ButtonV2>
                            </Show>
                          </div>
                        )}
                      </Show>

                      <Show when={可预览()}>
                        <section data-slot="card-template-preview-panel" class="flex flex-col gap-2 border-t border-v2-border-border-muted pt-3">
                          <div class="flex flex-wrap items-center gap-2">
                            <SelectV2
                              data-slot="card-template-preview-material"
                              appearance="base"
                              options={[...props.材料们]}
                              current={props.材料们.find((项) => 项.id === 材料id())}
                              value={(项) => 项.id}
                              label={(项) => 项.path}
                              placeholder="选择预览材料"
                              disabled={props.材料们.length === 0}
                              onSelect={(项) => {
                                if (项 !== null) 设材料id(项.id)
                              }}
                            />
                            <ButtonV2
                              type="button"
                              variant="outline"
                              size="small"
                              data-slot="card-template-preview-button"
                              disabled={预览中() || 材料id() === ""}
                              onClick={() => void 跑预览()}
                            >
                              {预览中() ? "预览中…" : "预览前 20 行"}
                            </ButtonV2>
                          </div>
                          <Show when={props.材料们.length === 0}>
                            <p data-slot="card-template-preview-nomaterial" class="text-[12px] text-v2-text-text-muted">
                              先导入并解析材料，才能预览
                            </p>
                          </Show>
                          <Show when={预览错误()}>
                            {(话) => (
                              <p data-slot="card-template-preview-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                                {话()}
                              </p>
                            )}
                          </Show>
                          <Show when={预览()}>
                            {(值) => <CardTemplatePreview 结果={值()} 过期={预览过期()} />}
                          </Show>
                        </section>
                      </Show>
                    </div>
                  )}
                </Show>
              )}
            </Show>
          </div>

          <div class="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-v2-border-border-muted px-6">
            <Show
              when={关确认()}
              fallback={
                <>
                  <ButtonV2 type="button" variant="neutral" data-slot="card-template-cancel" onClick={请求关闭}>
                    取消
                  </ButtonV2>
                  <Show when={props.只读 !== true}>
                    <ButtonV2
                      type="button"
                      variant="contrast"
                      data-slot="card-template-save"
                      disabled={校验错().length > 0 || 保存中() || 表单() === undefined}
                      onClick={() => void 保存()}
                    >
                      {保存中() ? "保存中…" : "保存"}
                    </ButtonV2>
                  </Show>
                </>
              }
            >
              <span data-slot="card-template-discard-hint" class="mr-auto text-[12px] text-v2-text-text-muted">
                有未保存的修改，确定关闭？
              </span>
              <ButtonV2
                type="button"
                variant="neutral"
                data-slot="card-template-discard-cancel"
                onClick={() => 设关确认(false)}
              >
                继续编辑
              </ButtonV2>
              <ButtonV2 type="button" variant="danger" data-slot="card-template-discard-ok" onClick={props.onClose}>
                放弃修改
              </ButtonV2>
            </Show>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
