"""
半调纸拼贴空镜服务（gbro-collage-broll skill 的产品化 provider）。

链路：一句英文画面提示词 → 图像模型出一张 editorial halftone paper-collage 静帧（= 组装动画的
完成态尾帧）→ ffmpeg 取其纸面底色造一张纯色空首帧 → 视频模型做首尾帧插值，出一段「从空场
逐件组装」的定格动画 → 去音轨 → 落到 remotion/public/ 下，返回 staticFile 相对路径。

与 minimax_service（实拍空镜）**并列且同形**：对外暴露的函数签名一模一样，由
video_provider 按 VIDEO_PROVIDER 选一个给 compose_service 用。

两段各有两种引擎可选（2026-08-18 定的默认值，理由见下）：
  静帧 COLLAGE_STILL_ENGINE = openrouter（默认，若配了 OPENROUTER_API_KEY）/ gemini（直连）
  动画 COLLAGE_VIDEO_ENGINE = minimax（默认）/ omni（Gemini Omni Flash 首尾帧）
  **为什么默认不用 Gemini**：Gemini API 的免费层对图像模型和 Omni 视频的额度是 `limit: 0`
  （实测 429 明写），项目不开计费一张静帧都出不来。OpenRouter 能代理这些图像模型，
  但**没有任何视频输出模型**（拉过它 414 个模型的清单，output_modalities 含 video 的是 0 个），
  所以动画那段落到 MiniMax H3 —— 它的 v2 接口支持首尾帧（实测 content item 的 role
  接受 first_frame / last_frame），且项目已经在为实拍空镜付费，不用再多开一个账号。

出处与差异（重要，别当成 skill 的等价实现）：
  prompt 体系、配色规则、组装顺序、交付约束都来自 skill（~/.claude/skills/gbro-collage-broll）。
  但 skill 的**三个人工审批闸门（隐喻确认 / 静帧确认 / 才生成视频）在这里没有** ——
  全自动出片链路里留不住人工确认。代价是：错的隐喻或错的静帧会直接进视频生成、直接花钱。
  对应的省钱手段换成了：① 同句持久缓存不重生 ② COLLAGE_MAX_COST 累计上限 ③ 失败即降级。
  另外 skill 默认交付 9:16，这里默认跟 MyCut 的 Remotion 画布走 16:9（COLLAGE_ASPECT 可改）。

设计约束（与 minimax_service 一致）：
- **可选/可降级**：没配 key / 没装 SDK / 生成失败 / 超时，一律返回 None，绝不中断成片
  （上层回退 scene 信息动画）。
- **省钱**：同一句话的产物按内容 hash 持久缓存，命中不重生；可设累计成本上限。
- **配置走环境变量**：
    OPENROUTER_API_KEY    静帧走 OpenRouter 时必填
    GEMINI_API_KEY        静帧走 gemini 引擎 / 动画走 omni 引擎时必填
                          （也读 data/settings.json 的 gemini_api_key，与 LLM 那把共用）
    MINIMAX_API_KEY       动画走 minimax 引擎时必填（复用 minimax_service 的全部配置）
    COLLAGE_STILL_ENGINE  openrouter / gemini；留空自动挑（有 OpenRouter key 就用它）
    COLLAGE_VIDEO_ENGINE  minimax（默认）/ omni
    COLLAGE_IMAGE_MODEL   静帧模型；留空按内置候选表依次试（两种引擎各有一张表）
    COLLAGE_VIDEO_MODEL   omni 引擎的视频模型（默认 gemini-omni-flash-preview）
                          minimax 引擎用 MINIMAX_MODEL，不看这一项
    COLLAGE_ASPECT        画面比例（默认 16:9，跟 Remotion 画布一致）
    COLLAGE_DURATION      单段秒数（默认 5；minimax 引擎限 4~15，omni 限 3~10，越界夹回）
    COLLAGE_DISABLE       1/true 时全局停用拼贴空镜
    COLLAGE_PRICE_PER_SECOND / COLLAGE_PRICE_PER_STILL   估价单价，默认 0 = 不估价
    COLLAGE_MAX_COST      单条成片累计成本上限（需先设单价才生效）
    COLLAGE_KEEP_FRAMES   1/true 时保留中间帧（首帧/尾帧 PNG）便于排查，默认渲染完即删
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from ..core.path_utils import get_project_root, get_settings_file_path
from ..utils.ffmpeg_utils import get_ffmpeg_path
from . import minimax_service as _mm
from . import overlay_safe_zone

logger = logging.getLogger(__name__)

DEFAULT_VIDEO_MODEL = "gemini-omni-flash-preview"
DEFAULT_DURATION = 5
DEFAULT_ASPECT = "16:9"
DEFAULT_VIDEO_ENGINE = "minimax"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# 静帧模型候选：按「质量优先」依次尝试，某个名字不存在/无权限就换下一个。
# 两张表的名字都是 2026-08-18 用真 key 核过的（不是猜的）：
#   gemini 直连  → 拉 /v1beta/models 对过
#   openrouter   → 拉 openrouter.ai/api/v1/models 对过（output_modalities 含 image）
IMAGE_MODEL_CANDIDATES = [
    "gemini-3-pro-image",        # 质量最好，拼贴静帧首选
    "gemini-3.1-flash-image",    # 更便宜的 flash 档
    "gemini-2.5-flash-image",    # 老一代兜底
]
OR_IMAGE_MODEL_CANDIDATES = [
    "google/gemini-3-pro-image",
    "google/gemini-3.1-flash-image",
    "google/gemini-2.5-flash-image",
]

# 各视频引擎实际接受的秒数区间（都是真接口报错列出来的，别凭印象改）：
#   omni    与 skill 自带 generate_video.py 的校验一致
#   minimax H3 报错原文：supported durations: 4s...15s
DURATION_RANGES = {"omni": (3, 10), "minimax": (4, 15)}

# 比例 → 出片像素（16:9 对齐 Remotion 画布 1920×1080，见 remotion/src/Root.tsx）
_DIMS = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:3": (1440, 1080),
    "3:4": (1080, 1440),
}

# minimax 引擎的首尾帧要 base64 塞进 JSON 请求体，全尺寸 PNG 太大；
# 且它出片本来就是 768P，条件帧给到 720P 已经够。长边压到这个值（保持比例）。
MM_FRAME_LONG_SIDE = 1280

# skill 的色彩规则：一批画面「同设计语言、不同底色」，底色按语意挑。
# 这里做不到按语意挑（没有人工闸门），改成按句子 hash 稳定取——同句永远同色（缓存才有意义），
# 一条视频里的不同句子自然分散到不同底色。
PALETTE: List[Tuple[str, str, str]] = [
    # (中文名, 底色 hex, 点色描述)
    ("burnt orange", "#C2410C", "cream white and pale teal"),
    ("deep red", "#B91C1C", "cream white and mustard yellow"),
    ("mustard yellow", "#CA8A04", "cream white and ink black"),
    ("ink green", "#14532D", "cream white and warm ochre"),
    ("deep purple", "#4C1D95", "cream white and pale cyan"),
    ("teal green", "#0F766E", "cream white and burnt orange"),
]

STILL_TIMEOUT = 300            # 单张静帧的 HTTP 超时（图像模型比文本慢得多）
FILES_ACTIVE_TIMEOUT = 120     # omni：Files API 等文件转 ACTIVE 的上限（秒）
VIDEO_TIMEOUT = 900            # 单段视频生成的最长等待（秒）
DOWNLOAD_TIMEOUT = 300


class CollageNotReady(RuntimeError):
    """拼贴空镜未就绪（没配 key 或没装 google-genai）。"""


# —— 配置读取 ——

def _api_key() -> str:
    """
    Gemini 密钥：环境变量 GEMINI_API_KEY → data/settings.json 的 gemini_api_key。
    刻意和 LLM 那把 Gemini key 共用：同一个 Google 账号计费，用户只需配一次。
    """
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if key:
        return key
    try:
        path = get_settings_file_path()
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return str(data.get("gemini_api_key") or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.debug("读取 settings.json 里的 gemini_api_key 失败: %s", e)
    return ""


def _openrouter_key() -> str:
    return (os.environ.get("OPENROUTER_API_KEY") or "").strip()


def _still_engine() -> str:
    """
    静帧引擎。显式配了就用；没配则自动挑：有 OpenRouter key 用 openrouter，否则 gemini 直连。
    自动挑的理由：Gemini 免费层对图像模型是 limit: 0，多数人手上能用的是 OpenRouter。
    """
    val = (os.environ.get("COLLAGE_STILL_ENGINE") or "").strip().lower()
    if val in {"openrouter", "gemini"}:
        return val
    if val:
        logger.warning("COLLAGE_STILL_ENGINE=%s 不认识（仅 openrouter/gemini），改为自动判断", val)
    return "openrouter" if _openrouter_key() else "gemini"


def _video_engine() -> str:
    """动画引擎。默认 minimax（Gemini 那条要开计费，见模块注释）。"""
    val = (os.environ.get("COLLAGE_VIDEO_ENGINE") or "").strip().lower()
    if val in DURATION_RANGES:
        return val
    if val:
        logger.warning("COLLAGE_VIDEO_ENGINE=%s 不认识（仅 %s），回退 %s",
                       val, "/".join(DURATION_RANGES), DEFAULT_VIDEO_ENGINE)
    return DEFAULT_VIDEO_ENGINE


def _image_models() -> List[str]:
    explicit = (os.environ.get("COLLAGE_IMAGE_MODEL") or "").strip()
    if explicit:
        return [explicit]
    return list(OR_IMAGE_MODEL_CANDIDATES if _still_engine() == "openrouter" else IMAGE_MODEL_CANDIDATES)


def _video_model() -> str:
    """动画模型名（minimax 引擎复用 MINIMAX_MODEL，omni 引擎读 COLLAGE_VIDEO_MODEL）。"""
    if _video_engine() == "minimax":
        return _mm._model()
    return (os.environ.get("COLLAGE_VIDEO_MODEL") or DEFAULT_VIDEO_MODEL).strip()


def _aspect(aspect: str = "") -> str:
    """画面比例；不认的值回退 16:9（跟 Remotion 画布一致，别让笔误改了画幅）。"""
    val = (aspect or os.environ.get("COLLAGE_ASPECT") or DEFAULT_ASPECT).strip()
    if val in _DIMS:
        return val
    logger.warning("COLLAGE_ASPECT=%s 不支持（仅 %s），回退 %s",
                   val, "/".join(_DIMS), DEFAULT_ASPECT)
    return DEFAULT_ASPECT


def _dims(aspect: str) -> Tuple[int, int]:
    return _DIMS.get(aspect, _DIMS[DEFAULT_ASPECT])


def _frame_dims(aspect: str) -> Tuple[int, int]:
    """
    条件帧（首帧/尾帧）的像素。minimax 引擎要把帧 base64 进请求体，长边压到 1280 省体积；
    omni 引擎走 Files API 上传，直接用画布尺寸。两者都保持比例不变。
    """
    w, h = _dims(aspect)
    if _video_engine() != "minimax":
        return w, h
    long_side = max(w, h)
    if long_side <= MM_FRAME_LONG_SIDE:
        return w, h
    scale = MM_FRAME_LONG_SIDE / long_side
    # 编码器要偶数宽高
    return (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2)


def _clamp_duration(val: int) -> int:
    lo, hi = DURATION_RANGES[_video_engine()]
    return max(lo, min(hi, val))


def _duration() -> int:
    """默认单段秒数，按当前引擎的接受区间夹回。"""
    raw = (os.environ.get("COLLAGE_DURATION") or "").strip()
    try:
        val = int(raw) if raw else DEFAULT_DURATION
    except ValueError:
        val = DEFAULT_DURATION
    return _clamp_duration(val)


def clip_seconds() -> int:
    """单段空镜秒数（对外）。与 minimax_service 同形。"""
    return _duration()


def audio_mode() -> str:
    """
    拼贴成片是**强制无声**的（skill 的交付标准，出片后还会用 ffmpeg 再去一次音轨），
    所以这里恒为 off：不存在「原生音轨」可用，旁白必须由 TTS 提供。
    注意 minimax 引擎出的片自带原生音轨，正是靠 _strip_audio 去掉的，别以为这里是空操作。
    """
    return "off"


def narration_enabled() -> bool:
    """恒 True：画面无声，全靠 TTS 旁白撑时间轴。"""
    return True


def clip_volume() -> float:
    """传给 Remotion 的 videoVolume。无声素材恒 0。"""
    return 0.0


def _price_per_second() -> float:
    raw = (os.environ.get("COLLAGE_PRICE_PER_SECOND") or "").strip()
    try:
        return float(raw) if raw else 0.0
    except ValueError:
        return 0.0


def _price_per_still() -> float:
    raw = (os.environ.get("COLLAGE_PRICE_PER_STILL") or "").strip()
    try:
        return float(raw) if raw else 0.0
    except ValueError:
        return 0.0


def max_cost() -> Optional[float]:
    """单条成片累计成本上限。没设任何单价就返回 None（估不出成本，上限无从判断）。"""
    raw = (os.environ.get("COLLAGE_MAX_COST") or "").strip()
    if not raw or (_price_per_second() <= 0 and _price_per_still() <= 0):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _keep_frames() -> bool:
    return os.environ.get("COLLAGE_KEEP_FRAMES", "").strip().lower() in {"1", "true", "yes", "on"}


def disabled() -> bool:
    """是否被显式关闭（COLLAGE_DISABLE=1/true）。"""
    return os.environ.get("COLLAGE_DISABLE", "").strip().lower() in {"1", "true", "yes", "on"}


def enabled() -> bool:
    return not disabled()


def _sdk(min_version: Tuple[int, int] = (1, 0)):
    """
    懒加载 google-genai。omni 引擎用的 Interactions API 需要 >= 2.10.0；
    静帧走 gemini 直连只需 1.x（generate_content 老接口就有）。
    没装或版本过旧时抛 CollageNotReady → is_available() False → 整条自动回退信息动画，
    不会因为镜像还没重建就把成片打挂。
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:  # noqa: BLE001
        raise CollageNotReady(f"未安装 google-genai（需 >= {min_version[0]}.{min_version[1]}）: {e}") from e

    ver = getattr(genai, "__version__", "0")
    try:
        parts = [int(x) for x in str(ver).split(".")[:2]]
    except ValueError:
        parts = [0, 0]
    if parts < list(min_version):
        raise CollageNotReady(
            f"google-genai 版本过旧（{ver}），当前引擎需 >= {min_version[0]}.{min_version[1]}"
        )
    return genai, types


