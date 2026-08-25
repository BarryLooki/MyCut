import { Fragment } from 'react'
import { Icon } from '@iconify/react'
import altArrowLeftLinear from '@iconify-icons/solar/alt-arrow-left-linear'
import { Link } from 'react-router-dom'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface SecondaryPageBreadcrumbItem {
  label: string
  to?: string
}

interface SecondaryPageNavigationProps {
  backTo: string
  backLabel: string
  items: SecondaryPageBreadcrumbItem[]
  className?: string
}

const SecondaryPageNavigation = ({
  backTo,
  backLabel,
  items,
  className,
}: SecondaryPageNavigationProps) => (
  <div className={cn('flex min-h-9 min-w-0 items-center gap-3', className)}>
    <Button asChild variant="ghost" size="sm" className="-ml-2 shrink-0 text-muted-foreground hover:text-foreground">
      <Link to={backTo} aria-label={`返回${backLabel}`}>
        <Icon icon={altArrowLeftLinear} className="size-4" />
        返回{backLabel}
      </Link>
    </Button>

    <Separator orientation="vertical" className="h-4" />

    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem className={isLast ? 'min-w-0' : 'shrink-0'}>
                {item.to && !isLast ? (
                  <BreadcrumbLink asChild>
                    <Link to={item.to}>{item.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="block truncate">{item.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  </div>
)

export default SecondaryPageNavigation
