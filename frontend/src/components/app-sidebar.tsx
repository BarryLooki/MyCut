import type { ComponentProps } from 'react'
import crownBold from '@iconify-icons/solar/crown-bold'
import crownLinear from '@iconify-icons/solar/crown-linear'
import documentTextBold from '@iconify-icons/solar/document-text-bold'
import documentTextLinear from '@iconify-icons/solar/document-text-linear'
import settingsBold from '@iconify-icons/solar/settings-bold'
import settingsLinear from '@iconify-icons/solar/settings-linear'
import shieldUserBold from '@iconify-icons/solar/shield-user-bold'
import shieldUserLinear from '@iconify-icons/solar/shield-user-linear'
import widgetBold from '@iconify-icons/solar/widget-bold'
import widgetLinear from '@iconify-icons/solar/widget-linear'
import { useNavigate } from 'react-router-dom'

import logoDark from '@/assets/logo-dark.svg'
import logoLight from '@/assets/logo-light.svg'
import { NavMain, type NavItem } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useAuth } from '@/context/AuthContext'

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const navigationItems: NavItem[] = [
    {
      title: '工作台',
      path: '/',
      icon: widgetLinear,
      activeIcon: widgetBold,
      activePrefixes: ['/hotspots', '/processing', '/project'],
    },
    {
      title: '文案库',
      path: '/scripts',
      icon: documentTextLinear,
      activeIcon: documentTextBold,
      activePrefixes: ['/script'],
    },
    { title: '会员', path: '/membership', icon: crownLinear, activeIcon: crownBold },
    ...(isAdmin ? [{ title: '后台管理', path: '/admin', icon: shieldUserLinear, activeIcon: shieldUserBold }] : []),
    { title: '设置', path: '/settings', icon: settingsLinear, activeIcon: settingsBold },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-20 justify-center px-6 py-4 group-data-[collapsible=icon]:px-[18px]">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex w-fit items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="前往 MyCut 工作台"
        >
          <img src={logoLight} alt="MyCut" className="h-7 w-auto dark:hidden group-data-[collapsible=icon]:hidden" />
          <img src={logoDark} alt="MyCut" className="hidden h-7 w-auto dark:block group-data-[collapsible=icon]:hidden" />
          <span className="hidden size-8 overflow-hidden group-data-[collapsible=icon]:block">
            <img src={logoLight} alt="" className="h-7 max-w-none dark:hidden" />
            <img src={logoDark} alt="" className="hidden h-7 max-w-none dark:block" />
          </span>
        </button>
      </SidebarHeader>
      <SidebarContent className="pt-1">
        <NavMain items={navigationItems} />
      </SidebarContent>
      <SidebarFooter className="px-3 pb-3">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
