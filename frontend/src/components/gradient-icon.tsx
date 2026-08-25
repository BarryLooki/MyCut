import type { CSSProperties } from 'react'
import type { IconifyIcon } from '@iconify/types'

import { cn } from '@/lib/utils'

interface GradientIconProps {
  icon?: IconifyIcon
  className?: string
}

export function GradientIcon({ icon, className }: GradientIconProps) {
  if (!icon) return null

  const width = icon.width || 24
  const height = icon.height || 24
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="color:#000">${icon.body}</svg>`
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  const style = {
    backgroundImage: 'var(--brand-gradient)',
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
  } as CSSProperties

  return <span aria-hidden="true" className={cn('inline-block shrink-0', className)} style={style} />
}
