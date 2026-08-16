import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { Scene, SceneTheme } from './SceneStage'
import { VisualStage, VisualType } from './VisualStage'
import { CN_FONT_STACK } from './fonts'

// 句间过渡时长（帧）。TransitionSeries 让相邻片段重叠这么多帧做交叉溶解；
// 总时长由 Root.tsx calcDuration 减去重叠帧算出，每句音频跟随自身片段，音画不失步。
// ~0.6s，丝滑从容的溶解（非 PPT 翻页/推屏）。
export const TRANSITION_FRAMES = 18

/**
 * 逐句字幕科普视频。
 * 结构：片头标题卡 → 逐句（上区信息动画 SceneStage + 下区口播字幕 + 配音）→ 片尾收束卡。
 *
 * 上区不再是静态 AI 图，而是按后端「视觉脚本」逐元素入场的信息动画
 * （关键词大字 / 图标 / 序号步骤 / 箭头 / 对比）。
 *
 * 配色不再写死：由后端 theme_service 按每条视频的内容调性生成一套主题（theme prop）
 * 传入——科技冷蓝 / 暖情橙 / 深墨财经…。后端已强制保证字幕对比度。
 * LLM 失败时后端回退 DESIGN.md 默认主题（单橙暖底）。
 */

export type CaptionSegment = {
  text: string
  audioSrc: string | null // 该句配音文件（staticFile 相对路径），可为 null（无配音）
  // 上区画面来源（素材混剪路线）。给了 visualType+visualSrc 就渲素材，否则回退 scene：
  //   'video'          实拍/生成的视频素材（OffthreadVideo）
  //   'image-kenburns' 静图 + 缓慢推拉
  //   'scene'/未指定    走结构化信息动画 scene
  visualType?: VisualType | null
  visualSrc?: string | null // 素材文件路径（相对 remotion/public/，或 http(s)/data）
  scene?: Scene | null // 该句的信息动画视觉脚本；null/空则上区留暖底
  overlayTheme?: SceneTheme | null // 实拍句叠加组件专用 theme（accent 取自视频主色，呼应画面）
  durationInFrames: number
  role?: string // hook | body | cta
}

// audioSrc 是相对 remotion/public/ 的 staticFile 路径；http(s)/data 原样用
const resolveSrc = (src: string): string =>
  /^(https?:|data:)/.test(src) ? src : staticFile(src)

// 字幕呈现样式。样式只决定「怎么显示字」，颜色一律从 theme 取（守 DESIGN.md 全单色+一抹橙）。
//   'classic'  一次性整句白字 + 柔阴影（默认，与历史产物逐帧一致）
//   'karaoke'  整句灰白打底，读到的字用 theme.accent 逐字点亮（按 时长/字数 匀速估算，非字级对齐）
export type CaptionStyle = 'classic' | 'karaoke'
export const DEFAULT_CAPTION_STYLE: CaptionStyle = 'classic'

export type CaptionedVideoProps = {
  title: string
  style?: string
  theme: SceneTheme
  segments: CaptionSegment[]
  titleDurationInFrames: number
  outroDurationInFrames: number
  // 字幕样式；缺省/非法值按 classic 处理，保证零回归
  captionStyle?: CaptionStyle
  // 实拍素材自带音轨的音量 0~1（MiniMax H3 出片带原生环境音）。
  // 缺省/0 = 静音，只留 TTS 旁白（历史行为）；后端按 MINIMAX_AUDIO_MODE 传值。
  videoVolume?: number
}

// 中文字体：显式加载的 Noto Sans SC（+ 系统字兜底），见 ./fonts
const FONT_STACK = CN_FONT_STACK

