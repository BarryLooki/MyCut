"""
空镜画面来源的 provider 选择（compose_service 只跟这个门面打交道）。

两条并列路线，用环境变量 VIDEO_PROVIDER 切：

    minimax（默认）  MiniMax H3 文生视频 → 实拍级空镜，自带原生音轨
    collage          Gemini 图像 + Omni Flash 首尾帧 → 半调纸拼贴组装动画，强制无声
                     （产品化自 gbro-collage-broll skill，见 collage_service 顶部注释）

两个模块的对外函数签名完全同形，所以这里只做转发，不做适配。刻意**每次调用都重新读
环境变量**：改 VIDEO_PROVIDER 不用重启进程也能生效（桌面模式下任务跑在常驻线程里）。

配错名字不报错、退回 minimax —— 别为了一个笔误把整条成片赔掉（与各 provider 内部
「参数越界就夹回默认」的处理方式一致）。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from . import collage_service, minimax_service

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "minimax"
_PROVIDERS = {
    "minimax": minimax_service,
    "collage": collage_service,
}


def name() -> str:
    """当前 provider 名（日志/诊断用）。"""
    val = (os.environ.get("VIDEO_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    if val in _PROVIDERS:
        return val
    logger.warning("VIDEO_PROVIDER=%s 不认识（仅 %s），回退 %s",
                   val, "/".join(_PROVIDERS), DEFAULT_PROVIDER)
    return DEFAULT_PROVIDER


def _p():
    return _PROVIDERS[name()]


# —— 以下与 minimax_service / collage_service 的对外契约逐一同形 ——

def disabled() -> bool:
    return _p().disabled()


def enabled() -> bool:
    return _p().enabled()


def is_available() -> bool:
    return _p().is_available()


def clip_seconds() -> int:
    return _p().clip_seconds()


def audio_mode() -> str:
    return _p().audio_mode()


def narration_enabled() -> bool:
    return _p().narration_enabled()


def clip_volume() -> float:
    return _p().clip_volume()


def max_cost() -> Optional[float]:
    return _p().max_cost()


def estimate_cost(prompt: str, duration: Optional[int] = None, aspect: str = "16:9") -> Optional[float]:
    return _p().estimate_cost(prompt, duration=duration, aspect=aspect)


def get_cache_dir() -> Path:
    return _p().get_cache_dir()


def generate_clip(
    prompt: str,
    dest_dir: Path,
    duration: Optional[int] = None,
    aspect: str = "16:9",
    rel_prefix: str = "",
    cache_key: str = "",
) -> Optional[str]:
    return _p().generate_clip(
        prompt, dest_dir, duration=duration, aspect=aspect,
        rel_prefix=rel_prefix, cache_key=cache_key,
    )
