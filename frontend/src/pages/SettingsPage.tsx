import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import chartLinear from '@iconify-icons/solar/chart-linear'
import infoCircleLinear from '@iconify-icons/solar/info-circle-linear'
import powerLinear from '@iconify-icons/solar/power-linear'
import { toast } from 'sonner'

import WorkspacePageHeader from '@/components/WorkspacePageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { isAnalyticsEnabled, setAnalyticsEnabled } from '@/analytics/posthog'
import { isDesktopMode } from '@/utils/desktopMode'

const SettingsPage = () => {
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled())

  return (
    <main className="min-h-full bg-[var(--workspace-background)] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <WorkspacePageHeader
          eyebrow="偏好设置"
          title="系统设置"
          description="管理应用行为、隐私和本地系统集成。"
          className="mb-8"
        />

        <div className="grid gap-6">
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-4 sm:p-8 sm:pb-5">
              <CardTitle className="text-lg">应用设置</CardTitle>
              <CardDescription>配置桌面应用的启动行为</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
              <AppSettings />
            </CardContent>
          </Card>

          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-4 sm:p-8 sm:pb-5">
              <CardTitle className="text-lg">隐私与数据</CardTitle>
              <CardDescription>决定是否帮助我们改进产品体验</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
              <div className="flex flex-col gap-4 rounded-2xl bg-muted/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex min-w-0 gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground">
                    <Icon icon={chartLinear} className="size-[18px]" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">允许匿名使用统计</p>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                      仅采集功能使用和出片状态，不包含视频内容、字幕文本或 API 密钥。
                    </p>
                  </div>
                </div>
                <Switch
                  checked={analyticsOn}
                  onCheckedChange={(checked) => {
                    setAnalyticsEnabled(checked)
                    setAnalyticsOn(checked)
                    toast.success(checked ? '已开启匿名使用统计' : '已关闭匿名使用统计')
                  }}
                  aria-label="允许匿名使用统计"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

const AppSettings = () => {
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const checkAutostartStatus = async () => {
      try {
        if (await isDesktopMode()) {
          const { invoke } = await import('@tauri-apps/api/core')
          setAutostartEnabled(Boolean(await invoke('is_autostart_enabled')))
        }
      } catch (error) {
        console.error('检查自动启动状态失败:', error)
      }
    }

    void checkAutostartStatus()
  }, [])

  const handleAutostartToggle = async (enabled: boolean) => {
    if (!(await isDesktopMode())) {
      toast.error('此功能仅在桌面应用中可用')
      return
    }

    setLoading(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke(enabled ? 'enable_autostart' : 'disable_autostart')
      setAutostartEnabled(enabled)
      toast.success(enabled ? '已启用开机自动启动' : '已关闭开机自动启动')
    } catch (error) {
      console.error('切换自动启动状态失败:', error)
      toast.error('操作失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-muted/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground">
            <Icon icon={powerLinear} className="size-[18px]" />
          </span>
          <div>
            <p className="text-sm font-medium">开机自动启动</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">应用将在系统启动后自动运行。</p>
          </div>
        </div>
        <Switch
          checked={autostartEnabled}
          disabled={loading}
          onCheckedChange={(checked) => void handleAutostartToggle(checked)}
          aria-label="开机自动启动"
        />
      </div>

      <Alert className="rounded-2xl border-0 bg-[var(--brand-soft)] shadow-none">
        <Icon icon={infoCircleLinear} />
        <AlertTitle>桌面功能</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          自动启动只在 MyCut 桌面应用中可用，浏览器预览不会修改系统设置。
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default SettingsPage
