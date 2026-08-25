/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key（公开 key，可打包进前端）。未配置则禁用埋点。 */
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  /** PostHog 实例地址，US: https://us.i.posthog.com，EU: https://eu.i.posthog.com */
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
  /** 仅开发环境使用：未配置 Supabase 时从登录页开始预览。 */
  readonly VITE_AUTH_PREVIEW?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.svg?react' {
  import React from 'react'
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
  export default ReactComponent
}
