import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import addCircleBold from '@iconify-icons/solar/add-circle-bold'
import clapperboardLinear from '@iconify-icons/solar/clapperboard-linear'
import clockCircleLinear from '@iconify-icons/solar/clock-circle-linear'
import galleryWideLinear from '@iconify-icons/solar/gallery-wide-linear'
import layersLinear from '@iconify-icons/solar/layers-linear'
import playCircleBold from '@iconify-icons/solar/play-circle-bold'
import videoLibraryLinear from '@iconify-icons/solar/video-library-linear'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import ClipCard from '@/components/ClipCard'
import CollectionCard from '@/components/CollectionCard'
import CollectionPreviewModal from '@/components/CollectionPreviewModal'
import CreateCollectionModal from '@/components/CreateCollectionModal'
import { ProjectTaskManager } from '@/components/ProjectTaskManager'
import SecondaryPageNavigation from '@/components/SecondaryPageNavigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCollectionVideoDownload } from '@/hooks/useCollectionVideoDownload'
import { cn } from '@/lib/utils'
import { projectApi } from '@/services/api'
import { Clip, Collection, useProjectStore } from '@/store/useProjectStore'

const parseTime = (time: string) => {
  const parts = time.replace(',', '.').split(':')
  if (parts.length !== 3) return 0
  return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0)
}

