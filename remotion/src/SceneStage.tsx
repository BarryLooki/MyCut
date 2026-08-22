import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { IconGlyph } from './icons'
import { CN_FONT_STACK } from './fonts'

/**
 * 信息动画舞台（自动成片上区）。
 *
 * 按后端 scene_service 生成的「视觉脚本」渲染这句话的信息动画：
 * 4 种版式 keyword / steps / arrow / compare，每个元素按 enterAt（秒）逐个入场，
 * 带弹入 + 上移 + 淡入动效。配色走 DESIGN.md 设计 token（由 theme 传入）。
 */

export type SceneTheme = {
  accent: string
  ink: string
  bg: string
  sub: string
  line: string
  card: string // 卡片底色（浅主题=白，深主题=略亮于 bg）
  muted: string // 弱化色（对比项的灰）
  accentSoft: string // 强调色的柔和背景（强调卡片底）
  onAccent: string // 放在 accent 上的文字色（序号圆内）
  dark?: boolean // 是否深色主题（影响投影深浅）
}

// 卡片统一投影：深主题用更深的投影，避免浅投影在深底上看不见
const cardShadow = (theme: SceneTheme) =>
  theme.dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 8px 24px rgba(26,26,25,0.06)'

export type SceneElement = {
  type: string
  text: string
  icon?: string
  enterAt: number // 相对本句开始的秒数
  emphasis?: boolean
}

export type Scene = {
  layout: 'keyword' | 'steps' | 'arrow' | 'compare'
  elements: SceneElement[]
}

/**
 * 叠加安全带（overlay 模式专用）。
 *
 * 组件叠在画面素材上时**绝不能压住画面主体**——拼贴（skill）那张静帧的纸片主体、
 * 实拍空镜的被摄物，都是这句话真正要给人看的东西，被卡片挡住就白生成了。
 * 解法是两头一起约束，不是只改前端：
 *   后端出画面时就把主体推到一侧、另一侧留大片干净负空间
 *     （collage_service._still_prompt / minimax_service._composition_hint）
 *   Remotion 这边只在留白那一侧的安全带里排版，永不居中
 * 侧别由后端逐句给（segment.overlaySide），两边用的是同一个口径。
 *
 * 带子刻意不占满高度：底部留出字幕区（字幕自 bottom:90 起，最多三行）。
 */
export type OverlaySide = 'left' | 'right'

// ⚠ widthPercent + edge 必须落在后端预留的留白带内：
//   后端 overlay_safe_zone.RESERVE_PERCENT = 45（画面宽的 45% 留白），
//   这里带子右缘 = (64 + 0.40×1920) / 1920 ≈ 43.3% < 45%，留 1.7% 余量。
//   改大任何一个数之前先把后端那个百分比一起改大，否则卡片会压到主体上。
const BAND = {
  widthPercent: 40, // 安全带宽度（画面宽的百分比）
  edge: 64, // 距画面外缘
  top: 60,
  bottom: 300, // 下边界，把字幕区整个让出来
}

const bandStyle = (side: OverlaySide): React.CSSProperties => ({
  position: 'absolute',
  top: BAND.top,
  bottom: BAND.bottom,
  width: `${BAND.widthPercent}%`,
  ...(side === 'right' ? { right: BAND.edge } : { left: BAND.edge }),
})

// 中文字体：显式加载的 Noto Sans SC（+ 系统字兜底），见 ./fonts
const FONT_STACK = CN_FONT_STACK

// 元素入场动画：从 enterAt 那一帧起，带弹性地「跳」入 + 上移 + 淡入。
// damping 调低 + stiffness 提高 → 有轻微回弹的活泼手感（不是平稳滑入）。
const useEnter = (enterAtSeconds: number) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const startFrame = Math.max(0, Math.round(enterAtSeconds * fps))
  const local = frame - startFrame
  const enter = spring({ frame: local, fps, config: { damping: 12, mass: 0.7, stiffness: 130 } })
  const appeared = local >= 0
  return {
    opacity: appeared ? interpolate(enter, [0, 1], [0, 1], { extrapolateRight: 'clamp' }) : 0,
    translateY: interpolate(enter, [0, 1], [40, 0], { extrapolateRight: 'clamp' }),
    scale: interpolate(enter, [0, 1], [0.8, 1]),
  }
}