def _check_ready() -> None:
    """按当前两个引擎检查密钥/依赖，不满足抛 CollageNotReady。不发任何网络请求。"""
    still, video = _still_engine(), _video_engine()

    if still == "openrouter":
        if not _openrouter_key():
            raise CollageNotReady("静帧引擎 openrouter 缺 OPENROUTER_API_KEY")
    else:
        if not _api_key():
            raise CollageNotReady("静帧引擎 gemini 缺 GEMINI_API_KEY（或 settings.json 的 gemini_api_key）")
        _sdk((1, 0))

    if video == "minimax":
        if not _mm._api_key():
            raise CollageNotReady("动画引擎 minimax 缺 MINIMAX_API_KEY")
    else:
        if not _api_key():
            raise CollageNotReady("动画引擎 omni 缺 GEMINI_API_KEY")
        _sdk((2, 10))


def is_available() -> bool:
    """
    当前引擎组合的密钥/依赖齐了就算可用。刻意不发探活请求（没有免费 ping），
    真正的可用性由 generate_clip 失败降级来兜。
    """
    try:
        _check_ready()
    except CollageNotReady as e:
        logger.info("拼贴空镜不可用：%s", e)
        return False
    return True


def estimate_cost(prompt: str, duration: Optional[int] = None, aspect: str = DEFAULT_ASPECT) -> Optional[float]:
    """
    估算一段拼贴空镜的成本（不发请求、不花钱）：静帧单价 + 视频单价 × 秒数。
    两个单价都没配就返回 None（上层视为 0，不做上限保护）。
    """
    per_sec, per_still = _price_per_second(), _price_per_still()
    if per_sec <= 0 and per_still <= 0:
        return None
    return per_still + per_sec * (duration or _duration())


