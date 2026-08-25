import { Icon } from '@iconify/react'
import altArrowUpLinear from '@iconify-icons/solar/alt-arrow-up-linear'
import crownLinear from '@iconify-icons/solar/crown-linear'
import logoutLinear from '@iconify-icons/solar/logout-linear'
import moonLinear from '@iconify-icons/solar/moon-linear'
import settingsLinear from '@iconify-icons/solar/settings-linear'
import sunLinear from '@iconify-icons/solar/sun-linear'
import userBold from '@iconify-icons/solar/user-bold'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'

export function NavUser() {
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const { authEnabled, user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'My Cutter'
  const email = user?.email || '本地工作空间'

  const handleLogout = async () => {
    try {
      await signOut()
      toast.success('已退出登录')
    } catch {
      toast.error('退出登录失败，请重试')
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-16 gap-3 rounded-2xl px-2.5 data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
            >
              <span className="brand-gradient flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm">
                <Icon icon={userBold} className="size-5 text-white" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5 text-left leading-tight">
                <span className="truncate text-[15px] font-normal">{displayName}</span>
                <span className="brand-gradient-text w-fit text-[11px]">Pro 计划</span>
              </span>
              <Icon icon={altArrowUpLinear} className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-2xl border-0 p-2 shadow-[var(--brand-card-shadow)]"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuLabel className="px-3 py-2 font-normal">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/membership')} className="rounded-xl py-2.5">
              <Icon icon={crownLinear} />
              升级会员
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleTheme} className="rounded-xl py-2.5">
              <Icon icon={theme === 'dark' ? sunLinear : moonLinear} />
              {theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/settings')} className="rounded-xl py-2.5">
              <Icon icon={settingsLinear} />
              设置
            </DropdownMenuItem>
            {authEnabled && user && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleLogout()} className="rounded-xl py-2.5">
                  <Icon icon={logoutLinear} />
                  退出登录
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
