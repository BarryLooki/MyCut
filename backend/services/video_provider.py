"""
空镜画面来源的 provider 选择（compose_service 只跟这个门面打交道）。

用环境变量 VIDEO_PROVIDER 选，三种模式：

    minimax（默认）  整条都用 MiniMax H3 文生视频 → 实拍级空镜，自带原生音轨
    collage          整条都用半调纸拼贴组装动画 → 强制无声
                     （产品化自 gbro-collage-broll skill，见 collage_service 顶部注释）
    mixed            **按句混排**：video_prompt_service 逐句判 visual_style
                     （live→实拍 / collage→拼贴），同一条成片里两种画面交替出现

两个 provider 的对外函数签名完全同形，所以单一模式下这里只做转发，不做适配。刻意**每次调用都
重新读环境变量**：改 VIDEO_PROVIDER 不用重启进程也能生效（桌面模式下任务跑在常驻线程里）。

配错名字不报错、退回 minimax —— 别为了一个笔误把整条成片赔掉（与各 provider 内部
「参数越界就夹回默认」的处理方式一致）。

## mixed 模式下那些「整条级」的问题问谁

有些设定是整条视频一个值（旁白开不开、素材音轨音量、成本上限），混排时两个 provider 的答案
不一样，规则如下：

- **旁白恒开**。实拍的 MINIMAX_AUDIO_MODE=only 本意是"声音全交给 H3 原生音轨、不做 TTS"，
  但拼贴出的片子是无声的 —— 混排时若真关了 TTS，拼贴那些句会**彻底没声音**。所以 mixed 下
  强制 narration_enabled()=True，audio_mode() 把 only 报成 mix。
- **素材音轨音量取实拍那档**：拼贴文件本身零音轨，全局音量对它没有影响；真正要紧的是别把
  实拍句的原生环境音顺手关掉。需要逐句精确值的地方用 clip_volume_for(style)。
- **成本上限取两边里最紧的那个**：MINIMAX_MAX_COST / COLLAGE_MAX_COST 谁小听谁的，
  混排时两种花费都记在同一本账上（compose_service 累加），上限当然要按更严的算。
- **可用性取并集**：只要有一个 provider 就绪，混排就能出画面；某种风格的 provider 没就绪时，
  那些句子退给另一个 provider 出画面（有画面总比回退信息动画好），而不是整条放弃。
  ⚠ 但注意拼贴的**动画引擎默认就是 MiniMax**（拿它做首尾帧插值），所以 MINIMAX_API_KEY 一缺，
  两个 provider 会同时不可用 → 整条回退信息动画。混排不等于多了一条备用链路。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from . import collage_service, minimax_service

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "minimax"
MIXED = "mixed"
_PROVIDERS = {
    "minimax": minimax_service,
    "collage": collage_service,
}
# video_prompt_service 给的句子风格 → 用哪个 provider 出这句
_STYLE_PROVIDER = {
    "live": "minimax",
    "collage": "collage",
}
# mixed 下问「整条级」设定时的基准 provider（实拍是主轴，且只有它管原生音轨）
_BASE = "minimax"


def name() -> str:
    """当前模式名：minimax | collage | mixed（日志/诊断用）。"""
    val = (os.environ.get("VIDEO_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    if val in _PROVIDERS or val == MIXED:
        return val
    logger.warning("VIDEO_PROVIDER=%s 不认识（仅 %s/%s），回退 %s",
                   val, "/".join(_PROVIDERS), MIXED, DEFAULT_PROVIDER)
    return DEFAULT_PROVIDER


def is_mixed() -> bool:
    """是否按句混排。混排时 compose_service 要把每句的 visual_style 传下来。"""
    return name() == MIXED


def _p():
    """单一模式下的那个 provider；mixed 下是「整条级」问题的基准 provider。"""
    return _PROVIDERS[_BASE if is_mixed() else name()]


def provider_for_style(style: str = "") -> str:
    """
    这句该由哪个 provider 出画面（返回 provider 名）。

    非 mixed 模式：忽略 style，恒等于当前 provider —— 保证「配成单一 provider」时行为与
    加混排之前逐帧一致。
    mixed 模式：按 style 映射；映射到的那个没就绪（没配 key / 缺依赖）就退给另一个，
    两个都没就绪才返回基准值（此时上层的 is_available() 早就是 False 了，走不到这里）。
    """
    if not is_mixed():
        return name()
    want = _STYLE_PROVIDER.get((style or "").strip().lower(), _BASE)
    if _PROVIDERS[want].is_available():
        return want
    other = next((k for k in _PROVIDERS if k != want), _BASE)
    if _PROVIDERS[other].is_available():
        logger.warning("混排：风格 %s 该用 %s，但它未就绪，这句改用 %s 出画面。", style, want, other)
        return other
    return want


def _for_style(style: str = ""):
    return _PROVIDERS[provider_for_style(style)]


# —— 以下与 minimax_service / collage_service 的对外契约逐一同形 ——

def disabled() -> bool:
    # mixed：两个都被 *_DISABLE=1 关掉才算整条关闭
    if is_mixed():
        return all(p.disabled() for p in _PROVIDERS.values())
    return _p().disabled()


def enabled() -> bool:
    if is_mixed():
        return any(p.enabled() for p in _PROVIDERS.values())
    return _p().enabled()


def is_available() -> bool:
    # mixed：有一个就绪就能出画面（另一种风格的句子退给它）
    if is_mixed():
        return any(p.is_available() for p in _PROVIDERS.values())
    return _p().is_available()


def clip_seconds() -> int:
    return _p().clip_seconds()


def audio_mode() -> str:
    mode = _p().audio_mode()
    # mixed 下 only（不做 TTS）会让拼贴句彻底没声音，报成 mix
    if is_mixed() and mode == "only":
        return "mix"
    return mode


def narration_enabled() -> bool:
    # mixed 恒开：见模块顶部「旁白恒开」
    return True if is_mixed() else _p().narration_enabled()


def clip_volume() -> float:
    return _p().clip_volume()


def clip_volume_for(style: str = "") -> float:
    """这句素材自带音轨的音量。拼贴文件零音轨 → 0；实拍按 MINIMAX_AUDIO_MODE 那档。"""
    return _for_style(style).clip_volume()


def max_cost() -> Optional[float]:
    if is_mixed():
        # 两边都配了上限就取更严的那个；只配了一个就听它的；都没配 = 不做上限保护
        caps = [c for c in (p.max_cost() for p in _PROVIDERS.values()) if c is not None]
        return min(caps) if caps else None
    return _p().max_cost()


def estimate_cost(prompt: str, duration: Optional[int] = None, aspect: str = "16:9",
                  style: str = "") -> Optional[float]:
    return _for_style(style).estimate_cost(prompt, duration=duration, aspect=aspect)


def get_cache_dir() -> Path:
    return _p().get_cache_dir()


def generate_clip(
    prompt: str,
    dest_dir: Path,
    duration: Optional[int] = None,
    aspect: str = "16:9",
    rel_prefix: str = "",
    cache_key: str = "",
    style: str = "",
    overlay_side: str = "",
) -> Optional[str]:
    """
    生成一段空镜，返回 Remotion 用的相对路径；失败返回 None（该句由上层回退信息动画）。

    style 只在 mixed 模式下起作用（见 provider_for_style），单一模式下被忽略。
    overlay_side 两个 provider 都认（各自用自己的措辞把主体推到另一侧），见 overlay_safe_zone。
    """
    return _for_style(style).generate_clip(
        prompt, dest_dir, duration=duration, aspect=aspect,
        rel_prefix=rel_prefix, cache_key=cache_key, overlay_side=overlay_side,
    )