# —— prompt 组装（skill 的模板，填入本句的视觉命题与配色）——

def _palette_for(key: str) -> Tuple[str, str, str]:
    """按 key 的 hash 稳定取一套配色：同句永远同色（否则缓存失效、重复扣费）。"""
    h = int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16)
    return PALETTE[h % len(PALETTE)]


def _still_prompt(visual: str, aspect: str, color_name: str, color_hex: str, accents: str,
                  overlay_side: str = "") -> str:
    """
    Gate 2 的 imagegen prompt 模板（SKILL.md Phase 2），把一句视觉命题做成完成态静帧。

    overlay_side：这一侧要留成空纸面，给 Remotion 组件用（见 overlay_safe_zone）。
    空字符串 = 不预留，构图回到 skill 原来的「主体居中 70%」。
    """
    return f"""Use case: ads-marketing
Asset type: final still frame for a {aspect} image-to-video B-roll clip
Primary request: Create a finished editorial paper-collage image expressing {visual}
Scene/backdrop: perfectly flat {color_name} paper field {color_hex} with subtle uncoated paper fiber.
Style/medium: premium editorial stop-motion paper collage; black-and-white halftone photographic \
cut-outs mixed with selective {accents} colored cardstock.
Composition/framing: {overlay_safe_zone.collage_framing(overlay_side, aspect)}.
Materials/textures: visible printed halftone dots, crisp machine-cut edges, thin warm-cream paper \
keylines, soft low-opacity physical drop shadows.
Constraints: one single clear visual metaphor, readable at a glance, no clutter.
Avoid: no typography, no readable letters, no numerals, no logos, no watermark, no UI, no subtitles, \
no glossy 3D, no photoreal environment, no clutter."""


