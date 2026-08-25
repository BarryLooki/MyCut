import React from 'react'
import { Icon } from '@iconify/react'
import altArrowDownLinear from '@iconify-icons/solar/alt-arrow-down-linear'
import hamburgerMenuLinear from '@iconify-icons/solar/hamburger-menu-linear'
import logoutLinear from '@iconify-icons/solar/logout-linear'
import moonLinear from '@iconify-icons/solar/moon-linear'
import settingsLinear from '@iconify-icons/solar/settings-linear'
import sunLinear from '@iconify-icons/solar/sun-linear'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import logoDark from '../assets/logo-dark.svg'
import logoLight from '../assets/logo-light.svg'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface NavigationItem {
  label: string
  path: string
  activePrefixes?: string[]
}

const Header: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { authEnabled, user, isAdmin, signOut } = useAuth()

  const navigationItems: NavigationItem[] = [
    { label: '工作台', path: '/', activePrefixes: ['/hotspots'] },
    { label: '项目', path: '/projects', activePrefixes: ['/processing', '/project'] },
    { label: '文案库', path: '/scripts', activePrefixes: ['/script'] },
    { label: '会员', path: '/membership' },
    ...((isAdmin || !authEnabled) ? [{ label: '后台', path: '/admin' }] : []),
  ]

  const isItemActive = (item: NavigationItem) => (
    location.pathname === item.path ||
    (item.activePrefixes?.some((prefix) => location.pathname.startsWith(prefix)) ?? false)
  )

  const handleLogout = async () => {
    try {
      await signOut()
      toast.success('已退出登录')
    } catch {
      toast.error('退出登录失败，请重试')
    }
  }

  const navControlClass = 'h-8 rounded-none px-0 text-[15px] font-normal tracking-[0.0675px] text-foreground/80 transition-none hover:bg-transparent hover:text-foreground'
  const underlineClass = 'after:absolute after:-bottom-2 after:left-0 after:h-px after:w-full after:bg-foreground'
  const navButtonClass = (active: boolean) => cn(
    navControlClass,
    'relative',
    underlineClass,
    active ? 'text-foreground after:opacity-100' : 'after:opacity-0',
  )

  return (
    <header className="relative z-50 h-14 shrink-0 bg-background/92 backdrop-blur-lg supports-[backdrop-filter]:bg-background/90">
      <div className="relative mx-auto flex h-full w-full max-w-[1441px] items-center justify-between px-5 sm:px-10">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="前往 MyCut 工作台"
        >
          <img src={logoLight} alt="MyCut" className="h-6 w-auto dark:hidden" />
          <img src={logoDark} alt="MyCut" className="hidden h-6 w-auto dark:block" />
        </button>

        <nav className="absolute inset-x-0 mx-auto hidden w-fit items-center justify-center gap-8 md:flex" aria-label="主导航">
          {navigationItems.map((item) => {
            const active = isItemActive(item)
            return (
              <Button
                key={item.path}
                type="button"
                variant="ghost"
                onClick={() => navigate(item.path)}
                className={navButtonClass(active)}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Button>
            )
          })}
        </nav>

        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  navControlClass,
                  'hidden gap-2 md:inline-flex',
                  location.pathname === '/settings' && 'text-foreground',
                )}
                aria-label="打开设置菜单"
              >
                <span
                  className={cn(
                    'relative flex h-8 items-center',
                    underlineClass,
                    location.pathname === '/settings' ? 'after:opacity-100' : 'after:opacity-0',
                  )}
                >
                  设置
                </span>
                <Icon icon={altArrowDownLinear} className="size-5 transition-transform data-[state=open]:rotate-180" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {authEnabled && user && (
                <>
                  <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => navigate('/settings')}>
                <Icon icon={settingsLinear} />
                系统设置
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                <Icon icon={theme === 'dark' ? sunLinear : moonLinear} />
                {theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              </DropdownMenuItem>
              {authEnabled && user && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleLogout()}>
                    <Icon icon={logoutLinear} />
                    退出登录
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="打开导航菜单">
                <Icon icon={hamburgerMenuLinear} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 md:hidden">
              {navigationItems.map((item) => (
                <DropdownMenuItem key={item.path} onSelect={() => navigate(item.path)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/settings')}>
                <Icon icon={settingsLinear} />
                系统设置
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                <Icon icon={theme === 'dark' ? sunLinear : moonLinear} />
                {theme === 'dark' ? '亮色模式' : '暗色模式'}
              </DropdownMenuItem>
              {authEnabled && user && (
                <DropdownMenuItem onSelect={() => void handleLogout()}>
                  <Icon icon={logoutLinear} />
                  退出登录
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

export default Header
