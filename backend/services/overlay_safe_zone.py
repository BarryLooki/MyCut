"""
叠加组件的「安全带」——生成画面时就把主体让开，别让 Remotion 组件挡住它。

## 为什么需要这个模块

成片里一句话的上区可能同时有两层：
  底层 = 画面素材（实拍空镜 / 半调纸拼贴，都是模型生成的）
  上层 = Remotion 信息组件（关键词卡 / 步骤 / 箭头 / 对比）

以前两层各自居中：拼贴静帧的模板写着 "central subject within the middle 70 percent"，
Remotion 的 overlay 又是 `justifyContent: center` —— 结果卡片正好盖在主体上，
画面里最该看清的那个隐喻（开关、手、纸片主体）被两张卡糊住，那段生成等于白花钱。

光改前端不够：把卡片挪到左边，主体还在正中，照样压。所以要**两头一起约束**：
  这里给出「留白侧」的构图指令 → 拼进图像/视频模型的 prompt，主体推到另一侧
  Remotion 只在留白侧的安全带里排版（remotion/src/SceneStage.tsx 的 BAND）

两边的百分比必须对得上，改一个要改另一个 —— 所以数字只写在这一处，
Remotion 那边的注释指回这里。

## 侧别谁定

compose_service 逐句分配（左右交替，见那边的 _overlay_sides）。它必须在**生成画面之前**
就定下来，因为侧别要进 prompt；也因此进了素材缓存键（同一句话换了侧别，是另一段素材，
不能复用旧文件）。
"""

from __future__ import annotations

# 留白侧占画面宽度的百分比。比 Remotion 安全带实际宽度（≈43.3%）略大，留一点余量。
RESERVE_PERCENT = 45
# 主体可用的那一侧
SUBJECT_PERCENT = 100 - RESERVE_PERCENT

LEFT = "left"
RIGHT = "right"
SIDES = (LEFT, RIGHT)


def normalize(side: str) -> str:
    """收敛外部传入的侧别；不认的值返回 ""（= 不预留，画面照旧居中构图）。"""
    val = (side or "").strip().lower()
    return val if val in SIDES else ""


def opposite(side: str) -> str:
    """留白在这一侧 → 主体该在哪一侧。侧别非法时返回 ""。"""
    side = normalize(side)
    if not side:
        return ""
    return RIGHT if side == LEFT else LEFT


def live_hint(side: str) -> str:
    """
    实拍空镜（MiniMax H3 文生视频）的构图约束，追加到画面提示词后面。
    侧别非法/为空时返回 ""（调用方原样用原 prompt，行为与加这个功能前一致）。
    """
    side = normalize(side)
    if not side:
        return ""
    return (
        f"Composition: place the main subject entirely in the {opposite(side)} "
        f"{SUBJECT_PERCENT} percent of the frame; keep the {side} {RESERVE_PERCENT} percent "
        f"of the frame as calm uncluttered negative space (open sky, plain wall, still water, "
        f"soft out-of-focus background) with no subject, no strong edges and no busy detail; "
        f"hold this framing for the whole shot"
    )


def collage_framing(side: str, aspect: str) -> str:
    """
    半调纸拼贴静帧的 Composition/framing 行。侧别为空时给回原来的居中版（零回归）。

    留白侧要求「完全空的纸面」而不只是"少放东西"：拼贴的纸片带硬边和投影，
    哪怕一角探进来，白底卡片压上去也会显脏。
    """
    side = normalize(side)
    if not side:
        return (
            f"{aspect} locked poster frame; central subject within the middle 70 percent; "
            f"generous clean color-field negative space; 3-6 large separable paper groups "
            f"for later assemble-from-empty animation"
        )
    return (
        f"{aspect} locked poster frame; place every paper element inside the {opposite(side)} "
        f"{SUBJECT_PERCENT} percent of the frame; the {side} {RESERVE_PERCENT} percent must stay "
        f"a completely empty flat paper field — no cut-outs, no halftone, no shadows, nothing "
        f"crossing into it (that band is reserved for graphics added later); the subject stays "
        f"fully visible and well composed inside its own {SUBJECT_PERCENT} percent, not squashed; "
        f"3-6 large separable paper groups for later assemble-from-empty animation"
    )


def collage_assembly_hint(side: str) -> str:
    """
    拼贴组装动画（首尾帧插值）的补充约束：整段都不许有纸片飞过留白带。
    否则纸片会从空的那一侧滑进来，中途正好压在卡片位置上。
    """
    side = normalize(side)
    if not side:
        return ""
    return (
        f"The {side} {RESERVE_PERCENT} percent of the frame stays an empty flat paper field for "
        f"the entire shot: no piece ever slides through it, rests in it or casts a shadow into it. "
        f"Every piece enters from the {opposite(side)} side or from outside the nearest edge."
    )
