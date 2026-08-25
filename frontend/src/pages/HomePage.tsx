import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import altArrowRightLinear from '@iconify-icons/solar/alt-arrow-right-linear'
import documentTextLinear from '@iconify-icons/solar/document-text-linear'
import fireBold from '@iconify-icons/solar/fire-bold'
import videoFramePlayHorizontalBold from '@iconify-icons/solar/video-frame-play-horizontal-bold'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import FileUpload from '../components/FileUpload'
import WorkspacePageHeader from '../components/WorkspacePageHeader'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

interface FeatureCardProps {
  title: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}

interface HomeLocationState {
  attachedScript?: string
  focusUpload?: boolean
}

const FeatureCard = ({
  title,
  description,
  icon,
  onClick,
}: FeatureCardProps) => (
  <Card className="group h-[222px] min-w-0 overflow-hidden border-0 bg-[#f7f7f7] shadow-none transition-colors hover:bg-[#f3f3f3] dark:bg-card dark:hover:bg-muted/65">
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-full w-full flex-col justify-center rounded-[20px] px-7 py-5 text-center text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-primary/35"
      aria-label={`${title}：${description}`}
    >
      <span className="brand-gradient flex size-10 items-center justify-center rounded-full text-white shadow-[0_8px_22px_rgb(255_107_166/0.18)] [&_svg]:size-[18px] [&_svg]:text-white">
        {icon}
      </span>
      <span className="mt-4 whitespace-normal text-base font-semibold leading-6 tracking-[-0.01em]">
        {title}
      </span>
      <span className="mt-1.5 max-w-[330px] whitespace-normal text-[13px] font-normal leading-5 text-muted-foreground">
        {description}
      </span>
      <span className="mt-3 flex size-6 items-center justify-center text-foreground/70 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground">
        <Icon icon={altArrowRightLinear} className="size-[18px]" />
      </span>
    </Button>
  </Card>
)

const HomePage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as HomeLocationState | null
  const [attachedScript, setAttachedScript] = useState<string | undefined>(locationState?.attachedScript)

  useEffect(() => {
    if (!locationState?.focusUpload) return
    const timer = window.setTimeout(() => {
      document.querySelector('#new-project')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [locationState?.focusUpload])

  const attachedTitle = useMemo(() => {
    if (!attachedScript) return undefined
    try {
      return JSON.parse(attachedScript).title || '未命名文案'
    } catch {
      return '已选文案'
    }
  }, [attachedScript])

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background px-4 py-4 sm:px-6 lg:px-8">
      <section className="mx-auto min-h-[790px] w-full max-w-[984px] rounded-[24px] bg-background" aria-labelledby="home-heading">
        <div className="flex w-full flex-col gap-12 px-1 py-12 sm:px-8 xl:px-16">
          <WorkspacePageHeader
            id="home-heading"
            eyebrow="AI 剪辑助手"
            title="开始新的剪辑"
            description="从热点选题、文案创作到视频成片，选择一种方式开始你的下一支作品。"
          />

          <div className="grid gap-4 md:grid-cols-2" aria-label="选择创作方式">
            <FeatureCard
              title="AI 查热点，选题就出文案"
              description="输入领域 · 查热点选题 · 生成大纲和文案 · 保存到文案库"
              icon={<Icon icon={fireBold} />}
              onClick={() => navigate('/hotspots')}
            />
            <FeatureCard
              title="文案一键自动成片"
              description="选一篇文案 · AI 配音 · 逐句字幕 · 自动生成视频"
              icon={<Icon icon={videoFramePlayHorizontalBold} />}
              onClick={() => navigate('/scripts')}
            />
          </div>

          <div id="new-project" className="scroll-mt-20">
            {attachedScript && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-muted/55 px-4 py-3 text-sm">
                <Icon icon={documentTextLinear} className="size-[18px] shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">已关联文案</p>
                  <p className="mt-0.5 truncate font-medium">{attachedTitle}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAttachedScript(undefined)}>
                  取消关联
                </Button>
              </div>
            )}
            <FileUpload
              variant="figma-home"
              attachedScript={attachedScript}
              onUploadSuccess={() => {
                toast.success(attachedScript ? '选题驱动项目已创建，正在按文案切片' : '项目已创建，正在处理中')
              }}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

export default HomePage