def _video_prompt(aspect: str, color_name: str, color_hex: str, overlay_side: str = "") -> str:
    """
    Gate 3 的动画 prompt 模板（SKILL.md Phase 3）：从空色场逐件组装到给定完成帧。
    首句按引擎换措辞：omni 的两帧是 input 里的 Image 1/2，minimax 的两帧带 first/last_frame role。
    """
    if _video_engine() == "minimax":
        opening = (f"Paper-collage stop-motion assembly. Start from the supplied empty first frame and "
                   f"end exactly on the supplied completed last frame. In one continuous locked-off "
                   f"shot, open on the empty flat {color_name} paper field.")
    else:
        opening = (f"Paper-collage stop-motion assembly, using Image 1 as the exact empty first frame "
                   f"and Image 2 as the exact completed last frame. In one continuous locked-off shot, "
                   f"open on the empty flat {color_name} paper field.")

    # 留白带的约束也要进动画 prompt：否则纸片会横穿空的那一侧滑进来，
    # 中途正好压在组件位置上（尾帧干净、过程脏，比全程都脏更难发现）。
    reserve = overlay_safe_zone.collage_assembly_hint(overlay_side)
    reserve_block = f"\n{reserve}\n" if reserve else ""

    return f"""{opening}

Assemble the scene piece by piece with crisp physical stop-motion timing: bring in the largest \
structural paper shapes first, then the main subject cut-outs, then the connecting pieces, then the \
final action and result. Each piece slides in and snaps into place. End by holding the supplied \
completed composition.
{reserve_block}
Preserve the exact {aspect} framing, {color_hex} color field, colored cardstock accents, uncoated \
paper grain, halftone dots, cream keylines, crisp cut edges and soft shadows. Restrained tactile 2D \
paper craft only.

No scene cuts, no camera movement, no zoom, no morphing, no new objects, no text, no letters, no \
numbers, no logos, no watermark, no UI, no sound."""