const TitleCard: React.FC<{ title: string; style?: string; theme: CaptionedVideoProps['theme'] }> = ({
  title,
  style,
  theme,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 } })
  const opacity = interpolate(enter, [0, 1], [0, 1])
  const translateY = interpolate(enter, [0, 1], [24, 0])

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_STACK,
        padding: '0 160px',
      }}
    >
      <div style={{ opacity, transform: `translateY(${translateY}px)`, textAlign: 'center' }}>
        {/* 顶部克制橙色小标记 */}
        <div
          style={{
            width: 56,
            height: 6,
            borderRadius: 999,
            backgroundColor: theme.accent,
            margin: '0 auto 40px',
          }}
        />
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            color: theme.ink,
            lineHeight: 1.25,
            letterSpacing: '1px',
          }}
        >
          {title}
        </div>
        {style ? (
          <div style={{ marginTop: 32, fontSize: 32, color: theme.sub, letterSpacing: '2px' }}>
            {style}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

// 画面卡：只负责上区视觉（实拍/静图/信息动画）+ 底部暗化渐变。
// 字幕不在这里——字幕单独走一条不参与转场的轨（见 CaptionTrack），避免句间 fade
// 转场时前后两句字幕在重叠帧里半透明叠加、互相遮挡。
const CaptionCard: React.FC<{
  segment: CaptionSegment
  theme: CaptionedVideoProps['theme']
  videoVolume?: number
}> = ({ segment, theme, videoVolume }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: FONT_STACK }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <VisualStage
          visualType={segment.visualType}
          visualSrc={segment.visualSrc}
          scene={segment.scene}
          theme={theme}
          overlayTheme={segment.overlayTheme}
          durationInFrames={segment.durationInFrames}
          videoVolume={videoVolume}
        />
      </AbsoluteFill>

      {/* 底部暗化渐变：统一都铺，保证任意画面（实拍/静图/信息动画）上白字字幕都清晰 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0) 48%, rgba(0,0,0,0.32) 70%, rgba(0,0,0,0.8) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  )
}

// 字幕容器：所有样式共用的定位/排版外框（压底稍偏下、居中、限宽），
// 各样式只负责容器内文字的呈现，位置口径一致，切换样式不跳位。
const CaptionBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ fontFamily: FONT_STACK }}>
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 90,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 200px',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: 1500,
          fontSize: 56,
          fontWeight: 600,
          lineHeight: 1.45,
          letterSpacing: '0.5px',
          textShadow: '0 2px 16px rgba(0,0,0,0.6)',
        }}
      >
        {children}
      </div>
    </div>
  </AbsoluteFill>
)

// classic：一次性显示整句，无淡入淡出。颜色统一白字 + 阴影。（历史默认，逐帧不变）
const ClassicCaption: React.FC<{ text: string }> = ({ text }) => (
  <CaptionBox>
    <span style={{ color: '#FFFFFF' }}>{text}</span>
  </CaptionBox>
)

// karaoke：整句灰白打底，随播放进度逐字用 theme.accent 点亮。
// 无字级时间戳（edge-tts 中文 WordBoundary 不可靠），故按 已播帧/总帧 × 字数 匀速估算亮到第几字。
// 已亮：accent 实色；未亮：半透明白（仍可读，形成"字随节奏往前推"的观感）。
const KaraokeCaption: React.FC<{ text: string; durationInFrames: number; accent: string }> = ({
  text,
  durationInFrames,
  accent,
}) => {
  const frame = useCurrentFrame()
  const chars = Array.from(text) // 按码点拆，兼容 emoji/组合字
  const progress = durationInFrames > 0 ? Math.min(1, Math.max(0, frame / durationInFrames)) : 1
  // 已点亮到第几个字（含）——四舍五入让最后一帧刚好全亮
  const lit = Math.round(progress * chars.length)
  return (
    <CaptionBox>
      {chars.map((ch, i) => (
        <span
          key={i}
          style={{
            color: i < lit ? accent : 'rgba(255,255,255,0.55)',
            transition: 'color 80ms ease-out',
          }}
        >
          {ch}
        </span>
      ))}
    </CaptionBox>
  )
}

// 字幕样式分发：按 captionStyle 选实现，非法/缺省回落 classic（零回归兜底）。
const CaptionText: React.FC<{
  text: string
  captionStyle: CaptionStyle
  durationInFrames: number
  accent: string
}> = ({ text, captionStyle, durationInFrames, accent }) => {
  if (captionStyle === 'karaoke') {
    return <KaraokeCaption text={text} durationInFrames={durationInFrames} accent={accent} />
  }
  return <ClassicCaption text={text} />
}

const OutroCard: React.FC<{ theme: CaptionedVideoProps['theme'] }> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 } })
  const opacity = interpolate(enter, [0, 1], [0, 1])

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.ink,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_STACK,
      }}
    >
      <div style={{ opacity, textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 600, color: theme.bg, letterSpacing: '2px' }}>
          感谢观看
        </div>
        <div style={{ marginTop: 24, fontSize: 28, color: theme.accent, letterSpacing: '6px' }}>
          MyCut
        </div>
      </div>
    </AbsoluteFill>
  )
}

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  title,
  style,
  theme,
  segments,
  titleDurationInFrames,
  outroDurationInFrames,
  captionStyle,
  videoVolume,
}) => {
  const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES })
  // 非法/缺省值回落 classic，守住零回归
  const activeCaptionStyle: CaptionStyle = captionStyle === 'karaoke' ? 'karaoke' : DEFAULT_CAPTION_STYLE

  // 字幕轨每句的起始帧与时长。TransitionSeries 让相邻片段重叠 TRANSITION_FRAMES 帧做转场，
  // 所以片头后第一句起点 = 片头时长 − 重叠帧；之后每句 = 前句起点 + 前句时长 − 重叠帧。
  // 字幕时长同样各减一个重叠帧，使相邻字幕区间首尾相接、不重叠 → 硬切、永不互相遮挡。
  const captionRanges: { from: number; duration: number }[] = []
  let cursor = titleDurationInFrames - TRANSITION_FRAMES
  segments.forEach((seg, i) => {
    // 除最后一句外，每句砍掉与下一句转场重叠的那段，避免两句字幕并存
    const trim = i < segments.length - 1 ? TRANSITION_FRAMES : 0
    captionRanges.push({ from: cursor, duration: Math.max(1, seg.durationInFrames - trim) })
    cursor += seg.durationInFrames - TRANSITION_FRAMES
  })

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* 画面轨：片头 / 逐句画面 / 片尾，句间 fade 丝滑溶解 */}
      <TransitionSeries>
        {/* 片头 */}
        <TransitionSeries.Sequence durationInFrames={titleDurationInFrames}>
          <TitleCard title={title} style={style} theme={theme} />
        </TransitionSeries.Sequence>

        {/* 片头 → 第一句：淡入 */}
        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        {/* 逐句：句与句之间用交叉溶解（fade），画面丝滑过渡，不是 PPT 式翻页/推屏 */}
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={seg.durationInFrames}>
              <CaptionCard segment={seg} theme={theme} videoVolume={videoVolume} />
              {seg.audioSrc ? <Audio src={resolveSrc(seg.audioSrc)} /> : null}
            </TransitionSeries.Sequence>
            {i < segments.length - 1 ? (
              <TransitionSeries.Transition presentation={fade()} timing={timing} />
            ) : null}
          </React.Fragment>
        ))}

        {/* 最后一句 → 片尾：淡入 */}
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={outroDurationInFrames}>
          <OutroCard theme={theme} />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* 字幕轨：独立于画面转场，按每句时间硬切显示，无淡入淡出、永不互相遮挡 */}
      {segments.map((seg, i) => {
        const r = captionRanges[i]
        return (
          <Sequence key={i} from={Math.max(0, r.from)} durationInFrames={r.duration}>
            {/* karaoke 用 useCurrentFrame（相对本 Sequence，从 0 起），进度基准 = 本 Sequence 时长 r.duration */}
            <CaptionText
              text={seg.text}
              captionStyle={activeCaptionStyle}
              durationInFrames={r.duration}
              accent={theme.accent}
            />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