const formatDuration = (seconds: number) => {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remaining = rounded % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

const formatUpdatedAt = (value?: string) => {
  if (!value) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const STATUS_LABELS = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '处理失败',
  error: '处理失败',
} as const

const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    currentProject,
    setCurrentProject,
    upsertProject,
    updateCollection,
    addCollection,
    deleteCollection,
    removeClipFromCollection,
    reorderCollectionClips,
    addClipToCollection,
  } = useProjectStore()

  const [statusLoading, setStatusLoading] = useState(false)
  const [showCreateCollection, setShowCreateCollection] = useState(false)
  const [sortBy, setSortBy] = useState<'time' | 'score'>('score')
  const [showCollectionDetail, setShowCollectionDetail] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const loadErrorNotified = useRef(false)
  const { generateAndDownloadCollectionVideo } = useCollectionVideoDownload()

  useEffect(() => {
    loadErrorNotified.current = false
    setPageError(null)
    setPageLoading(true)
    if (!id) {
      setPageError('缺少项目 ID。')
      setPageLoading(false)
      return
    }
    void loadProject()
    void loadProcessingStatus()
  }, [id])

  const loadProject = async () => {
    if (!id) return
    try {
      const project = await projectApi.getProject(id)

      if (project.status === 'completed') {
        try {
          const [clips, collections] = await Promise.all([
            projectApi.getClips(id),
            projectApi.getCollections(id),
          ])
          const projectWithData = {
            ...project,
            clips: clips || [],
            collections: collections || [],
          }
          setCurrentProject(projectWithData)
          upsertProject(projectWithData)
        } catch (loadError) {
          console.error('Failed to load clips/collections:', loadError)
          setCurrentProject(project)
        }
      } else {
        setCurrentProject(project)
      }
    } catch (loadError) {
      console.error('Failed to load project:', loadError)
      setPageError('没有找到这个项目，或当前连接暂时不可用。')
      if (!loadErrorNotified.current) {
        loadErrorNotified.current = true
        toast.error('加载项目失败')
      }
    } finally {
      setPageLoading(false)
    }
  }

  const loadProcessingStatus = async () => {
    if (!id) return
    setStatusLoading(true)
    try {
      await projectApi.getProcessingStatus(id)
    } catch (statusError) {
      console.error('Failed to load processing status:', statusError)
    } finally {
      setStatusLoading(false)
    }
  }

  const handleStartProcessing = async () => {
    if (!id) return
    try {
      await projectApi.startProcessing(id)
      toast.success('项目已开始处理')
      await loadProcessingStatus()
    } catch (startError) {
      console.error('Failed to start processing:', startError)
      toast.error('启动处理失败')
    }
  }

  const handleCreateCollection = async (title: string, summary: string, clipIds: string[]) => {
    if (!id) return
    try {
      await addCollection(id, {
        id: `collection_${Date.now()}`,
        collection_title: title,
        collection_summary: summary,
        clip_ids: clipIds,
        collection_type: 'manual',
        created_at: new Date().toISOString(),
      })
      setShowCreateCollection(false)
      toast.success('合集创建成功')
    } catch (createError) {
      console.error('Failed to create collection:', createError)
      toast.error('创建合集失败')
    }
  }

  const handleRemoveClipFromCollection = async (collectionId: string, clipId: string) => {
    if (!id) return
    try {
      await removeClipFromCollection(id, collectionId, clipId)
      toast.success('片段已从合集中移除')
    } catch (removeError) {
      console.error('Failed to remove clip from collection:', removeError)
      toast.error('移除片段失败')
    }
  }

  const handleDeleteCollection = async (collectionId: string) => {
    if (!id) return
    try {
      await deleteCollection(id, collectionId)
      setShowCollectionDetail(false)
      setSelectedCollection(null)
      toast.success('合集已删除')
    } catch (deleteError) {
      console.error('Failed to delete collection:', deleteError)
      toast.error('删除合集失败')
    }
  }

  const handleReorderCollectionClips = async (collectionId: string, newClipIds: string[]) => {
    if (!id) return
    try {
      await reorderCollectionClips(id, collectionId, newClipIds)
      toast.success('合集顺序已更新')
    } catch (reorderError) {
      console.error('Failed to reorder collection clips:', reorderError)
      toast.error('更新合集顺序失败')
    }
  }

  const handleAddClipToCollection = async (collectionId: string, clipIds: string[]) => {
    if (!id) return
    try {
      await addClipToCollection(id, collectionId, clipIds)
      toast.success('片段已添加到合集')
    } catch (addError) {
      console.error('Failed to add clip to collection:', addError)
      toast.error('添加片段失败')
    }
  }

  const sortedClips = useMemo(() => {
    const clips = [...(currentProject?.clips || [])]
    return clips.sort((a, b) => {
      if (sortBy === 'score') return b.final_score - a.final_score
      return parseTime(a.start_time) - parseTime(b.start_time)
    })
  }, [currentProject?.clips, sortBy])

  const sortedCollections = useMemo(
    () => [...(currentProject?.collections || [])].sort((a, b) => {
      const first = a.created_at ? new Date(a.created_at).getTime() : 0
      const second = b.created_at ? new Date(b.created_at).getTime() : 0
      return second - first
    }),
    [currentProject?.collections],
  )

  const totalDuration = useMemo(
    () => (currentProject?.clips || []).reduce(
      (sum, clip) => sum + Math.max(0, parseTime(clip.end_time) - parseTime(clip.start_time)),
      0,
    ),
    [currentProject?.clips],
  )

  if (pageLoading) {
    return (
      <main className="min-h-svh bg-background px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <SecondaryPageNavigation
            backTo="/projects"
            backLabel="我的项目"
          />
          <div className="space-y-3">
            <Skeleton className="h-7 w-80" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-24 rounded-[20px]" />
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="aspect-[4/3] rounded-[20px]" />)}
          </div>
        </div>
      </main>
    )
  }

  if (pageError || !currentProject || currentProject.id !== id) {
    return (
      <main className="min-h-svh bg-background px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <SecondaryPageNavigation
            backTo="/projects"
            backLabel="我的项目"
          />
          <Alert variant="destructive" className="rounded-[20px]">
            <AlertTitle>项目加载失败</AlertTitle>
            <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-4">
              <span>{pageError || '没有找到这个项目。'}</span>
              <Button variant="secondary" size="sm" onClick={() => navigate('/projects')}>返回我的项目</Button>
            </AlertDescription>
          </Alert>
        </div>
      </main>
    )
  }

  const clips = currentProject.clips || []
  const collections = currentProject.collections || []
  const isCompleted = currentProject.status === 'completed'
  const isFailed = currentProject.status === 'failed' || currentProject.status === 'error'
  const displayProjectName = currentProject.name.replace(/^成片(?:\s*[：:]\s*)?/, '').trim() || currentProject.name

  return (
    <main className="min-h-svh bg-background px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
      <div className="mx-auto max-w-7xl">
        <SecondaryPageNavigation
          backTo="/projects"
          backLabel="我的项目"
          className="mb-6"
        />

        <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">项目</span>
              <Badge variant="secondary" className="gap-1.5 rounded-lg px-2 py-1 font-normal">
                <span className={cn('size-1.5 rounded-full', isCompleted ? 'bg-emerald-500' : isFailed ? 'bg-destructive' : 'bg-primary')} />
                {STATUS_LABELS[currentProject.status]}
              </Badge>
            </div>
            <h1 className="max-w-3xl truncate text-2xl font-semibold tracking-[-0.025em] sm:text-[1.75rem]">
              {displayProjectName}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              管理 AI 精选片段，组合合集并继续完成视频。
            </p>
          </div>

          {currentProject.status === 'pending' ? (
            <Button onClick={() => void handleStartProcessing()} disabled={statusLoading}>
              <Icon icon={playCircleBold} className="size-4 text-white" />
              {statusLoading ? '正在启动' : '开始处理'}
            </Button>
          ) : isCompleted ? (
            <Button onClick={() => setShowCreateCollection(true)}>
              <Icon icon={addCircleBold} className="size-4 text-white" />
              创建合集
            </Button>
          ) : null}
        </header>

        <Card className="mb-9 border-0 bg-muted/70 shadow-none">
          <CardContent className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-background text-foreground shadow-sm">
                <Icon icon={clapperboardLinear} className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">素材概览</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  最近更新于 {formatUpdatedAt(currentProject.updated_at)}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 divide-x divide-border/80 sm:min-w-[420px]">
              <div className="px-4 first:pl-0 sm:first:pl-4">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon icon={videoLibraryLinear} />片段</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{clips.length}</dd>
              </div>
              <div className="px-4">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon icon={layersLinear} />合集</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{collections.length}</dd>
              </div>
              <div className="px-4 pr-0">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon icon={clockCircleLinear} />总时长</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{formatDuration(totalDuration)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {isCompleted ? (
          <div className="space-y-10">
            {sortedCollections.length > 0 && (
              <section aria-labelledby="collections-heading">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 id="collections-heading" className="text-lg font-semibold tracking-[-0.015em]">视频合集</h2>
                    <p className="mt-1 text-sm text-muted-foreground">将多个精彩片段编排成可以发布的成片。</p>
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">{collections.length} 个合集</span>
                </div>
                <div className="collections-scroll-container flex gap-5 overflow-x-auto pb-3">
                  {sortedCollections.map((collection) => (
                    <CollectionCard
                      key={collection.id}
                      collection={collection}
                      clips={clips}
                      onView={(item) => {
                        setSelectedCollection(item)
                        setShowCollectionDetail(true)
                      }}
                      onUpdate={(collectionId, updates) => updateCollection(currentProject.id, collectionId, updates)}
                      onGenerateVideo={async (collectionId) => {
                        const item = collections.find((collectionItem) => collectionItem.id === collectionId)
                        if (item) {
                          await generateAndDownloadCollectionVideo(currentProject.id, collectionId, item.collection_title)
                        }
                      }}
                      onDelete={handleDeleteCollection}
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="clips-heading">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="clips-heading" className="text-lg font-semibold tracking-[-0.015em]">精选片段</h2>
                  <p className="mt-1 text-sm text-muted-foreground">AI 根据内容完整度、节奏和信息价值生成的候选片段。</p>
                </div>
                <div className="flex rounded-xl bg-muted p-1" aria-label="片段排序方式">
                  {(['time', 'score'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortBy(value)}
                      className={cn(
                        'h-8 rounded-[9px] px-3.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                        sortBy === value && 'bg-background text-foreground shadow-sm',
                      )}
                      aria-pressed={sortBy === value}
                    >
                      {value === 'time' ? '按时间' : '按评分'}
                    </button>
                  ))}
                </div>
              </div>

              {sortedClips.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {sortedClips.map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      projectId={currentProject.id}
                      videoUrl={projectApi.getClipVideoUrl(currentProject.id, clip.id, clip.title || clip.generated_title)}
                      onDownload={(clipId) => projectApi.downloadVideo(currentProject.id, clipId)}
                      onClipUpdate={(clipId: string, updates: Partial<Clip>) => {
                        const updatedProject = {
                          ...currentProject,
                          clips: clips.map((item) => item.id === clipId ? { ...item, ...updates } : item),
                        }
                        setCurrentProject(updatedProject)
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-[20px] bg-muted/65 px-6 text-center">
                  <span className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-background text-muted-foreground shadow-sm">
                    <Icon icon={galleryWideLinear} className="size-6" />
                  </span>
                  <p className="text-sm font-medium">还没有可用片段</p>
                  <p className="mt-1 text-xs text-muted-foreground">处理完成后，AI 生成的候选片段会出现在这里。</p>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-5">
            <Card>
              <CardContent className="p-5 sm:p-6">
                <ProjectTaskManager projectId={currentProject.id} projectName={displayProjectName} />
              </CardContent>
            </Card>
            <div className="flex min-h-48 flex-col items-center justify-center rounded-[20px] bg-muted/65 px-6 text-center">
              <Icon icon={clapperboardLinear} className="mb-3 size-7 text-muted-foreground" />
              <p className="text-sm font-medium">项目正在准备中</p>
              <p className="mt-1 text-xs text-muted-foreground">完成处理后即可查看片段、评分和合集。</p>
            </div>
          </div>
        )}
      </div>

      <CreateCollectionModal
        visible={showCreateCollection}
        clips={clips}
        onCancel={() => setShowCreateCollection(false)}
        onCreate={handleCreateCollection}
      />

      <CollectionPreviewModal
        visible={showCollectionDetail}
        collection={selectedCollection}
        clips={clips}
        projectId={currentProject.id}
        onClose={() => {
          setShowCollectionDetail(false)
          setSelectedCollection(null)
        }}
        onUpdateCollection={(collectionId, updates) => updateCollection(currentProject.id, collectionId, updates)}
        onRemoveClip={handleRemoveClipFromCollection}
        onReorderClips={handleReorderCollectionClips}
        onDelete={handleDeleteCollection}
        onAddClip={handleAddClipToCollection}
      />
    </main>
  )
}

export default ProjectDetailPage
