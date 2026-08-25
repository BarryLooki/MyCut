import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import checkCircleLinear from '@iconify-icons/solar/check-circle-linear'
import crownBold from '@iconify-icons/solar/crown-bold'
import restartCircleLinear from '@iconify-icons/solar/restart-circle-linear'
import userRoundedLinear from '@iconify-icons/solar/user-rounded-linear'
import dayjs from 'dayjs'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import WorkspacePageHeader from '@/components/WorkspacePageHeader'
import { payApi } from '@/services/api'
import type { Membership } from '@/services/api'
import { openAlipayForm } from '@/utils/alipay'

const PRO_BENEFITS = [
  '不限量 AI 视频切片',
  'AI 查热点、生成大纲和文案',
  '自动成片与合集导出',
  '优先体验新功能',
]

const BASIC_BENEFITS = [
  'AI 查热点与文案管理',
  '基础剪辑项目工作区',
  '标准任务处理队列',
]

function getPaymentErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error
  ) {
    const response = (error as { response?: { data?: { detail?: string } } }).response
    if (response?.data?.detail) return response.data.detail
  }

  return '发起支付失败，请稍后重试'
}

const MembershipPage = () => {
  const [membership, setMembership] = useState<Membership | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const pollTimer = useRef<number | null>(null)

  const loadMembership = useCallback(async () => {
    try {
      setMembership(await payApi.getMembership())
    } catch {
      // Membership state does not block the purchase page.
    } finally {
      setMembershipLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMembership()
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [loadMembership])

  const startPolling = useCallback((outTradeNo: string) => {
    let elapsed = 0
    const interval = 3000
    const timeout = 5 * 60 * 1000

    pollTimer.current = window.setInterval(async () => {
      elapsed += interval
      try {
        const order = await payApi.getOrderStatus(outTradeNo)
        if (order.status === 'paid') {
          if (pollTimer.current) window.clearInterval(pollTimer.current)
          setPaying(false)
          toast.success('支付成功，会员已开通')
          void loadMembership()
          return
        }
      } catch {
        // Keep polling after a transient request failure.
      }

      if (elapsed >= timeout) {
        if (pollTimer.current) window.clearInterval(pollTimer.current)
        setPaying(false)
        toast.info('暂未检测到支付完成，如已付款请稍后刷新')
      }
    }, interval)
  }, [loadMembership])

  const handleBuy = async () => {
    setPaying(true)
    try {
      const { out_trade_no, pay_form_html } = await payApi.createAlipayOrder(1)
      const paymentWindow = openAlipayForm(pay_form_html)
      if (!paymentWindow) {
        setPaying(false)
        toast.warning('浏览器拦截了支付窗口，请允许弹窗后重试')
        return
      }
      toast.info('已打开支付宝收银台，请在新标签页完成支付')
      startPolling(out_trade_no)
    } catch (error: unknown) {
      setPaying(false)
      toast.error(getPaymentErrorMessage(error))
    }
  }

  const isMember = membership?.is_member
  const expiresText = membership?.expires_at
    ? dayjs(membership.expires_at).format('YYYY 年 M 月 D 日')
    : null
  const currentPlanName = isMember ? 'MyCut Pro' : '基础版'
  const currentBenefits = isMember ? PRO_BENEFITS : BASIC_BENEFITS

  return (
    <main className="min-h-[calc(100svh-3.5rem)] bg-[var(--workspace-background)] px-4 pb-16 pt-16 sm:px-6 lg:px-8 lg:pb-20">
      <div className="mx-auto w-full max-w-[1080px]">
        <WorkspacePageHeader
          id="membership-heading"
          eyebrow="账户与方案"
          title="会员"
          description="查看当前等级，或升级到 Pro 解锁完整创作能力。"
        />

        <section
          aria-label="会员等级与升级方案"
          className="mt-7 grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-stretch"
        >
          <Card className="flex min-h-[440px] flex-col border-border/70 bg-card shadow-none">
            <CardHeader className="space-y-0 p-6 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-muted-foreground">当前等级</p>
                {membershipLoading ? (
                  <Skeleton className="h-6 w-16 rounded-full" />
                ) : (
                  <Badge
                    variant="secondary"
                    className="border-0 bg-secondary text-foreground hover:bg-secondary"
                  >
                    使用中
                  </Badge>
                )}
              </div>
              <div className="mt-7 flex items-center gap-3.5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-foreground">
                  <Icon icon={userRoundedLinear} className="size-5" />
                </span>
                {membershipLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                ) : (
                  <div>
                    <CardTitle className="text-2xl tracking-[-0.03em]">{currentPlanName}</CardTitle>
                    <CardDescription className="mt-1">
                      {isMember ? '完整创作权限已开启' : '包含基础创作能力'}
                    </CardDescription>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex-1 px-6 pb-6 sm:px-7 sm:pb-7">
              <Separator className="mb-5 bg-border/70" />
              <p className="mb-4 text-xs font-medium text-muted-foreground">当前包含</p>
              {membershipLoading ? (
                <div className="space-y-4" aria-label="正在读取当前等级权益">
                  {BASIC_BENEFITS.map((benefit) => (
                    <div key={benefit} className="flex items-center gap-3">
                      <Skeleton className="size-[18px] rounded-full" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="space-y-4" aria-label="当前等级权益">
                  {currentBenefits.map((benefit) => (
                    <li key={benefit} className="flex items-center gap-3 text-sm text-foreground/85">
                      <Icon
                        icon={checkCircleLinear}
                        className="size-[18px] shrink-0 text-muted-foreground"
                      />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>

            <CardFooter className="mt-auto items-start border-t border-border/70 px-6 py-5 sm:px-7">
              <div>
                <p className="text-xs text-muted-foreground">账户状态</p>
                {membershipLoading ? (
                  <Skeleton className="mt-2 h-4 w-36" />
                ) : (
                  <p className="mt-1 text-sm font-medium">
                    {isMember && expiresText ? `有效期至 ${expiresText}` : '当前未开通付费会员'}
                  </p>
                )}
              </div>
            </CardFooter>
          </Card>

          <Card className="relative min-h-[440px] overflow-hidden border-primary/20 shadow-[0_18px_48px_rgb(18_18_23/0.07)] dark:border-primary/30">
            <div aria-hidden="true" className="brand-gradient h-1 w-full" />
            <div className="grid min-h-[436px] md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="flex min-w-0 flex-col">
                <CardHeader className="space-y-0 p-6 sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      {isMember ? '续费方案' : '更高等级'}
                    </p>
                    <Badge className="border-0 bg-[var(--brand-soft)] text-foreground shadow-none hover:bg-[var(--brand-soft)]">
                      {isMember ? '当前方案' : '推荐'}
                    </Badge>
                  </div>

                  <div className="mt-7 flex items-center gap-3.5">
                    <span className="brand-gradient flex size-10 items-center justify-center rounded-xl text-white">
                      <Icon icon={crownBold} className="size-5 text-white" />
                    </span>
                    <div>
                      <CardTitle className="text-2xl tracking-[-0.03em]">MyCut Pro</CardTitle>
                      <CardDescription className="mt-1">完整的 AI 视频创作方案</CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 px-6 pb-6 sm:px-7 sm:pb-7">
                  <Separator className="mb-5 bg-border/70" />
                  <p className="mb-4 text-xs font-medium text-muted-foreground">Pro 专属权益</p>
                  <ul
                    className="grid gap-x-7 gap-y-4 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2"
                    aria-label="MyCut Pro 权益"
                  >
                    {PRO_BENEFITS.map((benefit) => (
                      <li key={benefit} className="flex items-start gap-3 text-sm text-foreground/90">
                        <Icon
                          icon={checkCircleLinear}
                          className="mt-px size-[18px] shrink-0 text-primary"
                        />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </div>

              <aside className="flex flex-col border-t border-border/70 bg-muted/35 p-6 md:border-l md:border-t-0 sm:p-7">
                <p className="text-xs font-medium text-muted-foreground">按月订阅</p>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="pb-1.5 text-sm font-medium">¥</span>
                  <span className="ac-mono text-[44px] font-semibold leading-none tracking-[-0.055em]">98</span>
                  <span className="pb-1.5 text-xs text-muted-foreground">/ 月</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">开通或续费后立即生效</p>

                <Button
                  type="button"
                  size="lg"
                  className="mt-7 h-11 w-full md:mt-auto"
                  disabled={paying}
                  onClick={() => void handleBuy()}
                >
                  {paying && (
                    <Icon icon={restartCircleLinear} className="motion-safe:animate-spin" />
                  )}
                  {paying ? '正在打开收银台' : isMember ? '续费一个月' : '升级到 Pro'}
                </Button>
              </aside>
            </div>
          </Card>
        </section>
      </div>
    </main>
  )
}

export default MembershipPage
