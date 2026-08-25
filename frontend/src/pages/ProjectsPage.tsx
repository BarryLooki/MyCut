import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import folderOpenLinear from '@iconify-icons/solar/folder-open-linear'
import magniferLinear from '@iconify-icons/solar/magnifer-linear'
import uploadBold from '@iconify-icons/solar/upload-bold'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import ProjectCard from '@/components/ProjectCard'
import WorkspacePageHeader from '@/components/WorkspacePageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectPolling } from '@/hooks/useProjectPolling'
import { projectApi } from '@/services/api'
import { useSimpleProgressStore } from '@/stores/useSimpleProgressStore'
import type { Project } from '@/store/useProjectStore'
import { useProjectStore } from '@/store/useProjectStore'

type ProjectFilter = 'all' | 'active' | 'completed' | 'failed'

const FILTER_OPTIONS: { value: ProjectFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '处理中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
]

const ProjectSkeleton = () => (
  <Card className="overflow-hidden shadow-none">
    <Skeleton className="aspect-video w-full rounded-none" />
    <CardContent className="space-y-4 p-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
      <Skeleton className="h-8 w-full rounded-xl" />
      <div className="flex items-center justify-between border-t pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-20 rounded-xl" />
      </div>
    </CardContent>
  </Card>
)

const ProjectsPage = () => {
  const navigate = useNavigate()
  const { projects, setProjects, deleteProject } = useProjectStore()
  const [loading, setLoading] = useState(projects.length === 0)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<ProjectFilter>('all')

  useProjectPolling({
    onProjectsUpdate: (updatedProjects) => {
      setProjects(updatedProjects || [])
      setLoading(false)
    },
    enabled: true,
    interval: 30000,
  })

  useEffect(() => {
    const hasActive = projects.some((project) => (
      project.status === 'processing' || project.status === 'pending'
    ))

    if (!hasActive) {
      try {
        const { stopPolling, clearAllProgress } = useSimpleProgressStore.getState()
        stopPolling()
        clearAllProgress()
      } catch (error) {
        console.warn('停止全局进度轮询时出现问题:', error)
      }
    }
  }, [projects])

  useEffect(() => {
    const loadProjects = async () => {
      setLoading(true)
      try {
        const response = await projectApi.getProjects()
        setProjects(Array.isArray(response) ? response : [])
      } catch (error) {
        toast.error('加载项目失败')
        console.error('Load projects error:', error)
      } finally {
        setLoading(false)
      }
    }

    void loadProjects()
  }, [setProjects])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase()

    return [...projects]
      .filter((project) => {
        const matchesQuery = !normalizedQuery || [project.name, project.description, project.video_category]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)

        if (!matchesQuery) return false
        if (filter === 'active') return project.status === 'pending' || project.status === 'processing'
        if (filter === 'completed') return project.status === 'completed'
        if (filter === 'failed') return project.status === 'failed' || project.status === 'error'
        return true
      })
      .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
  }, [filter, projects, searchQuery])

  const projectCounts = useMemo(() => ({
    all: projects.length,
    active: projects.filter((project) => project.status === 'pending' || project.status === 'processing').length,
    completed: projects.filter((project) => project.status === 'completed').length,
    failed: projects.filter((project) => project.status === 'failed' || project.status === 'error').length,
  }), [projects])

  const handleDeleteProject = async (id: string) => {
    try {
      await projectApi.deleteProject(id)
      deleteProject(id)
      toast.success('项目已删除')
    } catch (error) {
      toast.error('删除项目失败')
      console.error('Delete project error:', error)
    }
  }

  const handleRetryProject = async () => {
    try {
      const response = await projectApi.getProjects()
      setProjects(Array.isArray(response) ? response : [])
      toast.success('已重新开始处理项目')
    } catch {
      toast.error('刷新项目状态失败')
    }
  }

  const handleProjectClick = (project: Project) => {
    if (project.status === 'pending') {
      toast.warning('项目正在导入中，请稍后再查看详情')
      return
    }
    navigate(`/project/${project.id}`)
  }

  return (
    <main className="min-h-[calc(100svh-3.5rem)] bg-[var(--workspace-background)] px-4 pb-16 pt-16 sm:px-6 lg:px-8 lg:pb-20">
      <div className="mx-auto w-full max-w-[1240px]">
        <WorkspacePageHeader
          eyebrow="项目工作区"
          title="项目"
          description="查看处理状态，继续最近的剪辑工作。"
          titleAddon={!loading && <Badge variant="secondary" className="border-0 font-normal tabular-nums">{projects.length}</Badge>}
        >
          <Button type="button" size="lg" className="self-start sm:self-auto" onClick={() => navigate('/', { state: { focusUpload: true } })}>
            <Icon icon={uploadBold} className="text-white" />
            新建项目
          </Button>
        </WorkspacePageHeader>

        <div className="mt-7 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="筛选项目状态">
            {FILTER_OPTIONS.map((option) => {
              const active = filter === option.value
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={active ? 'secondary' : 'ghost'}
                  className={active ? 'bg-secondary' : 'text-muted-foreground'}
                  onClick={() => setFilter(option.value)}
                  aria-pressed={active}
                >
                  {option.label}
                  <span className="tabular-nums text-muted-foreground">{projectCounts[option.value]}</span>
                </Button>
              )
            })}
          </div>

          <div className="relative w-full lg:w-[300px]">
            <Icon icon={magniferLinear} className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
              className="pl-10"
            />
          </div>
        </div>

        <section className="mt-5" aria-label="项目列表">
          {loading ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <ProjectSkeleton />
              <ProjectSkeleton />
              <ProjectSkeleton />
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDeleteProject}
                  onRetry={handleRetryProject}
                  onClick={() => handleProjectClick(project)}
                />
              ))}
            </div>
          ) : projects.length > 0 ? (
            <Card className="shadow-none">
              <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon icon={magniferLinear} className="size-5" />
                </span>
                <h2 className="mt-4 text-base font-semibold">没有找到匹配的项目</h2>
                <p className="mt-2 text-sm text-muted-foreground">调整状态筛选或换一个搜索关键词。</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-5"
                  onClick={() => {
                    setFilter('all')
                    setSearchQuery('')
                  }}
                >
                  清除筛选
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-none">
              <CardContent className="flex min-h-[460px] flex-col items-center justify-center px-6 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                  <Icon icon={folderOpenLinear} className="size-5" />
                </span>
                <h2 className="mt-5 text-base font-semibold">还没有剪辑项目</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">上传一段视频素材，创建你的第一个 AI 剪辑项目。</p>
                <Button className="mt-5" onClick={() => navigate('/', { state: { focusUpload: true } })}>
                  <Icon icon={uploadBold} className="text-white" />
                  上传素材
                </Button>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  )
}

export default ProjectsPage
