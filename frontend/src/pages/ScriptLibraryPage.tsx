import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import addCircleBold from '@iconify-icons/solar/add-circle-bold'
import checkCircleLinear from '@iconify-icons/solar/check-circle-linear'
import clockCircleLinear from '@iconify-icons/solar/clock-circle-linear'
import documentTextLinear from '@iconify-icons/solar/document-text-linear'
import lightbulbLinear from '@iconify-icons/solar/lightbulb-linear'
import magicStick2Linear from '@iconify-icons/solar/magic-stick-2-linear'
import magniferLinear from '@iconify-icons/solar/magnifer-linear'
import penNewSquareLinear from '@iconify-icons/solar/pen-new-square-linear'
import restartCircleLinear from '@iconify-icons/solar/restart-circle-linear'
import scissorsLinear from '@iconify-icons/solar/scissors-linear'
import trashBinLinear from '@iconify-icons/solar/trash-bin-minimalistic-linear'
import videoFramePlayBold from '@iconify-icons/solar/video-frame-play-horizontal-bold'
import videoFramePlayLinear from '@iconify-icons/solar/video-frame-play-horizontal-linear'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import WorkspacePageHeader from '@/components/WorkspacePageHeader'
import { cn } from '@/lib/utils'
import { composeApi, scriptApi } from '@/services/api'
import type { CaptionStyle, SavedScript } from '@/services/api'

const CAPTION_STYLE_OPTIONS: { value: CaptionStyle; label: string; description: string }[] = [
  { value: 'classic', label: '经典字幕', description: '整句显示，画面干净稳定，适合大多数内容。' },
  { value: 'karaoke', label: '逐字点亮', description: '跟随口播逐字强调，更适合节奏鲜明的短视频。' },
]

const WORKFLOW_STEPS = [
  { icon: lightbulbLinear, label: '确定选题', description: '从热点或自己的想法开始' },
  { icon: documentTextLinear, label: '编辑文案', description: '完善大纲、口播与画面提示' },
  { icon: videoFramePlayLinear, label: '生成成片', description: '选择字幕样式并自动生成视频' },
]

type SortOption = 'updated' | 'created' | 'title'

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response
    if (response?.data?.detail) return response.data.detail
  }

  return fallback
}

function scriptTimestamp(script: SavedScript, field: 'created_at' | 'updated_at') {
  const value = script[field]
  return value ? dayjs(value).valueOf() : 0
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining ? `${minutes} 分 ${remaining} 秒` : `${minutes} 分钟`
}

