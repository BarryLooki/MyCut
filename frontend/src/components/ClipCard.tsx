import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import clockCircleLinear from '@iconify-icons/solar/clock-circle-linear'
import closeCircleLinear from '@iconify-icons/solar/close-circle-linear'
import downloadBold from '@iconify-icons/solar/download-bold'
import downloadLinear from '@iconify-icons/solar/download-linear'
import playCircleBold from '@iconify-icons/solar/play-circle-bold'
import playCircleLinear from '@iconify-icons/solar/play-circle-linear'
import starBold from '@iconify-icons/solar/star-bold'
import videoFramePlayHorizontalLinear from '@iconify-icons/solar/video-frame-play-horizontal-linear'
import { Modal } from 'antd'
import ReactPlayer from 'react-player'
import { toast } from 'sonner'

import EditableTitle from '@/components/EditableTitle'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Clip } from '@/store/useProjectStore'

interface ClipCardProps {
  clip: Clip
  videoUrl?: string
  onDownload: (clipId: string) => void | Promise<void>
  projectId?: string
  onClipUpdate?: (clipId: string, updates: Partial<Clip>) => void
}

const parseTime = (time: string) => {
  const parts = time.replace(',', '.').split(':')
  if (parts.length !== 3) return 0
  return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0)
}

const formatDuration = (seconds: number) => {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remaining = rounded % 60
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

const shortTime = (value: string) => value.replace(',', '.').slice(0, 8)

const ClipCard = ({ clip, videoUrl, onDownload, onClipUpdate }: ClipCardProps) => {
  const [showPlayer, setShowPlayer] = useState(false)
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null)
  const playerRef = useRef<ReactPlayer>(null)

  useEffect(() => {
    if (!videoUrl) {
      setVideoThumbnail(null)
      return
    }

    let cancelled = false
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, Number.isFinite(video.duration) ? video.duration / 3 : 1)
    }

    video.onseeked = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0)
      setVideoThumbnail(canvas.toDataURL('image/jpeg', 0.82))
    }

    video.src = videoUrl
    return () => {
      cancelled = true
      video.removeAttribute('src')
      video.load()
    }
  }, [videoUrl])

  const handleDownload = async () => {
    try {
      await onDownload(clip.id)
    } catch (downloadError) {
      console.error('下载失败:', downloadError)
      toast.error('下载失败')
    }
  }

  const displayContent = (() => {
    if (clip.recommend_reason?.trim()) return clip.recommend_reason

    if (Array.isArray(clip.content)) {
      const concisePoints = clip.content.filter((item) => {
        const value = item.trim()
        if (value.length > 100) return false
        return value.split(/[，。！？；：“”"'（）【】]/).length <= 3
      })
      if (concisePoints.length > 0) return concisePoints.join(' ')
    }

    return clip.outline?.trim() || '暂无内容要点'
  })()

  const duration = formatDuration(Math.max(0, parseTime(clip.end_time) - parseTime(clip.start_time)))
  const score = Math.round(Math.min(1, clip.final_score || 0) * 100)

  return (
    <>
      <Card className="group overflow-hidden bg-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgb(16_24_40/0.10)]">
        <button
          type="button"
          onClick={() => setShowPlayer(true)}
          className="relative block aspect-video w-full overflow-hidden bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-inset"
          aria-label={`播放片段：${clip.title || clip.generated_title || '未命名片段'}`}
        >
          {videoThumbnail ? (
            <img
              src={videoThumbnail}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(145deg,#f7f7f8,#ececef)] dark:bg-[linear-gradient(145deg,#29282b,#202023)]">
              <div className="absolute inset-x-5 bottom-5 flex h-5 items-end gap-1 opacity-45" aria-hidden="true">
                {[8, 15, 11, 18, 9, 14, 6, 17, 12, 19, 8, 13, 10, 16, 7, 12].map((height, index) => (
                  <span key={index} className="flex-1 rounded-sm bg-foreground/25" style={{ height }} />
                ))}
              </div>
              <Icon icon={videoFramePlayHorizontalLinear} className="size-8 text-muted-foreground/65" />
            </div>
          )}

          <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />
          <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 scale-95 items-center justify-center rounded-full bg-black/72 text-white opacity-0 shadow-lg backdrop-blur-md transition-[opacity,transform] duration-200 group-hover:scale-100 group-hover:opacity-100">
            <Icon icon={playCircleBold} className="size-6 text-white" />
          </span>

          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md">
            <Icon icon={starBold} className="size-3 text-white" />
            AI {score}
          </span>
          <span className="absolute bottom-3 right-3 rounded-lg bg-black/72 px-2 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-md">
            {duration}
          </span>
        </button>

        <CardContent className="p-4">
          <div className="min-w-0">
            <EditableTitle
              title={clip.title || clip.generated_title || '未命名片段'}
              clipId={clip.id}
              onTitleUpdate={(title) => onClipUpdate?.(clip.id, { title })}
              className="line-clamp-1"
              style={{ fontSize: '15px', fontWeight: 520, color: 'var(--foreground)', padding: 0 }}
            />
            <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground" title={displayContent}>
              {displayContent}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
            <Icon icon={clockCircleLinear} className="size-3.5" />
            <span>{shortTime(clip.start_time)}</span>
            <span>—</span>
            <span>{shortTime(clip.end_time)}</span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowPlayer(true)}>
              <Icon icon={playCircleLinear} className="size-4" />
              预览
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => void handleDownload()} aria-label="下载片段">
              <Icon icon={downloadLinear} className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={showPlayer}
        onCancel={() => setShowPlayer(false)}
        footer={[
          <Button key="download" onClick={() => void handleDownload()}>
            <Icon icon={downloadBold} className="size-4 text-white" />
            下载视频
          </Button>,
        ]}
        width={860}
        centered
        destroyOnHidden
        closeIcon={<Icon icon={closeCircleLinear} className="size-5" />}
        title={
          <EditableTitle
            title={clip.title || clip.generated_title || '视频预览'}
            clipId={clip.id}
            onTitleUpdate={(title) => onClipUpdate?.(clip.id, { title })}
            style={{ color: 'var(--foreground)', fontSize: '16px', fontWeight: 520 }}
          />
        }
      >
        <div className="overflow-hidden rounded-[16px] bg-black">
          {videoUrl && (
            <ReactPlayer
              ref={playerRef}
              url={videoUrl}
              width="100%"
              height="440px"
              controls
              playing={showPlayer}
              config={{
                file: {
                  attributes: { controlsList: 'nodownload', preload: 'metadata' },
                  forceHLS: false,
                  forceDASH: false,
                },
              }}
            />
          )}
        </div>
      </Modal>
    </>
  )
}

export default ClipCard
