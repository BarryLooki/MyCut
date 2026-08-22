import React from 'react'
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion'
import { OverlaySide, Scene, SceneStage, SceneTheme } from './SceneStage'

/**
 * 上区视觉舞台——素材混剪路线的核心。
 *
 * 按每句的 visualType 决定上区画面来源：
 *   - 'video'         实拍/生成的视频素材（OffthreadVideo，cover 铺满 + 极缓推拉）
 *   - 'image-kenburns' 静图 + Ken Burns 缓慢推拉（"动的照片"，纪实感）
 *   - 'scene'         结构化信息动画（现有 SceneStage：关键词/步骤/箭头/对比）
 *   - null/未知        回退到 scene（有 scene 就渲，没有则由上层留暖底）
 *
 * 素材来源与 Remotion 解耦：不管素材来自素材库 / 生视频模型 / 静图库，
 * 到这里都只是一个 staticFile 相对路径（http(s)/data 原样用）。
 * 落地方式同 audioSrc：素材放 remotion/public/ 下，visualSrc 传相对路径。
 */

export type VisualType = 'video' | 'image-kenburns' | 'scene'

// visualSrc 是相对 remotion/public/ 的 staticFile 路径；http(s)/data 原样用
const resolveSrc = (src: string): string =>
  /^(https?:|data:)/.test(src) ? src : staticFile(src)

// —— 视频层：cover 铺满全屏 + 整段极缓慢放大（Ken Burns 味，避免死板静止）——
// span = 本片段时长（帧）。注意 useCurrentFrame 在 Sequence 内已是局部帧（从 0 起），
// 但 useVideoConfig().durationInFrames 是整条合成总时长，不能用来算单段推拉——必须用片段时长。
const VideoLayer: React.FC<{ src: string; span: number; volume: number }> = ({
  src,
  span,
  volume,
}) => {
  const frame = useCurrentFrame()
  // 1.0 → 1.06 极缓推近，克制不喧宾夺主
  const scale = interpolate(frame, [0, Math.max(1, span)], [1, 1.06], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <OffthreadVideo
        src={resolveSrc(src)}
        // 素材自带音轨（MiniMax H3 会输出与画面同步的原生立体声环境音）：
        //   volume=0 → muted，旁白独占声道（历史行为）
        //   0<volume<1 → 环境声垫在旁白下面，音画同源、更有现场感
        //   volume=1 → 素材声音全量（无 TTS 旁白时用）
        // 后端按 MINIMAX_AUDIO_MODE 决定传什么值，见 compose_service。
        {...(volume > 0 ? { volume } : { muted: true })}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  )
}

// —— 静图 Ken Burns：缓慢推拉 + 轻微平移，把静图变成有呼吸的镜头 ——
// span = 本片段时长（帧），同 VideoLayer，不能用整条合成总时长。
const ImageKenBurns: React.FC<{ src: string; span: number }> = ({ src, span }) => {
  const frame = useCurrentFrame()
  const scale = interpolate(frame, [0, Math.max(1, span)], [1.04, 1.14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // 轻微横向漂移（约 ±1.5% 画面宽），方向固定，确定可复现
  const translateX = interpolate(frame, [0, span], [-1.5, 1.5], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={resolveSrc(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translateX(${translateX}%)`,
        }}
      />
    </AbsoluteFill>
  )
}

export const VisualStage: React.FC<{
  visualType?: VisualType | null
  visualSrc?: string | null
  scene?: Scene | null
  theme: SceneTheme
  overlayTheme?: SceneTheme | null // 叠加组件专用 theme（accent 取自视频主色）；缺省用全局 theme
  overlaySide?: OverlaySide | null // 叠加组件落在哪一侧安全带（后端出画面时已把主体推到另一侧）
  durationInFrames: number // 本片段时长（帧），用于 Ken Burns 推拉落界
  videoVolume?: number // 视频素材自带音轨音量 0~1；缺省 0 = 静音（旁白独占声道）
}> = ({ visualType, visualSrc, scene, theme, overlayTheme, overlaySide, durationInFrames, videoVolume }) => {
  const hasMedia = !!visualSrc && (visualType === 'video' || visualType === 'image-kenburns')

  // 有实拍/静图素材：铺为底层；若同时有 scene，把精致组件（SceneStage overlay 模式）
  // 叠在画面上——实底卡片 + 阴影悬浮，跳过浅色光斑背景。这样成片是「实拍视频 + Remotion 组件」。
  // 组件只落在 overlaySide 那一侧的安全带里，不压画面主体（见 SceneStage 的 BAND 注释）。
  if (hasMedia) {
    return (
      <AbsoluteFill>
        {visualType === 'video' ? (
          <VideoLayer
            src={visualSrc!}
            span={durationInFrames}
            volume={Math.min(1, Math.max(0, videoVolume ?? 0))}
          />
        ) : (
          <ImageKenBurns src={visualSrc!} span={durationInFrames} />
        )}
        {scene ? (
          <SceneStage scene={scene} theme={overlayTheme || theme} overlay side={overlaySide} />
        ) : null}
      </AbsoluteFill>
    )
  }

  // 无实拍素材：走完整信息动画（浅底光斑背景版）；都没有则留空（上层背景色透出）
  if (scene) {
    return <SceneStage scene={scene} theme={theme} />
  }
  return null
}
