import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface WorkspacePageHeaderProps {
  title: ReactNode
  description: ReactNode
  eyebrow?: ReactNode
  id?: string
  titleAddon?: ReactNode
  children?: ReactNode
  className?: string
}

const WorkspacePageHeader = ({
  title,
  description,
  eyebrow,
  id,
  titleAddon,
  children,
  className,
}: WorkspacePageHeaderProps) => (
  <header className={cn('flex min-h-[185px] w-full flex-col items-center text-center', className)}>
    {eyebrow && (
      <span className="brand-gradient-text rounded-full border border-[#ffc99e] px-3 py-1.5 text-sm font-normal leading-none dark:border-primary/45">
        {eyebrow}
      </span>
    )}
    <div className={cn('flex flex-wrap items-center justify-center gap-3', eyebrow && 'mt-5')}>
      <h1
        id={id}
        className="text-[38px] font-semibold leading-none tracking-[-0.03em] text-[#171717] dark:text-foreground sm:text-[47px]"
      >
        {title}
      </h1>
      {titleAddon}
    </div>
    <p className="mt-5 max-w-[856px] text-[15px] leading-6 tracking-[0.0675px] text-[#171717]/72 dark:text-muted-foreground">
      {description}
    </p>
    {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div>}
  </header>
)

export default WorkspacePageHeader