const ScriptLibraryPage = () => {
  const navigate = useNavigate()
  const [scripts, setScripts] = useState<SavedScript[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>('updated')
  const [composingId, setComposingId] = useState<string | null>(null)
  const [pendingScript, setPendingScript] = useState<SavedScript | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedScript | null>(null)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('classic')

  const load = async () => {
    setLoading(true)
    try {
      setScripts(await scriptApi.list())
    } catch {
      toast.error('加载文案列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const visibleScripts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
    const filtered = normalizedQuery
      ? scripts.filter((script) => {
          const searchableText = [
            script.title,
            script.outline?.hook,
            script.angle,
            script.target_audience,
            script.style,
          ].filter(Boolean).join(' ').toLocaleLowerCase()
          return searchableText.includes(normalizedQuery)
        })
      : [...scripts]

    return filtered.sort((a, b) => {
      if (sortOption === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sortOption === 'created') return scriptTimestamp(b, 'created_at') - scriptTimestamp(a, 'created_at')
      return scriptTimestamp(b, 'updated_at') - scriptTimestamp(a, 'updated_at')
    })
  }, [scripts, searchQuery, sortOption])

  const totalSegments = scripts.reduce((sum, script) => sum + (script.segments?.length || 0), 0)
  const totalDuration = scripts.reduce((sum, script) => sum + (script.est_duration || 0), 0)

  const handleEdit = (script: SavedScript) => navigate('/script', { state: { savedScript: script } })

  const handleUseForClip = (script: SavedScript) => {
    const selected = { title: script.title, outline: script.outline, segments: script.segments }
    navigate('/', { state: { attachedScript: JSON.stringify(selected) } })
  }

  const openComposeSheet = (script: SavedScript) => {
    if (!script.segments?.length) {
      toast.warning('这篇文案还没有分镜内容，无法生成视频')
      return
    }
    setCaptionStyle('classic')
    setPendingScript(script)
  }

  const handleCompose = async () => {
    const script = pendingScript
    if (!script) return
    setComposingId(script.id)

    try {
      const ready = await composeApi.ready()
      if (!ready.ready) {
        toast.warning(ready.hint || '自动成片依赖未就绪')
        return
      }
      await composeApi.fromScript(script.id, true, captionStyle)
      setPendingScript(null)
      toast.success('已开始生成视频，去工作台查看进度')
      navigate('/')
    } catch (error: unknown) {
      toast.error(getRequestErrorMessage(error, '启动生成视频失败'))
    } finally {
      setComposingId(null)
    }
  }

  const handleDelete = async () => {
    const script = deleteTarget
    if (!script) return

    try {
      await scriptApi.remove(script.id)
      setScripts((current) => current.filter((item) => item.id !== script.id))
      setDeleteTarget(null)
      toast.success('文案已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <main className="min-h-[calc(100svh-3.5rem)] bg-[var(--workspace-background)] px-4 pb-16 pt-16 sm:px-6 lg:px-8 lg:pb-20">
      <div className="mx-auto w-full max-w-[1240px]">
        <WorkspacePageHeader
          eyebrow="内容工作区"
          title="文案库"
          description="集中管理选题、口播与分镜，并从这里继续剪辑或生成成片。"
        >
          {!loading && scripts.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>{scripts.length} 篇文案</span>
              <span className="size-1 rounded-full bg-border" />
              <span>{totalSegments} 个分镜</span>
              <span className="size-1 rounded-full bg-border" />
              <span>预计 {formatDuration(totalDuration)}</span>
            </div>
          )}
        </WorkspacePageHeader>

        <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="library-list-heading">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Icon icon={magniferLinear} className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索标题、钩子或风格"
                  aria-label="搜索文案"
                  className="pl-10"
                />
              </div>
              <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
                <SelectTrigger className="w-full rounded-xl border-transparent bg-muted sm:w-[148px] dark:bg-input/30" aria-label="文案排序方式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">最近更新</SelectItem>
                  <SelectItem value="created">最近创建</SelectItem>
                  <SelectItem value="title">标题排序</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card className="overflow-hidden shadow-none">
              <CardHeader className="border-b border-border/70 pb-5">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle id="library-list-heading" className="text-base">全部文案</CardTitle>
                  {!loading && (
                    <span className="text-xs text-muted-foreground tabular-nums">{visibleScripts.length} 个结果</span>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {loading ? (
                  <div className="divide-y divide-border/70">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="space-y-4 p-6">
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-10 rounded-xl" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="h-3 w-3/5" />
                          </div>
                        </div>
                        <Skeleton className="h-16 rounded-xl" />
                      </div>
                    ))}
                  </div>
                ) : visibleScripts.length > 0 ? (
                  <div className="divide-y divide-border/70">
                    {visibleScripts.map((script) => {
                      const outlinePoints = script.outline?.sections?.map((section) => section.point).filter(Boolean).slice(0, 3) || []
                      const updatedAt = script.updated_at || script.created_at

                      return (
                        <article key={script.id} className="group p-6 transition-colors hover:bg-muted/25 sm:p-7">
                          <div className="flex items-start gap-4">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
                              <Icon icon={documentTextLinear} className="size-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(script)}
                                  className="min-w-0 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <h2 className="truncate text-base font-semibold tracking-[-0.015em] group-hover:text-primary">{script.title}</h2>
                                </button>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {updatedAt ? `${dayjs(updatedAt).format('M 月 D 日 HH:mm')} 更新` : '最近更新'}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                {script.outline?.hook || '这篇文案还没有填写开头钩子。'}
                              </p>

                              <div className="mt-4 flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="border-0 font-normal">{script.segments?.length || 0} 个分镜</Badge>
                                {script.est_duration ? (
                                  <Badge variant="secondary" className="border-0 gap-1.5 font-normal">
                                    <Icon icon={clockCircleLinear} className="size-3.5" />
                                    {formatDuration(script.est_duration)}
                                  </Badge>
                                ) : null}
                                {script.style ? <Badge variant="secondary" className="border-0 font-normal">{script.style}</Badge> : null}
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    'border-0 gap-1.5 font-normal',
                                    script.segments?.length ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : undefined,
                                  )}
                                >
                                  <Icon icon={checkCircleLinear} className="size-3.5" />
                                  {script.segments?.length ? '可生成视频' : '待完善'}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {outlinePoints.length > 0 && (
                            <div className="mt-5 grid gap-2 rounded-2xl bg-muted/55 p-4 sm:grid-cols-[88px_minmax(0,1fr)]">
                              <span className="text-xs font-medium text-muted-foreground">大纲快照</span>
                              <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-xs text-foreground/80">
                                {outlinePoints.map((point, index) => (
                                  <span key={`${point}-${index}`} className="inline-flex min-w-0 items-center gap-2">
                                    <span className="size-1 rounded-full bg-primary" />
                                    <span className="max-w-40 truncate">{point}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="mt-5 flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="secondary" onClick={() => handleEdit(script)}>
                              <Icon icon={penNewSquareLinear} />
                              编辑文案
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleUseForClip(script)}>
                              <Icon icon={scissorsLinear} />
                              剪辑视频
                            </Button>
                            <Button size="sm" onClick={() => openComposeSheet(script)} disabled={composingId === script.id}>
                              <Icon
                                icon={composingId === script.id ? restartCircleLinear : videoFramePlayBold}
                                className={composingId === script.id ? 'motion-safe:animate-spin' : 'text-white'}
                              />
                              生成视频
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="ml-auto text-muted-foreground hover:text-destructive"
                              aria-label={`删除文案 ${script.title}`}
                              onClick={() => setDeleteTarget(script)}
                            >
                              <Icon icon={trashBinLinear} />
                            </Button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : scripts.length > 0 ? (
                  <div className="flex min-h-[390px] flex-col items-center justify-center px-6 text-center">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                      <Icon icon={magniferLinear} className="size-5" />
                    </span>
                    <h2 className="mt-4 text-sm font-semibold">没有找到匹配的文案</h2>
                    <p className="mt-2 text-xs text-muted-foreground">换一个关键词，或清除当前搜索条件。</p>
                    <Button className="mt-5" size="sm" variant="outline" onClick={() => setSearchQuery('')}>清除搜索</Button>
                  </div>
                ) : (
                  <div className="flex min-h-[390px] flex-col items-center justify-center px-6 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                      <Icon icon={documentTextLinear} className="size-5" />
                    </span>
                    <h2 className="mt-5 text-base font-semibold">建立你的第一篇文案</h2>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">从一个选题开始，依次完成大纲、分镜和成片。</p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button onClick={() => navigate('/script')}>新建文案</Button>
                      <Button variant="outline" onClick={() => navigate('/hotspots')}>从热点开始</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-5">
            <Card className="overflow-hidden border-0 bg-secondary/65 shadow-none">
              <div aria-hidden="true" className="brand-gradient h-1.5 w-full" />
              <CardHeader className="pb-5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-background text-primary shadow-sm dark:bg-card">
                  <Icon icon={magicStick2Linear} className="size-5" />
                </span>
                <CardTitle className="pt-3 text-lg">开始下一篇创作</CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">可以从空白文案开始，也可以先查找适合你的热门选题。</p>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <Button className="w-full" onClick={() => navigate('/script')}>
                  <Icon icon={addCircleBold} className="text-white" />
                  新建空白文案
                </Button>
                <Button variant="outline" className="w-full bg-background dark:bg-card" onClick={() => navigate('/hotspots')}>
                  <Icon icon={lightbulbLinear} />
                  从热点选题开始
                </Button>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="pb-5">
                <CardTitle className="text-base">从想法到成片</CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">每篇文案都会经过同一套清晰流程。</p>
              </CardHeader>
              <CardContent>
                <div className="relative space-y-0">
                  <div aria-hidden="true" className="absolute bottom-7 left-5 top-7 w-px bg-border" />
                  {WORKFLOW_STEPS.map((step, index) => (
                    <div key={step.label} className="relative flex gap-4 py-3 first:pt-0 last:pb-0">
                      <span className="z-10 flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
                        <Icon icon={step.icon} className="size-4" />
                      </span>
                      <div className="pt-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular-nums">0{index + 1}</span>
                          <p className="text-sm font-medium">{step.label}</p>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Sheet open={Boolean(pendingScript)} onOpenChange={(open) => !open && setPendingScript(null)}>
        <SheetContent className="w-full gap-0 sm:max-w-[440px]">
          <SheetHeader className="border-b px-6 pb-6 pt-7">
            <SheetTitle className="text-xl">生成视频</SheetTitle>
            <SheetDescription className="pt-1 leading-6">
              为「{pendingScript?.title}」选择字幕呈现方式。
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-6">
            <p className="mb-4 text-sm font-medium">字幕样式</p>
            {CAPTION_STYLE_OPTIONS.map((option) => {
              const active = captionStyle === option.value
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => setCaptionStyle(option.value)}
                  className={cn(
                    'w-full rounded-2xl border p-4 text-left outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'border-primary/35 bg-[var(--brand-soft)]' : 'border-border bg-background hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn('text-sm font-medium', active && 'text-primary')}>{option.label}</span>
                    {option.value === 'classic' && <Badge variant="secondary" className="border-0 font-normal">推荐</Badge>}
                  </div>
                  <span className="mt-2 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                </button>
              )
            })}
          </div>

          <SheetFooter className="border-t px-6 py-5">
            <Button className="w-full" size="lg" disabled={Boolean(composingId)} onClick={() => void handleCompose()}>
              <Icon
                icon={composingId ? restartCircleLinear : videoFramePlayBold}
                className={composingId ? 'motion-safe:animate-spin' : 'text-white'}
              />
              {composingId ? '正在启动' : '开始生成视频'}
            </Button>
            <p className="text-center text-xs leading-5 text-muted-foreground">生成后可在工作台查看实时进度</p>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这篇文案？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.title}」及其大纲和分镜内容将被永久删除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export default ScriptLibraryPage
