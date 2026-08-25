import type { IconifyIcon } from '@iconify/types'
import { Icon } from '@iconify/react'
import { useLocation, useNavigate } from 'react-router-dom'

import { GradientIcon } from '@/components/gradient-icon'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export interface NavItem {
  title: string
  path: string
  icon: IconifyIcon
  activeIcon?: IconifyIcon
  activePrefixes?: string[]
}

interface NavMainProps {
  items: NavItem[]
}

export function NavMain({ items }: NavMainProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { setOpenMobile } = useSidebar()

  const isItemActive = (item: NavItem) => {
    if (location.pathname === item.path) return true
    return item.activePrefixes?.some((prefix) => location.pathname.startsWith(prefix)) ?? false
  }

  const openItem = (path: string) => {
    navigate(path)
    setOpenMobile(false)
  }

  return (
    <SidebarGroup className="px-3 py-1">
      <SidebarMenu className="gap-1.5">
        {items.map((item) => {
          const isActive = isItemActive(item)

          return (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton
                type="button"
                tooltip={item.title}
                isActive={isActive}
                onClick={() => openItem(item.path)}
                className={cn(
                  'h-11 gap-3 rounded-xl px-3 text-[15px] font-normal text-sidebar-foreground/76',
                  'hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  'focus-visible:bg-sidebar-accent focus-visible:text-sidebar-foreground focus-visible:ring-0',
                  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-normal data-[active=true]:text-sidebar-foreground',
                  'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-xl group-data-[collapsible=icon]:px-0!',
                )}
              >
                {isActive ? (
                  <GradientIcon icon={item.activeIcon ?? item.icon} className="size-[19px]" />
                ) : (
                  <Icon icon={item.icon} className="size-[18px] shrink-0 text-sidebar-foreground/72" />
                )}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