# —— ffmpeg 小工具 ——

def _run_ffmpeg(args: List[str], timeout: int = 120) -> bool:
    try:
        proc = subprocess.run(
            [get_ffmpeg_path(), "-y", *args],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout,
        )
        if proc.returncode != 0:
            logger.warning("ffmpeg 失败（%s）: %s", proc.returncode, (proc.stderr or "").strip()[-300:])
            return False
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg 异常: %s", e)
        return False


def _fit_frame(src: Path, dest: Path, width: int, height: int) -> bool:
    """把静帧统一到条件帧像素（等比放大后居中裁切，不留黑边）。"""
    return _run_ffmpeg([
        "-i", str(src),
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}",
        str(dest),
    ])


def _field_color(still: Path) -> str:
    """
    取静帧的纸面底色：裁左上角一块缩到 1×1 求平均（主体在画面中部，取角落最接近纯色场）。
    失败回退调色板给的 hex —— 首帧底色和尾帧差一点点不致命，但差太多会让组装动画突兀。
    """
    try:
        proc = subprocess.run(
            [get_ffmpeg_path(), "-y", "-i", str(still),
             "-vf", "crop=iw/8:ih/8:0:0,scale=1:1", "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30,
        )
        d = proc.stdout
        if len(d) >= 3:
            return f"#{d[0]:02X}{d[1]:02X}{d[2]:02X}"
    except Exception as e:  # noqa: BLE001
        logger.warning("取静帧底色失败: %s", e)
    return ""


def _flat_frame(dest: Path, hex_color: str, width: int, height: int) -> bool:
    """造一张纯色空首帧（组装动画的起点：空纸面）。"""
    color = "0x" + hex_color.lstrip("#")
    return _run_ffmpeg([
        "-f", "lavfi", "-i", f"color=c={color}:s={width}x{height}",
        "-frames:v", "1", str(dest),
    ])


def _strip_audio(src: Path, dest: Path) -> bool:
    """
    强制无声交付（skill 的规则）：即使 prompt 已写 no sound 也再去一次音轨，
    否则素材音轨会和 TTS 旁白打架（minimax 引擎出的片一定带原生音轨）。
    视频流直接 copy，不重编码。
    """
    return _run_ffmpeg(["-i", str(src), "-map", "0:v:0", "-c:v", "copy", "-an", str(dest)])


def _probe(path: Path) -> str:
    """出片后的轻量 QA：打一行实际宽高/帧率/时长，便于事后核对（不阻断）。"""
    try:
        from ..utils.ffmpeg_utils import get_ffprobe_path

        proc = subprocess.run(
            [get_ffprobe_path(), "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate,duration",
             "-of", "csv=p=0", str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30,
        )
        return (proc.stdout or "").strip()
    except Exception:  # noqa: BLE001
        return ""


# —— 静帧生成 ——

def _skip_to_next_model(err: str) -> bool:
    """这个错是「模型名/权限」问题（该换下一个候选）还是别的（值得换个 config 再试）。"""
    msg = err.lower()
    return any(k in msg for k in ("not found", "does not exist", "no endpoints", "permission",
                                  "not a valid model", "unsupported model"))


def _or_extract_image(payload: Dict[str, Any]) -> Optional[bytes]:
    """
    从 OpenRouter chat/completions 响应里挖出图片字节。
    它把图放在 choices[0].message.images[].image_url.url（data URI）；
    个别模型改放 message.content 的多模态数组里，两种都收。
    """
    def from_data_uri(url: str) -> Optional[bytes]:
        if not isinstance(url, str) or "base64," not in url:
            return None
        try:
            return base64.b64decode(url.split("base64,", 1)[1])
        except Exception:  # noqa: BLE001
            return None

    for choice in payload.get("choices") or []:
        msg = choice.get("message") or {}
        for item in msg.get("images") or []:
            data = from_data_uri(((item or {}).get("image_url") or {}).get("url") or "")
            if data:
                return data
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                data = from_data_uri((part.get("image_url") or {}).get("url") or "")
                if data:
                    return data
    return None


def _gen_still_openrouter(prompt: str, dest: Path, aspect: str) -> str:
    """
    OpenRouter 出静帧，返回实际用的模型名。失败抛异常（由 generate_clip 降级）。

    候选表逐个试；每个模型先带 image_config（比例）试一次，OpenRouter/模型不认这个字段
    就去掉重试 —— 比例丢了后面 ffmpeg 会裁，模型名和权限才是主要不确定项。
    """
    headers = {
        "Authorization": f"Bearer {_openrouter_key()}",
        "Content-Type": "application/json",
        # OpenRouter 建议带上，便于在它的用量面板里区分来源
        "HTTP-Referer": "https://mycut.icu",
        "X-Title": "MyCut collage b-roll",
    }
    last_err: Optional[str] = None

    for name in _image_models():
        for extra in ({"image_config": {"aspect_ratio": aspect}}, {}):
            body: Dict[str, Any] = {
                "model": name,
                "messages": [{"role": "user", "content": prompt}],
                "modalities": ["image", "text"],
                **extra,
            }
            try:
                r = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=STILL_TIMEOUT)
            except Exception as e:  # noqa: BLE001
                last_err = f"{name}: 网络异常 {e}"
                continue

            if r.status_code in (401, 403):
                # 认证/额度问题与具体模型无关，接着试另外 5 个组合是白费请求
                raise RuntimeError(f"OpenRouter 拒绝认证（HTTP {r.status_code}）：{r.text[:200]}")
            if r.status_code != 200:
                last_err = f"{name}: HTTP {r.status_code} {r.text[:300]}"
                if _skip_to_next_model(r.text):
                    break  # 模型名/权限问题，换下一个模型，别再试第二种 body
                continue

            try:
                payload = r.json()
            except Exception as e:  # noqa: BLE001
                last_err = f"{name}: 响应不是 JSON（{e}）{r.text[:200]}"
                continue

            # OpenRouter 会把上游错误塞在 200 响应的 error 字段里
            if isinstance(payload.get("error"), dict):
                last_err = f"{name}: {str(payload['error'])[:300]}"
                if _skip_to_next_model(str(payload["error"])):
                    break
                continue

            data = _or_extract_image(payload)
            if not data:
                last_err = f"{name}: 没返回图片数据（可能被安全策略拦了）{str(payload)[:200]}"
                continue

            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return name

    raise RuntimeError(f"静帧生成失败（openrouter，试过 {_image_models()}）: {last_err}")


def _gen_still_gemini(prompt: str, dest: Path, aspect: str) -> str:
    """Gemini 直连出静帧（备选引擎；免费层是 limit: 0，要开计费）。返回实际用的模型名。"""
    genai, types = _sdk((1, 0))
    client = genai.Client(api_key=_api_key())
    last_err: Optional[Exception] = None

    for name in _image_models():
        for cfg in (
            types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(aspect_ratio=aspect),
            ),
            types.GenerateContentConfig(response_modalities=["IMAGE"]),
        ):
            try:
                resp = client.models.generate_content(model=name, contents=[prompt], config=cfg)
            except Exception as e:  # noqa: BLE001
                last_err = e
                if _skip_to_next_model(str(e)):
                    break  # 模型名/权限问题，换下一个模型，别再试第二种 config
                continue

            data = None
            for cand in getattr(resp, "candidates", None) or []:
                content = getattr(cand, "content", None)
                for part in (getattr(content, "parts", None) or []):
                    inline = getattr(part, "inline_data", None)
                    if inline is not None and getattr(inline, "data", None):
                        data = inline.data
                        break
                if data:
                    break
            if not data:
                last_err = RuntimeError(f"{name} 没返回图片数据（可能被安全策略拦了）")
                continue

            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return name

    raise RuntimeError(f"静帧生成失败（gemini，试过 {_image_models()}）: {last_err}")


