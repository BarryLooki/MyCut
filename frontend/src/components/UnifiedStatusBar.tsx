/**
 * 统一状态栏组件 - 替换旧的复杂进度系统
 * 支持下载中、处理中、完成等状态的统一显示
 */

import React, { useEffect, useState } from 'react'
import { Progress } from './ui/progress'
import { useSimpleProgressStore, getStageDisplayName, isCompleted, isFailed } from '../stores/useSimpleProgressStore'

interface UnifiedStatusBarProps {
  projectId: string
  status: string
  downloadProgress?: number
  onStatusChange?: (status: string) => void
  onDownloadProgressUpdate?: (progress: number) => void
}

export const UnifiedStatusBar: React.FC<UnifiedStatusBarProps> = ({
  projectId,
  status,
  downloadProgress = 0,
  onStatusChange,
  onDownloadProgressUpdate
}) => {
  const { getProgress, startPolling, stopPolling } = useSimpleProgressStore()
  const [isPolling, setIsPolling] = useState(false)
  const [currentDownloadProgress, setCurrentDownloadProgress] = useState(downloadProgress)
  
  const progress = getProgress(projectId)

  // 根据状态决定是否轮询
  useEffect(() => {
    // 如果已有进度且已到达终态，则不启动轮询
    if (progress && (isCompleted(progress.stage) || isFailed(progress.message))) {
      if (isPolling) {
        console.log(`进度已终态，停止轮询: ${projectId}`)
        stopPolling()
        setIsPolling(false)
      }
      return
    }

    if ((status === 'processing' || status === 'pending') && !isPolling) {
      console.log(`开始轮询处理进度: ${projectId}`)
      startPolling([projectId], 5000) // 5秒轮询一次，减少频繁请求
      setIsPolling(true)
    } else if (status !== 'processing' && status !== 'pending' && isPolling) {
      console.log(`停止轮询处理进度: ${projectId}`)
      stopPolling()
      setIsPolling(false)
    }

    return () => {
      if (isPolling) {
        console.log(`清理轮询: ${projectId}`)
        stopPolling()
        setIsPolling(false)
      }
    }
  }, [status, projectId, isPolling, startPolling, stopPolling, progress])

  // 下载进度轮询
  useEffect(() => {
    if (status === 'downloading') {
      const pollDownloadProgress = async () => {
        try {
          console.log(`轮询下载进度: ${projectId}`)
          const response = await fetch(`/api/v1/projects/${projectId}`)
          if (response.ok) {
            const projectData = await response.json()
            console.log('项目数据:', projectData)
            const newProgress = projectData.processing_config?.download_progress || 0
            console.log(`下载进度更新: ${newProgress}%`)
            setCurrentDownloadProgress(newProgress)
            onDownloadProgressUpdate?.(newProgress)
            
            // 如果下载完成，检查是否需要切换到处理状态
            if (newProgress >= 100) {
              console.log('下载完成，切换到处理状态')
              setTimeout(() => {
                onStatusChange?.('processing')
              }, 1000)
            }
          } else {
            console.error('获取项目数据失败:', response.status, response.statusText)
          }
        } catch (error) {
          console.error('获取下载进度失败:', error)
        }
      }

      // 立即获取一次
      pollDownloadProgress()
      
      // 每5秒轮询一次，减少频繁请求
      const interval = setInterval(pollDownloadProgress, 5000)
      
      return () => clearInterval(interval)
    }
  }, [status, projectId, onDownloadProgressUpdate, onStatusChange])

  // 处理状态变化
  useEffect(() => {
    if (progress) {
      // 进度到达终态时，立刻停止轮询并同步状态
      if (isCompleted(progress.stage) || isFailed(progress.message)) {
        if (isPolling) {
          console.log(`进度达到终态，停止轮询: ${projectId}`)
          stopPolling()
          setIsPolling(false)
        }
        if (onStatusChange) {
          onStatusChange(isCompleted(progress.stage) ? 'completed' : 'failed')
        }
      }
    }
  }, [progress, onStatusChange])

  const ProgressRow = ({ label, percent }: { label: string; percent: number }) => (
    <div className="w-full">
      <Progress value={Math.max(0, Math.min(100, percent))} />
      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
      </div>
    </div>
  )

  const StatusRow = ({ label, failed = false }: { label: string; failed?: boolean }) => (
    <div className={`flex min-h-6 items-center gap-2 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${failed ? 'bg-destructive' : 'bg-foreground'}`} />
      <span>{label}</span>
    </div>
  )

  if (status === 'importing') return <ProgressRow label="导入中" percent={downloadProgress} />
  if (status === 'downloading') return <ProgressRow label="下载中" percent={currentDownloadProgress} />

  if (status === 'processing') {
    if (!progress) return <ProgressRow label="初始化中" percent={0} />
    const { stage, percent, message } = progress
    if (isFailed(message)) return <StatusRow label="处理失败" failed />
    return <ProgressRow label={getStageDisplayName(stage)} percent={percent} />
  }

  if (status === 'completed') return <StatusRow label="已完成" />
  if (status === 'failed') return <StatusRow label="处理失败" failed />

  // 等待
  return <StatusRow label="等待中" />
}

// 简化的进度条组件 - 用于详细进度显示
interface SimpleProgressDisplayProps {
  projectId: string
  status: string
  showDetails?: boolean
}

export const SimpleProgressDisplay: React.FC<SimpleProgressDisplayProps> = ({
  projectId,
  status,
  showDetails = false
}) => {
  const { getProgress } = useSimpleProgressStore()
  const progress = getProgress(projectId)

  if (status !== 'processing' || !progress || !showDetails) {
    return null
  }

  const { percent, message } = progress

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>处理进度</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <Progress value={percent} />
      {message && (
        <p className="text-xs text-muted-foreground">{message}</p>
      )}
    </div>
  )
}
