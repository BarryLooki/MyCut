import { useState } from 'react'
import { Icon } from '@iconify/react'
import clockCircleLinear from '@iconify-icons/solar/clock-circle-linear'
import disketteLinear from '@iconify-icons/solar/diskette-linear'
import documentTextBold from '@iconify-icons/solar/document-text-bold'
import documentTextLinear from '@iconify-icons/solar/document-text-linear'
import lightbulbLinear from '@iconify-icons/solar/lightbulb-linear'
import restartCircleLinear from '@iconify-icons/solar/restart-circle-linear'
import scissorsLinear from '@iconify-icons/solar/scissors-linear'
import videoFramePlayHorizontalBold from '@iconify-icons/solar/video-frame-play-horizontal-bold'
import videoFramePlayHorizontalLinear from '@iconify-icons/solar/video-frame-play-horizontal-linear'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import SecondaryPageNavigation from '@/components/SecondaryPageNavigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { composeApi, scriptApi } from '@/services/api'
import type { Outline, SavedScript, ScriptSegment, TopicCard } from '@/services/api'

const STYLE_OPTIONS = ['干货', '热血', '亲和', '犀利', '轻松']
const ROLE_LABEL: Record<ScriptSegment['role'], string> = {
  hook: '开头钩子',
  body: '正文',
  cta: '结尾号召',
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response
    if (response?.data?.detail) return response.data.detail
  }

  return fallback
}

const ScriptEditorPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { topic?: TopicCard; savedScript?: SavedScript } | null
  const passedTopic = state?.topic
  const savedScript = state?.savedScript

  const [scriptId, setScriptId] = useState<string | null>(savedScript?.id || null)
  const [title, setTitle] = useState(savedScript?.title || passedTopic?.title || '')
  const [angle, setAngle] = useState(savedScript?.angle || passedTopic?.angle || '')
  const [audience, setAudience] = useState(savedScript?.target_audience || passedTopic?.target_audience || '')
  const [keywords] = useState<string[]>(savedScript?.keywords || passedTopic?.keywords || [])
  const [duration, setDuration] = useState(savedScript?.est_duration || 60)
  const [style, setStyle] = useState(savedScript?.style || '干货')

  const [outline, setOutline] = useState<Outline | null>(savedScript?.outline || null)
  const [segments, setSegments] = useState<ScriptSegment[]>(savedScript?.segments || [])
  const [loadingOutline, setLoadingOutline] = useState(false)
  const [loadingScript, setLoadingScript] = useState(false)
  const [saving, setSaving] = useState(false)
  const [composing, setComposing] = useState(false)
  const [withScene, setWithScene] = useState(true)

  const handleGenerateOutline = async () => {
    if (!title.trim()) {
      toast.warning('请填写选题标题')
      return
    }

    setLoadingOutline(true)
    try {
      const response = await scriptApi.generateOutline({
        title: title.trim(),
        angle,
        target_audience: audience,
        keywords,
        duration,
      })
      setOutline(response)
      setSegments([])
    } catch (error: unknown) {
      toast.error(getRequestErrorMessage(error, '生成大纲失败'))
    } finally {
      setLoadingOutline(false)
    }
  }

  const handleGenerateScript = async () => {
    if (!outline) {
      toast.warning('请先生成大纲')
      return
    }

    setLoadingScript(true)
    try {
      const response = await scriptApi.generateScript({ title: title.trim(), outline, style, duration })
      setSegments(response)
    } catch (error: unknown) {
      toast.error(getRequestErrorMessage(error, '生成文案失败'))
    } finally {
      setLoadingScript(false)
    }
  }

  const updateHook = (value: string) => outline && setOutline({ ...outline, hook: value })
  const updateCta = (value: string) => outline && setOutline({ ...outline, cta: value })
  const updateSection = (index: number, field: 'point' | 'detail', value: string) => {
    if (!outline) return
    const sections = outline.sections.map((section, sectionIndex) => (
      sectionIndex === index ? { ...section, [field]: value } : section
    ))
    setOutline({ ...outline, sections })
  }

  const updateSegment = <K extends keyof ScriptSegment>(
    index: number,
    field: K,
    value: ScriptSegment[K],
  ) => {
    setSegments((current) => current.map((segment, segmentIndex) => (
      segmentIndex === index ? { ...segment, [field]: value } : segment
    )))
  }

  const buildPayload = () => ({
    title: title.trim(),
    angle,
    target_audience: audience,
    keywords,
    outline: outline || { hook: '', sections: [], cta: '' },
    segments,
    style,
    est_duration: duration,
  })

  const handleSave = async () => {
    if (!title.trim()) {
      toast.warning('请填写选题标题')
      return
    }
    if (!outline) {
      toast.warning('请先生成大纲再保存')
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      if (scriptId) {
        await scriptApi.update(scriptId, payload)
        toast.success('文案已更新')
      } else {
        const created = await scriptApi.save(payload)
        setScriptId(created.id)
        toast.success('已保存到文案库')
      }
    } catch (error: unknown) {
      toast.error(getRequestErrorMessage(error, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleUseForClip = () => {
    if (!outline) {
      toast.warning('请先生成大纲')
      return
    }
    const script = { title: title.trim(), outline, segments }
    navigate('/', { state: { attachedScript: JSON.stringify(script) } })
  }

  const handleCompose = async () => {
    if (segments.length === 0) {
      toast.warning('请先生成文案再生成视频')
      return
    }

    setComposing(true)
    try {
      const ready = await composeApi.ready()
      if (!ready.ready) {
        toast.warning(ready.hint || '自动成片依赖未就绪')
        return
      }

      let id = scriptId
      const payload = buildPayload()
      if (id) {
        await scriptApi.update(id, payload)
      } else {
        const created = await scriptApi.save(payload)
        id = created.id
        setScriptId(created.id)
      }

      if (!id) throw new Error('Missing script id')
      await composeApi.fromScript(id, withScene)
      toast.success(withScene ? '已开始生成视频（含信息动画）' : '已开始生成视频')
      navigate('/')
    } catch (error: unknown) {
      toast.error(getRequestErrorMessage(error, '启动生成视频失败'))
    } finally {
      setComposing(false)
    }
  }

  const totalSeconds = segments.reduce((sum, segment) => sum + (segment.est_seconds || 0), 0)
  const hasSegments = segments.length > 0
  const hasOutline = Boolean(outline)

  return (
    <main className="min-h-[calc(100svh-3.5rem)] bg-[var(--workspace-background)]">
      <div className="mx-auto w-full max-w-[1360px] px-4 pt-4 sm:px-6 lg:px-8">
        <SecondaryPageNavigation
          backTo="/scripts"
          backLabel="文案库"
          items={[{ label: '文案库', to: '/scripts' }, { label: scriptId ? '编辑文案' : '新建文案' }]}
        />
      </div>

      <div className="sticky top-0 z-40 mt-2 border-b border-border/70 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/88">
        <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
            <Icon icon={documentTextLinear} className="size-5" />
          </span>
          <div className="mr-auto min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">文案编辑</h1>
              <Badge variant="secondary" className="border-0 font-normal">
                {scriptId ? '已存文案' : '新文案'}
              </Badge>
            </div>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">选题、结构与分镜在同一个工作区完成</p>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex h-9 cursor-pointer items-center gap-2 rounded-[10px] bg-secondary px-3 text-xs text-secondary-foreground">
                  <Switch checked={withScene} onCheckedChange={setWithScene} aria-label="生成信息动画" />
                  信息动画
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 leading-5">
                为每句生成关键词、图标和步骤动画；关闭后仅生成字幕，出片更快。
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button type="button" variant="outline" size="sm" disabled={!hasOutline || saving} onClick={() => void handleSave()}>
            <Icon icon={saving ? restartCircleLinear : disketteLinear} className={saving ? 'motion-safe:animate-spin' : undefined} />
            {saving ? '保存中' : scriptId ? '更新' : '保存'}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasSegments} onClick={handleUseForClip}>
            <Icon icon={scissorsLinear} />
            剪辑视频
          </Button>
          <Button type="button" size="sm" disabled={!hasSegments || composing} onClick={() => void handleCompose()}>
            <Icon
              icon={composing ? restartCircleLinear : videoFramePlayHorizontalBold}
              className={composing ? 'motion-safe:animate-spin' : 'text-white'}
            />
            {composing ? '正在生成' : '生成视频'}
          </Button>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1360px] items-start gap-5 px-4 py-6 sm:px-6 md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)] lg:px-8 lg:py-8 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <Card className="shadow-none">
            <CardHeader className="pb-5">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">创作设置</CardTitle>
                <span className="text-xs text-muted-foreground">01 / 03</span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">明确这篇内容要讲什么，以及讲给谁听。</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="script-title">选题标题</Label>
                <Input
                  id="script-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="输入本期内容主题"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-angle">切入角度</Label>
                <Textarea
                  id="script-angle"
                  value={angle}
                  onChange={(event) => setAngle(event.target.value)}
                  placeholder="这条内容具体讲什么"
                  className="min-h-20 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-audience">目标观众</Label>
                <Input
                  id="script-audience"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  placeholder="这条内容要讲给谁听"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="script-duration">目标时长</Label>
                  <div className="relative">
                    <Input
                      id="script-duration"
                      type="number"
                      min={10}
                      max={600}
                      value={duration}
                      onChange={(event) => setDuration(Number(event.target.value) || 60)}
                      className="pr-10 tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">秒</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="script-style">表达风格</Label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger id="script-style" className="rounded-xl border-transparent bg-muted dark:bg-input/30">
                      <SelectValue placeholder="选择风格" />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant={hasOutline ? 'secondary' : 'default'}
                  disabled={loadingOutline}
                  onClick={() => void handleGenerateOutline()}
                >
                  <Icon
                    icon={loadingOutline ? restartCircleLinear : lightbulbLinear}
                    className={loadingOutline ? 'motion-safe:animate-spin' : undefined}
                  />
                  {loadingOutline ? '生成中' : hasOutline ? '重做大纲' : '生成大纲'}
                </Button>
                <Button
                  type="button"
                  variant={hasOutline && !hasSegments ? 'default' : 'secondary'}
                  disabled={!hasOutline || loadingScript}
                  onClick={() => void handleGenerateScript()}
                >
                  <Icon
                    icon={loadingScript ? restartCircleLinear : documentTextBold}
                    className={loadingScript ? 'motion-safe:animate-spin' : undefined}
                  />
                  {loadingScript ? '生成中' : hasSegments ? '重写文案' : '生成文案'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="pb-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CardTitle className="text-base">内容大纲</CardTitle>
                  <span className="text-xs text-muted-foreground">02 / 03</span>
                </div>
                {outline && (
                  <Badge variant="secondary" className="border-0 font-normal tabular-nums">
                    {outline.sections.length + 2} 个板块
                  </Badge>
                )}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">先确定叙事结构，再展开完整分镜。</p>
            </CardHeader>
            <CardContent>
              {loadingOutline ? (
                <div className="space-y-4" aria-label="正在生成大纲">
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                </div>
              ) : outline ? (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="outline-hook">开头钩子</Label>
                      <span className="text-[11px] text-muted-foreground">HOOK</span>
                    </div>
                    <Textarea
                      id="outline-hook"
                      value={outline.hook}
                      onChange={(event) => updateHook(event.target.value)}
                      className="min-h-24 resize-none"
                    />
                  </div>

                  <Separator />
                  <div className="space-y-4">
                    <Label>正文要点</Label>
                    {outline.sections.map((section, index) => (
                      <div key={index} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
                        <span className="mt-2 flex size-6 items-center justify-center rounded-full bg-secondary text-[11px] font-medium tabular-nums text-muted-foreground">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="space-y-2">
                          <Input
                            value={section.point}
                            onChange={(event) => updateSection(index, 'point', event.target.value)}
                            placeholder={`要点 ${index + 1}`}
                            className="font-medium"
                            aria-label={`正文要点 ${index + 1}`}
                          />
                          <Textarea
                            value={section.detail}
                            onChange={(event) => updateSection(index, 'detail', event.target.value)}
                            placeholder="补充这一部分的表达重点"
                            className="min-h-20 resize-none"
                            aria-label={`正文要点 ${index + 1} 详情`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="outline-cta">结尾号召</Label>
                      <span className="text-[11px] text-muted-foreground">CTA</span>
                    </div>
                    <Textarea
                      id="outline-cta"
                      value={outline.cta}
                      onChange={(event) => updateCta(event.target.value)}
                      className="min-h-24 resize-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    <Icon icon={lightbulbLinear} className="size-5" />
                  </span>
                  <p className="mt-4 text-sm font-medium">从创作设置开始</p>
                  <p className="mt-1.5 max-w-56 text-xs leading-5 text-muted-foreground">填写标题后生成大纲，这里会出现可编辑的内容结构。</p>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <Card className="min-h-[720px] overflow-hidden shadow-none">
          <CardHeader className="border-b border-border/70 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <CardTitle className="text-lg">分镜文案</CardTitle>
                  <span className="text-xs text-muted-foreground">03 / 03</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">逐段调整口播内容、画面提示和节奏。</p>
              </div>
              {hasSegments && (
                <div className="flex items-center gap-3 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
                  <span>{segments.length} 个镜头</span>
                  <span className="h-3 w-px bg-border" />
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Icon icon={clockCircleLinear} className="size-3.5" />
                    约 {totalSeconds} 秒
                  </span>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loadingScript ? (
              <div className="space-y-0 divide-y divide-border/70" aria-label="正在生成文案">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="space-y-4 p-6 sm:p-7">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-7 w-12 rounded-full" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-10 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : hasSegments ? (
              <div className="divide-y divide-border/70">
                {segments.map((segment, index) => (
                  <article key={`${segment.index}-${index}`} className="p-6 sm:p-7">
                    <div className="mb-4 flex flex-wrap items-center gap-2.5">
                      <Badge variant="secondary" className="border-0 font-normal tabular-nums">
                        #{String(segment.index + 1).padStart(2, '0')}
                      </Badge>
                      <span className="text-sm font-medium">{ROLE_LABEL[segment.role]}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <Label htmlFor={`segment-duration-${index}`} className="text-xs font-normal text-muted-foreground">时长</Label>
                        <div className="relative w-[76px]">
                          <Input
                            id={`segment-duration-${index}`}
                            type="number"
                            min={0}
                            value={segment.est_seconds}
                            onChange={(event) => updateSegment(index, 'est_seconds', Number(event.target.value) || 0)}
                            className="h-8 rounded-[10px] py-1 pl-3 pr-7 text-xs tabular-nums"
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">秒</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Textarea
                        value={segment.narration}
                        onChange={(event) => updateSegment(index, 'narration', event.target.value)}
                        placeholder="输入这一镜的口播文案"
                        className="min-h-24 resize-y text-[15px] leading-7"
                        aria-label={`镜头 ${index + 1} 口播文案`}
                      />
                      <div className="relative">
                        <Icon
                          icon={videoFramePlayHorizontalLinear}
                          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          value={segment.visual}
                          onChange={(event) => updateSegment(index, 'visual', event.target.value)}
                          placeholder="补充画面、构图或动效建议"
                          className="pl-10 text-xs"
                          aria-label={`镜头 ${index + 1} 画面建议`}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[560px] flex-col items-center justify-center px-6 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                  <Icon icon={documentTextLinear} className="size-5" />
                </span>
                <h2 className="mt-5 text-base font-semibold">还没有分镜内容</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  完成左侧创作设置并生成大纲后，即可生成可直接编辑和成片的分镜文案。
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export default ScriptEditorPage
