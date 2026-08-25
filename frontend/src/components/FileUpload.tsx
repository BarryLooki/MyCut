import React, { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import closeCircleLinear from '@iconify-icons/solar/close-circle-linear'
import restartLinear from '@iconify-icons/solar/restart-linear'
import starsMinimalisticLinear from '@iconify-icons/solar/stars-minimalistic-linear'
import subtitlesLinear from '@iconify-icons/solar/subtitles-linear'
import uploadBold from '@iconify-icons/solar/upload-bold'
import uploadLinear from '@iconify-icons/solar/upload-linear'
import videoFrameBold from '@iconify-icons/solar/video-frame-bold'
import { useDropzone } from 'react-dropzone'
import { toast } from 'sonner'

import { cn } from '../lib/utils'
import { projectApi, VideoCategory } from '../services/api'
import { useProjectStore } from '../store/useProjectStore'
import { validateApiConfigBeforeProjectCreation } from '../utils/apiConfigCheck'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Progress } from './ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Separator } from './ui/separator'
import { Skeleton } from './ui/skeleton'

interface FileUploadProps {
  onUploadSuccess?: (projectId: string) => void
  attachedScript?: string
  variant?: 'default' | 'figma-home'
}

interface UploadError {
  code?: string
  message?: string
  userMessage?: string
  response?: {
    status?: number
    data?: { detail?: string }
  }
}

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess, attachedScript, variant = 'default' }) => {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [projectName, setProjectName] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [categories, setCategories] = useState<VideoCategory[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [files, setFiles] = useState<{ video?: File; srt?: File }>({})
  const { addProject } = useProjectStore()

  useEffect(() => {
    const loadCategories = async () => {
      setLoadingCategories(true)
      try {
        const response = await projectApi.getVideoCategories()
        setCategories(response.categories)
        if (response.default_category) setSelectedCategory(response.default_category)
        else if (response.categories.length > 0) setSelectedCategory(response.categories[0].value)
      } catch (error) {
        console.error('Failed to load video categories:', error)
        toast.error('加载视频分类失败')
      } finally {
        setLoadingCategories(false)
      }
    }

    void loadCategories()
  }, [])

  const onDrop = (acceptedFiles: File[]) => {
    const nextFiles = { ...files }

    acceptedFiles.forEach((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(extension || '')) {
        nextFiles.video = file
        setProjectName(file.name.replace(/\.[^/.]+$/, ''))
      } else if (extension === 'srt') {
        nextFiles.srt = file
      }
    })

    setFiles(nextFiles)
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.avi', '.mov', '.mkv', '.webm'],
      'application/x-subrip': ['.srt'],
    },
    multiple: true,
    disabled: uploading,
    noClick: true,
    noKeyboard: true,
  })

  const handleUpload = async () => {
    if (!files.video) {
      toast.error('请选择视频文件')
      return
    }
    if (!projectName.trim()) {
      toast.error('请输入项目名称')
      return
    }

    const hasValidApiConfig = await validateApiConfigBeforeProjectCreation()
    if (!hasValidApiConfig) return

    setUploading(true)
    setUploadProgress(0)
    let progressInterval: number | undefined

    try {
      progressInterval = window.setInterval(() => {
        setUploadProgress((currentProgress) => {
          if (currentProgress >= 85) return currentProgress
          const increment = Math.max(1, Math.floor((90 - currentProgress) / 10))
          return currentProgress + increment
        })
      }, 300)

      const newProject = await projectApi.uploadFiles({
        video_file: files.video,
        srt_file: files.srt,
        project_name: projectName.trim(),
        video_category: selectedCategory,
        script_json: attachedScript,
      })

      if (progressInterval) window.clearInterval(progressInterval)
      setUploadProgress(100)
      addProject(newProject)
      toast.success('项目创建成功，正在后台处理')

      setFiles({})
      setProjectName('')
      setUploadProgress(0)
      if (categories.length > 0) setSelectedCategory(categories[0].value)
      onUploadSuccess?.(newProject.id)
    } catch (rawError) {
      const error = rawError as UploadError
      console.error('上传失败，详细错误:', error)

      let errorMessage = '上传失败，请重试'
      let warning = false

      if (error.response?.status === 413) {
        errorMessage = '文件太大，请选择较小的视频文件'
        warning = true
      } else if (error.response?.status === 415) {
        errorMessage = '不支持该文件格式，请使用 MP4、AVI、MOV、MKV 或 WebM'
        warning = true
      } else if (error.response?.status === 400) {
        errorMessage = error.response.data?.detail || '文件格式或内容有问题，请检查后重试'
      } else if (error.response?.status === 500) {
        errorMessage = '服务器处理文件时出错，请稍后重试'
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = '上传超时，请检查网络连接后重试'
      } else {
        errorMessage = error.response?.data?.detail || error.userMessage || error.message || errorMessage
      }

      if (warning) toast.warning(errorMessage)
      else toast.error(errorMessage)

      if (error.code === 'ECONNABORTED' || (error.response?.status || 0) >= 500) {
        toast.info('如果问题持续存在，请检查网络连接或联系技术支持')
      }
    } finally {
      if (progressInterval) window.clearInterval(progressInterval)
      setUploading(false)
    }
  }

  const removeFile = (type: 'video' | 'srt') => {
    setFiles((currentFiles) => {
      const nextFiles = { ...currentFiles }
      delete nextFiles[type]
      return nextFiles
    })
    if (type === 'video') setProjectName('')
  }

  if (!files.video) {
    if (variant === 'figma-home') {
      return (
        <div
          {...getRootProps()}
          className={cn(
            'h-[183px] w-full overflow-hidden rounded-[24px] border border-black/[0.08] bg-background p-[7px] transition-colors dark:border-white/10',
            isDragActive && 'border-primary/55 bg-[var(--brand-soft)]',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} />
          <Button
            type="button"
            variant="ghost"
            onClick={open}
            disabled={uploading}
            className="flex h-[167px] w-full flex-col gap-0 rounded-[16px] border border-dashed border-black/[0.12] bg-[#fcfcfc] px-6 py-0 hover:bg-muted/45 dark:border-white/12 dark:bg-card dark:hover:bg-muted/55"
          >
            <span className="brand-gradient flex size-11 items-center justify-center rounded-full text-white shadow-[0_8px_22px_rgb(255_107_166/0.2)]">
              <Icon icon={uploadBold} className="size-5 text-white" />
            </span>
            <span className="mt-4 text-[19px] font-semibold leading-none text-foreground">
              {isDragActive ? '松开以上传素材' : '上传本地视频，AI 自动剪辑'}
            </span>
            <span className="mt-[9px] whitespace-normal text-center text-sm font-normal leading-5 text-foreground/40">
              支持 MP4、MOV、AVI、MKV、WebM，可导入 SRT 字幕或交由 AI 自动生成
            </span>
          </Button>
        </div>
      )
    }

    return (
      <div
        {...getRootProps()}
        className={cn(
          'flex min-h-[17rem] w-full flex-col items-center justify-center rounded-[16px] bg-muted/55 px-6 py-9 text-center transition-colors',
          isDragActive && 'bg-muted/85',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <input {...getInputProps()} />
        <Icon icon={uploadLinear} className="size-7 text-muted-foreground" />
        <h3 className="mt-4 text-base font-semibold tracking-[-0.015em]">
          {isDragActive ? '松开以上传素材' : '拖入视频素材'}
        </h3>
        <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
          支持 MP4、MOV、AVI、MKV、WebM，可同时导入 SRT 字幕。
        </p>
        <Button type="button" className="mt-5" onClick={open} disabled={uploading}>
          <Icon icon={uploadBold} className="size-4 text-white" />
          选择视频
        </Button>
        <span className="mt-3 text-xs text-muted-foreground">单个文件建议不超过 2 GB</span>
      </div>
    )
  }

  return (
    <div {...getRootProps()} className={cn('space-y-5', isDragActive && 'rounded-[16px] bg-muted/35 p-2')}>
      <input {...getInputProps()} />

      <div className="overflow-hidden rounded-[16px] bg-muted/55">
        <div className="flex items-center gap-3 p-4">
          <Icon icon={videoFrameBold} className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{files.video.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{(files.video.size / 1024 / 1024).toFixed(2)} MB · 视频素材</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={open} disabled={uploading}>更换</Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeFile('video')} disabled={uploading} aria-label="移除视频">
            <Icon icon={closeCircleLinear} />
          </Button>
        </div>
        <Separator />
        <div className="flex items-center gap-3 p-4">
          <Icon icon={files.srt ? subtitlesLinear : starsMinimalisticLinear} className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{files.srt ? files.srt.name : '自动生成字幕'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{files.srt ? 'SRT 字幕文件已准备' : '未添加字幕时将使用 AI 语音识别'}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={open} disabled={uploading}>{files.srt ? '更换' : '添加字幕'}</Button>
          {files.srt && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeFile('srt')} disabled={uploading} aria-label="移除字幕">
              <Icon icon={closeCircleLinear} />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="project-name">项目名称</Label>
          <Input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="输入项目名称" disabled={uploading} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="video-category">视频分类</Label>
          {loadingCategories ? (
            <Skeleton className="h-10 w-full rounded-xl" />
          ) : (
            <Select value={selectedCategory} onValueChange={setSelectedCategory} disabled={uploading}>
              <SelectTrigger id="video-category" className="w-full" aria-label="选择视频分类">
                <SelectValue placeholder="选择视频分类" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.value} value={category.value}>{category.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {uploading && (
        <div className="space-y-2.5 rounded-[16px] bg-muted/60 p-4" role="status">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Icon icon={restartLinear} className="size-4 animate-spin" />
              正在上传并创建项目
            </span>
            <span className="tabular-nums text-muted-foreground">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} />
        </div>
      )}

      <Separator />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">创建后将在后台自动分析、生成字幕并切片。</p>
        <Button type="button" onClick={() => void handleUpload()} disabled={uploading || !projectName.trim()} className="w-full sm:w-auto">
          <Icon icon={uploadBold} className={cn('size-4 text-white', uploading && 'animate-pulse')} />
          {uploading ? '正在创建项目' : '开始导入并处理'}
        </Button>
      </div>
    </div>
  )
}

export default FileUpload
