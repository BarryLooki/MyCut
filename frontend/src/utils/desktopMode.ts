// 是否运行在「桌面模式」——决定能否保存配置到本地 data/settings.json。
//
// 历史实现只看浏览器里有没有 Tauri 全局对象（window.__TAURI__）。但本项目已移除 Tauri
// 桌面壳、改为「浏览器访问前端 + desktop_start 后端」，那种判断恒为 false，导致即使后端
// 明明是桌面模式，前端也永远提示「Web 模式无法保存」。
//
// 正确口径是问后端：后端 GET /api/v1/settings/desktop-mode 如实返回运行模式。
// Tauri 对象仍作为快速兜底（真在 Tauri 壳里则直接判 true，省一次请求）。
// 结果缓存，避免每次保存配置都打一次后端。

const DESKTOP_MODE_URL = '/api/v1/settings/desktop-mode'

let cached: boolean | null = null

export async function isDesktopMode(): Promise<boolean> {
  if (cached !== null) return cached

  // 快速兜底：真的在 Tauri 壳里就直接是桌面模式
  if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
    cached = true
    return true
  }

  // 问后端：desktop_start 启动的后端会返回 is_desktop_mode=true
  try {
    const resp = await fetch(DESKTOP_MODE_URL, { headers: { Accept: 'application/json' } })
    if (resp.ok) {
      const data = await resp.json()
      cached = Boolean(data?.is_desktop_mode)
      return cached
    }
  } catch {
    // 网络/后端异常时不缓存，下次重试；本次按非桌面处理，保守禁用保存
  }
  return false
}

// 供测试或运行时切换后端后手动清缓存
export function resetDesktopModeCache(): void {
  cached = null
}
