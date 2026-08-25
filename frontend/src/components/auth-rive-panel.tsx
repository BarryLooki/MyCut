import { useEffect, useState } from "react"
import {
  Alignment,
  Fit,
  Layout,
  useRive,
} from "@rive-app/react-webgl2"

const RIVE_SOURCE = "/rive/riveapp-yuji-ishikawa.riv"
const RIVE_LAYOUT = new Layout({
  fit: Fit.Contain,
  alignment: Alignment.Center,
})

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setReducedMotion(mediaQuery.matches)
    updatePreference()
    mediaQuery.addEventListener("change", updatePreference)
    return () => mediaQuery.removeEventListener("change", updatePreference)
  }, [])

  return reducedMotion
}

export function AuthRivePanel() {
  const reducedMotion = usePrefersReducedMotion()
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  )

  const { rive, RiveComponent } = useRive(
    {
      src: RIVE_SOURCE,
      artboard: "Artboard",
      stateMachines: reducedMotion ? undefined : "Animation",
      autoplay: !reducedMotion,
      layout: RIVE_LAYOUT,
      onLoad: () => setStatus("ready"),
      onLoadError: () => setStatus("failed"),
      automaticallyHandleEvents: false,
    },
    {
      useDevicePixelRatio: true,
      useOffscreenRenderer: true,
      shouldResizeCanvasToContainer: true,
      shouldUseIntersectionObserver: true,
    }
  )

  useEffect(() => {
    if (!rive) return
    if (reducedMotion) rive.pause()
    else rive.play("Animation")
  }, [reducedMotion, rive])

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-muted"
      aria-busy={status === "loading"}
    >
      {status === "failed" ? (
        <div aria-hidden="true" className="absolute inset-0 bg-muted" />
      ) : (
        <div className="absolute inset-0 transition-[filter] duration-300 dark:[filter:invert(.96)_hue-rotate(180deg)]">
          <RiveComponent
            className={`h-full w-full transition-[opacity,filter] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
              status === "ready"
                ? "opacity-100 blur-0"
                : "opacity-40 blur-md"
            }`}
            role="img"
            aria-label="会响应鼠标移动的彩色角色互动动画"
          />
        </div>
      )}
    </div>
  )
}