// —— 关键词大字卡（可带图标）——
// band 模式（叠在画面上、挤在安全带里）：图标改放文字左侧成一行，尺寸整体收一档，
// 竖着排也不占高；全屏模式保持原来的「图标在上、大字在下、居中」。
const KeywordChip: React.FC<{ el: SceneElement; theme: SceneTheme; band: OverlaySide | null }> = ({
  el,
  theme,
  band,
}) => {
  const { opacity, translateY, scale } = useEnter(el.enterAt)
  const emph = !!el.emphasis
  const fg = emph ? theme.accent : theme.ink
  const inBand = band !== null
  const iconBox = inBand ? 84 : 132
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        display: 'flex',
        flexDirection: inBand ? 'row' : 'column',
        alignItems: 'center',
        gap: inBand ? 20 : 22,
        padding: inBand ? 0 : '0 24px',
      }}
    >
      {el.icon ? (
        <div
          style={{
            width: iconBox,
            height: iconBox,
            flexShrink: 0,
            borderRadius: inBand ? 22 : 30,
            backgroundColor: emph ? theme.accentSoft : theme.card,
            border: `1px solid ${theme.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: cardShadow(theme),
          }}
        >
          <IconGlyph name={el.icon} size={inBand ? 46 : 72} color={fg} strokeWidth={1.8} />
        </div>
      ) : null}
      <div
        style={{
          fontSize: inBand ? 44 : 64,
          fontWeight: 700,
          color: fg,
          letterSpacing: '1px',
          textAlign: inBand ? (band === 'right' ? 'right' : 'left') : 'center',
        }}
      >
        {el.text}
      </div>
    </div>
  )
}

const KeywordLayout: React.FC<{
  elements: SceneElement[]
  theme: SceneTheme
  band: OverlaySide | null
}> = ({ elements, theme, band }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      // band 模式竖着排并贴住画面外缘那侧，留白带才装得下
      flexDirection: band ? 'column' : 'row',
      alignItems: band ? (band === 'right' ? 'flex-end' : 'flex-start') : 'center',
      justifyContent: 'center',
      gap: band ? 30 : 72,
      flexWrap: 'wrap',
      fontFamily: FONT_STACK,
    }}
  >
    {elements.map((el, i) => (
      <KeywordChip key={i} el={el} theme={theme} band={band} />
    ))}
  </div>
)

// —— 序号步骤列表 ——
const StepsLayout: React.FC<{
  elements: SceneElement[]
  theme: SceneTheme
  band: OverlaySide | null
}> = ({ elements, theme, band }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: band ? 22 : 28,
      // band 模式外框已经是安全带，不能再吃 220px 内边距（会把字挤出带外）
      padding: band ? 0 : '0 220px',
      fontFamily: FONT_STACK,
    }}
  >
    {elements.map((el, i) => {
      const { opacity, translateY } = useEnter(el.enterAt)
      const emph = !!el.emphasis
      return (
        <div
          key={i}
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            display: 'flex',
            alignItems: 'center',
            gap: band ? 22 : 28,
          }}
        >
          <div
            style={{
              width: band ? 54 : 68,
              height: band ? 54 : 68,
              flexShrink: 0,
              borderRadius: 999,
              backgroundColor: theme.accent,
              color: theme.onAccent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: band ? 28 : 34,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {i + 1}
          </div>
          <div style={{ fontSize: band ? 40 : 52, fontWeight: 600, color: emph ? theme.accent : theme.ink }}>
            {el.text}
          </div>
        </div>
      )
    })}
  </div>
)

// —— 箭头流程：全屏左 → 右；band 模式改成上 ↓ 下（窄带里横着放不下两张卡）——
const ArrowNode: React.FC<{ el: SceneElement; theme: SceneTheme; band: OverlaySide | null }> = ({
  el,
  theme,
  band,
}) => {
  const { opacity, translateY, scale } = useEnter(el.enterAt)
  const emph = !!el.emphasis
  const fg = emph ? theme.accent : theme.ink
  const inBand = band !== null
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        // band 模式吃满带宽（竖排两张卡左右对齐），全屏模式各占约 460px
        ...(inBand ? { width: '100%', boxSizing: 'border-box' as const } : { flex: '0 1 460px' }),
        display: 'flex',
        flexDirection: inBand ? 'row' : 'column',
        alignItems: 'center',
        gap: 18,
        padding: inBand ? '24px 26px' : '40px 28px',
        borderRadius: inBand ? 22 : 28,
        backgroundColor: emph ? theme.accentSoft : theme.card,
        border: `1px solid ${theme.line}`,
        boxShadow: cardShadow(theme),
      }}
    >
      {el.icon ? (
        <IconGlyph name={el.icon} size={inBand ? 46 : 64} color={fg} strokeWidth={1.8} />
      ) : null}
      <div
        style={{
          fontSize: inBand ? 38 : 46,
          fontWeight: 700,
          color: fg,
          textAlign: inBand ? 'left' : 'center',
        }}
      >
        {el.text}
      </div>
    </div>
  )
}

/**
 * 取「两端对照」版式（arrow / compare）的两个元素，保证**不是同一个**。
 *
 * 原写法 `find(typeA) || elements[0]` 有个坑：一句话只剩**一个**元素、且它的 type 是 typeB 时，
 * find(typeA) 是 undefined，退到 elements[0] 又拿回同一个元素 —— 两端指向同一条数据，
 * 画面上就是两张一模一样的卡片（实测出现过："复述知识" 被画了两遍）。
 * 后端会丢弃同句里文字重复的元素（见 scene_service 去重），只剩一端是常态，必须防住。
 * 只剩一端时返回 [el, undefined]：调用方渲一张卡、不画箭头/分隔。
 */
const pickPair = (
  elements: SceneElement[],
  typeA: string,
  typeB: string,
): [SceneElement | undefined, SceneElement | undefined] => {
  const a = elements.find((e) => e.type === typeA)
  const b = elements.find((e) => e.type === typeB)
  if (a || b) {
    return [a || elements.find((e) => e !== b), b || elements.find((e) => e !== a)]
  }
  // 两端的 type 都没标（LLM 漏写/老数据）：按出现顺序取前两个
  return [elements[0], elements[1]]
}

const ArrowLayout: React.FC<{
  elements: SceneElement[]
  theme: SceneTheme
  band: OverlaySide | null
}> = ({ elements, theme, band }) => {
  const [from, to] = pickPair(elements, 'arrowFrom', 'arrowTo')
  // 箭头随 "to" 元素入场
  const arrowEnter = useEnter(to ? to.enterAt : 0)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: band ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: band ? 14 : 24,
        padding: band ? 0 : '0 120px',
        fontFamily: FONT_STACK,
      }}
    >
      {from ? <ArrowNode el={from} theme={theme} band={band} /> : null}
      {/* 只有一端时整块不渲染——否则是一支指向空气的箭头，且在安全带的竖排里还白占一段高度
          （后端会丢弃同句里文字重复的元素，只剩一端这事真会出现，见 scene_service 去重） */}
      {from && to ? (
        <div style={{ opacity: arrowEnter.opacity, flexShrink: 0 }}>
          {band ? (
            <svg width="60" height="72" viewBox="0 0 60 72" fill="none" stroke={theme.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
              <line x1="30" y1="8" x2="30" y2="60" />
              <path d="M16 48 L30 62 L44 48" />
            </svg>
          ) : (
            <svg width="120" height="60" viewBox="0 0 120 60" fill="none" stroke={theme.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
              <line x1="10" y1="30" x2="100" y2="30" />
              <path d="M88 16 L104 30 L88 44" />
            </svg>
          )}
        </div>
      ) : null}
      {to ? <ArrowNode el={to} theme={theme} band={band} /> : null}
    </div>
  )
}

// —— 对比：左错 / 右对 ——
const CompareCol: React.FC<{
  el: SceneElement
  kind: 'bad' | 'good'
  theme: SceneTheme
  band: OverlaySide | null
}> = ({ el, kind, theme, band }) => {
  const { opacity, translateY, scale } = useEnter(el.enterAt)
  const bad = kind === 'bad'
  const badge = bad ? theme.muted : theme.accent
  const inBand = band !== null
  const badgeBox = inBand ? 44 : 56
  return (
    <div
      style={{
        opacity: opacity * (bad ? 0.92 : 1), // 入场淡入 × 错项整体稍降
        transform: `translateY(${translateY}px) scale(${scale})`,
        // band 模式吃满带宽、内部横排（✗/✓ + 文字），像一条清单；全屏模式仍是左右两张大卡
        ...(inBand ? { width: '100%', boxSizing: 'border-box' as const } : { flex: '0 1 500px' }),
        display: 'flex',
        flexDirection: inBand ? 'row' : 'column',
        alignItems: 'center',
        gap: inBand ? 16 : 20,
        padding: inBand ? '22px 24px' : '44px 28px',
        borderRadius: inBand ? 22 : 28,
        backgroundColor: theme.card,
        border: `1.5px solid ${bad ? theme.line : theme.accent}`,
        boxShadow: cardShadow(theme),
      }}
    >
      <div
        style={{
          width: badgeBox,
          height: badgeBox,
          flexShrink: 0,
          borderRadius: 999,
          border: `2px solid ${badge}`,
          color: badge,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width={inBand ? 24 : 30} height={inBand ? 24 : 30} viewBox="0 0 24 24" fill="none" stroke={badge} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {bad ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <path d="M5 12.5 10 17.5 19 7" />
          )}
        </svg>
      </div>
      {el.icon ? (
        <IconGlyph
          name={el.icon}
          size={inBand ? 42 : 56}
          color={bad ? theme.sub : theme.ink}
          strokeWidth={1.8}
        />
      ) : null}
      <div
        style={{
          fontSize: inBand ? 36 : 44,
          fontWeight: 700,
          color: bad ? theme.sub : theme.ink,
          textAlign: inBand ? 'left' : 'center',
        }}
      >
        {el.text}
      </div>
    </div>
  )
}

const CompareLayout: React.FC<{
  elements: SceneElement[]
  theme: SceneTheme
  band: OverlaySide | null
}> = ({ elements, theme, band }) => {
  const [bad, good] = pickPair(elements, 'compareBad', 'compareGood')
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: band ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: band ? 18 : 40,
        padding: band ? 0 : '0 120px',
        fontFamily: FONT_STACK,
      }}
    >
      {bad ? <CompareCol el={bad} kind="bad" theme={theme} band={band} /> : null}
      {good ? <CompareCol el={good} kind="good" theme={theme} band={band} /> : null}
    </div>
  )
}

// —— 极淡的浮动背景光斑（让上区不空、有呼吸感，但绝不抢字） ——
// 帧驱动正弦漂移，确定可复现（不用随机）。三团 accent 大模糊圆缓慢游动。
const AmbientBackground: React.FC<{ theme: SceneTheme }> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps // 秒
  const blobs = [
    { baseX: 22, baseY: 30, r: 460, sp: 0.06, ph: 0, amp: 5 },
    { baseX: 78, baseY: 62, r: 520, sp: 0.05, ph: 2.1, amp: 6 },
    { baseX: 55, baseY: 20, r: 380, sp: 0.08, ph: 4.2, amp: 4 },
  ]
  const alpha = theme.dark ? 0.16 : 0.10
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {blobs.map((b, i) => {
        const dx = Math.sin(t * b.sp * Math.PI * 2 + b.ph) * b.amp
        const dy = Math.cos(t * b.sp * Math.PI * 2 + b.ph) * b.amp
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `calc(${b.baseX + dx}% - ${b.r / 2}px)`,
              top: `calc(${b.baseY + dy}% - ${b.r / 2}px)`,
              width: b.r,
              height: b.r,
              borderRadius: '50%',
              background: theme.accent,
              opacity: alpha,
              filter: 'blur(90px)',
            }}
          />
        )
      })}
    </div>
  )
}

export const SceneStage: React.FC<{
  scene: Scene
  theme: SceneTheme
  overlay?: boolean
  side?: OverlaySide | null // overlay 模式下组件落在哪一侧安全带（后端逐句给）
}> = ({ scene, theme, overlay = false, side }) => {
  const elements = scene.elements || []
  // overlay 模式一律进安全带，永不居中——居中就会压住画面主体（见 BAND 注释）。
  // 后端没给侧别（老 props.json 重渲）时默认落左侧：素材主体多半在中间偏右，
  // 靠边总比正中压脸好。
  const band: OverlaySide | null = overlay ? (side === 'right' ? 'right' : 'left') : null
  const layout = (() => {
    switch (scene.layout) {
      case 'steps':
        return <StepsLayout elements={elements} theme={theme} band={band} />
      case 'arrow':
        return <ArrowLayout elements={elements} theme={theme} band={band} />
      case 'compare':
        return <CompareLayout elements={elements} theme={theme} band={band} />
      case 'keyword':
      default:
        return <KeywordLayout elements={elements} theme={theme} band={band} />
    }
  })()

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* overlay 模式（叠在画面素材上）：跳过浮动光斑背景，只留悬浮卡片，避免弄脏画面 */}
      {overlay ? null : <AmbientBackground theme={theme} />}
      <div style={band ? bandStyle(band) : { position: 'absolute', inset: 0 }}>
        {elements.length === 0 ? null : layout}
      </div>
    </div>
  )
}