def _gen_still(prompt: str, dest: Path, aspect: str) -> str:
    if _still_engine() == "openrouter":
        return _gen_still_openrouter(prompt, dest, aspect)
    return _gen_still_gemini(prompt, dest, aspect)


# —— 动画生成（首尾帧插值）——

def _data_uri(path: Path) -> str:
    mime = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _gen_video_minimax(first: Path, last: Path, prompt: str, seconds: int, aspect: str, dest: Path) -> bool:
    """
    MiniMax H3 首尾帧插值，直接下载到 dest（含原生音轨，外层再去）。

    接口形状是 2026-08-18 用越界 duration 免费探出来的：content item 的 type 只接受
    text|image_url|video_url|audio_url；多张图时每个 item 必须带 role，first_frame /
    last_frame 是合法值。帧用 data URI 内联（没有公网可放图的地方）。
    """
    body: Dict[str, Any] = {
        "model": _mm._model(),
        "content": [
            {"type": "image_url", "role": "first_frame", "image_url": {"url": _data_uri(first)}},
            {"type": "image_url", "role": "last_frame", "image_url": {"url": _data_uri(last)}},
            {"type": "text", "text": prompt},
        ],
        "resolution": _mm._resolution(),
        "ratio": _mm._ratio(aspect),
        "duration": seconds,
    }
    resp = requests.post(
        f"{_mm._base_url()}/v2/video_generation",
        headers=_mm._headers(),
        json=body,
        timeout=_mm.REQUEST_TIMEOUT,
    )
    data = _mm._parse(resp)
    task_id = str(data.get("task_id") or data.get("id") or "").strip()
    if not task_id:
        raise RuntimeError(f"MiniMax 未返回 task_id: {str(data)[:200]}")

    url = _mm._wait_for_url(task_id)
    return _mm._download(url, dest, timeout=DOWNLOAD_TIMEOUT)


