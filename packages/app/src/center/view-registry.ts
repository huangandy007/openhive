import type { Component } from "solid-js"

/** 视图组件的入参：要渲染的是哪个文件；内容由视图自行按需读取。 */
export interface ViewProps {
  path: string
}

/** 中栏内容视图组件。 */
export type ViewComponent = Component<ViewProps>

/** 一次视图注册：认领若干扩展名，交给同一个视图组件渲染。 */
export interface ViewRegistration {
  /** 认领的扩展名，带点，如 [".doc", ".docx"]。 */
  extensions: readonly string[]
  component: ViewComponent
}

export interface ViewRegistry {
  register(registration: ViewRegistration): void
  resolve(extension: string): ViewComponent | undefined
}

/**
 * 中栏「内容类型（扩展名）→ 视图组件」注册表（FR-007 / FR-008）。
 *
 * 注册式扩展：新增一种格式支持只需 `register()`，框架零改动（SC-003）。
 */
export function createViewRegistry(): ViewRegistry {
  const views = new Map<string, ViewComponent>()

  return {
    register(registration) {
      const keys = registration.extensions.map((extension) => extension.toLowerCase())
      // 先全量校验再落库：中途冲突时整批不生效，避免留下半注册状态。
      for (const key of keys) {
        if (views.has(key)) throw new Error(`视图注册冲突：扩展名 ${key} 已有归属视图`)
      }
      for (const key of keys) views.set(key, registration.component)
    },
    resolve(extension) {
      return views.get(extension.toLowerCase())
    },
  }
}

/**
 * 从文件路径 / 文件名取扩展名（带点、小写），取不到则 undefined。
 *
 * 语义对齐 `path.extname`：取 basename 最后一个点之后的部分，故纯 dotfile
 * （`.gitignore`，含嵌在目录里的 `a/b/.gitignore`）无扩展名。`/` 与 `\` 都当分隔符，
 * Windows 与 Unix 路径通吃。
 * 取不到的情形交给调用方降级呈现（T015）。
 */
export function extensionOf(path: string): string | undefined {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
  const index = name.lastIndexOf(".")
  if (index <= 0 || index === name.length - 1) return undefined
  return name.slice(index).toLowerCase()
}