def _upload_frame(client, path: Path) -> Dict[str, str]:
    """omni：上传一帧到 Files API 并等它转 ACTIVE，返回 Interactions 用的 image item。"""
    f = client.files.upload(file=str(path))
    name = getattr(f, "name", None)
    deadline = time.time() + FILES_ACTIVE_TIMEOUT
    while name and str(getattr(f, "state", "")).upper().endswith("PROCESSING") and time.time() < deadline:
        time.sleep(2)
        f = client.files.get(name=name)
    state = str(getattr(f, "state", "")).upper()
    if state.endswith("FAILED"):
        raise RuntimeError(f"帧上传失败: {path.name} state={state}")
    return {
        "type": "image",
        "uri": getattr(f, "uri", ""),
        "mime_type": getattr(f, "mime_type", None) or "image/png",
    }


def _download_gemini(uri: str, dest: Path) -> bool:
    """下载 omni 成品（Files API 的 URI 要带 alt=media 和 x-goog-api-key）。"""
    sep = "&" if "?" in uri else "?"
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with requests.get(f"{uri}{sep}alt=media",
                          headers={"x-goog-api-key": _api_key()},
                          stream=True, timeout=DOWNLOAD_TIMEOUT) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    if chunk:
                        f.write(chunk)
        return dest.exists() and dest.stat().st_size > 0
    except Exception as e:  # noqa: BLE001
        logger.warning("下载拼贴视频失败 %s: %s", uri, e)
        return False


def _gen_video_omni(first: Path, last: Path, prompt: str, seconds: int, aspect: str, dest: Path) -> bool:
    """Gemini Omni Flash 首尾帧插值（备选引擎；免费层 limit: 0，要开计费）。"""
    genai, _types = _sdk((2, 10))
    client = genai.Client(api_key=_api_key())
    inputs = [_upload_frame(client, first), _upload_frame(client, last), {"type": "text", "text": prompt}]
    interaction = client.interactions.create(
        model=_video_model(),
        input=inputs,
        response_format={
            "type": "video",
            "aspect_ratio": aspect,
            "delivery": "uri",
            "duration": f"{seconds}s",
        },
    )
    out = getattr(interaction, "output_video", None)
    uri = getattr(out, "uri", "") if out else ""
    if not uri:
        raise RuntimeError(f"Omni 未返回视频 URI: {str(out)[:200]}")
    return _download_gemini(uri, dest)


def _gen_video(first: Path, last: Path, prompt: str, seconds: int, aspect: str, dest: Path) -> bool:
    if _video_engine() == "minimax":
        return _gen_video_minimax(first, last, prompt, seconds, aspect, dest)
    return _gen_video_omni(first, last, prompt, seconds, aspect, dest)


# —— 缓存与对外入口 ——

def _cache_name(cache_key: str, duration: int, aspect: str, overlay_side: str = "") -> str:
    """
    按 (两个引擎, 视频模型, 静帧模型集合, cache_key, 秒数, 比例, 留白侧) 内容 hash 命名。

    cache_key 应传**稳定的句子原文**，而非 LLM 生成的英文 prompt——后者每次都有细微差别，
    hash 每次都变，缓存永不命中、重复扣费。
    engine 进 hash：换引擎等于换画面质感，旧缓存不该被当成新引擎的产物复用。
    overlay_side 进 hash：留白在左还是在右是**两张不同构图**的图，
    同一句话换了侧别必须重生，否则组件会压在主体上（正是这次要修的问题）。
    """
    key = (f"{_still_engine()}|{_video_engine()}|{_video_model()}|{','.join(_image_models())}"
           f"|{cache_key}|{duration}|{aspect}|{overlay_safe_zone.normalize(overlay_side)}").encode("utf-8")
    return "cl_" + hashlib.sha1(key).hexdigest()[:16] + ".mp4"


def get_cache_dir() -> Path:
    """持久素材缓存目录（remotion/public/collage_cache/），与会被清理的 job 目录分离。"""
    return get_project_root() / "remotion" / "public" / "collage_cache"


def generate_clip(
    prompt: str,
    dest_dir: Path,
    duration: Optional[int] = None,
    aspect: str = DEFAULT_ASPECT,
    rel_prefix: str = "",
    cache_key: str = "",
    overlay_side: str = "",
) -> Optional[str]:
    """
    生成一段拼贴组装空镜并落到 dest_dir，返回相对 remotion/public/ 的 staticFile 路径。
    任何失败返回 None（上层回退信息动画）。命中持久缓存不重生（省钱）。

    Args:
        prompt: 英文画面提示词（video_prompt_service 产出，当作「一句话视觉命题」用）
        dest_dir: 本次成片的落地目录（remotion/public/compose/<job_id>/，渲染后会被清理）
        duration: 片段秒数（缺省用 COLLAGE_DURATION，默认 5；按引擎区间夹回）
        aspect: 画面比例（缺省 COLLAGE_ASPECT，默认 16:9）
        rel_prefix: 返回相对路径的前缀（如 'compose/<job_id>'）
        cache_key: 缓存键，应传**稳定的句子原文**。同 key 复用同一段视频。
        overlay_side: 'left'/'right' —— 这一侧留成空纸面，给 Remotion 组件让位
                      （见 overlay_safe_zone）。缺省/非法 = 不预留，主体居中。

    Returns:
        staticFile 相对路径（如 'compose/<job_id>/cl_xxx.mp4'）；失败 None
    """
    prompt = (prompt or "").strip()
    if not prompt:
        return None

    seconds = _clamp_duration(duration) if duration else _duration()
    ratio = _aspect(aspect)
    frame_w, frame_h = _frame_dims(ratio)
    side = overlay_safe_zone.normalize(overlay_side)

    key = (cache_key or "").strip() or prompt
    fname = _cache_name(key, seconds, ratio, side)
    dest = dest_dir / fname
    rel = f"{rel_prefix}/{fname}" if rel_prefix else fname
    cached = get_cache_dir() / fname

    # 1) 本 job 目录已有（同条视频内重复句）：直接复用
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("拼贴空镜 job 内命中，跳过生成: %s", fname)
        return rel

    # 2) 持久缓存命中（跨视频/重跑同一句）：复制到 job 目录，不生成、不扣费
    if cached.exists() and cached.stat().st_size > 0:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(cached, dest)
            logger.info("拼贴空镜持久缓存命中，跳过生成（省钱）: %s", fname)
            return rel
        except Exception as e:  # noqa: BLE001
            logger.warning("缓存复制失败，改为重新生成: %s", e)

    # 3) 未命中：真正生成（静帧 → 首尾帧 → 插值动画 → 去音轨）
    color_name, color_hex, accents = _palette_for(key)
    work = dest_dir / f".collage_{fname[:-4]}"
    raw_still = work / "last-frame-original.png"
    last_frame = work / "last-frame.png"
    first_frame = work / "first-frame.png"
    raw_video = work / "with-audio.mp4"

    try:
        _check_ready()

        # 3a) 静帧（= 组装动画的完成态尾帧）
        used = _gen_still(
            _still_prompt(prompt, ratio, color_name, color_hex, accents, side), raw_still, ratio
        )
        logger.info("拼贴静帧完成（engine=%s model=%s, %s, %s, 留白=%s）: %s",
                    _still_engine(), used, ratio, color_name, side or "无", raw_still.name)

        # 3b) 统一尾帧像素 + 造同底色的纯色空首帧
        if not _fit_frame(raw_still, last_frame, frame_w, frame_h):
            raise RuntimeError("尾帧裁切失败")
        if not _flat_frame(first_frame, _field_color(last_frame) or color_hex, frame_w, frame_h):
            raise RuntimeError("首帧生成失败")

        # 3c) 首尾帧插值出组装动画
        if not _gen_video(first_frame, last_frame,
                          _video_prompt(ratio, color_name, color_hex, side), seconds, ratio, raw_video):
            raise RuntimeError("视频生成/下载失败")

        # 3d) 强制无声交付
        if not _strip_audio(raw_video, dest):
            raise RuntimeError("去音轨失败")
    except CollageNotReady as e:
        logger.warning("拼贴空镜未就绪，回退: %s", e)
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("拼贴空镜生成失败，回退: %s", e)
        return None
    finally:
        if work.exists() and not _keep_frames():
            shutil.rmtree(work, ignore_errors=True)

    # 存一份到持久缓存，供以后同一句复用
    try:
        cache_dir = get_cache_dir()
        cache_dir.mkdir(parents=True, exist_ok=True)
        if not cached.exists():
            shutil.copy(dest, cached)
    except Exception as e:  # noqa: BLE001
        logger.warning("写入持久缓存失败（不影响本次）: %s", e)

    logger.info("拼贴空镜生成完成: %s（%s）", fname, _probe(dest) or "未探到流信息")
    return rel


if __name__ == "__main__":
    # 冒烟自测：python -m backend.services.collage_service
    # 真会调接口、真会扣费（一张静帧 + 一段最短秒数的视频）。
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if not is_available():
        print("✗ 未就绪，看上面日志（缺 key 或依赖）")
        sys.exit(1)
    out_dir = get_project_root() / "remotion" / "public" / "collage_smoke"
    test_prompt = ("a skilled editor trapped in an endless loop of manual cutting, "
                   "spending a full cycle of time to produce only one short strip of film")
    print(f"→ 静帧 {_still_engine()}:{_image_models()} / 动画 {_video_engine()}:{_video_model()} "
          f"/ {_aspect()} {_duration()}s / 条件帧 {_frame_dims(_aspect())}")
    result = generate_clip(test_prompt, out_dir, rel_prefix="collage_smoke", cache_key="collage-smoke-test")
    print(f"✓ 成功: {out_dir / Path(result).name}" if result else "✗ 失败，看上面日志")
